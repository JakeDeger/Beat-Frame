import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import { EVENTS } from '@shared/ipc'
import type {
  AutomationItem,
  RenderJob,
  UploadJob,
  VideoMetadata,
  VideoMode
} from '@shared/types'
import { DEFAULT_SHORT, DEFAULT_TRIM } from '@shared/defaults'
import { JsonStore } from './store'
import { createLogger } from './logger'
import { broadcast, notify } from './events'
import { getSettings } from './settings'
import { extractMapId } from './beatsaver'
import { generateMetadata } from './metadata'
import { renderQueue } from './render/renderQueue'
import { uploadQueue } from './youtube/uploadQueue'
import { isSignedIn } from './youtube/auth'

const log = createLogger('automation')

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm'])
const SCHEDULER_TICK_MS = 30_000

interface AutomationState {
  items: AutomationItem[]
  /** fingerprint -> processed; skips files we've already handled */
  processedFiles: Record<string, boolean>
  /** "YYYY-MM-DD|slotId" -> fired */
  firedSlots: Record<string, boolean>
}

class AutomationService {
  private store: JsonStore<AutomationState> | null = null
  private watcher: FSWatcher | null = null
  private schedulerTimer: NodeJS.Timeout | null = null
  private watchedFolder: string | null = null

  init(): void {
    this.store = new JsonStore<AutomationState>('automation.json', {
      items: [],
      processedFiles: {},
      firedSlots: {}
    })
    // Items that were mid-render/upload when the app closed: re-evaluate.
    for (const item of this.items()) {
      if (item.status === 'rendering' || item.status === 'queued') {
        item.status = 'failed'
        item.error = 'Interrupted by app restart. Use Retry to run it again.'
      }
      if (item.status === 'uploading') {
        // The upload queue resumes pending uploads itself.
        item.status = 'ready_to_upload'
      }
    }
    this.persist()

    renderQueue.onJobDone((job) => this.onRenderDone(job))
    uploadQueue.onUploadDone((job) => this.onUploadDone(job))

    this.applySettings()
    this.schedulerTimer = setInterval(() => this.schedulerTick(), SCHEDULER_TICK_MS)
    // Prune old fired-slot records weekly-ish to keep the store tiny.
    this.pruneFiredSlots()
  }

