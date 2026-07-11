import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildRenderPlan } from '../src/main/services/render/plan'
import { findLoudestOffset } from '../src/main/services/ffmpeg/loudness'
import { makeRender, makeShort, makeTemplate, makeTrim } from './helpers'
import type { VideoFileInfo } from '../src/shared/types'

/**
 * End-to-end verification of the generated ffmpeg command against a real
 * ffmpeg binary. Skipped automatically when ffmpeg/ffprobe are not on PATH.
 */

const hasFfmpeg = ((): boolean => {
  try {
    return spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
})()

const d = describe.skipIf(!hasFfmpeg)

let dir: string
let sourcePath: string
let introPath: string
let outroPath: string

function probe(file: string): { durationSec: number; width: number; height: number; hasAudio: boolean } {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file
  ]).toString()
  const parsed = JSON.parse(out)
  const video = parsed.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
  const audio = parsed.streams.find((s: { codec_type: string }) => s.codec_type === 'audio')
  return {
    durationSec: Number(parsed.format.duration),
    width: video.width,
    height: video.height,
    hasAudio: !!audio
  }
}

function sourceInfo(overrides: Partial<VideoFileInfo> = {}): VideoFileInfo {
  return {
    path: sourcePath,
    durationSec: 40,
    width: 1280,
    height: 720,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioStreamCount: 1,
    sizeBytes: 0,
    ...overrides
  }
}

