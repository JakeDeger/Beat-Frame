import fs from 'fs'
import { getAccessToken } from './auth'
import { createLogger } from '../logger'
import type { UploadRequest, YouTubeAccount, YouTubePlaylist } from '@shared/types'

const log = createLogger('yt-api')
const API = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3'
const CHUNK_SIZE = 8 * 1024 * 1024 // multiple of 256 KiB as required by Google

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false
  ) {
    super(message)
    this.name = 'YouTubeApiError'
  }
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  })
  if (!res.ok) {
    const text = await res.text()
    const retryable = res.status === 429 || res.status >= 500
    throw new YouTubeApiError(parseApiError(text, res.status), res.status, retryable)
  }
  return (await res.json()) as T
}

function parseApiError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }
    const reason = parsed.error?.errors?.[0]?.reason
    if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') {
      return 'YouTube API quota or upload limit exceeded. Try again after midnight Pacific Time.'
    }
    return parsed.error?.message ?? `YouTube API error (HTTP ${status})`
  } catch {
    return `YouTube API error (HTTP ${status})`
  }
}

// ---------------------------------------------------------------------------
// Channel / playlists
// ---------------------------------------------------------------------------

export async function getMyChannel(): Promise<YouTubeAccount | null> {
  const data = await apiFetch<{
    items?: Array<{ id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }>
  }>(`${API}/channels?part=snippet&mine=true`)
  const ch = data.items?.[0]
  if (!ch) return null
  return {
    channelId: ch.id,
    channelTitle: ch.snippet?.title ?? 'My Channel',
    thumbnailUrl: ch.snippet?.thumbnails?.default?.url ?? ''
  }
}

export async function listMyPlaylists(): Promise<YouTubePlaylist[]> {
  const playlists: YouTubePlaylist[] = []
  let pageToken = ''
  do {
    const data = await apiFetch<{
      items?: Array<{ id: string; snippet?: { title?: string }; contentDetails?: { itemCount?: number } }>
      nextPageToken?: string
    }>(`${API}/playlists?part=snippet,contentDetails&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`)
    for (const item of data.items ?? []) {
      playlists.push({
        id: item.id,
        title: item.snippet?.title ?? 'Untitled playlist',
        itemCount: item.contentDetails?.itemCount ?? 0
      })
    }
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return playlists
}

export async function addToPlaylist(playlistId: string, videoId: string): Promise<void> {
  await apiFetch(`${API}/playlistItems?part=snippet`, {
    method: 'POST',
    body: JSON.stringify({
      snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } }
    })
  })
}

// ---------------------------------------------------------------------------
// Resumable upload
// ---------------------------------------------------------------------------

export interface UploadProgressFn {
  (uploadedBytes: number, totalBytes: number): void
}

/**
 * Resumable upload per Google's protocol: initiate a session, then PUT the
 * file in chunks. Interrupted chunks are retried with backoff by querying the
 * session for the last committed byte.
 */
