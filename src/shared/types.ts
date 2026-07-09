/**
 * Shared domain types used across the main process, preload bridge and renderer.
 * This file is the single source of truth for the app's data model.
 */

// ---------------------------------------------------------------------------
// Video / rendering
// ---------------------------------------------------------------------------

export type VideoMode = 'longform' | 'short'

export type Resolution = 'source' | '1080p' | '1440p' | '2160p'
export type Codec = 'h264' | 'h265' | 'av1'
export type HwAccel = 'auto' | 'none' | 'nvenc' | 'amf' | 'qsv'
export type QualityPreset = 'fast' | 'balanced' | 'quality'
export type FrameRate = 'source' | 30 | 60

export interface RenderSettings {
  resolution: Resolution
  frameRate: FrameRate
  codec: Codec
  hwAccel: HwAccel
  quality: QualityPreset
  /** kbps; 0 means "auto" (derived from resolution/codec) */
  videoBitrateKbps: number
  audioBitrateKbps: number
  normalizeAudio: boolean
  /** dB gain applied to the whole mix, 0 = untouched */
  volumeGainDb: number
  /** Optional explicit path to an ffmpeg binary; empty = auto-resolve */
  ffmpegPath: string
  /** Optional explicit path to an ffprobe binary; empty = auto-resolve */
  ffprobePath: string
}

export interface TemplateConfig {
  /** Channel / brand name shown on intro & outro */
  channelName: string
  /** Accent color (hex) used across intro/outro/thumbnail */
  accentColor: string
  /** Secondary accent for gradients */
  accentColorB: string
  /** Card background tint (hex) */
  backgroundColor: string
  /** CSS font stack for title cards */
  fontFamily: string
  /** Absolute path to a logo image (optional) */
  logoPath: string
  /** Intro card visible duration in seconds */
  introDurationSec: number
  /** Outro end-screen duration in seconds */
  outroDurationSec: number
  /** Show mapped difficulty on the intro card */
  showDifficulty: boolean
  /** Intro animation style */
  introStyle: 'slide-up' | 'fade' | 'zoom'
  /** Intro card layout: centered glass panel, or split-screen cover art + player avatar */
  introLayout: 'panel' | 'split'
  /** Show a blurred clip from a random part of the gameplay behind intro/outro cards */
  blurredBackdrop: boolean
  /** Outro message headline */
  outroHeadline: string
  /** Outro sub-message */
  outroSubline: string
}

export interface TrimOptions {
  /** Seconds to drop from the start of the recording */
  trimStartSec: number
  /** Seconds to drop from the end of the recording */
  trimEndSec: number
}

export interface ShortOptions {
  /** Where the Short's gameplay window starts, seconds into the (trimmed) video */
  startOffsetSec: number
  /** Target duration of the Short (<= 180) */
  durationSec: number
  /** Horizontal crop bias: -1 = far left, 0 = center, 1 = far right */
  cropBias: number
  /** Ignore startOffsetSec and start at the most intense (loudest) section */
  autoHighlight: boolean
}

// ---------------------------------------------------------------------------
// BeatSaver / player metadata
// ---------------------------------------------------------------------------

export interface MapDifficulty {
  characteristic: string
  difficulty: string
  njs: number
  nps: number
  stars?: number
}

export interface BeatSaverMap {
  id: string
  /** Full map name as listed on BeatSaver */
  name: string
  songName: string
  songSubName: string
  /** Artist */
  songAuthorName: string
  /** Mapper */
  levelAuthorName: string
  bpm: number
  durationSec: number
  coverUrl: string
  /** Local file path of the downloaded cover (filled in by the main process) */
  coverPath?: string
  /** SHA1 of the current map version — used for score lookups */
  hash: string
  difficulties: MapDifficulty[]
  uploadedAt?: string
}

export type PlayerPlatform = 'beatleader' | 'scoresaber'

export interface PlayerProfile {
  platform: PlayerPlatform
  id: string
  name: string
  avatarUrl: string
  country: string
  rank: number
  profileUrl: string
}

/** The player's own score on the rendered map (BeatLeader). */
export interface PlayerScore {
  /** 0..1, e.g. 0.9742 */
  accuracy: number
  /** Leaderboard rank for this score, 0 = unknown */
  rank: number
}

// ---------------------------------------------------------------------------
// Render queue
// ---------------------------------------------------------------------------

