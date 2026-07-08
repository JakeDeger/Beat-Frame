import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { EVENTS } from '@shared/ipc'
import type { BeatSaverMap, PlayerProfile, RenderJob, RenderRequest, TemplateConfig } from '@shared/types'
import { JsonStore } from '../store'
import { createLogger } from '../logger'
import { broadcast, notify } from '../events'
import { getSettings } from '../settings'
import { probeVideo } from '../ffmpeg/probe'
import { detectEncoders, pickEncoder } from '../ffmpeg/encoders'
import { runFfmpeg, isHardwareEncoderFailure, type FfmpegHandle } from '../ffmpeg/run'
import { buildRenderPlan, softwareFallbackFor, computeOutputDims } from './plan'
import { lookupMap, bestDifficulty } from '../beatsaver'
import { lookupPlayer, playerAvatarPath } from '../players'
import { introCardHtml, outroCardHtml, shortIntroCardHtml, thumbnailHtml, type CardData } from './cardsHtml'
import { captureHtmlToPng, captureHtmlToJpeg, fileToDataUri } from './capture'

const log = createLogger('render-queue')
const MAX_LOG_LINES = 200

type JobDoneListener = (job: RenderJob) => void

class RenderQueue {
  private jobs: RenderJob[] = []
  private active: { jobId: string; handle: FfmpegHandle } | null = null
  private processing = false
  private store: JsonStore<{ jobs: RenderJob[] }> | null = null
  private doneListeners = new Set<JobDoneListener>()
  private lastProgressBroadcast = 0

  init(): void {
    this.store = new JsonStore<{ jobs: RenderJob[] }>('render-queue.json', { jobs: [] })
    this.jobs = this.store.get().jobs ?? []
    // Jobs that were mid-flight when the app closed are marked failed.
    for (const job of this.jobs) {
      if (job.status === 'rendering' || job.status === 'preparing' || job.status === 'finalizing') {
        job.status = 'failed'
        job.error = 'Interrupted — the app was closed during this render.'
        job.finishedAt = Date.now()
      }
    }
    this.persist()
    void this.pump()
  }

  onJobDone(listener: JobDoneListener): () => void {
    this.doneListeners.add(listener)
    return () => this.doneListeners.delete(listener)
  }

  list(): RenderJob[] {
    return this.jobs
  }

  get(id: string): RenderJob | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  enqueue(request: RenderRequest): RenderJob {
    const job: RenderJob = {
      id: randomUUID(),
      request,
      status: 'queued',
      progress: { percent: 0, etaSeconds: null, fps: null, speed: null },
      logs: [],
      outputPath: null,
      thumbnailPath: null,
      map: null,
      player: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null
    }
    this.jobs.push(job)
    this.changed()
    void this.pump()
    return job
  }

  cancel(id: string): void {
    const job = this.get(id)
    if (!job) return
    if (job.status === 'queued') {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      this.changed()
    } else if (this.active?.jobId === id) {
      this.active.handle.cancel()
    }
  }

  remove(id: string): void {
    const job = this.get(id)
    if (!job) return
    if (job.status === 'rendering' || job.status === 'preparing' || job.status === 'finalizing') {
      this.cancel(id)
    }
    this.jobs = this.jobs.filter((j) => j.id !== id)
    this.changed()
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter(
      (j) => j.status !== 'completed' && j.status !== 'failed' && j.status !== 'cancelled'
    )
    this.changed()
  }

  // -------------------------------------------------------------------------

