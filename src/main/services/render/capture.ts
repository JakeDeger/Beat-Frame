import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'

const log = createLogger('capture')

/**
 * Render an HTML document in an offscreen BrowserWindow and capture it as a
 * PNG (with alpha) at an exact pixel size. Used for intro/outro cards and
 * thumbnails.
 */
export async function captureHtmlToPng(html: string, width: number, height: number, outPath: string): Promise<string> {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  try {
    win.webContents.setFrameRate(10)
    // Serve from a temp file — data: URLs choke on multi-MB embedded covers.
    const tmpHtml = path.join(app.getPath('temp'), `beatframe-card-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
    fs.writeFileSync(tmpHtml, html)
    try {
      await win.loadFile(tmpHtml)
      // Give layout/fonts/backdrop-filter a beat to settle.
      await delay(400)
      const image = await captureWithAlpha(win)
      const resized = image.getSize().width === width ? image : image.resize({ width, height })
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, resized.toPNG())
      return outPath
    } finally {
      fs.rmSync(tmpHtml, { force: true })
    }
  } catch (err) {
    log.error('card capture failed', err)
    throw new Error(`Failed to render the title card: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    win.destroy()
  }
}

export async function captureHtmlToJpeg(html: string, width: number, height: number, outPath: string, quality = 92): Promise<string> {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    frame: false,
    webPreferences: { offscreen: true, sandbox: false, backgroundThrottling: false }
  })
  try {
    win.webContents.setFrameRate(10)
    const tmpHtml = path.join(app.getPath('temp'), `beatframe-thumb-${Date.now()}.html`)
    fs.writeFileSync(tmpHtml, html)
    try {
      await win.loadFile(tmpHtml)
      await delay(400)
      const image = await win.webContents.capturePage()
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, image.toJPEG(quality))
      return outPath
    } finally {
      fs.rmSync(tmpHtml, { force: true })
    }
  } finally {
    win.destroy()
  }
}

/**
 * capturePage() flattens transparency on some platforms, so for alpha cards we
 * prefer the offscreen 'paint' event (BGRA with alpha) and fall back to
 * capturePage if no paint arrives in time.
 */
async function captureWithAlpha(win: BrowserWindow): Promise<Electron.NativeImage> {
  const viaPaint = new Promise<Electron.NativeImage>((resolve) => {
    win.webContents.once('paint', (_event, _dirty, image) => resolve(image))
    win.webContents.invalidate()
  })
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
  const painted = await Promise.race([viaPaint, timeout])
  if (painted) return painted
  return win.webContents.capturePage()
}

/** Read a local image file into a data: URI ('' when missing/unreadable). */
export function fileToDataUri(filePath: string | null | undefined): string {
  if (!filePath) return ''
  try {
    const buf = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mime =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
