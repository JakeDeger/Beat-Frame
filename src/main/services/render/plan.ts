import type {
  RenderSettings,
  ShortOptions,
  TemplateConfig,
  TrimOptions,
  VideoFileInfo,
  VideoMode
} from '@shared/types'

/**
 * Pure render-plan builder producing a SINGLE-PASS ffmpeg invocation.
 *
 * Long-form structure (v1.4): three real sections joined by crossfades —
 *
 *   [ intro section ]  ~>  [ gameplay, untouched ]  ~>  [ end screen ]
 *    blurred clip of       full recording with its     blurred clip +
 *    the gameplay (or      own audio, no cuts, no      end card, audio
 *    black) + title card   effects, no retiming        faded to silence
 *
 * The gameplay's audio starts with the gameplay section (the intro is
 * musically silent, like a cold open) and every audio track in the source is
 * mixed together — OBS-style multi-track recordings previously played only
 * the first track, which is often empty.
 *
 * Shorts keep the compact overlay intro (a separate intro section would waste
 * precious seconds of a ≤3-minute vertical video).
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
  /** Blurred-gameplay backdrops; null = plain black behind the cards */
  backdrop: BackdropOffsets | null
  outputPath: string
}

export interface BackdropOffsets {
  /** Seek (seconds, in source time) of the clip behind the intro card */
  introOffsetSec: number
  /** Seek (seconds, in source time) of the clip behind the end screen */
  outroOffsetSec: number
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
/** Crossfade length at each section junction (long-form). */
export const XFADE_SEC = 0.5

// ---------------------------------------------------------------------------
// Output geometry
// ---------------------------------------------------------------------------

export function computeOutputDims(
  source: { width: number; height: number },
  mode: VideoMode,
  resolution: RenderSettings['resolution']
): { width: number; height: number } {
  if (mode === 'short') {
    const h = resolution === '2160p' ? 3840 : resolution === '1440p' ? 2560 : 1920
    return { width: (h * 9) / 16, height: h }
  }
  if (resolution === 'source') {
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
  /** Gameplay length used (seconds, after trim / Short windowing) */
  gameplaySec: number
  /** Intro section (long-form) or intro overlay (Shorts) length */
  introSec: number
  /** End-screen section length; 0 for Shorts */
  outroSec: number
  /** Final output duration */
  totalSec: number
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
    const intro = clamp(Math.min(3.5, template.introDurationSec), 1.5, Math.min(5, duration / 3))
    return {
      seekSec: round3(trimStart + startOffset),
      gameplaySec: round3(duration),
      introSec: round3(intro),
      outroSec: 0,
      totalSec: round3(duration)
    }
  }

  const intro = clamp(template.introDurationSec, 3, 15)
  const outro = clamp(template.outroDurationSec, 4, 20)
  return {
    seekSec: round3(trimStart),
    gameplaySec: round3(available),
    introSec: round3(intro),
    outroSec: round3(outro),
    // Sections overlap by one crossfade at each of the two junctions.
    totalSec: round3(intro + available + outro - 2 * XFADE_SEC)
  }
}

/**
 * Pick source positions for the card backdrops: intro clip from the
 * early-middle of the recording, outro clip from the later half. `rand` is
 * injected for deterministic tests.
 */
export function pickBackdropOffsets(
  sourceDurationSec: number,
  timeline: Timeline,
  rand: () => number = Math.random
): BackdropOffsets {
  const introLen = timeline.introSec + 0.5
  const outroLen = timeline.outroSec + 0.5

  const pick = (min: number, max: number, clipLen: number): number => {
    const upper = sourceDurationSec - clipLen
    const lo = clamp(min, 0, Math.max(0, upper))
    const hi = clamp(max, lo, Math.max(lo, upper))
    return round3(lo + rand() * (hi - lo))
  }

  return {
    introOffsetSec: pick(sourceDurationSec * 0.15, sourceDurationSec * 0.55, introLen),
    outroOffsetSec: pick(sourceDurationSec * 0.5, sourceDurationSec * 0.9, outroLen)
  }
}

// ---------------------------------------------------------------------------
// Card animation helpers
// ---------------------------------------------------------------------------

function introCardFilter(introSec: number, template: TemplateConfig, streamIn: string, streamOut: string): string {
  const fadeOutStart = round3(Math.max(0.5, introSec - 0.7))
  let chain = `[${streamIn}]format=rgba,fade=t=in:st=0.25:d=0.6:alpha=1,fade=t=out:st=${fadeOutStart}:d=0.7:alpha=1`
  if (template.introStyle === 'zoom') {
    chain += `,scale=iw*1.06:ih*1.06`
  }
  chain += `[${streamOut}]`
  return chain
}

function introOverlayXY(template: TemplateConfig, introSec: number): string {
  if (template.introStyle === 'slide-up') {
    return `x=0:y='(H*0.03)*pow(1-min(t/0.8,1),3)'`
  }
  if (template.introStyle === 'zoom') {
    const d = round3(Math.max(1, introSec))
    return `x='-(W*0.03)*(t/${d})':y='-(H*0.03)*(t/${d})'`
  }
  return 'x=0:y=0'
}

// ---------------------------------------------------------------------------
// Filtergraph
// ---------------------------------------------------------------------------

export interface BackdropIndices {
  introIndex: number
  outroIndex: number | null
}

export function buildFilterGraph(input: {
  mode: VideoMode
  timeline: Timeline
  outputWidth: number
  outputHeight: number
  /** Concrete output frame rate — every section is normalized to it */
  fps: number
  cropBias: number
  /** Number of audio streams in the source (0 = silent output, >1 = mixed) */
  audioStreams: number
  normalizeAudio: boolean
  volumeGainDb: number
  template: TemplateConfig
  hasOutroCard: boolean
  backdrop: BackdropIndices | null
}): { graph: string; videoLabel: string; audioLabel: string | null } {
  const { mode, timeline, outputWidth, outputHeight, template, fps } = input
  const parts: string[] = []

  const biasFactor = round3(clamp((input.cropBias + 1) / 2, 0, 1))
  const cropChain = mode === 'short' ? `crop=w='min(iw,ih*9/16)':h=ih:x='(iw-ow)*${biasFactor}':y=0,` : ''

  // Quarter-res blur pipeline for backdrops.
  const blurW = Math.max(2, Math.round(outputWidth / 4 / 2) * 2)
  const blurH = Math.max(2, Math.round(outputHeight / 4 / 2) * 2)
  const blurChain = `${cropChain}scale=${blurW}:${blurH}:flags=bilinear,gblur=sigma=6,scale=${outputWidth}:${outputHeight}:flags=bilinear`

  /** Backdrop (blurred clip) or plain black, normalized for concatenation. */
  const sectionBackground = (label: string, inputIndex: number | null, durationSec: number): void => {
    if (inputIndex !== null) {
      parts.push(
        `[${inputIndex}:v]${blurChain},fps=${fps},setsar=1,trim=duration=${durationSec},setpts=PTS-STARTPTS,` +
          `tpad=stop_mode=clone:stop_duration=${durationSec},trim=duration=${durationSec},setpts=PTS-STARTPTS[${label}]`
      )
    } else {
      parts.push(`color=c=black:size=${outputWidth}x${outputHeight}:rate=${fps}:duration=${durationSec},setsar=1[${label}]`)
    }
  }

  let audioLabel: string | null = null
  const audioSource = (label: string): void => {
    // Mix every source audio track — multi-track recordings (OBS) often keep
    // the audible mix on a track other than the first.
    if (input.audioStreams > 1) {
      const inputs = Array.from({ length: input.audioStreams }, (_, i) => `[0:a:${i}]`).join('')
      parts.push(`${inputs}amix=inputs=${input.audioStreams}:duration=longest:normalize=0[${label}]`)
    } else {
      parts.push(`[0:a:0]anull[${label}]`)
    }
  }

  if (mode === 'short') {
    // ----- Shorts: overlay intro on the gameplay window (unchanged shape) --
    const D = timeline.totalSec
    let base = `[0:v]${cropChain}scale=${outputWidth}:${outputHeight}:flags=lanczos,fps=${fps},setsar=1,fade=t=in:st=0:d=0.5[base]`
    parts.push(base)
    let last = 'base'
    if (input.backdrop) {
      const bgFadeOutStart = round3(Math.max(0.3, timeline.introSec - 0.6))
      parts.push(
        `[${input.backdrop.introIndex}:v]${blurChain},fps=${fps},setsar=1,fade=t=in:st=0:d=0.5,format=rgba,fade=t=out:st=${bgFadeOutStart}:d=0.6:alpha=1[introbg]`
      )
      parts.push(`[${last}][introbg]overlay=x=0:y=0:eof_action=pass[bgin]`)
      last = 'bgin'
    }
    parts.push(introCardFilter(timeline.introSec, template, '1:v', 'introcard'))
    parts.push(`[${last}][introcard]overlay=${introOverlayXY(template, timeline.introSec)}:eof_action=pass[vintro]`)
    parts.push(`[vintro]fade=t=out:st=${round3(Math.max(0, D - 0.8))}:d=0.8,format=yuv420p[vout]`)

    if (input.audioStreams > 0) {
      audioSource('amixed')
      const af: string[] = []
      if (input.normalizeAudio) af.push('loudnorm=I=-14:TP=-1.5:LRA=11')
      if (input.volumeGainDb !== 0) af.push(`volume=${round3(input.volumeGainDb)}dB`)
      af.push('afade=t=in:st=0:d=0.5')
      af.push(`afade=t=out:st=${round3(Math.max(0, D - 0.8))}:d=0.8`)
      parts.push(`[amixed]${af.join(',')}[aout]`)
      audioLabel = 'aout'
    }
    return { graph: parts.join(';'), videoLabel: 'vout', audioLabel }
  }

  // ----- Long-form: intro section ~> gameplay ~> end screen ----------------
  const I = timeline.introSec
  const G = timeline.gameplaySec
  const O = timeline.outroSec
  const total = timeline.totalSec

  // Intro section: backdrop/black + animated title card, fading in from black.
  sectionBackground('introbg', input.backdrop ? input.backdrop.introIndex : null, I)
  parts.push(introCardFilter(I, template, '1:v', 'introcard'))
  parts.push(
    `[introbg][introcard]overlay=${introOverlayXY(template, I)}:eof_action=pass,fade=t=in:st=0:d=0.5[seg_intro]`
  )

  // Gameplay section: exactly as recorded (scale/fps normalization only).
  parts.push(`[0:v]scale=${outputWidth}:${outputHeight}:flags=lanczos,fps=${fps},setsar=1,setpts=PTS-STARTPTS[seg_game]`)

  // End screen section, fading out to black at the very end (section-local time).
  sectionBackground('outrobg', input.backdrop ? input.backdrop.outroIndex : null, O)
  parts.push(`[2:v]format=rgba,fade=t=in:st=0.2:d=0.6:alpha=1[outrocard]`)
  parts.push(
    `[outrobg][outrocard]overlay=x=0:y=0:eof_action=pass,fade=t=out:st=${round3(Math.max(0, O - 0.9))}:d=0.9[seg_outro]`
  )

  // Join with crossfades.
  const x1Offset = round3(I - XFADE_SEC)
  const x2Offset = round3(I + G - 2 * XFADE_SEC)
  parts.push(`[seg_intro][seg_game]xfade=transition=fade:duration=${XFADE_SEC}:offset=${x1Offset}[xf1]`)
  parts.push(`[xf1][seg_outro]xfade=transition=fade:duration=${XFADE_SEC}:offset=${x2Offset}[xf2]`)
  parts.push(`[xf2]format=yuv420p[vout]`)

  // Audio: silence under the intro, gameplay audio in the middle, fade to
  // silence as the end screen arrives.
  if (input.audioStreams > 0) {
    audioSource('amixed')
    const af: string[] = []
    if (input.normalizeAudio) af.push('loudnorm=I=-14:TP=-1.5:LRA=11')
    if (input.volumeGainDb !== 0) af.push(`volume=${round3(input.volumeGainDb)}dB`)
    af.push('afade=t=in:st=0:d=0.3')
    const gameplayStart = round3(I - XFADE_SEC)
    const fadeOutStart = round3(Math.max(0, G - 1.0))
    af.push(`afade=t=out:st=${fadeOutStart}:d=1.0`)
    af.push(`adelay=delays=${Math.round(gameplayStart * 1000)}:all=1`)
    af.push('apad')
    af.push(`atrim=0:${total}`)
    parts.push(`[amixed]${af.join(',')}[aout]`)
    audioLabel = 'aout'
  }

  return { graph: parts.join(';'), videoLabel: 'vout', audioLabel }
}

// ---------------------------------------------------------------------------
// Encoder arguments
// ---------------------------------------------------------------------------

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

export function softwareFallbackFor(encoderName: string): string | null {
  if (encoderName.startsWith('h264_')) return 'libx264'
  if (encoderName.startsWith('hevc_')) return 'libx265'
  if (encoderName.startsWith('av1_')) return 'libsvtav1'
  return null
}

// ---------------------------------------------------------------------------
// Full plan
// ---------------------------------------------------------------------------

/** Concrete output fps: explicit override, else the (sane) source rate. */
export function resolveFps(sourceFps: number, frameRate: RenderSettings['frameRate']): number {
  if (frameRate !== 'source') return frameRate
  if (!Number.isFinite(sourceFps) || sourceFps < 10 || sourceFps > 240) return 30
  return Math.round(sourceFps * 100) / 100
}

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
  if (mode === 'longform' && !input.outroCardPath) {
    throw new PlanError('Long-form renders require an end-screen card.')
  }
  const fps = resolveFps(source.fps, render.frameRate)

