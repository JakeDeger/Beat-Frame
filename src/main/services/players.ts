import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { fetchJson, downloadFile, HttpError } from './http'
import { createLogger } from './logger'
import type { PlayerPlatform, PlayerProfile } from '@shared/types'

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
      const p = await fetchJson<BeatLeaderPlayer>(`https://api.beatleader.xyz/player/${encodeURIComponent(parsed.id)}`)
      profile = {
        platform: 'beatleader',
        id: p.id ?? parsed.id,
        name: p.name ?? 'Unknown Player',
        avatarUrl: p.avatar ?? '',
        country: p.country ?? '',
        rank: p.rank ?? 0,
        profileUrl: `https://beatleader.xyz/u/${p.id ?? parsed.id}`
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
    if (err instanceof HttpError && err.status === 404) {
      throw new PlayerLookupError(`No ${parsed.platform === 'beatleader' ? 'BeatLeader' : 'ScoreSaber'} player found for that link.`)
    }
    throw new PlayerLookupError(
      `Could not load the player profile (${err instanceof Error ? err.message : 'network error'}).`
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
