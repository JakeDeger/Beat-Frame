import type { AppSettings, RenderSettings, ScheduleSettings, TemplateConfig, AutomationSettings, ShortOptions, TrimOptions } from './types'

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  resolution: 'source',
  frameRate: 'source',
  codec: 'h264',
  hwAccel: 'auto',
  quality: 'balanced',
  videoBitrateKbps: 0,
  audioBitrateKbps: 192,
  normalizeAudio: true,
  volumeGainDb: 0,
  ffmpegPath: '',
  ffprobePath: ''
}

export const DEFAULT_TEMPLATE: TemplateConfig = {
  channelName: '',
  accentColor: '#ff2d78',
  accentColorB: '#2d9bff',
  backgroundColor: '#0b0e17',
  fontFamily: "'Segoe UI', 'Inter', system-ui, sans-serif",
  logoPath: '',
  introDurationSec: 6,
  outroDurationSec: 8,
  showDifficulty: true,
  introStyle: 'slide-up',
  introLayout: 'split',
  blurredBackdrop: true,
  outroHeadline: 'Thanks for watching!',
  outroSubline: 'Subscribe for more Beat Saber gameplay'
}

export const DEFAULT_AUTOMATION: AutomationSettings = {
  enabled: false,
  inputFolder: '',
  archiveFolder: '',
  mode: 'longform',
  autoUpload: false,
  requireReview: true,
  generateThumbnail: true,
  defaultPrivacy: 'private',
  playlistId: null
}

export const DEFAULT_SCHEDULE: ScheduleSettings = {
  enabled: false,
  longformTime: '18:00',
  shortsTimes: ['12:00'],
  notifyOnEmptyQueue: true
}

export const DEFAULT_TRIM: TrimOptions = { trimStartSec: 0, trimEndSec: 0 }

export const DEFAULT_SHORT: ShortOptions = { startOffsetSec: 0, durationSec: 60, cropBias: 0 }

export const DEFAULT_SETTINGS: AppSettings = {
  outputFolder: '',
  playerName: '',
  playerProfileUrl: '',
  render: DEFAULT_RENDER_SETTINGS,
  template: DEFAULT_TEMPLATE,
  automation: DEFAULT_AUTOMATION,
  schedule: DEFAULT_SCHEDULE,
  uploadPresets: [],
  extraKeywords: [],
  youtubeClientId: '',
  youtubeClientSecret: '',
  checkForUpdates: true
}

/** Deep-merge persisted settings over defaults so new fields appear after updates. */
export function mergeSettings(saved: unknown): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!saved || typeof saved !== 'object') return base
  return deepMerge(base as unknown as Record<string, unknown>, saved as Record<string, unknown>) as unknown as AppSettings
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    if (
      value &&
      current &&
      typeof value === 'object' &&
      typeof current === 'object' &&
      !Array.isArray(value) &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}
