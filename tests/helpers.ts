import type { BeatSaverMap, RenderSettings, ShortOptions, TemplateConfig, TrimOptions, VideoFileInfo } from '../src/shared/types'
import { DEFAULT_RENDER_SETTINGS, DEFAULT_SHORT, DEFAULT_TEMPLATE, DEFAULT_TRIM } from '../src/shared/defaults'

export function makeSource(overrides: Partial<VideoFileInfo> = {}): VideoFileInfo {
  return {
    path: '/videos/gameplay.mp4',
    durationSec: 210,
    width: 1920,
    height: 1080,
    fps: 60,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioStreamCount: 1,
    sizeBytes: 500_000_000,
    ...overrides
  }
}

export function makeMap(overrides: Partial<BeatSaverMap> = {}): BeatSaverMap {
  return {
    id: '25f',
    name: 'Beat It',
    songName: 'Beat It',
    songSubName: '',
    songAuthorName: 'Michael Jackson',
    levelAuthorName: 'GreatYazer',
    bpm: 139,
    durationSec: 258,
    coverUrl: 'https://cdn.beatsaver.com/cover.jpg',
    hash: 'abc123def456',
    difficulties: [
      { characteristic: 'Standard', difficulty: 'Expert', njs: 12, nps: 4.2 },
      { characteristic: 'Standard', difficulty: 'Hard', njs: 10, nps: 3.1 }
    ],
    ...overrides
  }
}

export function makeTemplate(overrides: Partial<TemplateConfig> = {}): TemplateConfig {
  return { ...DEFAULT_TEMPLATE, ...overrides }
}

export function makeRender(overrides: Partial<RenderSettings> = {}): RenderSettings {
  return { ...DEFAULT_RENDER_SETTINGS, ...overrides }
}

export function makeTrim(overrides: Partial<TrimOptions> = {}): TrimOptions {
  return { ...DEFAULT_TRIM, ...overrides }
}

export function makeShort(overrides: Partial<ShortOptions> = {}): ShortOptions {
  return { ...DEFAULT_SHORT, ...overrides }
}
