/**
 * Drives the real BeatFrame Studio app under Xvfb via Playwright:
 *  1. screenshots every page
 *  2. renders real card previews (sample data + real BeatSaver map)
 *  3. runs a full end-to-end render through the app's own queue
 * Usage: xvfb-run -a node drive-app.mjs <projectRoot> <outDir> [videoPath]
 */
import { _electron } from 'playwright-core'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const [projectRoot, outDir, videoPathArg] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })

const log = (...a) => console.log('[drive]', ...a)

// Synthetic "gameplay" clip unless a real one is provided.
let videoPath = videoPathArg
if (!videoPath) {
  videoPath = path.join(outDir, 'gameplay [25f].mp4')
  if (!fs.existsSync(videoPath)) {
    log('generating synthetic gameplay clip…')
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100',
      '-af', "volume='0.1+0.9*abs(sin(t/6))':eval=frame",
      '-t', '75', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', videoPath
    ], { timeout: 180000 })
  }
}

const app = await _electron.launch({
  args: [projectRoot, '--no-sandbox', '--disable-gpu'],
  cwd: projectRoot,
  env: { ...process.env, NODE_ENV: 'production' }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2500)

const shoot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) })
  log('screenshot', name)
}

// --- 1. all pages ---
const pages = ['Home', 'Render Queue', 'Automation', 'Uploads', 'Templates', 'Settings']
for (const label of pages) {
  await page.click(`button.nav-item:has-text("${label}")`)
  await page.waitForTimeout(700)
  await shoot(label.toLowerCase().replace(/\s+/g, '-'))
}

// --- 2. card previews through the real pipeline ---
const previews = [
  ['intro', '', 'preview-intro-sample'],
  ['intro', '25f', 'preview-intro-real'],
  ['outro', '25f', 'preview-outro-real'],
  ['thumbnail', '25f', 'preview-thumb-real'],
  ['intro-short', '25f', 'preview-short-real']
]
for (const [kind, mapId, name] of previews) {
  try {
    const dataUri = await page.evaluate(
      ([k, id]) => window.api.cardPreview(k, id),
      [kind, mapId]
    )
    fs.writeFileSync(path.join(outDir, `${name}.${kind === 'thumbnail' ? 'jpg' : 'png'}`), Buffer.from(dataUri.split(',')[1], 'base64'))
    log('card preview OK:', name)
  } catch (err) {
    log('CARD PREVIEW FAILED:', name, String(err).slice(0, 400))
  }
}

// --- 3. full end-to-end render through the app queue ---
const request = {
  videoPath,
  mapId: '25f',
  mode: 'longform',
  playerName: 'TestPlayer',
  playerProfileUrl: '',
  outputFolder: path.join(outDir, 'renders'),
  trim: { trimStartSec: 0, trimEndSec: 0 },
  short: { startOffsetSec: 0, durationSec: 30, cropBias: 0, autoHighlight: true },
  generateThumbnail: true
}
log('enqueueing long-form render…')
await page.evaluate((req) => window.api.enqueueRender(req), request)

// also a Short with auto-highlight
log('enqueueing short render…')
await page.evaluate((req) => window.api.enqueueRender(req), { ...request, mode: 'short', generateThumbnail: false })

await page.click(`button.nav-item:has-text("Render Queue")`)

const deadline = Date.now() + 8 * 60 * 1000
let jobs = []
for (;;) {
  jobs = await page.evaluate(() => window.api.listRenders())
  const done = jobs.every((j) => ['completed', 'failed', 'cancelled'].includes(j.status))
  if (done || Date.now() > deadline) break
  await page.waitForTimeout(3000)
}
await page.waitForTimeout(500)
await shoot('queue-after-render')

for (const j of jobs) {
  log(`JOB ${j.request.mode}: status=${j.status} output=${j.outputPath} thumb=${j.thumbnailPath} error=${j.error ?? ''}`)
  log('  last logs:', JSON.stringify(j.logs.slice(-6)))
}

fs.writeFileSync(path.join(outDir, 'jobs.json'), JSON.stringify(jobs, null, 2))
await app.close()
log('DONE')
