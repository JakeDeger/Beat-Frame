import { describe, expect, it } from 'vitest'
import {
  autoBitrateKbps,
  buildFilterGraph,
  buildRenderPlan,
  computeOutputDims,
  computeTimeline,
  encoderArgs,
  pickBackdropOffsets,
  resolveFps,
  PlanError,
  softwareFallbackFor,
  XFADE_SEC,
  type BackdropIndices,
  type Timeline
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
  it('always outputs 9:16 for shorts', () => {
    expect(computeOutputDims({ width: 1920, height: 1080 }, 'short', 'source')).toEqual({ width: 1080, height: 1920 })
  })
})

describe('computeTimeline', () => {
  it('long-form: intro and outro are their own sections around untouched gameplay', () => {
    const t = computeTimeline({
      sourceDurationSec: 200,
      mode: 'longform',
      trim: makeTrim({ trimStartSec: 5, trimEndSec: 10 }),
      short: makeShort(),
      template: makeTemplate() // intro 6s, outro 8s
    })
    expect(t.seekSec).toBe(5)
    expect(t.gameplaySec).toBe(185)
    expect(t.introSec).toBe(6)
    expect(t.outroSec).toBe(8)
    // two crossfades overlap the junctions
    expect(t.totalSec).toBe(6 + 185 + 8 - 2 * XFADE_SEC)
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

  it('shorts: no outro section, capped at 180 s, offset applied', () => {
    const t = computeTimeline({
      sourceDurationSec: 400,
      mode: 'short',
      trim: makeTrim(),
      short: makeShort({ startOffsetSec: 30, durationSec: 500 }),
      template: makeTemplate()
    })
    expect(t.seekSec).toBe(30)
    expect(t.gameplaySec).toBe(180)
    expect(t.outroSec).toBe(0)
    expect(t.totalSec).toBe(180)
  })
})

describe('resolveFps', () => {
  it('uses the override when set and a sane source rate otherwise', () => {
    expect(resolveFps(59.94, 30)).toBe(30)
    expect(resolveFps(59.94, 'source')).toBe(59.94)
    expect(resolveFps(0, 'source')).toBe(30) // corrupt probe data
  })
})

// ---------------------------------------------------------------------------

const longTimeline: Timeline = { seekSec: 0, gameplaySec: 100, introSec: 6, outroSec: 8, totalSec: 113 }

function longformGraph(overrides: Partial<Parameters<typeof buildFilterGraph>[0]> = {}) {
  return buildFilterGraph({
    mode: 'longform',
    timeline: longTimeline,
    outputWidth: 1920,
    outputHeight: 1080,
    fps: 60,
    cropBias: 0,
    audioStreams: 1,
    normalizeAudio: true,
    volumeGainDb: 0,
    template: makeTemplate(),
    hasOutroCard: true,
    backdrop: null as BackdropIndices | null,
    ...overrides
  })
}

describe('buildFilterGraph (long-form sections)', () => {
  it('builds intro ~> gameplay ~> outro joined by crossfades', () => {
    const { graph, videoLabel, audioLabel } = longformGraph()
    expect(videoLabel).toBe('vout')
    expect(audioLabel).toBe('aout')
    expect(graph).toContain('[seg_intro][seg_game]xfade=transition=fade:duration=0.5:offset=5.5')
    expect(graph).toContain('[xf1][seg_outro]xfade=transition=fade:duration=0.5:offset=105')
  })

  it('gameplay section is only scaled/fps-normalized — never cut or retimed', () => {
    const { graph } = longformGraph()
    const gameChain = graph.split(';').find((p) => p.endsWith('[seg_game]'))!
    expect(gameChain).toContain('scale=1920:1080')
    expect(gameChain).toContain('fps=60')
    expect(gameChain).not.toContain('trim=')
    expect(gameChain).not.toContain('overlay')
    expect(gameChain.replace('setpts=PTS-STARTPTS', '')).not.toContain('setpts') // normalization only
  })

  it('uses black section backgrounds when the backdrop is disabled', () => {
    const { graph } = longformGraph()
    expect(graph).toContain('color=c=black:size=1920x1080:rate=60:duration=6')
    expect(graph).toContain('color=c=black:size=1920x1080:rate=60:duration=8')
    expect(graph).not.toContain('gblur')
  })

  it('uses blurred gameplay clips behind the cards when enabled', () => {
    const { graph } = longformGraph({ backdrop: { introIndex: 3, outroIndex: 4 } })
    expect(graph).toContain('[3:v]')
    expect(graph).toContain('[4:v]')
    expect(graph).toContain('gblur=sigma=6')
    expect(graph).not.toContain('color=c=black')
  })

  it('delays gameplay audio to the gameplay section and pads silence to the total', () => {
    const { graph } = longformGraph()
    expect(graph).toContain('adelay=delays=5500:all=1') // introSec - xfade = 5.5 s
    expect(graph).toContain('apad')
    expect(graph).toContain('atrim=0:113')
    expect(graph).toContain(`afade=t=out:st=99:d=1`) // gameplay-local fade before the end screen
    expect(graph).toContain('loudnorm=I=-14')
  })

  it('mixes every audio track of multi-track recordings', () => {
    const { graph } = longformGraph({ audioStreams: 3 })
    expect(graph).toContain('[0:a:0][0:a:1][0:a:2]amix=inputs=3:duration=longest:normalize=0')
  })

  it('omits the audio chain entirely for silent sources', () => {
    const { graph, audioLabel } = longformGraph({ audioStreams: 0 })
    expect(audioLabel).toBeNull()
    expect(graph).not.toContain('amix')
    expect(graph).not.toContain('adelay')
  })
})

describe('buildFilterGraph (shorts overlay)', () => {
  const shortTimeline: Timeline = { seekSec: 0, gameplaySec: 60, introSec: 3.5, outroSec: 0, totalSec: 60 }

  it('crops to 9:16 with bias and overlays the intro card', () => {
    const { graph } = buildFilterGraph({
      mode: 'short',
      timeline: shortTimeline,
      outputWidth: 1080,
      outputHeight: 1920,
      fps: 60,
      cropBias: 1,
      audioStreams: 2,
      normalizeAudio: false,
      volumeGainDb: 0,
      template: makeTemplate(),
      hasOutroCard: false,
      backdrop: { introIndex: 2, outroIndex: null }
    })
    expect(graph).toContain("crop=w='min(iw,ih*9/16)':h=ih:x='(iw-ow)*1'")
    expect(graph).toContain('scale=1080:1920')
    expect(graph).not.toContain('xfade') // gameplay stays a single continuous take
    expect(graph).toContain('amix=inputs=2')
    expect(graph).not.toContain('adelay') // audio starts with the video
  })
})

describe('encoderArgs', () => {
  it('uses CRF for libx264 when bitrate is auto', () => {
    const args = encoderArgs('libx264', 'balanced', 0, 1080).join(' ')
    expect(args).toContain('-crf 19')
    expect(args).not.toContain('-b:v')
  })
  it('always gives AMF a bitrate (auto-derived when unset)', () => {
    expect(encoderArgs('hevc_amf', 'quality', 0, 2160).join(' ')).toContain(`-b:v ${autoBitrateKbps(2160, 'hevc_amf')}k`)
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
  it('assembles the sectioned long-form invocation', () => {
    const plan = buildRenderPlan({
      source: makeSource(), // 210 s
      mode: 'longform',
      trim: makeTrim({ trimStartSec: 2 }),
      short: makeShort(),
      template: makeTemplate(), // intro 6, outro 8
      render: makeRender(),
      encoderName: 'libx264',
      introCardPath: '/tmp/intro.png',
      outroCardPath: '/tmp/outro.png',
      backdrop: { introOffsetSec: 42.5, outroOffsetSec: 150 },
      outputPath: '/out/final.mp4'
    })
    const cmd = plan.args.join(' ')
    expect(cmd).toContain('-ss 2')
    expect(cmd.split('/videos/gameplay.mp4').length - 1).toBe(3) // main + 2 backdrops
    expect(cmd).toContain('-ss 42.5')
    expect(cmd).toContain('-map [vout]')
    expect(cmd).toContain('-map [aout]')
    expect(cmd).toContain('-movflags +faststart')
    expect(plan.durationSec).toBe(6 + 208 + 8 - 1)
  })

  it('rejects long-form without an end screen card', () => {
    expect(() =>
      buildRenderPlan({
        source: makeSource(),
        mode: 'longform',
        trim: makeTrim(),
        short: makeShort(),
        template: makeTemplate(),
        render: makeRender(),
        encoderName: 'libx264',
        introCardPath: '/tmp/intro.png',
        outroCardPath: null,
        backdrop: null,
        outputPath: '/out/final.mp4'
      })
    ).toThrow(PlanError)
  })

  it('builds shorts without outro inputs', () => {
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
      backdrop: null,
      outputPath: '/out/short.mp4'
    })
    expect(plan.args.join(' ')).not.toContain('outro')
    expect(plan.outputWidth).toBe(1080)
    expect(plan.durationSec).toBe(45)
  })
})

describe('pickBackdropOffsets', () => {
  const timeline: Timeline = { seekSec: 0, gameplaySec: 192, introSec: 6, outroSec: 8, totalSec: 205 }

  it('stays within the source and clear of the clip ends', () => {
    for (const r of [0, 0.5, 0.9999]) {
      const { introOffsetSec, outroOffsetSec } = pickBackdropOffsets(210, timeline, () => r)
      expect(introOffsetSec).toBeGreaterThanOrEqual(0)
      expect(introOffsetSec + timeline.introSec).toBeLessThanOrEqual(210)
      expect(outroOffsetSec + timeline.outroSec).toBeLessThanOrEqual(210)
    }
  })

  it('draws intro from earlier footage than outro', () => {
    const a = pickBackdropOffsets(210, timeline, () => 0)
    expect(a.introOffsetSec).toBeLessThan(a.outroOffsetSec)
  })
})