export interface RenderRequest {
  videoPath: string
  mapId: string
  mode: VideoMode
  playerName: string
  playerProfileUrl: string
  outputFolder: string
  trim: TrimOptions
  short: ShortOptions
  /** Also produce a thumbnail image next to the output */
  generateThumbnail: boolean
}

export type RenderStatus =
  | 'queued'
  | 'preparing'
  | 'rendering'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RenderProgress {
  /** 0..100 */
  percent: number
  etaSeconds: number | null
  fps: number | null
  /** Encoding speed multiplier, e.g. 2.4 means 2.4x realtime */
  speed: number | null
}

export interface RenderJob {
  id: string
  request: RenderRequest
  status: RenderStatus
  progress: RenderProgress
  /** Rolling tail of ffmpeg/log output */
  logs: string[]
  outputPath: string | null
  thumbnailPath: string | null
  map: BeatSaverMap | null
  player: PlayerProfile | null
  /** Player's score on this map, when found on BeatLeader */
  score: PlayerScore | null
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

export type UploadPrivacy = 'private' | 'unlisted' | 'public'

export interface VideoMetadata {
  title: string
  description: string
  tags: string[]
  categoryId: string
}

export interface UploadRequest {
  videoPath: string
  thumbnailPath: string | null
  metadata: VideoMetadata
  privacy: UploadPrivacy
  /** ISO timestamp — when set, video is scheduled (privacy forced to private until then) */
  publishAt: string | null
  playlistId: string | null
  /** Mark as a Short (adds #Shorts handling) — informational only */
  isShort: boolean
}

export type UploadStatus =
  | 'pending'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface UploadJob {
  id: string
  request: UploadRequest
  status: UploadStatus
  /** 0..100 */
  progress: number
  attempts: number
  error: string | null
  youtubeVideoId: string | null
  createdAt: number
  finishedAt: number | null
}

export interface YouTubeAccount {
  channelId: string
  channelTitle: string
  thumbnailUrl: string
}

export interface YouTubePlaylist {
  id: string
  title: string
  itemCount: number
}

export interface UploadPreset {
  id: string
  name: string
  privacy: UploadPrivacy
  playlistId: string | null
  extraTags: string[]
  descriptionFooter: string
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export interface AutomationSettings {
  enabled: boolean
  inputFolder: string
  archiveFolder: string
  mode: VideoMode | 'both'
  /** Upload automatically after rendering */
  autoUpload: boolean
  /** Pause for manual metadata review before uploading */
  requireReview: boolean
  generateThumbnail: boolean
  defaultPrivacy: UploadPrivacy
  playlistId: string | null
}

export type AutomationItemStatus =
  | 'detected'
  | 'needs_map_id'
  | 'queued'
  | 'rendering'
  | 'awaiting_review'
  | 'ready_to_upload'
  | 'uploading'
  | 'uploaded'
  | 'archived'
  | 'failed'
  | 'skipped'

export interface AutomationItem {
  id: string
  filePath: string
  fileName: string
  status: AutomationItemStatus
  mapId: string | null
  mode: VideoMode
  renderJobId: string | null
  uploadJobId: string | null
  outputPath: string | null
  thumbnailPath: string | null
  metadata: VideoMetadata | null
  error: string | null
  detectedAt: number
  updatedAt: number
}

export interface ScheduleSettings {
  enabled: boolean
  /** "HH:MM" 24h local time for the daily long-form upload */
  longformTime: string
  /** "HH:MM" times for daily Shorts uploads */
  shortsTimes: string[]
  /** Notify when the ready queue is empty */
  notifyOnEmptyQueue: boolean
}

// ---------------------------------------------------------------------------
// Settings root
// ---------------------------------------------------------------------------

export interface AppSettings {
  outputFolder: string
  playerName: string
  playerProfileUrl: string
  render: RenderSettings
  template: TemplateConfig
  automation: AutomationSettings
  schedule: ScheduleSettings
  uploadPresets: UploadPreset[]
  /** Custom keywords merged into generated tags */
  extraKeywords: string[]
  /** OAuth client credentials for the YouTube Data API */
  youtubeClientId: string
  youtubeClientSecret: string
  checkForUpdates: boolean
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export interface EncoderSupport {
  /** encoder name -> available */
  encoders: Record<string, boolean>
  ffmpegVersion: string | null
  ffmpegPath: string | null
  ffprobePath: string | null
}

export interface VideoFileInfo {
  path: string
  durationSec: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  sizeBytes: number
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
}

export interface AppNotification {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  createdAt: number
}
