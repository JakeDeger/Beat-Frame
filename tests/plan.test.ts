import { describe, expect, it } from 'vitest'
import {
  autoBitrateKbps,
  buildFilterGraph,
  buildRenderPlan,
  computeOutputDims,
  computeTimeline,
  encoderArgs,
  PlanError,
  softwareFallbackFor
} from '../src/main/services/render/plan'
import { makeRender, makeShort, makeSource, makeTemplate, makeTrim } from './helpers'

describe('computeOutputDims', () => {
  it('keeps source dimensions for long-form "source" resolution', () => {
    expect(computeOutputDims({ width: 1920, height: 1080 }, 'longform', 'source')).toEqual({ width: 1920, height: 1080 })
  })

  it('forces even dimensions for yuv420p', () => {
    expect(computeOutputDims({ width: 1921, height: 1080 }, 'longform', 'source')).toEqual({ width: 1920, height: 1080 })
  })

  it('scales to 4K preserving aspect', () => {
    expect(computeOutputDims({ width: 1920, height: 1080 }, 'longform', '2160p')).toEqual({ width: 3840, height: 2160 })
  })

  it('handles ultrawide sources', () => {
    const dims = computeOutputDims({ width: 3440, height: 1440 }, 'longform', '1080p')
    expect(dims.height).toBe(1080)
    expect(dims.width).toBe(2580)
  })

  it('always outputs 9:16 for shorts', () => {
    expect(computeOutputDims({ width: 1920, height: 1080 }, 'short', 'source')).toEqual({ width: 1080, height: 1920 })
    expect(computeOutputDims({ width: 1920, height: 1080 }, 'short', '2160p')).toEqual({ width: 2160, height: 3840 })
  })
})

describe('computeTimeline', () => {
  it('trims start and end for long-form', () => {
    const t = computeTimeline({
      sourceDurationSec: 200,
      mode: 'longform',
      trim: makeTrim({ trimStartSec: 5, trimEndSec: 10 }),
      short: makeShort(),
      template: makeTemplate()
    })
    expect(t.seekSec).toBe(5)
    expect(t.durationSec).toBe(185)
    expect(t.introDurationSec).toBe(6)
    expect(t.outroStartSec).toBe(177)
  })

  it('rejects over-trimmed videos with a clear error', () => {
    expect(() =>
      computeTimeline({
        sourceDurationSec: 30,
        mode: 'longform',
        trim: makeTrim({ trimStartSec: 20, trimEndSec: 20 }),
        short: makeShort(),
        template: makeTemplate()
      })
    ).toThrow(PlanError)
  })

  it('caps shorts at 180 seconds and applies the start offset', () => {
    const t = computeTimeline({
      sourceDurationSec: 400,
      mode: 'short',
      trim: makeTrim(),
      short: makeShort({ startOffsetSec: 30, durationSec: 500 }),
      template: makeTemplate()
    })
    expect(t.seekSec).toBe(30)
    expect(t.durationSec).toBe(180)
    expect(t.outroStartSec).toBeNull()
  })

  it('clamps the short window to the available footage', () => {
    const t = computeTimeline({
      sourceDurationSec: 50,
      mode: 'short',
      trim: makeTrim(),
      short: makeShort({ startOffsetSec: 0, durationSec: 60 }),
      template: makeTemplate()
    })
    expect(t.durationSec).toBe(50)
  })
})

describe('buildFilterGraph', () => {
  const base = {
    mode: 'longform' as const,
    timeline: { seekSec: 0, durationSec: 100, introDurationSec: 6, outroStartSec: 92 },
    outputWidth: 1920,
    outputHeight: 1080,
    sourceFps: 60,
    frameRate: 'source' as const,
    cropBias: 0,
    hasAudio: true,
    normalizeAudio: true,
    volumeGainDb: 0,
    template: makeTemplate(),
    hasOutroCard: true
  }

  it('produces a single-pass graph with intro, outro, fades and audio conditioning', () => {
    const { graph, videoLabel, audioLabel } = buildFilterGraph(base)
    expect(videoLabel).toBe('vout')
    expect(audioLabel).toBe('aout')
    expect(graph).toContain('scale=1920:1080')
    expect(graph).toContain('fade=t=in:st=0:d=1')
    expect(graph).toContain('overlay') // intro
    expect(graph).toContain('setpts=PTS+92/TB') // outro shifted to the end
    expect(graph).toContain('loudnorm=I=-14')
    expect(graph).toContain('afade=t=out:st=98.5:d=1.5')
    expect(graph).toContain('fade=t=out:st=98.8:d=1.2')
  })

  it('never cuts or retimes gameplay (no trim/setpts speed filters on the main stream)', () => {
    const { graph } = buildFilterGraph(base)
    const mainChain = graph.split(';')[0]
    expect(mainChain).not.toContain('trim=')
    expect(mainChain).not.toContain('setpts=')
    expect(mainChain).not.toContain('zoompan')
  })

  it('crops to 9:16 with bias for shorts', () => {
    const { graph } = buildFilterGraph({
      ...base,
      mode: 'short',
      cropBias: 1,
      outputWidth: 1080,
      outputHeight: 1920,
      hasOutroCard: false,
      timeline: { seekSec: 0, durationSec: 60, introDurationSec: 3.5, outroStartSec: null }
    })
    expect(graph).toContain("crop=w='min(iw,ih*9/16)':h=ih:x='(iw-ow)*1'")
    expect(graph).toContain('scale=1080:1920')
    expect(graph).not.toContain('setpts=PTS+') // no outro card
  })

  it('omits audio chain when the source has no audio', () => {
    const { graph, audioLabel } = buildFilterGraph({ ...base, hasAudio: false })
    expect(audioLabel).toBeNull()
    expect(graph).not.toContain('loudnorm')
  })

  it('skips loudnorm when normalization is off but keeps fades', () => {
    const { graph } = buildFilterGraph({ ...base, normalizeAudio: false, volumeGainDb: 3 })
    expect(graph).not.toContain('loudnorm')
    expect(graph).toContain('volume=3dB')
    expect(graph).toContain('afade=t=in')
  })

  it('inserts fps filter only when the frame rate changes', () => {
    expect(buildFilterGraph({ ...base, frameRate: 30 }).graph).toContain('fps=30')
    expect(buildFilterGraph({ ...base, frameRate: 60 }).graph).not.toContain('fps=60')
    expect(buildFilterGraph(base).graph).not.toContain('fps=')
  })
})

