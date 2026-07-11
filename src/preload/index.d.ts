import type {
  AppNotification,
  AppSettings,
  AutomationItem,
  BeatSaverMap,
  EncoderSupport,
  PlayerProfile,
  PlayerScore,
  RenderJob,
  RenderRequest,
  UpdateInfo,
  UploadJob,
  UploadRequest,
  VideoFileInfo,
  VideoMetadata,
  YouTubeAccount,
  YouTubePlaylist
} from '../shared/types'

/** Strongly-typed surface of the preload bridge as seen from the renderer. */
export interface Api {
  getSettings(): Promise<AppSettings>
  setSettings(settings: AppSettings): Promise<AppSettings>

  pickVideo(): Promise<string | null>
  pickFolder(title?: string): Promise<string | null>
  pickImage(): Promise<string | null>
  openPath(p: string): Promise<unknown>
  openExternal(url: string): Promise<unknown>
  showInFolder(p: string): Promise<unknown>

  probeVideo(path: string): Promise<VideoFileInfo>
  detectEncoders(force?: boolean): Promise<EncoderSupport>

  lookupMap(mapId: string): Promise<BeatSaverMap>
  lookupPlayer(profileUrl: string): Promise<PlayerProfile>
  generateMetadata(input: {
    map: BeatSaverMap
    player: PlayerProfile | null
    playerName: string
    mode: 'longform' | 'short'
    extraKeywords: string[]
    channelName: string
    score?: PlayerScore | null
    descriptionFooter?: string
  }): Promise<VideoMetadata>
  cardPreview(kind: 'intro' | 'intro-short' | 'outro' | 'thumbnail', mapId: string): Promise<string>
  pathForFile(file: File): string

  enqueueRender(request: RenderRequest): Promise<RenderJob>
  cancelRender(id: string): Promise<void>
  removeRender(id: string): Promise<void>
  listRenders(): Promise<RenderJob[]>
  clearFinishedRenders(): Promise<void>

  ytSignIn(): Promise<YouTubeAccount | null>
  ytAuthStatus(): Promise<YouTubeAccount | null>
  ytSignOut(): Promise<void>
  ytPlaylists(): Promise<YouTubePlaylist[]>
  enqueueUpload(request: UploadRequest): Promise<UploadJob>
  listUploads(): Promise<UploadJob[]>
  retryUpload(id: string): Promise<void>
  cancelUpload(id: string): Promise<void>
  removeUpload(id: string): Promise<void>

  ytInsights(): Promise<{
    overview: {
      channelId: string
      channelTitle: string
      subscriberCount: number
      totalViews: number
      videoCount: number
      subsGained28d: number
      views28d: number
      videos: Array<{
        videoId: string
        title: string
        publishedAt: string
        durationSec: number
        isShort: boolean
        privacyStatus: string
        views: number
        averageViewPercentage: number | null
        subscribersGained: number | null
        mapId: string | null
        thumbnailUrl: string
      }>
    }
    insights: Array<{
      id: string
      level: 'good' | 'suggestion' | 'warning'
      title: string
      detail: string
      action?:
        | { kind: 'set-intro-duration'; seconds: number }
        | { kind: 'set-mode-both' }
        | { kind: 'add-short-slot'; time: string }
        | { kind: 'refresh-thumbnail'; videoId: string; mapId: string }
    }>
    subscriberGoal: number
  }>
  ytRefreshThumbnail(videoId: string, mapId: string): Promise<string>

  automationItems(): Promise<AutomationItem[]>
  automationStatus(): Promise<{
    watching: boolean
    signedIn: boolean
    upcoming: Array<{ iso: string; mode: 'longform' | 'short'; title: string }>
  }>
  automationSetMapId(itemId: string, mapId: string): Promise<void>
  automationApprove(itemId: string, metadata: VideoMetadata | null): Promise<void>
  automationSkip(itemId: string): Promise<void>
  automationRetry(itemId: string): Promise<void>

  appVersion(): Promise<string>
  checkForUpdates(): Promise<UpdateInfo>
  openLogs(): Promise<unknown>

  onRenderJobsChanged(cb: (jobs: RenderJob[]) => void): () => void
  onUploadJobsChanged(cb: (jobs: UploadJob[]) => void): () => void
  onAutomationChanged(cb: (items: AutomationItem[]) => void): () => void
  onNotification(cb: (n: AppNotification) => void): () => void
  onAuthChanged(cb: () => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}

export {}