  const args: string[] = []
  // Input 0: gameplay.
  if (timeline.seekSec > 0) args.push('-ss', String(timeline.seekSec))
  args.push('-t', String(timeline.gameplaySec), '-i', source.path)
  // Input 1: intro card (looped still).
  args.push('-loop', '1', '-framerate', '30', '-t', String(round3(timeline.introSec + 0.2)), '-i', input.introCardPath)
  // Input 2: outro card (long-form only).
  let nextIndex = 2
  if (hasOutroCard) {
    args.push('-loop', '1', '-framerate', '30', '-t', String(round3(timeline.outroSec + 0.2)), '-i', input.outroCardPath!)
    nextIndex = 3
  }

  // Backdrop inputs (short seeked reads of the same recording).
  let backdropIndices: BackdropIndices | null = null
  if (input.backdrop) {
    args.push('-ss', String(round3(input.backdrop.introOffsetSec)), '-t', String(round3(timeline.introSec + 0.5)), '-i', source.path)
    const introIndex = nextIndex++
    let outroIndex: number | null = null
    if (hasOutroCard) {
      args.push('-ss', String(round3(input.backdrop.outroOffsetSec)), '-t', String(round3(timeline.outroSec + 0.5)), '-i', source.path)
      outroIndex = nextIndex++
    }
    backdropIndices = { introIndex, outroIndex }
  }

  const { graph, videoLabel, audioLabel } = buildFilterGraph({
    mode,
    timeline,
    outputWidth: dims.width,
    outputHeight: dims.height,
    fps,
    cropBias: input.short.cropBias,
    audioStreams: source.audioCodec !== null ? Math.max(1, source.audioStreamCount ?? 1) : 0,
    normalizeAudio: render.normalizeAudio,
    volumeGainDb: render.volumeGainDb,
    template,
    hasOutroCard,
    backdrop: backdropIndices
  })

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
    durationSec: timeline.totalSec,
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
