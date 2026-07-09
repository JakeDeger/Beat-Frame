import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BeatSaverMap, PlayerProfile, PlayerScore } from '@shared/types'
import { getSettings } from '../settings'
import { lookupMap } from '../beatsaver'
import { fetchBeatLeaderScore, lookupPlayer } from '../players'
import { bestDifficulty } from '../beatsaver'
import { buildCardData } from './renderQueue'
import { introCardHtml, outroCardHtml, shortIntroCardHtml, thumbnailHtml } from './cardsHtml'
import { captureHtmlToPng, captureHtmlToJpeg } from './capture'

export type PreviewKind = 'intro' | 'intro-short' | 'outro' | 'thumbnail'

/**
 * Render a one-off preview of a title card / end screen / thumbnail as a
 * data: URI, so users can check their template with real map data without
 * running a full render. Falls back to sample data when no map ID is given.
 */
export async function renderCardPreview(kind: PreviewKind, mapId: string): Promise<string> {
  const settings = getSettings()

  let map: BeatSaverMap
  let player: PlayerProfile | null = null
  let score: PlayerScore | null = null
  if (mapId.trim()) {
    map = await lookupMap(mapId.trim())
    if (settings.playerProfileUrl) {
      try {
        player = await lookupPlayer(settings.playerProfileUrl)
        if (player.platform === 'beatleader' && map.hash) {
          const diff = bestDifficulty(map.difficulties)
          if (diff) score = await fetchBeatLeaderScore(player.id, map.hash, diff.difficulty, diff.characteristic)
        }
      } catch {
        // preview stays useful without a profile
      }
    }
  } else {
    map = sampleMap()
  }

  const data = buildCardData(map, player, score, settings.playerName || (mapId ? '' : 'PlayerName'), settings.template)

  const tmp = path.join(os.tmpdir(), `beatframe-preview-${Date.now()}.${kind === 'thumbnail' ? 'jpg' : 'png'}`)
  try {
    if (kind === 'thumbnail') {
      await captureHtmlToJpeg(thumbnailHtml(data), 1280, 720, tmp)
    } else if (kind === 'intro-short') {
      await captureHtmlToPng(shortIntroCardHtml(data), 540, 960, tmp)
    } else if (kind === 'outro') {
      await captureHtmlToPng(outroCardHtml(data), 1280, 720, tmp)
    } else {
      await captureHtmlToPng(introCardHtml(data), 1280, 720, tmp)
    }
    const buf = fs.readFileSync(tmp)
    const mime = kind === 'thumbnail' ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function sampleMap(): BeatSaverMap {
  return {
    id: 'sample',
    name: 'Sample Song',
    songName: 'Sample Song',
    songSubName: '',
    songAuthorName: 'Sample Artist',
    levelAuthorName: 'Sample Mapper',
    bpm: 128,
    durationSec: 180,
    coverUrl: '',
    hash: '',
    difficulties: [{ characteristic: 'Standard', difficulty: 'Expert+', njs: 16, nps: 5.5 }],
    uploadedAt: undefined
  }
}
