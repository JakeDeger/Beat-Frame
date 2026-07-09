import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveFfmpegPath } from './paths'
import { createLogger } from '../logger'

const execFileAsync = promisify(execFile)
const log = createLogger('loudness')

/**
 * Audio-energy sampling used to find "intense" moments in a recording:
 * Shorts can auto-start at the loudest section, and the blurred card
 * backdrops prefer energetic gameplay over arbitrary footage.
 *
 * Strategy: measure the mean volume (ffmpeg volumedetect) of a handful of
 * evenly spaced candidate windows. Audio-only decoding runs at 100x+
 * realtime, so sampling ~6 windows adds well under a second of prep time.
 */

export interface LoudnessSearch {
  /** Search range start in the source file (seconds) */
  rangeStartSec: number
  /** Search range end (window must fit before this point) */
  rangeEndSec: number
  /** Window length to compare (seconds) */
  windowSec: number
  /** Number of evenly spaced candidates to sample */
  candidates?: number
}

/** Parse `mean_volume: -17.3 dB` from volumedetect stderr output. */
export function parseMeanVolume(output: string): number | null {
  const m = output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

/** Evenly spaced candidate offsets across [rangeStart, rangeEnd - window]. */
export function candidateOffsets(search: LoudnessSearch): number[] {
  const count = Math.max(2, search.candidates ?? 6)
  const last = search.rangeEndSec - search.windowSec
  if (!(last > search.rangeStartSec)) {
    return last >= 0 && search.rangeStartSec >= 0 ? [Math.max(0, Math.min(search.rangeStartSec, last))] : []
  }
  const step = (last - search.rangeStartSec) / (count - 1)
  return Array.from({ length: count }, (_, i) => Math.round((search.rangeStartSec + i * step) * 10) / 10)
}

async function measureMeanVolume(filePath: string, offsetSec: number, windowSec: number): Promise<number | null> {
  const ffmpeg = resolveFfmpegPath()
  if (!ffmpeg) return null
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        '-hide_banner', '-nostats',
        '-ss', String(offsetSec),
        '-t', String(windowSec),
        '-i', filePath,
        '-map', '0:a:0', '-vn',
        '-af', 'volumedetect',
        '-f', 'null', '-'
      ],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
    )
    return parseMeanVolume(stderr)
  } catch (err) {
    log.warn(`volume sample failed at ${offsetSec}s`, err instanceof Error ? err.message.split('\n')[0] : err)
    return null
  }
}

/**
 * Find the loudest window in the search range. Returns its start offset, or
 * null when the file has no measurable audio (caller falls back to defaults).
 */
export async function findLoudestOffset(filePath: string, search: LoudnessSearch): Promise<number | null> {
  const offsets = candidateOffsets(search)
  if (offsets.length === 0) return null
  const volumes = await Promise.all(offsets.map((o) => measureMeanVolume(filePath, o, search.windowSec)))
  let best: { offset: number; volume: number } | null = null
  for (let i = 0; i < offsets.length; i++) {
    const v = volumes[i]
    if (v !== null && (best === null || v > best.volume)) {
      best = { offset: offsets[i], volume: v }
    }
  }
  if (best) log.info(`loudest window @ ${best.offset}s (${best.volume} dB) of ${offsets.length} candidates`)
  return best?.offset ?? null
}
