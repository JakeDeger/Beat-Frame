import { app, BrowserWindow, screen, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerIpcHandlers } from './ipc'
import { createLogger } from './services/logger'
import { flushSettings } from './services/settings'
import { JsonStore } from './services/store'
import { renderQueue } from './services/render/renderQueue'
import { uploadQueue } from './services/youtube/uploadQueue'
import { automation } from './services/automation'

const log = createLogger('main')
// Works in both ESM and CJS bundles (Rollup shims import.meta.url for CJS).
const appDir = path.dirname(fileURLToPath(import.meta.url))

interface WindowState {
  width: number
  height: number
  x: number | undefined
  y: number | undefined
  maximized: boolean
}

let windowStore: JsonStore<WindowState> | null = null

function loadWindowState(): WindowState {
  windowStore ??= new JsonStore<WindowState>('window-state.json', {
    width: 1280,
    height: 820,
    x: undefined,
    y: undefined,
    maximized: false
  })
  const state = windowStore.get()
  // Ignore a saved position that's now off-screen (monitor unplugged etc.).
  if (state.x !== undefined && state.y !== undefined) {
    const onScreen = screen
      .getAllDisplays()
      .some((d) => state.x! >= d.bounds.x - 100 && state.x! < d.bounds.x + d.bounds.width && state.y! >= d.bounds.y - 100 && state.y! < d.bounds.y + d.bounds.height)
    if (!onScreen) return { ...state, x: undefined, y: undefined }
  }
  return state
}

function createWindow(): BrowserWindow {
  const state = loadWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
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

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize()
    win.show()
  })

  const persistBounds = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const bounds = win.getNormalBounds()
    windowStore?.set({ width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, maximized })
  }
  win.on('resized', persistBounds)
  win.on('moved', persistBounds)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)
  win.on('close', persistBounds)

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
