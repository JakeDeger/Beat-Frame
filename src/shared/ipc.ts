/**
 * IPC channel names shared between main and renderer.
 * Grouped by feature; every channel is invoked via ipcRenderer.invoke unless
 * it is listed under EVENTS (main -> renderer pushes).
 */

export const IPC = {
  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Dialogs / shell
  DIALOG_PICK_VIDEO: 'dialog:pickVideo',
  DIALOG_PICK_FOLDER: 'dialog:pickFolder',
  DIALOG_PICK_IMAGE: 'dialog:pickImage',
  SHELL_OPEN_PATH: 'shell:openPath',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  SHELL_SHOW_IN_FOLDER: 'shell:showInFolder',

  // Probing / encoders
  VIDEO_PROBE: 'video:probe',
  ENCODERS_DETECT: 'encoders:detect',

  // BeatSaver / players
  BEATSAVER_LOOKUP: 'beatsaver:lookup',
  PLAYER_LOOKUP: 'player:lookup',

  // Render queue
  RENDER_ENQUEUE: 'render:enqueue',
  RENDER_CANCEL: 'render:cancel',
  RENDER_REMOVE: 'render:remove',
  RENDER_LIST: 'render:list',
  RENDER_CLEAR_FINISHED: 'render:clearFinished',

  // Metadata
  METADATA_GENERATE: 'metadata:generate',

  // Card previews
  CARD_PREVIEW: 'card:preview',

  // YouTube
  YT_AUTH_START: 'yt:authStart',
  YT_AUTH_STATUS: 'yt:authStatus',
  YT_SIGN_OUT: 'yt:signOut',
  YT_PLAYLISTS: 'yt:playlists',
  UPLOAD_ENQUEUE: 'upload:enqueue',
  UPLOAD_LIST: 'upload:list',
  UPLOAD_RETRY: 'upload:retry',
  UPLOAD_CANCEL: 'upload:cancel',
  UPLOAD_REMOVE: 'upload:remove',
  YT_INSIGHTS: 'yt:insights',
  YT_REFRESH_THUMBNAIL: 'yt:refreshThumbnail',

  // Automation
  AUTOMATION_STATUS: 'automation:status',
  AUTOMATION_ITEMS: 'automation:items',
  AUTOMATION_SET_MAP_ID: 'automation:setMapId',
  AUTOMATION_APPROVE: 'automation:approve',
  AUTOMATION_SKIP: 'automation:skip',
  AUTOMATION_RETRY: 'automation:retry',

  // App
  APP_VERSION: 'app:version',
  APP_CHECK_UPDATE: 'app:checkUpdate',
  APP_OPEN_LOGS: 'app:openLogs'
} as const

export const EVENTS = {
  RENDER_JOBS_CHANGED: 'event:renderJobsChanged',
  UPLOAD_JOBS_CHANGED: 'event:uploadJobsChanged',
  AUTOMATION_CHANGED: 'event:automationChanged',
  NOTIFICATION: 'event:notification',
  AUTH_CHANGED: 'event:authChanged'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS]