describe('encoderArgs', () => {
  it('uses CRF for libx264 when bitrate is auto', () => {
    const args = encoderArgs('libx264', 'balanced', 0, 1080).join(' ')
    expect(args).toContain('-crf 19')
    expect(args).toContain('-preset medium')
    expect(args).not.toContain('-b:v')
  })

  it('uses explicit bitrate when configured', () => {
    const args = encoderArgs('libx264', 'balanced', 12000, 1080).join(' ')
    expect(args).toContain('-b:v 12000k')
    expect(args).toContain('-maxrate 18000k')
  })

  it('always gives AMF a bitrate (auto-derived when unset)', () => {
    const args = encoderArgs('hevc_amf', 'quality', 0, 2160).join(' ')
    expect(args).toContain(`-b:v ${autoBitrateKbps(2160, 'hevc_amf')}k`)
  })

  it('maps quality presets for NVENC', () => {
    expect(encoderArgs('h264_nvenc', 'quality', 0, 1080).join(' ')).toContain('-preset p7')
    expect(encoderArgs('h264_nvenc', 'fast', 0, 1080).join(' ')).toContain('-preset p3')
  })
})

describe('softwareFallbackFor', () => {
  it('maps hardware encoders to software equivalents', () => {
    expect(softwareFallbackFor('h264_nvenc')).toBe('libx264')
    expect(softwareFallbackFor('hevc_qsv')).toBe('libx265')
    expect(softwareFallbackFor('av1_amf')).toBe('libsvtav1')
    expect(softwareFallbackFor('libx264')).toBeNull()
  })
})

describe('buildRenderPlan', () => {
  it('assembles a complete ffmpeg invocation', () => {
    const plan = buildRenderPlan({
      source: makeSource(),
      mode: 'longform',
      trim: makeTrim({ trimStartSec: 2 }),
      short: makeShort(),
      template: makeTemplate(),
      render: makeRender(),
      encoderName: 'libx264',
      introCardPath: '/tmp/intro.png',
      outroCardPath: '/tmp/outro.png',
      outputPath: '/out/final.mp4'
    })
    const cmd = plan.args.join(' ')
    expect(cmd).toContain('-ss 2')
    expect(cmd).toContain('-i /videos/gameplay.mp4')
    expect(cmd).toContain('-loop 1')
    expect(cmd).toContain('/tmp/intro.png')
    expect(cmd).toContain('/tmp/outro.png')
    expect(cmd).toContain('-filter_complex')
    expect(cmd).toContain('-map [vout]')
    expect(cmd).toContain('-map [aout]')
    expect(cmd).toContain('-c:a aac')
    expect(cmd).toContain('-movflags +faststart')
    expect(cmd.endsWith('/out/final.mp4')).toBe(true)
    expect(plan.durationSec).toBe(208)
  })

  it('omits the outro input for shorts', () => {
    const plan = buildRenderPlan({
      source: makeSource(),
      mode: 'short',
      trim: makeTrim(),
      short: makeShort({ durationSec: 45 }),
      template: makeTemplate(),
      render: makeRender(),
      encoderName: 'h264_nvenc',
      introCardPath: '/tmp/intro.png',
      outroCardPath: null,
      outputPath: '/out/short.mp4'
    })
    expect(plan.args.join(' ')).not.toContain('outro')
    expect(plan.outputWidth).toBe(1080)
    expect(plan.outputHeight).toBe(1920)
    expect(plan.durationSec).toBe(45)
  })
})
