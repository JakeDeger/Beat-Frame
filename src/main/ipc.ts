import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings, RenderRequest, UploadRequest, VideoMetadata } from '@shared/types'
import { getSettings, setSettings } from './services/settings'
import { getLogDirectory, createLogger } from './services/logger'
import { probeVideo } from './services/ffmpeg/probe'
import { detectEncoders, resetEncoderCache } from './services/ffmpeg/encoders'
import { resetBinaryCache } from './services/ffmpeg/paths'
import { lookupMap } from './services/beatsaver'
import { lookupPlayer } from './services/players'
import { generateMetadata, type MetadataInput } from './services/metadata'
import { renderQueue } from './services/render/renderQueue'
import { renderCardPreview, type PreviewKind } from './services/render/preview'
import { uploadQueue } from './services/youtube/uploadQueue'
import { startSignIn, signOut, isSignedIn } from './services/youtube/auth'
import { getMyChannel, listMyPlaylists } from './services/youtube/api'
import { automation } from './services/automation'
import { checkForUpdates } from './services/updates'

const log = createLogger('ipc')

/**
 * All handlers funnel errors into `{ ok: false, error }` results so the
 * renderer always gets a human-readable message instead of an opaque
 * "Error invoking remote method".
 */
type Result<T> = { ok: true; value: T } | { ok: false; error: string }

function handle<T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      const value = await fn(...(args as never[]))
      return { ok: true, value }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`${channel} failed: ${message}`)
      return { ok: false, error: message }
    }
  })
}

export function registerIpcHandlers(): void {
  // --- settings ---
  handle(IPC.SETTINGS_GET, () => getSettings())
  handle(IPC.SETTINGS_SET, (settings: AppSettings) => {
    const saved = setSettings(settings)
    resetBinaryCache()
    resetEncoderCache()
    automation.applySettings()
    return saved
  })

  // --- dialogs / shell ---
  handle(IPC.DIALOG_PICK_VIDEO, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose a Beat Saber recording',
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IPC.DIALOG_PICK_FOLDER, async (title: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: title || 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IPC.DIALOG_PICK_IMAGE, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IPC.SHELL_OPEN_PATH, (p: string) => shell.openPath(p))
  handle(IPC.SHELL_OPEN_EXTERNAL, (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened.')
    return shell.openExternal(url)
  })
  handle(IPC.SHELL_SHOW_IN_FOLDER, (p: string) => shell.showItemInFolder(p))

  // --- probing / encoders ---
  handle(IPC.VIDEO_PROBE, (filePath: string) => probeVideo(filePath))
  // force=true re-runs the (test-encode) hardware verification; plain loads use the cache.
  handle(IPC.ENCODERS_DETECT, (force: boolean) => detectEncoders(force === true))

  // --- metadata sources ---
  handle(IPC.BEATSAVER_LOOKUP, (mapId: string) => lookupMap(mapId))
  handle(IPC.PLAYER_LOOKUP, (profileUrl: string) => lookupPlayer(profileUrl))
  handle(IPC.METADATA_GENERATE, (input: MetadataInput) => generateMetadata(input))
  handle(IPC.CARD_PREVIEW, (kind: PreviewKind, mapId: string) => renderCardPreview(kind, mapId))

  // --- render queue ---
  handle(IPC.RENDER_ENQUEUE, (request: RenderRequest) => renderQueue.enqueue(request))
  handle(IPC.RENDER_CANCEL, (id: string) => renderQueue.cancel(id))
  handle(IPC.RENDER_REMOVE, (id: string) => renderQueue.remove(id))
  handle(IPC.RENDER_LIST, () => renderQueue.list())
  handle(IPC.RENDER_CLEAR_FINISHED, () => renderQueue.clearFinished())

  // --- YouTube ---
  handle(IPC.YT_AUTH_START, async () => {
    await startSignIn()
    return getMyChannel()
  })
  handle(IPC.YT_AUTH_STATUS, async () => {
    if (!isSignedIn()) return null
    try {
      return await getMyChannel()
    } catch {
      return null
    }
  })
  handle(IPC.YT_SIGN_OUT, () => signOut())
  handle(IPC.YT_PLAYLISTS, () => listMyPlaylists())
  handle(IPC.UPLOAD_ENQUEUE, (request: UploadRequest) => uploadQueue.enqueue(request))
  handle(IPC.UPLOAD_LIST, () => uploadQueue.list())
  handle(IPC.UPLOAD_RETRY, (id: string) => uploadQueue.retry(id))
  handle(IPC.UPLOAD_CANCEL, (id: string) => uploadQueue.cancel(id))
  handle(IPC.UPLOAD_REMOVE, (id: string) => uploadQueue.remove(id))

  // --- automation ---
  handle(IPC.AUTOMATION_ITEMS, () => automation.items())
  handle(IPC.AUTOMATION_STATUS, () => ({
    watching: getSettings().automation.enabled && !!getSettings().automation.inputFolder
  }))
  handle(IPC.AUTOMATION_SET_MAP_ID, (itemId: string, mapId: string) => automation.setMapId(itemId, mapId))
  handle(IPC.AUTOMATION_APPROVE, (itemId: string, metadata: VideoMetadata | null) =>
    automation.approve(itemId, metadata)
  )
  handle(IPC.AUTOMATION_SKIP, (itemId: string) => automation.skip(itemId))
  handle(IPC.AUTOMATION_RETRY, (itemId: string) => automation.retry(itemId))

  // --- app ---
  handle(IPC.APP_VERSION, () => app.getVersion())
  handle(IPC.APP_CHECK_UPDATE, () => checkForUpdates())
  handle(IPC.APP_OPEN_LOGS, () => shell.openPath(getLogDirectory()))
}