  private async pump(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      // Renders run strictly sequentially: parallel encodes fight over the GPU
      // and slow each other down.
      for (;;) {
        const next = this.jobs.find((j) => j.status === 'queued')
        if (!next) break
        await this.process(next)
      }
    } finally {
      this.processing = false
    }
  }

  private async process(job: RenderJob): Promise<void> {
    job.status = 'preparing'
    job.startedAt = Date.now()
    this.changed()
    try {
      const settings = getSettings()
      const req = job.request

      // 1. Probe input.
      const source = await probeVideo(req.videoPath)
      this.appendLog(job, `Probed: ${source.width}x${source.height} @ ${source.fps}fps, ${Math.round(source.durationSec)}s`)

      // 2. Metadata lookups (player is optional and non-fatal).
      const map = await lookupMap(req.mapId)
      job.map = map
      let player: PlayerProfile | null = null
      if (req.playerProfileUrl) {
        try {
          player = await lookupPlayer(req.playerProfileUrl)
          job.player = player
        } catch (err) {
          this.appendLog(job, `Player profile lookup failed (continuing): ${err instanceof Error ? err.message : err}`)
        }
      }
      this.changed()

      // 3. Render title cards at output resolution.
      const dims = computeOutputDims(source, req.mode, settings.render.resolution)
      const cardData = buildCardData(map, player, req.playerName, settings.template)
      const workDir = path.join(app.getPath('userData'), 'work', job.id)
      fs.mkdirSync(workDir, { recursive: true })

      const introHtml = req.mode === 'short' ? shortIntroCardHtml(cardData) : introCardHtml(cardData)
      const introCardPath = await captureHtmlToPng(introHtml, dims.width, dims.height, path.join(workDir, 'intro.png'))
      let outroCardPath: string | null = null
      if (req.mode === 'longform') {
        outroCardPath = await captureHtmlToPng(outroCardHtml(cardData), dims.width, dims.height, path.join(workDir, 'outro.png'))
      }
      this.appendLog(job, 'Title cards rendered')

      // 4. Build the ffmpeg plan.
      const support = await detectEncoders()
      let encoderName = pickEncoder(settings.render.codec, settings.render.hwAccel, support)
      const outputPath = this.outputPathFor(req, map)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })

      const makePlan = (encoder: string) =>
        buildRenderPlan({
          source,
          mode: req.mode,
          trim: req.trim,
          short: req.short,
          template: settings.template,
          render: settings.render,
          encoderName: encoder,
          introCardPath,
          outroCardPath,
          outputPath
        })

      // 5. Encode (with automatic software fallback if the GPU path fails).
      let plan = makePlan(encoderName)
      job.status = 'rendering'
      this.appendLog(job, `Encoding with ${encoderName} → ${plan.outputWidth}x${plan.outputHeight}`)
      this.changed()
      try {
        await this.runRender(job, plan.args, plan.durationSec)
      } catch (err) {
        const fallback = softwareFallbackFor(encoderName)
        if (!isCancellation(err) && fallback && isHardwareEncoderFailure(err)) {
          this.appendLog(job, `${encoderName} unavailable on this machine — retrying with ${fallback}`)
          notify('warning', 'GPU encoder unavailable', `Falling back to ${fallback} for this render.`)
          encoderName = fallback
          plan = makePlan(fallback)
          job.progress = { percent: 0, etaSeconds: null, fps: null, speed: null }
          this.changed()
          await this.runRender(job, plan.args, plan.durationSec)
        } else {
          throw err
        }
      }
      job.outputPath = outputPath

      // 6. Thumbnail.
      if (req.generateThumbnail) {
        job.status = 'finalizing'
        this.changed()
        try {
          const thumbPath = outputPath.replace(/\.mp4$/i, '') + '-thumbnail.jpg'
          await captureHtmlToJpeg(thumbnailHtml(cardData), 1280, 720, thumbPath)
          job.thumbnailPath = thumbPath
          this.appendLog(job, 'Thumbnail generated')
        } catch (err) {
          this.appendLog(job, `Thumbnail generation failed (continuing): ${err instanceof Error ? err.message : err}`)
        }
      }

      job.status = 'completed'
      job.finishedAt = Date.now()
      job.progress = { percent: 100, etaSeconds: 0, fps: null, speed: null }
      this.appendLog(job, `Done: ${outputPath}`)
      notify('success', 'Render complete', `${map.songName} (${req.mode === 'short' ? 'Short' : 'Long-form'}) is ready.`, true)
      this.cleanupWorkDir(workDir)
    } catch (err) {
      const cancelled = isCancellation(err)
      job.status = cancelled ? 'cancelled' : 'failed'
      if (!cancelled) {
        job.error = err instanceof Error ? err.message : String(err)
        log.error(`render job ${job.id} failed`, err)
        notify('error', 'Render failed', job.error.split('\n')[0], true)
      }
      job.finishedAt = Date.now()
    } finally {
      this.active = null
      this.changed()
      for (const listener of this.doneListeners) {
        try {
          listener(job)
        } catch (err) {
          log.error('job-done listener failed', err)
        }
      }
    }
  }

  private runRender(job: RenderJob, args: string[], durationSec: number): Promise<void> {
    const handle = runFfmpeg({
      args,
      totalDurationSec: durationSec,
      onProgress: (progress) => {
        job.progress = progress
        const now = Date.now()
        if (now - this.lastProgressBroadcast > 400) {
          this.lastProgressBroadcast = now
          this.changed(false)
        }
      },
      onLog: (line) => this.appendLog(job, line, false)
    })
    this.active = { jobId: job.id, handle }
    return handle.promise
  }

  private outputPathFor(req: RenderRequest, map: BeatSaverMap): string {
    const settings = getSettings()
    const folder = req.outputFolder || settings.outputFolder || path.join(app.getPath('videos'), 'BeatFrame Renders')
    const safeName = sanitizeFileName(`${map.songName} [${map.id}]`).slice(0, 120).trim()
    const suffix = req.mode === 'short' ? ' (Short)' : ''
    let candidate = path.join(folder, `${safeName}${suffix}.mp4`)
    let n = 2
    while (fs.existsSync(candidate)) {
      candidate = path.join(folder, `${safeName}${suffix} (${n}).mp4`)
      n++
    }
    return candidate
  }

  private appendLog(job: RenderJob, line: string, broadcastNow = true): void {
    job.logs.push(line)
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES)
    if (broadcastNow) this.changed(false)
  }

  private cleanupWorkDir(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* temp files; best-effort */
    }
  }

  private changed(persist = true): void {
    if (persist) this.persist()
    broadcast(EVENTS.RENDER_JOBS_CHANGED, this.serializable())
  }

  private persist(): void {
    // Trim logs before persisting to keep the file small.
    this.store?.set({ jobs: this.jobs.map((j) => ({ ...j, logs: j.logs.slice(-30) })) })
  }

  serializable(): RenderJob[] {
    return this.jobs
  }
}

function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Render cancelled')
}

export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ')
}

export function buildCardData(
  map: BeatSaverMap,
  player: PlayerProfile | null,
  playerNameOverride: string,
  template: TemplateConfig
): CardData {
  const diff = bestDifficulty(map.difficulties)
  return {
    songTitle: map.songName,
    songArtist: map.songAuthorName,
    mapper: map.levelAuthorName,
    difficulty: diff ? diff.difficulty : null,
    playerName: playerNameOverride || player?.name || '',
    coverDataUri: fileToDataUri(map.coverPath),
    avatarDataUri: player ? fileToDataUri(playerAvatarPath(player)) : '',
    logoDataUri: fileToDataUri(template.logoPath || null),
    template
  }
}

export const renderQueue = new RenderQueue()
