import type {
  RenderSettings,
  ShortOptions,
  TemplateConfig,
  TrimOptions,
  VideoFileInfo,
  VideoMode
} from '@shared/types'

/**
 * Pure render-plan builder. Given the probed source, user options and the
 * pre-rendered title cards, it produces the complete ffmpeg argument list for
 * a SINGLE-PASS encode: trim + scale + intro/outro overlays + fades + audio
 * conditioning all happen in one filtergraph, so the gameplay itself is never
 * re-encoded twice and no intermediate files are written.
 *
 * Editing philosophy (deliberate): gameplay is untouched — no cuts, no zooms,
 * no speed changes. The only video operations are the intro/outro overlays at
 * the very edges and a fade-in/fade-out.
 */

export interface RenderPlanInput {
  source: VideoFileInfo
  mode: VideoMode
  trim: TrimOptions
  short: ShortOptions
  template: TemplateConfig
  render: RenderSettings
  /** Concrete ffmpeg encoder, e.g. "h264_nvenc" or "libx264" */
  encoderName: string
  introCardPath: string
  /** Only used in long-form mode */
  outroCardPath: string | null
  outputPath: string
}

export interface RenderPlan {
  args: string[]
  outputWidth: number
  outputHeight: number
  /** Duration of the final output in seconds */
  durationSec: number
  encoderName: string
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanError'
  }
}

const SHORT_MAX_DURATION = 180

// ---------------------------------------------------------------------------
// Output geometry
// ---------------------------------------------------------------------------