  shutdown(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer)
    void this.watcher?.close()
  }

  /** (Re)start or stop the folder watcher based on current settings. */
  applySettings(): void {
    const auto = getSettings().automation
    const shouldWatch = auto.enabled && !!auto.inputFolder
    if (!shouldWatch || this.watchedFolder !== auto.inputFolder) {
      void this.watcher?.close()
      this.watcher = null
      this.watchedFolder = null
    }
    if (shouldWatch && !this.watcher) {
      if (!fs.existsSync(auto.inputFolder)) {
        try {
          fs.mkdirSync(auto.inputFolder, { recursive: true })
        } catch {
          notify('error', 'Automation', `Input folder does not exist: ${auto.inputFolder}`)
          return
        }
      }
      this.watchedFolder = auto.inputFolder
      this.watcher = chokidar.watch(auto.inputFolder, {
        ignoreInitial: false, // pick up files dropped while the app was closed
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 4000, pollInterval: 500 }
      })
      this.watcher.on('add', (filePath) => this.onFileDetected(filePath))
      this.watcher.on('error', (err) => log.error('watcher error', err))
      log.info(`watching ${auto.inputFolder}`)
    }
  }

  items(): AutomationItem[] {
    return this.store?.get().items ?? []
  }

  // -------------------------------------------------------------------------
  // Intake
  // -------------------------------------------------------------------------

  private onFileDetected(filePath: string): void {
    const ext = path.extname(filePath).toLowerCase()
    if (!VIDEO_EXTENSIONS.has(ext)) return

    const fingerprint = this.fingerprint(filePath)
    if (!fingerprint) return
    const state = this.store!.get()
    if (state.processedFiles[fingerprint]) return
    state.processedFiles[fingerprint] = true

    const auto = getSettings().automation
    const modes: VideoMode[] = auto.mode === 'both' ? ['longform', 'short'] : [auto.mode]
    const mapId = extractMapId(path.basename(filePath))

    for (const mode of modes) {
      const item: AutomationItem = {
        id: randomUUID(),
        filePath,
        fileName: path.basename(filePath),
        status: mapId ? 'detected' : 'needs_map_id',
        mapId,
        mode,
        renderJobId: null,
        uploadJobId: null,
        outputPath: null,
        thumbnailPath: null,
        metadata: null,
        error: null,
        detectedAt: Date.now(),
        updatedAt: Date.now()
      }
      state.items.push(item)
      log.info(`detected ${item.fileName} (${mode}), mapId=${mapId ?? 'unknown'}`)
      if (mapId) {
        this.startRender(item)
      }
    }
    if (!mapId) {
      notify(
        'warning',
        'Map ID needed',
        `Could not detect a BeatSaver ID for "${path.basename(filePath)}". Set it on the Automation page.`,
        true
      )
    }
    this.changed()
  }

  setMapId(itemId: string, mapId: string): void {
    const item = this.items().find((i) => i.id === itemId)
    if (!item) return
    item.mapId = mapId.trim().toLowerCase()
    item.error = null
    this.startRender(item)
    this.changed()
  }

  skip(itemId: string): void {
    const item = this.items().find((i) => i.id === itemId)
    if (!item) return
    if (item.renderJobId) renderQueue.cancel(item.renderJobId)
    item.status = 'skipped'
    item.updatedAt = Date.now()
    this.changed()
  }

  retry(itemId: string): void {
    const item = this.items().find((i) => i.id === itemId)
    if (!item) return
    item.error = null
    if (!item.mapId) {
      item.status = 'needs_map_id'
    } else if (!item.outputPath) {
      this.startRender(item)
    } else {
      item.status = 'ready_to_upload'
      this.maybeUploadNow(item)
    }
    this.changed()
  }

  /** Approve reviewed metadata (optionally edited) and queue for upload. */
  approve(itemId: string, metadata: VideoMetadata | null): void {
    const item = this.items().find((i) => i.id === itemId)
    if (!item || item.status !== 'awaiting_review') return
    if (metadata) item.metadata = metadata
    item.status = 'ready_to_upload'
    item.updatedAt = Date.now()
    this.maybeUploadNow(item)
    this.changed()
  }

  // -------------------------------------------------------------------------
  // Render stage
  // -------------------------------------------------------------------------

  private startRender(item: AutomationItem): void {
    const settings = getSettings()
    const auto = settings.automation
    if (!item.mapId) {
      item.status = 'needs_map_id'
      return
    }
    const job = renderQueue.enqueue({
      videoPath: item.filePath,
      mapId: item.mapId,
      mode: item.mode,
      playerName: settings.playerName,
      playerProfileUrl: settings.playerProfileUrl,
      outputFolder: settings.outputFolder,
      trim: { ...DEFAULT_TRIM },
      short: { ...DEFAULT_SHORT },
      generateThumbnail: auto.generateThumbnail
    })
    item.renderJobId = job.id
    item.status = 'queued'
    item.updatedAt = Date.now()
  }

  private onRenderDone(job: RenderJob): void {
    const item = this.items().find((i) => i.renderJobId === job.id)
    if (!item) return

    if (job.status !== 'completed') {
      if (job.status === 'cancelled') {
        if (item.status !== 'skipped') item.status = 'skipped'
      } else {
        item.status = 'failed'
        item.error = job.error ?? 'Render failed'
      }
      item.updatedAt = Date.now()
      this.changed()
      return
    }

    item.outputPath = job.outputPath
    item.thumbnailPath = job.thumbnailPath
    const settings = getSettings()
    if (job.map) {
      item.metadata = generateMetadata({
        map: job.map,
        player: job.player,
        playerName: settings.playerName,
        mode: item.mode,
        extraKeywords: settings.extraKeywords,
        channelName: settings.template.channelName
      })
    }

    const auto = settings.automation
    if (!auto.autoUpload) {
      item.status = 'awaiting_review'
      notify('info', 'Render ready', `"${item.fileName}" rendered. Review it on the Automation page.`)
    } else if (auto.requireReview) {
      item.status = 'awaiting_review'
      notify('info', 'Review needed', `"${item.fileName}" is rendered — review metadata before upload.`, true)
    } else {
      item.status = 'ready_to_upload'
      this.maybeUploadNow(item)
    }
    item.updatedAt = Date.now()
    this.changed()
  }

  // -------------------------------------------------------------------------
  // Upload stage
  // -------------------------------------------------------------------------

  /** Upload immediately unless the daily scheduler is responsible for timing. */
  private maybeUploadNow(item: AutomationItem): void {
    const settings = getSettings()
    if (!settings.automation.autoUpload) return
    if (settings.schedule.enabled) return // scheduler decides when
    this.startUpload(item)
  }

  private startUpload(item: AutomationItem): void {
    if (!item.outputPath || !item.metadata) {
      item.status = 'failed'
      item.error = 'Missing rendered output or metadata.'
      return
    }
    if (!isSignedIn()) {
      item.status = 'failed'
      item.error = 'Not signed in to YouTube. Connect your account in Settings, then Retry.'
      notify('error', 'Upload skipped', item.error, true)
      return
    }
    const auto = getSettings().automation
    const job = uploadQueue.enqueue({
      videoPath: item.outputPath,
      thumbnailPath: item.mode === 'longform' ? item.thumbnailPath : null,
      metadata: item.metadata,
      privacy: auto.defaultPrivacy,
      publishAt: null,
      playlistId: auto.playlistId,
      isShort: item.mode === 'short'
    })
    item.uploadJobId = job.id
    item.status = 'uploading'
    item.updatedAt = Date.now()
    this.changed()
  }

  private onUploadDone(job: UploadJob): void {
    const item = this.items().find((i) => i.uploadJobId === job.id)
    if (!item) return
    if (job.status === 'completed') {
      item.status = 'uploaded'
      item.updatedAt = Date.now()
      this.archive(item)
    } else if (job.status === 'failed') {
      item.status = 'failed'
      item.error = job.error ?? 'Upload failed'
      item.updatedAt = Date.now()
    }
    this.changed()
  }

  /** Move the original recording into the archive folder after upload. */
  private archive(item: AutomationItem): void {
    const auto = getSettings().automation
    if (!auto.archiveFolder) return
    // With mode "both", only archive when every sibling item is done.
    const siblings = this.items().filter((i) => i.filePath === item.filePath && i.id !== item.id)
    const allDone = siblings.every((s) => ['uploaded', 'archived', 'skipped', 'failed'].includes(s.status))
    if (!allDone) return
    try {
      if (!fs.existsSync(item.filePath)) return
      fs.mkdirSync(auto.archiveFolder, { recursive: true })
      let dest = path.join(auto.archiveFolder, item.fileName)
      let n = 2
      while (fs.existsSync(dest)) {
        const ext = path.extname(item.fileName)
        dest = path.join(auto.archiveFolder, `${path.basename(item.fileName, ext)} (${n})${ext}`)
        n++
      }
      fs.renameSync(item.filePath, dest)
      for (const sibling of [item, ...siblings]) {
        if (sibling.status === 'uploaded') sibling.status = 'archived'
      }
      log.info(`archived ${item.fileName} -> ${dest}`)
    } catch (err) {
      log.warn('archive failed', err)
    }
  }

  // -------------------------------------------------------------------------
  // Daily schedule
  // -------------------------------------------------------------------------

  private schedulerTick(): void {
    const settings = getSettings()
    if (!settings.schedule.enabled) return

    const now = new Date()
    // Local date key so slots roll over at local midnight, matching slot times.
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const slots: Array<{ id: string; time: string; mode: VideoMode }> = [
      { id: 'longform', time: settings.schedule.longformTime, mode: 'longform' as VideoMode },
      ...settings.schedule.shortsTimes.map((t, i) => ({ id: `short-${i}`, time: t, mode: 'short' as VideoMode }))
    ]

    const state = this.store!.get()
    for (const slot of slots) {
      const key = `${today}|${slot.id}`
      if (state.firedSlots[key]) continue
      if (!isTimeReached(now, slot.time)) continue
      state.firedSlots[key] = true

      const candidate = this.items()
        .filter((i) => i.status === 'ready_to_upload' && i.mode === slot.mode)
        .sort((a, b) => a.detectedAt - b.detectedAt)[0]
      if (candidate) {
        log.info(`schedule slot ${slot.id} firing for ${candidate.fileName}`)
        this.startUpload(candidate)
      } else if (settings.schedule.notifyOnEmptyQueue) {
        notify(
          'warning',
          'Upload queue empty',
          `No ${slot.mode === 'short' ? 'Short' : 'long-form video'} was ready for the ${slot.time} slot.`,
          true
        )
      }
    }
    this.persist()
  }

  private pruneFiredSlots(): void {
    const state = this.store!.get()
    const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    for (const key of Object.keys(state.firedSlots)) {
      if (key.slice(0, 10) < cutoff) delete state.firedSlots[key]
    }
    this.persist()
  }

  // -------------------------------------------------------------------------

  private fingerprint(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath)
      return `${path.basename(filePath)}|${stat.size}`
    } catch {
      return null
    }
  }

  private changed(): void {
    this.persist()
    broadcast(EVENTS.AUTOMATION_CHANGED, this.items())
  }

  private persist(): void {
    this.store?.set(this.store.get())
  }
}

/** True once local time has passed HH:MM today. */
export function isTimeReached(now: Date, hhmm: string): boolean {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return false
  const slotMinutes = Number(m[1]) * 60 + Number(m[2])
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes >= slotMinutes
}

export const automation = new AutomationService()
