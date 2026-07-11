import { getAccessToken } from './auth'
import { createLogger } from '../logger'

const log = createLogger('yt-analytics')
const DATA_API = 'https://www.googleapis.com/youtube/v3'
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2'

/**
 * Channel growth data for the "road to 1000 subs" insights.
 *
 * Honest scope note: YouTube's public Analytics API exposes views, watch
 * percentage and subscribers gained — it does NOT expose impressions or
 * thumbnail click-through rate (Studio-only). The insights engine therefore
 * optimizes what is actually measurable.
 */

export class AnalyticsScopeError extends Error {
  constructor() {
    super('The connected Google account has not granted analytics access. Disconnect and reconnect your YouTube account to enable Channel insights.')
    this.name = 'AnalyticsScopeError'
  }
}

export interface VideoStats {
  videoId: string
  title: string
  publishedAt: string
  /** ISO8601 duration converted to seconds */
  durationSec: number
  isShort: boolean
  privacyStatus: string
  views: number
  averageViewPercentage: number | null
  subscribersGained: number | null
  /** True when we found a beatsaver.com map link in the description */
  mapId: string | null
  thumbnailUrl: string
}

export interface ChannelOverview {
  channelId: string
  channelTitle: string
  subscriberCount: number
  totalViews: number
  videoCount: number
  /** Last 28 days */
  subsGained28d: number
  views28d: number
  videos: VideoStats[]
}

async function apiFetch<T>(url: string): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 403 && /insufficient|forbidden|scope/i.test(text)) {
      throw new AnalyticsScopeError()
    }
    throw new Error(`YouTube API error (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** Parse ISO8601 durations like PT1M30S / PT2H3M4S into seconds. */
export function parseIsoDuration(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

export async function getChannelOverview(): Promise<ChannelOverview> {
  const ch = await apiFetch<{
    items?: Array<{
      id: string
      snippet?: { title?: string }
      statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string }
      contentDetails?: { relatedPlaylists?: { uploads?: string } }
    }>
  }>(`${DATA_API}/channels?part=snippet,statistics,contentDetails&mine=true`)
  const channel = ch.items?.[0]
  if (!channel) throw new Error('No YouTube channel found for the connected account.')

  const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads
  let videos: VideoStats[] = []
  if (uploadsPlaylist) {
    const playlist = await apiFetch<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>(
      `${DATA_API}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylist}&maxResults=20`
    )
    const ids = (playlist.items ?? []).map((i) => i.contentDetails?.videoId).filter((v): v is string => !!v)
    if (ids.length > 0) {
      const vres = await apiFetch<{
        items?: Array<{
          id: string
          snippet?: { title?: string; publishedAt?: string; description?: string; thumbnails?: { medium?: { url?: string } } }
          contentDetails?: { duration?: string }
          statistics?: { viewCount?: string }
          status?: { privacyStatus?: string }
        }>
      }>(`${DATA_API}/videos?part=snippet,contentDetails,statistics,status&id=${ids.join(',')}`)

      videos = (vres.items ?? []).map((v) => {
        const durationSec = parseIsoDuration(v.contentDetails?.duration ?? 'PT0S')
        const description = v.snippet?.description ?? ''
        const mapMatch = description.match(/beatsaver\.com\/maps\/([0-9a-fA-F]{1,8})/i)
        return {
          videoId: v.id,
          title: v.snippet?.title ?? 'Untitled',
          publishedAt: v.snippet?.publishedAt ?? '',
          durationSec,
          isShort: durationSec > 0 && durationSec <= 183,
          privacyStatus: v.status?.privacyStatus ?? 'private',
          views: Number(v.statistics?.viewCount ?? 0),
          averageViewPercentage: null,
          subscribersGained: null,
          mapId: mapMatch ? mapMatch[1].toLowerCase() : null,
          thumbnailUrl: v.snippet?.thumbnails?.medium?.url ?? ''
        }
      })

      // Per-video analytics for the last 90 days.
      try {
        const report = await apiFetch<{ rows?: Array<Array<string | number>> }>(
          `${ANALYTICS_API}/reports?ids=channel==MINE&startDate=${isoDaysAgo(90)}&endDate=${isoDaysAgo(0)}` +
            `&metrics=views,averageViewPercentage,subscribersGained&dimensions=video&filters=video==${ids.join(',')}`
        )
        const byId = new Map((report.rows ?? []).map((r) => [String(r[0]), r]))
        for (const v of videos) {
          const row = byId.get(v.videoId)
          if (row) {
            v.averageViewPercentage = Math.round(Number(row[2]) * 10) / 10
            v.subscribersGained = Number(row[3])
          }
        }
      } catch (err) {
        if (err instanceof AnalyticsScopeError) throw err
        log.warn('per-video analytics failed (continuing with Data API stats)', err instanceof Error ? err.message : err)
      }
    }
  }

  // Channel totals for the last 28 days.
  let subsGained28d = 0
  let views28d = 0
  try {
    const totals = await apiFetch<{ rows?: Array<Array<number>> }>(
      `${ANALYTICS_API}/reports?ids=channel==MINE&startDate=${isoDaysAgo(28)}&endDate=${isoDaysAgo(0)}&metrics=views,subscribersGained`
    )
    const row = totals.rows?.[0]
    if (row) {
      views28d = Number(row[0] ?? 0)
      subsGained28d = Number(row[1] ?? 0)
    }
  } catch (err) {
    if (err instanceof AnalyticsScopeError) throw err
    log.warn('channel totals failed', err instanceof Error ? err.message : err)
  }

  return {
    channelId: channel.id,
    channelTitle: channel.snippet?.title ?? 'My Channel',
    subscriberCount: Number(channel.statistics?.subscriberCount ?? 0),
    totalViews: Number(channel.statistics?.viewCount ?? 0),
    videoCount: Number(channel.statistics?.videoCount ?? 0),
    subsGained28d,
    views28d,
    videos
  }
}