export async function uploadVideo(
  request: UploadRequest,
  onProgress: UploadProgressFn,
  isCancelled: () => boolean
): Promise<string> {
  if (!fs.existsSync(request.videoPath)) {
    throw new YouTubeApiError(`Video file not found: ${request.videoPath}`)
  }
  const totalBytes = fs.statSync(request.videoPath).size
  const token = await getAccessToken()

  const snippet = {
    title: request.metadata.title.slice(0, 100),
    description: request.metadata.description.slice(0, 4900),
    tags: request.metadata.tags,
    categoryId: request.metadata.categoryId
  }
  const status: Record<string, unknown> = {
    privacyStatus: request.publishAt ? 'private' : request.privacy,
    selfDeclaredMadeForKids: false
  }
  if (request.publishAt) status.publishAt = request.publishAt

  const initRes = await fetch(`${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Length': String(totalBytes),
      'X-Upload-Content-Type': 'video/mp4'
    },
    body: JSON.stringify({ snippet, status })
  })
  if (!initRes.ok) {
    const text = await initRes.text()
    throw new YouTubeApiError(parseApiError(text, initRes.status), initRes.status, initRes.status >= 500 || initRes.status === 429)
  }
  const sessionUrl = initRes.headers.get('location')
  if (!sessionUrl) throw new YouTubeApiError('YouTube did not return an upload session URL.')

  const fd = fs.openSync(request.videoPath, 'r')
  try {
    let offset = 0
    let consecutiveFailures = 0
    while (offset < totalBytes) {
      if (isCancelled()) throw new YouTubeApiError('Upload cancelled')
      const chunkLen = Math.min(CHUNK_SIZE, totalBytes - offset)
      const buffer = Buffer.alloc(chunkLen)
      fs.readSync(fd, buffer, 0, chunkLen, offset)

      let res: Response
      try {
        res = await fetch(sessionUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${await getAccessToken()}`,
            'Content-Length': String(chunkLen),
            'Content-Range': `bytes ${offset}-${offset + chunkLen - 1}/${totalBytes}`
          },
          body: new Uint8Array(buffer)
        })
      } catch (err) {
        // Network hiccup: resync offset with the server and retry.
        consecutiveFailures++
        if (consecutiveFailures > 5) {
          throw new YouTubeApiError(`Upload failed repeatedly: ${err instanceof Error ? err.message : err}`, undefined, true)
        }
        await backoff(consecutiveFailures)
        offset = await querySessionOffset(sessionUrl, totalBytes, offset)
        continue
      }

      if (res.status === 308) {
        // Incomplete — server tells us how much it has.
        consecutiveFailures = 0
        const range = res.headers.get('range')
        offset = range ? Number(range.split('-')[1]) + 1 : offset + chunkLen
        onProgress(offset, totalBytes)
      } else if (res.ok) {
        onProgress(totalBytes, totalBytes)
        const body = (await res.json()) as { id?: string }
        if (!body.id) throw new YouTubeApiError('Upload finished but no video ID was returned.')
        log.info(`uploaded video ${body.id}`)
        return body.id
      } else if (res.status === 429 || res.status >= 500) {
        consecutiveFailures++
        if (consecutiveFailures > 5) {
          throw new YouTubeApiError(parseApiError(await res.text(), res.status), res.status, true)
        }
        await backoff(consecutiveFailures)
        offset = await querySessionOffset(sessionUrl, totalBytes, offset)
      } else {
        throw new YouTubeApiError(parseApiError(await res.text(), res.status), res.status)
      }
    }
    throw new YouTubeApiError('Upload loop ended unexpectedly.')
  } finally {
    fs.closeSync(fd)
  }
}

async function querySessionOffset(sessionUrl: string, totalBytes: number, fallback: number): Promise<number> {
  try {
    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        'Content-Length': '0',
        'Content-Range': `bytes */${totalBytes}`
      }
    })
    if (res.status === 308) {
      const range = res.headers.get('range')
      return range ? Number(range.split('-')[1]) + 1 : 0
    }
  } catch {
    /* keep fallback */
  }
  return fallback
}

export async function setThumbnail(videoId: string, thumbnailPath: string, strict = false): Promise<void> {
  if (!fs.existsSync(thumbnailPath)) {
    if (strict) throw new YouTubeApiError('Thumbnail file not found.')
    return
  }
  const token = await getAccessToken()
  const data = fs.readFileSync(thumbnailPath)
  const res = await fetch(`${UPLOAD_API}/thumbnails/set?videoId=${videoId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(data)
  })
  if (!res.ok) {
    const text = await res.text()
    // Custom thumbnails need a verified account — during uploads we warn and
    // continue; explicit user actions (thumbnail refresh) surface the error.
    if (strict) throw new YouTubeApiError(parseApiError(text, res.status), res.status)
    log.warn(`thumbnail set failed (${res.status}): ${text}`)
  }
}

function backoff(attempt: number): Promise<void> {
  const ms = Math.min(30_000, 1000 * 2 ** attempt)
  return new Promise((r) => setTimeout(r, ms))
}
