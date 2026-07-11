import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { fetchJson, downloadFile, HttpError } from './http'
import { createLogger } from './logger'
import type { PlayerPlatform, PlayerProfile, PlayerScore } from '@shared/types'

const log = createLogger('players')

export class PlayerLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlayerLookupError'
  }
}

/**
 * Parse a BeatLeader or ScoreSaber profile URL (or bare numeric ID prefixed
 * with a platform, e.g. "beatleader:76561198...") into platform + player ID.
 */
export function parseProfileUrl(input: string): { platform: PlayerPlatform; id: string } | null {
  const text = input.trim()
  if (!text) return null

  const bl = text.match(/(?:www\.)?beatleader\.(?:xyz|com|net)\/u\/([A-Za-z0-9_-]+)/i)
  if (bl) return { platform: 'beatleader', id: bl[1] }

  const ss = text.match(/(?:www\.)?scoresaber\.com\/u\/(\d+)/i)
  if (ss) return { platform: 'scoresaber', id: ss[1] }

  const prefixed = text.match(/^(beatleader|scoresaber):(\S+)$/i)
  if (prefixed) return { platform: prefixed[1].toLowerCase() as PlayerPlatform, id: prefixed[2] }

  return null
}

interface BeatLeaderPlayer {
  id?: string
  name?: string
  avatar?: string
  country?: string
  rank?: number
}

interface ScoreSaberPlayer {
  id?: string
  name?: string
  profilePicture?: string
  country?: string
  rank?: number
}

const cache = new Map<string, PlayerProfile>()

export async function lookupPlayer(profileUrl: string): Promise<PlayerProfile> {
  const parsed = parseProfileUrl(profileUrl)
  if (!parsed) {
    throw new PlayerLookupError(
      'Could not recognize that profile link. Paste a BeatLeader (beatleader.xyz/u/...) or ScoreSaber (scoresaber.com/u/...) profile URL.'
    )
  }
  const cacheKey = `${parsed.platform}:${parsed.id}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  let profile: PlayerProfile
  try {
    if (parsed.platform === 'beatleader') {
      // .com is BeatLeader's primary domain; .xyz kept as a fallback.
      let p: BeatLeaderPlayer
      try {
        p = await fetchJson<BeatLeaderPlayer>(`https://api.beatleader.com/player/${encodeURIComponent(parsed.id)}`, { retries: 1 })
      } catch (first) {
        if (first instanceof HttpError && first.status === 404) throw first
        log.warn('api.beatleader.com failed, trying .xyz', first instanceof Error ? first.message : first)
        p = await fetchJson<BeatLeaderPlayer>(`https://api.beatleader.xyz/player/${encodeURIComponent(parsed.id)}`, { retries: 1 })
      }
      profile = {
        platform: 'beatleader',
        id: p.id ?? parsed.id,
        name: p.name ?? 'Unknown Player',
        avatarUrl: p.avatar ?? '',
        country: p.country ?? '',
        rank: p.rank ?? 0,
        profileUrl: `https://beatleader.com/u/${p.id ?? parsed.id}`
      }
    } else {
      const p = await fetchJson<ScoreSaberPlayer>(
        `https://scoresaber.com/api/player/${encodeURIComponent(parsed.id)}/basic`
      )
      profile = {
        platform: 'scoresaber',
        id: p.id ?? parsed.id,
        name: p.name ?? 'Unknown Player',
        avatarUrl: p.profilePicture ?? '',
        country: p.country ?? '',
        rank: p.rank ?? 0,
        profileUrl: `https://scoresaber.com/u/${p.id ?? parsed.id}`
      }
    }
  } catch (err) {
    if (err instanceof PlayerLookupError) throw err
    const site = parsed.platform === 'beatleader' ? 'BeatLeader' : 'ScoreSaber'
    if (err instanceof HttpError && err.status === 404) {
      throw new PlayerLookupError(
        `${site} has no player "${parsed.id}" — open your profile in a browser and copy the URL exactly.`
      )
    }
    const detail = err instanceof HttpError ? `HTTP ${err.status}` : err instanceof Error ? err.message.split('\n')[0] : 'network error'
    throw new PlayerLookupError(
      `Could not reach ${site} (${detail}). Check your internet connection or firewall, then try again.`
    )
  }

  // Cache the avatar locally so title cards can embed it (non-fatal on failure).
  if (profile.avatarUrl) {
    try {
      const avatarDir = path.join(app.getPath('userData'), 'avatars')
      const avatarPath = path.join(avatarDir, `${profile.platform}-${profile.id}.png`)
      if (!fs.existsSync(avatarPath)) {
        await downloadFile(profile.avatarUrl, avatarPath)
      }
      ;(profile as PlayerProfile & { avatarPath?: string }).avatarPath = avatarPath
    } catch (err) {
      log.warn('avatar download failed', err)
    }
  }

  cache.set(cacheKey, profile)
  return profile
}

/** Local avatar path attached by lookupPlayer (present after a successful download). */
export function playerAvatarPath(profile: PlayerProfile): string | null {
  const p = (profile as PlayerProfile & { avatarPath?: string }).avatarPath
  return p && fs.existsSync(p) ? p : null
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/** Convert our display difficulty names to BeatLeader API identifiers. */
export function difficultyToBeatLeader(difficulty: string): string {
  const table: Record<string, string> = {
    'Expert+': 'ExpertPlus',
    Expert: 'Expert',
    Hard: 'Hard',
    Normal: 'Normal',
    Easy: 'Easy'
  }
  return table[difficulty] ?? difficulty.replace(/\+$/, 'Plus').replace(/\s+/g, '')
}

interface BeatLeaderScore {
  accuracy?: number
  rank?: number
}

/**
 * Fetch the player's own score for a map (BeatLeader only). Returns null when
 * the player has no score there — callers treat this as purely optional data.
 */
export async function fetchBeatLeaderScore(
  playerId: string,
  mapHash: string,
  difficulty: string,
  characteristic = 'Standard'
): Promise<PlayerScore | null> {
  if (!playerId || !mapHash) return null
  const pathPart = `score/${encodeURIComponent(playerId)}/${encodeURIComponent(mapHash)}/${encodeURIComponent(difficultyToBeatLeader(difficulty))}/${encodeURIComponent(characteristic)}`
  for (const base of ['https://api.beatleader.com', 'https://api.beatleader.xyz']) {
    try {
      const score = await fetchJson<BeatLeaderScore>(`${base}/${pathPart}`, { retries: 0, timeoutMs: 10_000 })
      if (typeof score.accuracy !== 'number' || score.accuracy <= 0) return null
      return { accuracy: score.accuracy, rank: score.rank ?? 0 }
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null // player simply has no score
      log.warn(`score lookup failed via ${base}`, err instanceof Error ? err.message : err)
    }
  }
  return null
}

/** Format a 0..1 accuracy as a display label, e.g. 0.97423 -> "97.42%". */
export function formatAccuracy(accuracy: number): string {
  return `${(accuracy * 100).toFixed(2)}%`
}
