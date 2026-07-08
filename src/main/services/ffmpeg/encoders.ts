import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveFfmpegPath, resolveFfprobePath } from './paths'
import { createLogger } from '../logger'
import type { Codec, EncoderSupport, HwAccel } from '@shared/types'

const execFileAsync = promisify(execFile)
const log = createLogger('encoders')

/** Encoders we care about, in preference order per codec. */
const ENCODER_CANDIDATES = [
  'h264_nvenc',
  'hevc_nvenc',
  'av1_nvenc',
  'h264_amf',
  'hevc_amf',
  'av1_amf',
  'h264_qsv',
  'hevc_qsv',
  'av1_qsv',
  'libx264',
  'libx265',
  'libsvtav1',
  'libaom-av1'
] as const

let cache: EncoderSupport | null = null

export async function detectEncoders(force = false): Promise<EncoderSupport> {
  if (cache && !force) return cache
  const ffmpeg = resolveFfmpegPath()
  const result: EncoderSupport = {
    encoders: {},
    ffmpegVersion: null,
    ffmpegPath: ffmpeg,
    ffprobePath: resolveFfprobePath()
  }
  if (!ffmpeg) {
    cache = result
    return result
  }
  try {
    const [versionOut, encodersOut] = await Promise.all([
      execFileAsync(ffmpeg, ['-version'], { timeout: 10_000 }),
      execFileAsync(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
    ])
    result.ffmpegVersion = versionOut.stdout.split('\n')[0]?.replace('ffmpeg version ', '').split(' ')[0] ?? null
    for (const enc of ENCODER_CANDIDATES) {
      result.encoders[enc] = new RegExp(`\\s${escapeRegExp(enc)}\\s`).test(encodersOut.stdout)
    }
  } catch (err) {
    log.error('encoder detection failed', err)
  }
  cache = result
  return result
}

export function resetEncoderCache(): void {
  cache = null
}

/**
 * Pick the concrete ffmpeg encoder for a codec + hardware preference,
 * falling back to software when the requested hardware path is unavailable.
 * NOTE: `-encoders` listing only proves the build supports it; actual GPU
 * availability is verified at render time with automatic software fallback.
 */
export function pickEncoder(codec: Codec, hwAccel: HwAccel, support: EncoderSupport): string {
  const table: Record<Codec, Record<Exclude<HwAccel, 'auto' | 'none'>, string> & { software: string[] }> = {
    h264: { nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv', software: ['libx264'] },
    h265: { nvenc: 'hevc_nvenc', amf: 'hevc_amf', qsv: 'hevc_qsv', software: ['libx265'] },
    av1: { nvenc: 'av1_nvenc', amf: 'av1_amf', qsv: 'av1_qsv', software: ['libsvtav1', 'libaom-av1'] }
  }
  const entry = table[codec]
  const has = (name: string): boolean => support.encoders[name] === true

  if (hwAccel !== 'none') {
    const hwOrder: Array<Exclude<HwAccel, 'auto' | 'none'>> =
      hwAccel === 'auto' ? ['nvenc', 'qsv', 'amf'] : [hwAccel]
    for (const hw of hwOrder) {
      if (has(entry[hw])) return entry[hw]
    }
  }
  for (const sw of entry.software) {
    if (has(sw)) return sw
  }
  // Last resort: let ffmpeg error out with a clear message about the encoder.
  return entry.software[0]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