export function computeOutputDims(
  source: { width: number; height: number },
  mode: VideoMode,
  resolution: RenderSettings['resolution']
): { width: number; height: number } {
  if (mode === 'short') {
    // Vertical 9:16. "source"/"1080p" -> 1080x1920, 1440p -> 1440x2560, 4K -> 2160x3840.
    const h = resolution === '2160p' ? 3840 : resolution === '1440p' ? 2560 : 1920
    return { width: (h * 9) / 16, height: h }
  }
  if (resolution === 'source') {
    // Keep dimensions even for yuv420p.
    return { width: source.width - (source.width % 2), height: source.height - (source.height % 2) }
  }
  const targetH = resolution === '2160p' ? 2160 : resolution === '1440p' ? 1440 : 1080
  const aspect = source.width / source.height
  let width = Math.round((targetH * aspect) / 2) * 2
  if (width <= 0) width = Math.round((targetH * 16) / 9 / 2) * 2
  return { width, height: targetH }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface Timeline {
  /** Seek into the source file (seconds) */
  seekSec: number
  /** Output duration (seconds) */
  durationSec: number
  introDurationSec: number
  /** Time the outro card starts fading in; null when no outro */
  outroStartSec: number | null
}

export function computeTimeline(input: {
  sourceDurationSec: number
  mode: VideoMode
  trim: TrimOptions
  short: ShortOptions
  template: TemplateConfig
}): Timeline {
  const { sourceDurationSec, mode, trim, short, template } = input
  const trimStart = clamp(trim.trimStartSec, 0, Math.max(0, sourceDurationSec - 1))
  const trimEnd = clamp(trim.trimEndSec, 0, Math.max(0, sourceDurationSec - trimStart - 1))
  const available = sourceDurationSec - trimStart - trimEnd
  if (available < 5) {
    throw new PlanError('The trimmed video is shorter than 5 seconds — check the trim values.')
  }

  if (mode === 'short') {
    const startOffset = clamp(short.startOffsetSec, 0, Math.max(0, available - 5))
    const duration = clamp(short.durationSec, 5, Math.min(SHORT_MAX_DURATION, available - startOffset))
    const introDuration = clamp(Math.min(3.5, template.introDurationSec), 1.5, Math.min(5, duration / 3))
    return {
      seekSec: trimStart + startOffset,
      durationSec: round3(duration),
      introDurationSec: round3(introDuration),
      outroStartSec: null
    }
  }

  const introDuration = clamp(template.introDurationSec, 2, Math.min(15, available / 4))
  const outroDuration = clamp(template.outroDurationSec, 3, Math.min(20, available / 4))
  return {
    seekSec: trimStart,
    durationSec: round3(available),
    introDurationSec: round3(introDuration),
    outroStartSec: round3(available - outroDuration)
  }
}

// ---------------------------------------------------------------------------
// Filtergraph
// ---------------------------------------------------------------------------

function introCardFilter(timeline: Timeline, template: TemplateConfig, streamIn: string, streamOut: string): string {
  const introEnd = timeline.introDurationSec
  const fadeOutStart = round3(Math.max(0.5, introEnd - 0.7))
  let chain = `[${streamIn}]format=rgba,fade=t=in:st=0.25:d=0.6:alpha=1,fade=t=out:st=${fadeOutStart}:d=0.7:alpha=1`
  if (template.introStyle === 'zoom') {
    // Card is enlarged once; the overlay position drifts to fake a slow zoom.
    chain += `,scale=iw*1.06:ih*1.06`
  }
  chain += `[${streamOut}]`
  return chain
}

function introOverlayXY(template: TemplateConfig, introDurationSec: number): string {
  if (template.introStyle === 'slide-up') {
    // Ease-out slide from 3% below final position over the first 0.8 s.
    return `x=0:y='(H*0.03)*pow(1-min(t/0.8,1),3)'`
  }
  if (template.introStyle === 'zoom') {
    // 106%-sized card drifts from centered to slightly up-left across the intro.
    const d = round3(Math.max(1, introDurationSec))
    return `x='-(W*0.03)*(t/${d})':y='-(H*0.03)*(t/${d})'`
  }
  return 'x=0:y=0'
}

export function buildFilterGraph(input: {
  mode: VideoMode
  timeline: Timeline
  outputWidth: number
  outputHeight: number
  sourceFps: number
  frameRate: RenderSettings['frameRate']
  cropBias: number
  hasAudio: boolean
  normalizeAudio: boolean
  volumeGainDb: number
  template: TemplateConfig
  hasOutroCard: boolean
}): { graph: string; videoLabel: string; audioLabel: string | null } {
  const { mode, timeline, outputWidth, outputHeight, template } = input
  const parts: string[] = []
  const D = timeline.durationSec

  // --- base video ---
  let base = `[0:v]`
  if (mode === 'short') {
    // Center-ish crop to 9:16 with user bias (-1 left .. 1 right), then scale.
    const biasFactor = round3(clamp((input.cropBias + 1) / 2, 0, 1))
    base += `crop=w='min(iw,ih*9/16)':h=ih:x='(iw-ow)*${biasFactor}':y=0,`
  }
  base += `scale=${outputWidth}:${outputHeight}:flags=lanczos`
  if (input.frameRate !== 'source' && input.frameRate !== input.sourceFps) {
    base += `,fps=${input.frameRate}`
  }
  const fadeInDur = mode === 'short' ? 0.5 : 1.0
  base += `,setsar=1,fade=t=in:st=0:d=${fadeInDur}[base]`
  parts.push(base)

  // --- intro card ---
  parts.push(introCardFilter(timeline, template, '1:v', 'introcard'))
  parts.push(
    `[base][introcard]overlay=${introOverlayXY(template, timeline.introDurationSec)}:eof_action=pass[vintro]`
  )

  let lastVideo = 'vintro'

  // --- outro card (long-form only) ---
  if (input.hasOutroCard && timeline.outroStartSec !== null) {
    parts.push(
      `[2:v]format=rgba,fade=t=in:st=0:d=0.8:alpha=1,setpts=PTS+${round3(timeline.outroStartSec)}/TB[outrocard]`
    )
    parts.push(`[${lastVideo}][outrocard]overlay=x=0:y=0:eof_action=pass[voutro]`)
    lastVideo = 'voutro'
  }

  // --- final fade to black ---
  const fadeOutDur = mode === 'short' ? 0.8 : 1.2
  const fadeOutStart = round3(Math.max(0, D - fadeOutDur))
  parts.push(`[${lastVideo}]fade=t=out:st=${fadeOutStart}:d=${fadeOutDur},format=yuv420p[vout]`)

  // --- audio ---
  let audioLabel: string | null = null
  if (input.hasAudio) {
    const af: string[] = []
    if (input.normalizeAudio) af.push('loudnorm=I=-14:TP=-1.5:LRA=11')
    if (input.volumeGainDb !== 0) af.push(`volume=${round3(input.volumeGainDb)}dB`)
    af.push('afade=t=in:st=0:d=0.5')
    const aFadeOutDur = mode === 'short' ? 0.8 : 1.5
    af.push(`afade=t=out:st=${round3(Math.max(0, D - aFadeOutDur))}:d=${aFadeOutDur}`)
    parts.push(`[0:a]${af.join(',')}[aout]`)
    audioLabel = 'aout'
  }

  return { graph: parts.join(';'), videoLabel: 'vout', audioLabel }
}

// ---------------------------------------------------------------------------
// Encoder arguments
// ---------------------------------------------------------------------------

/** Auto video bitrate (kbps) used for encoders that need explicit rate control. */
export function autoBitrateKbps(height: number, encoderName: string): number {
  const base = height >= 2160 ? 45_000 : height >= 1440 ? 24_000 : 12_000
  const efficient = /hevc|265|av1/.test(encoderName)
  return efficient ? Math.round(base * 0.6) : base
}

export function encoderArgs(encoderName: string, quality: RenderSettings['quality'], explicitBitrateKbps: number, outputHeight: number): string[] {
  const q = quality
  const args: string[] = ['-c:v', encoderName]
  const bitrate = explicitBitrateKbps > 0 ? explicitBitrateKbps : 0

  const withBitrate = (kbps: number): string[] => [
    '-b:v',
    `${kbps}k`,
    '-maxrate',
    `${Math.round(kbps * 1.5)}k`,
    '-bufsize',
    `${kbps * 2}k`
  ]

  if (encoderName.endsWith('_nvenc')) {
    args.push('-preset', q === 'fast' ? 'p3' : q === 'balanced' ? 'p5' : 'p7')
    if (bitrate > 0) args.push(...withBitrate(bitrate))
    else args.push('-rc', 'vbr', '-cq', q === 'fast' ? '23' : q === 'balanced' ? '20' : '18', '-b:v', '0')
    args.push('-spatial-aq', '1')
  } else if (encoderName.endsWith('_amf')) {
    args.push('-quality', q === 'fast' ? 'speed' : q === 'balanced' ? 'balanced' : 'quality')
    args.push(...withBitrate(bitrate > 0 ? bitrate : autoBitrateKbps(outputHeight, encoderName)))
  } else if (encoderName.endsWith('_qsv')) {
    args.push('-preset', q === 'fast' ? 'faster' : q === 'balanced' ? 'medium' : 'slower')
    if (bitrate > 0) args.push(...withBitrate(bitrate))
    else args.push('-global_quality', q === 'fast' ? '24' : q === 'balanced' ? '21' : '19')
  } else if (encoderName === 'libx264') {
    args.push('-preset', q === 'fast' ? 'veryfast' : q === 'balanced' ? 'medium' : 'slow')
    if (bitrate > 0) args.push(...withBitrate(bitrate))
    else args.push('-crf', q === 'fast' ? '21' : q === 'balanced' ? '19' : '17')
  } else if (encoderName === 'libx265') {
    args.push('-preset', q === 'fast' ? 'faster' : q === 'balanced' ? 'medium' : 'slow')
    if (bitrate > 0) args.push(...withBitrate(bitrate))
    else args.push('-crf', q === 'fast' ? '24' : q === 'balanced' ? '22' : '20')
    args.push('-tag:v', 'hvc1')
  } else if (encoderName === 'libsvtav1') {
    args.push('-preset', q === 'fast' ? '9' : q === 'balanced' ? '7' : '5')
    args.push('-crf', q === 'fast' ? '32' : q === 'balanced' ? '28' : '24')
  } else if (encoderName === 'libaom-av1') {
    args.push('-cpu-used', q === 'fast' ? '8' : q === 'balanced' ? '6' : '4')
    args.push('-crf', q === 'fast' ? '32' : q === 'balanced' ? '28' : '24', '-b:v', '0')
  } else if (bitrate > 0) {
    args.push(...withBitrate(bitrate))
  }
  return args
}

/** Encoder to fall back to when a hardware encoder fails at runtime. */
export function softwareFallbackFor(encoderName: string): string | null {
  if (encoderName.startsWith('h264_')) return 'libx264'
  if (encoderName.startsWith('hevc_')) return 'libx265'
  if (encoderName.startsWith('av1_')) return 'libsvtav1'
  return null
}

// ---------------------------------------------------------------------------
// Full plan
// ---------------------------------------------------------------------------

export function buildRenderPlan(input: RenderPlanInput): RenderPlan {
  const { source, mode, template, render } = input
  const timeline = computeTimeline({
    sourceDurationSec: source.durationSec,
    mode,
    trim: input.trim,
    short: input.short,
    template
  })
  const dims = computeOutputDims(source, mode, render.resolution)
  const hasOutroCard = mode === 'longform' && !!input.outroCardPath

  const { graph, videoLabel, audioLabel } = buildFilterGraph({
    mode,
    timeline,
    outputWidth: dims.width,
    outputHeight: dims.height,
    sourceFps: source.fps,
    frameRate: render.frameRate,
    cropBias: input.short.cropBias,
    hasAudio: source.audioCodec !== null,
    normalizeAudio: render.normalizeAudio,
    volumeGainDb: render.volumeGainDb,
    template,
    hasOutroCard
  })

  const args: string[] = []
  // Input 0: gameplay (seek before -i for fast seeking; we re-encode anyway).
  if (timeline.seekSec > 0) args.push('-ss', String(round3(timeline.seekSec)))
  args.push('-t', String(round3(timeline.durationSec)), '-i', source.path)
  // Input 1: intro card (looped still).
  args.push('-loop', '1', '-framerate', '30', '-t', String(round3(timeline.introDurationSec + 0.1)), '-i', input.introCardPath)
  // Input 2: outro card.
  if (hasOutroCard && timeline.outroStartSec !== null) {
    const outroLen = round3(timeline.durationSec - timeline.outroStartSec + 0.1)
    args.push('-loop', '1', '-framerate', '30', '-t', String(outroLen), '-i', input.outroCardPath!)
  }

  args.push('-filter_complex', graph, '-map', `[${videoLabel}]`)
  if (audioLabel) {
    args.push('-map', `[${audioLabel}]`, '-c:a', 'aac', '-b:a', `${render.audioBitrateKbps}k`)
  } else {
    args.push('-an')
  }

  args.push(...encoderArgs(input.encoderName, render.quality, render.videoBitrateKbps, dims.height))
  args.push('-movflags', '+faststart', '-map_metadata', '-1', input.outputPath)

  return {
    args,
    outputWidth: dims.width,
    outputHeight: dims.height,
    durationSec: timeline.durationSec,
    encoderName: input.encoderName
  }
}

// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
