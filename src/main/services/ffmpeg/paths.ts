import fs from 'fs'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import { getSettings } from '../settings'
import { createLogger } from '../logger'

const require = createRequire(import.meta.url)
const log = createLogger('ffmpeg-paths')

let cachedFfmpeg: string | null | undefined
let cachedFfprobe: string | null | undefined

/**
 * Resolve the ffmpeg binary with the following priority:
 *  1. user-configured path in settings
 *  2. bundled ffmpeg-static binary (unpacked from asar in production)
 *  3. `ffmpeg` on PATH
 */
export function resolveFfmpegPath(): string | null {
  const configured = getSettings().render.ffmpegPath
  if (configured && fs.existsSync(configured)) return configured
  if (cachedFfmpeg !== undefined) return cachedFfmpeg
  cachedFfmpeg = resolveBundled('ffmpeg-static') ?? resolveOnPath('ffmpeg')
  return cachedFfmpeg
}

export function resolveFfprobePath(): string | null {
  const configured = getSettings().render.ffprobePath
  if (configured && fs.existsSync(configured)) return configured
  if (cachedFfprobe !== undefined) return cachedFfprobe
  cachedFfprobe = resolveBundledFfprobe() ?? resolveOnPath('ffprobe')
  return cachedFfprobe
}

/** Clear cached lookups (used after the user edits binary paths in settings). */
export function resetBinaryCache(): void {
  cachedFfmpeg = undefined
  cachedFfprobe = undefined
}

function fixAsarPath(p: string): string {
  // Binaries cannot be spawned from inside the asar archive; electron-builder
  // unpacks them to app.asar.unpacked (configured in electron-builder.yml).
  return p.replace('app.asar', 'app.asar.unpacked')
}

function resolveBundled(moduleName: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(moduleName) as string | null
    if (typeof mod === 'string') {
      const p = fixAsarPath(mod)
      if (fs.existsSync(p)) return p
    }
  } catch {
    log.warn(`${moduleName} not installed; falling back to system binary`)
  }
  return null
}

function resolveBundledFfprobe(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('ffprobe-static') as { path?: string }
    if (mod?.path) {
      const p = fixAsarPath(mod.path)
      if (fs.existsSync(p)) return p
    }
  } catch {
    log.warn('ffprobe-static not installed; falling back to system binary')
  }
  return null
}

function resolveOnPath(bin: string): string | null {
  try {
    const probe = spawnSync(bin, ['-version'], { timeout: 5000 })
    if (probe.status === 0) return bin
  } catch {
    /* not on PATH */
  }
  return null
}
