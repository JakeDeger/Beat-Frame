import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerIpcHandlers } from './ipc'
import { createLogger } from './services/logger'
import { flushSettings } from './services/settings'
import { renderQueue } from './services/render/renderQueue'
import { uploadQueue } from './services/youtube/uploadQueue'
import { automation } from './services/automation'

const log = createLogger('main')
// Works in both ESM and CJS bundles (Rollup shims import.meta.url for CJS).
const appDir = path.dirname(fileURLToPath(import.meta.url))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0e17',
    title: 'BeatFrame Studio',
    webPreferences: {
      preload: path.join(appDir, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // External links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(appDir, '../renderer/index.html'))
  }
  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    log.info(`BeatFrame Studio ${app.getVersion()} starting`)
    registerIpcHandlers()
    renderQueue.init()
    uploadQueue.init()
    automation.init()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // The automation pipeline keeps running while the app lives in the
    // background on macOS; on Windows/Linux closing the window quits.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    automation.shutdown()
    flushSettings()
  })

  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', err)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', reason instanceof Error ? reason : String(reason))
  })
}