beforeAll(() => {
  if (!hasFfmpeg) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beatframe-it-'))
  sourcePath = path.join(dir, 'gameplay.mp4')
  introPath = path.join(dir, 'intro.png')
  outroPath = path.join(dir, 'outro.png')

  // Synthetic 40 s "gameplay" clip with tone audio.
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', sourcePath
  ], { timeout: 120_000 })

  // Semi-transparent cards standing in for the captured HTML title cards.
  for (const [file, color] of [
    [introPath, 'blue@0.5'],
    [outroPath, 'black@0.9']
  ] as const) {
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=1280x720,format=rgba`, '-frames:v', '1', file
    ], { timeout: 60_000 })
  }
}, 180_000)

d('long-form render plan executes on real ffmpeg', () => {
  it('produces intro section + gameplay + end screen with expected total duration', () => {
    const outputPath = path.join(dir, 'longform.mp4')
    const plan = buildRenderPlan({
      source: sourceInfo(),
      mode: 'longform',
      trim: makeTrim({ trimStartSec: 2, trimEndSec: 3 }), // 35 s gameplay
      short: makeShort(),
      template: makeTemplate({ introDurationSec: 4, outroDurationSec: 5 }),
      render: makeRender({ quality: 'fast' }),
      encoderName: 'libx264',
      introCardPath: introPath,
      outroCardPath: outroPath,
      // Exercise the blurred-gameplay backdrop path on real ffmpeg.
      backdrop: { introOffsetSec: 12, outroOffsetSec: 28 },
      outputPath
    })
    const res = spawnSync('ffmpeg', ['-hide_banner', '-y', ...plan.args], { timeout: 300_000 })
    expect(res.status, res.stderr?.toString().slice(-2000)).toBe(0)

    const info = probe(outputPath)
    expect(info.width).toBe(1280)
    expect(info.height).toBe(720)
    expect(info.hasAudio).toBe(true)
    // intro 4 + gameplay 35 + outro 5 - two 0.5 s crossfades
    expect(Math.abs(info.durationSec - 43)).toBeLessThan(0.6)
  }, 300_000)

  it('supports every intro animation style (black section background)', () => {
    for (const introStyle of ['fade', 'slide-up', 'zoom'] as const) {
      const outputPath = path.join(dir, `style-${introStyle}.mp4`)
      const plan = buildRenderPlan({
        source: sourceInfo(),
        mode: 'longform',
        trim: makeTrim({ trimStartSec: 0, trimEndSec: 25 }), // 15 s gameplay
        short: makeShort(),
        template: makeTemplate({ introStyle, introDurationSec: 3, outroDurationSec: 4 }),
        render: makeRender({ quality: 'fast', normalizeAudio: false }),
        encoderName: 'libx264',
        introCardPath: introPath,
        outroCardPath: outroPath,
        backdrop: null,
        outputPath
      })
      const res = spawnSync('ffmpeg', ['-hide_banner', '-y', ...plan.args], { timeout: 300_000 })
      expect(res.status, `${introStyle}: ${res.stderr?.toString().slice(-2000)}`).toBe(0)
      const info = probe(outputPath)
      expect(Math.abs(info.durationSec - (3 + 15 + 4 - 1))).toBeLessThan(0.6)
    }
  }, 600_000)

  it('mixes multi-track recordings so audio survives an empty first track', () => {
    // Track 0 silent, track 1 audible — the OBS layout that used to render mute.
    const multiPath = path.join(dir, 'multitrack.mp4')
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
      '-f', 'lavfi', '-i', 'anullsrc=sample_rate=44100:channel_layout=stereo',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-map', '0:v', '-map', '1:a', '-map', '2:a',
      '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', multiPath
    ], { timeout: 120_000 })

    const outputPath = path.join(dir, 'multitrack-out.mp4')
    const plan = buildRenderPlan({
      source: sourceInfo({ path: multiPath, durationSec: 20, width: 640, height: 360, audioStreamCount: 2 }),
      mode: 'longform',
      trim: makeTrim(),
      short: makeShort(),
      template: makeTemplate({ introDurationSec: 3, outroDurationSec: 4 }),
      render: makeRender({ quality: 'fast', normalizeAudio: false }),
      encoderName: 'libx264',
      introCardPath: introPath,
      outroCardPath: outroPath,
      backdrop: null,
      outputPath
    })
    const res = spawnSync('ffmpeg', ['-hide_banner', '-y', ...plan.args], { timeout: 300_000 })
    expect(res.status, res.stderr?.toString().slice(-2000)).toBe(0)

    // The output must contain real signal, not silence.
    const vol = execFileSync('ffmpeg', [
      '-hide_banner', '-i', outputPath, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'
    ], { timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = String(vol) // volumedetect writes to stderr; execFileSync merges? capture below
    const m = /mean_volume:\s*(-?\d+(\.\d+)?) dB/.exec(stderr)
    // Fallback: rerun capturing stderr explicitly if needed
    let mean = m ? Number(m[1]) : null
    if (mean === null) {
      const r2 = spawnSync('ffmpeg', ['-hide_banner', '-i', outputPath, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 60_000 })
      const m2 = /mean_volume:\s*(-?\d+(\.\d+)?) dB/.exec(String(r2.stderr))
      mean = m2 ? Number(m2[1]) : null
    }
    expect(mean).not.toBeNull()
    expect(mean!).toBeGreaterThan(-40) // a silent render would be ~-91 dB
  }, 300_000)
})

d('loudness analysis on real ffmpeg', () => {
  it('finds the loud section of a clip', async () => {
    // 40 s of near-silence with a loud burst from 20-30 s.
    const clip = path.join(dir, 'levels.mp4')
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
      '-f', 'lavfi', '-i', "sine=frequency=440:sample_rate=44100",
      '-af', "volume='if(between(t,20,30),1,0.02)':eval=frame",
      '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', clip
    ], { timeout: 120_000 })

    const best = await findLoudestOffset(clip, { rangeStartSec: 0, rangeEndSec: 40, windowSec: 8, candidates: 6 })
    expect(best).not.toBeNull()
    // The loudest 8 s window must start inside (or overlap) the 20-30 s burst.
    expect(best!).toBeGreaterThanOrEqual(14)
    expect(best!).toBeLessThanOrEqual(30)
  }, 120_000)
})

d('shorts render plan executes on real ffmpeg', () => {
  it('produces a vertical 9:16 clip of the requested length', () => {
    const outputPath = path.join(dir, 'short.mp4')
    const plan = buildRenderPlan({
      source: sourceInfo(),
      mode: 'short',
      trim: makeTrim(),
      short: makeShort({ startOffsetSec: 5, durationSec: 20, cropBias: 0.5 }),
      template: makeTemplate(),
      render: makeRender({ quality: 'fast' }),
      encoderName: 'libx264',
      introCardPath: introPath, // wrong aspect is fine for smoke purposes
      outroCardPath: null,
      backdrop: { introOffsetSec: 30, outroOffsetSec: 0 },
      outputPath
    })
    // Shorts intro card is generated at 9:16 in production; regenerate one here.
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=red@0.5:size=1080x1920,format=rgba', '-frames:v', '1', introPath
    ], { timeout: 60_000 })

    const res = spawnSync('ffmpeg', ['-hide_banner', '-y', ...plan.args], { timeout: 300_000 })
    expect(res.status, res.stderr?.toString().slice(-2000)).toBe(0)

    const info = probe(outputPath)
    expect(info.width).toBe(1080)
    expect(info.height).toBe(1920)
    expect(Math.abs(info.durationSec - 20)).toBeLessThan(0.6)
  }, 300_000)
})
