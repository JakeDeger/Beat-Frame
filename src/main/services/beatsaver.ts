import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { fetchJson, downloadFile, HttpError } from './http'
import { createLogger } from './logger'
import type { BeatSaverMap, MapDifficulty } from '@shared/types'

const log = createLogger('beatsaver')
const API = 'https://api.beatsaver.com'

const cache = new Map<string, BeatSaverMap>()

export class BeatSaverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatSaverError'
  }
}

/** BeatSaver map keys are short hex strings, e.g. "25f", "1e6ff". */
export function isValidMapId(id: string): boolean {
  return /^[0-9a-fA-F]{1,8}$/.test(id.trim())
}

/** Extract a plausible BeatSaver ID from free text (filenames, "!bsr 25f", URLs). */
export function extractMapId(text: string): string | null {
  const url = text.match(/beatsaver\.com\/maps\/([0-9a-fA-F]{1,8})/i)
  if (url) return url[1].toLowerCase()
  const bsr = text.match(/!bsr\s+([0-9a-fA-F]{1,8})\b/i)
  if (bsr) return bsr[1].toLowerCase()
  const bracket = text.match(/[[({]([0-9a-fA-F]{2,8})[\])}]/)
  if (bracket && /\d/.test(bracket[1])) return bracket[1].toLowerCase()
  return null
}

interface ApiMapVersionDiff {
  characteristic?: string
  difficulty?: string
  njs?: number
  nps?: number
  stars?: number
}

export interface ApiMap {
  id: string
  name?: string
  uploaded?: string
  metadata?: {
    songName?: string
    songSubName?: string
    songAuthorName?: string
    levelAuthorName?: string
    bpm?: number
    duration?: number
  }
  versions?: Array<{
    hash?: string
    coverURL?: string
    diffs?: ApiMapVersionDiff[]
  }>
}

/** Pure conversion from the BeatSaver API shape to our domain model. */
export function mapFromApi(raw: ApiMap, fallbackId: string): BeatSaverMap {
  const meta = raw.metadata ?? {}
  const version = raw.versions?.[0]
  const difficulties: MapDifficulty[] = (version?.diffs ?? []).map((d) => ({
    characteristic: d.characteristic ?? 'Standard',
    difficulty: normalizeDifficulty(d.difficulty ?? ''),
    njs: d.njs ?? 0,
    nps: Math.round((d.nps ?? 0) * 100) / 100,
    stars: d.stars
  }))
  return {
    id: raw.id ?? fallbackId,
    name: raw.name ?? meta.songName ?? fallbackId,
    songName: meta.songName ?? raw.name ?? 'Unknown Song',
    songSubName: meta.songSubName ?? '',
    songAuthorName: meta.songAuthorName ?? 'Unknown Artist',
    levelAuthorName: meta.levelAuthorName ?? 'Unknown Mapper',
    bpm: meta.bpm ?? 0,
    durationSec: meta.duration ?? 0,
    coverUrl: version?.coverURL ?? '',
    hash: (version?.hash ?? '').toLowerCase(),
    difficulties,
    uploadedAt: raw.uploaded
  }
}

export async function lookupMap(mapId: string): Promise<BeatSaverMap> {
  const id = mapId.trim().toLowerCase()
  if (!isValidMapId(id)) {
    throw new BeatSaverError(`"${mapId}" is not a valid BeatSaver ID. IDs are short codes like "25f" or "1e6ff".`)
  }
  const cached = cache.get(id)
  if (cached) return cached

  let raw: ApiMap
  try {
    raw = await fetchJson<ApiMap>(`${API}/maps/id/${id}`)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new BeatSaverError(`Map "${id}" was not found on BeatSaver. Double-check the ID.`)
    }
    throw new BeatSaverError(
      `Could not reach BeatSaver (${err instanceof Error ? err.message : 'network error'}). Check your connection and try again.`
    )
  }

  const map = mapFromApi(raw, id)

  // Download cover art for title cards / thumbnails; non-fatal when it fails.
  if (map.coverUrl) {
    try {
      const coverDir = path.join(app.getPath('userData'), 'covers')
      const coverPath = path.join(coverDir, `${map.id}${path.extname(new URL(map.coverUrl).pathname) || '.jpg'}`)
      if (!fs.existsSync(coverPath)) {
        await downloadFile(map.coverUrl, coverPath)
      }
      map.coverPath = coverPath
    } catch (err) {
      log.warn(`cover download failed for ${map.id}`, err)
    }
  }

  cache.set(id, map)
  return map
}

export function normalizeDifficulty(d: string): string {
  const map: Record<string, string> = {
    easy: 'Easy',
    normal: 'Normal',
    hard: 'Hard',
    expert: 'Expert',
    expertplus: 'Expert+'
  }
  return map[d.toLowerCase().replace(/\s+/g, '')] ?? d
}

/** Pick the most impressive difficulty for display (Expert+ > Expert > ...). */
export function bestDifficulty(diffs: MapDifficulty[]): MapDifficulty | null {
  const order = ['Expert+', 'Expert', 'Hard', 'Normal', 'Easy']
  const standard = diffs.filter((d) => d.characteristic === 'Standard')
  const pool = standard.length > 0 ? standard : diffs
  for (const name of order) {
    const found = pool.find((d) => d.difficulty === name)
    if (found) return found
  }
  return pool[0] ?? null
}
