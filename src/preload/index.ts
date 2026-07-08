import { contextBridge, ipcRenderer } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function subscribe(channel: string, callback: (payload: unknown) => void): () => void {
  const listener = (_event: unknown, payload: unknown): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // settings
  getSettings: () => invoke(IPC.SETTINGS_GET),
  setSettings: (settings: unknown) => invoke(IPC.SETTINGS_SET, settings),

  // dialogs / shell
  pickVideo: () => invoke<string | null>(IPC.DIALOG_PICK_VIDEO),
  pickFolder: (title?: string) => invoke<string | null>(IPC.DIALOG_PICK_FOLDER, title ?? ''),
  pickImage: () => invoke<string | null>(IPC.DIALOG_PICK_IMAGE),
  openPath: (p: string) => invoke(IPC.SHELL_OPEN_PATH, p),
  openExternal: (url: string) => invoke(IPC.SHELL_OPEN_EXTERNAL, url),
  showInFolder: (p: string) => invoke(IPC.SHELL_SHOW_IN_FOLDER, p),

  // probing / encoders
  probeVideo: (path: string) => invoke(IPC.VIDEO_PROBE, path),
  detectEncoders: () => invoke(IPC.ENCODERS_DETECT),

  // metadata sources
  lookupMap: (mapId: string) => invoke(IPC.BEATSAVER_LOOKUP, mapId),
  lookupPlayer: (profileUrl: string) => invoke(IPC.PLAYER_LOOKUP, profileUrl),
  generateMetadata: (input: unknown) => invoke(IPC.METADATA_GENERATE, input),

  // render queue
  enqueueRender: (request: unknown) => invoke(IPC.RENDER_ENQUEUE, request),
  cancelRender: (id: string) => invoke(IPC.RENDER_CANCEL, id),
  removeRender: (id: string) => invoke(IPC.RENDER_REMOVE, id),
  listRenders: () => invoke(IPC.RENDER_LIST),
  clearFinishedRenders: () => invoke(IPC.RENDER_CLEAR_FINISHED),

  // youtube
  ytSignIn: () => invoke(IPC.YT_AUTH_START),
  ytAuthStatus: () => invoke(IPC.YT_AUTH_STATUS),
  ytSignOut: () => invoke(IPC.YT_SIGN_OUT),
  ytPlaylists: () => invoke(IPC.YT_PLAYLISTS),
  enqueueUpload: (request: unknown) => invoke(IPC.UPLOAD_ENQUEUE, request),
  listUploads: () => invoke(IPC.UPLOAD_LIST),
  retryUpload: (id: string) => invoke(IPC.UPLOAD_RETRY, id),
  cancelUpload: (id: string) => invoke(IPC.UPLOAD_CANCEL, id),
  removeUpload: (id: string) => invoke(IPC.UPLOAD_REMOVE, id),

  // automation
  automationItems: () => invoke(IPC.AUTOMATION_ITEMS),
  automationStatus: () => invoke(IPC.AUTOMATION_STATUS),
  automationSetMapId: (itemId: string, mapId: string) => invoke(IPC.AUTOMATION_SET_MAP_ID, itemId, mapId),
  automationApprove: (itemId: string, metadata: unknown) => invoke(IPC.AUTOMATION_APPROVE, itemId, metadata),
  automationSkip: (itemId: string) => invoke(IPC.AUTOMATION_SKIP, itemId),
  automationRetry: (itemId: string) => invoke(IPC.AUTOMATION_RETRY, itemId),

  // app
  appVersion: () => invoke<string>(IPC.APP_VERSION),
  checkForUpdates: () => invoke(IPC.APP_CHECK_UPDATE),
  openLogs: () => invoke(IPC.APP_OPEN_LOGS),

  // events
  onRenderJobsChanged: (cb: (jobs: unknown) => void) => subscribe(EVENTS.RENDER_JOBS_CHANGED, cb),
  onUploadJobsChanged: (cb: (jobs: unknown) => void) => subscribe(EVENTS.UPLOAD_JOBS_CHANGED, cb),
  onAutomationChanged: (cb: (items: unknown) => void) => subscribe(EVENTS.AUTOMATION_CHANGED, cb),
  onNotification: (cb: (n: unknown) => void) => subscribe(EVENTS.NOTIFICATION, cb),
  onAuthChanged: (cb: () => void) => subscribe(EVENTS.AUTH_CHANGED, () => cb())
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api
