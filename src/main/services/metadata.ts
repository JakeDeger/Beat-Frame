import type { BeatSaverMap, PlayerProfile, PlayerScore, VideoMetadata, VideoMode } from '@shared/types'

/**
 * SEO-aware YouTube metadata generation from BeatSaver + player data.
 * Pure functions — unit tested in tests/metadata.test.ts.
 *
 * Guidelines applied:
 *  - Titles < 100 chars (YouTube hard limit), front-load the song name.
 *  - Descriptions: first 2 lines carry the hook (shown before "more").
 *  - Tags: relevant only, total < 500 chars (YouTube limit), no spam.
 *  - Hashtags: max 3 in the description (YouTube only shows 3 above title).
 *  - No clickbait claims — titles describe exactly what the video is.
 */

export interface MetadataInput {
  map: BeatSaverMap
  player: PlayerProfile | null
  playerName: string
  mode: VideoMode
  extraKeywords: string[]
  channelName: string
  /** Player's own score on the map (optional; adds an accuracy line) */
  score?: PlayerScore | null
}

const TITLE_MAX = 100
const TAGS_MAX_TOTAL = 480
const GAMING_CATEGORY_ID = '20'

export function generateMetadata(input: MetadataInput): VideoMetadata {
  return {
    title: generateTitle(input),
    description: generateDescription(input),
    tags: generateTags(input),
    categoryId: GAMING_CATEGORY_ID
  }
}

export function generateTitle(input: MetadataInput): string {
  const { map, mode } = input
  const song = cleanupWhitespace(map.songName)
  const artist = cleanupWhitespace(map.songAuthorName)
  const player = displayPlayerName(input)
  const diff = topDifficultyLabel(map)

  const parts: string[] = []
  const core = artist && artist !== 'Unknown Artist' ? `${song} - ${artist}` : song
  parts.push(core)
  if (diff) parts.push(diff)
  parts.push('Beat Saber')
  if (player) parts.push(`by ${player}`)
  if (mode === 'short') parts.push('#shorts')

  let title = parts.join(' | ')
  // Degrade gracefully to stay under the limit: drop player, then difficulty.
  if (title.length > TITLE_MAX) {
    title = [core, diff, 'Beat Saber', mode === 'short' ? '#shorts' : '']
      .filter(Boolean)
      .join(' | ')
  }
  if (title.length > TITLE_MAX) {
    title = [core, 'Beat Saber'].join(' | ')
  }
  if (title.length > TITLE_MAX) {
    title = truncate(core, TITLE_MAX - 13) + ' | Beat Saber'
  }
  return title
}

export function generateDescription(input: MetadataInput): string {
  const { map, mode } = input
  const song = cleanupWhitespace(map.songName)
  const artist = cleanupWhitespace(map.songAuthorName)
  const player = displayPlayerName(input)
  const diff = topDifficultyLabel(map)

  const lines: string[] = []
  lines.push(
    `${song}${artist && artist !== 'Unknown Artist' ? ` by ${artist}` : ''} — played in Beat Saber${diff ? ` on ${diff}` : ''}${player ? ` by ${player}` : ''}.`
  )
  lines.push('')
  lines.push(`🎵 Song: ${song}`)
  if (artist && artist !== 'Unknown Artist') lines.push(`🎤 Artist: ${artist}`)
  lines.push(`🗺️ Map by: ${cleanupWhitespace(map.levelAuthorName)}`)
  lines.push(`📥 Map: https://beatsaver.com/maps/${map.id}`)
  if (map.bpm > 0) lines.push(`⚡ BPM: ${Math.round(map.bpm)}`)
  if (input.score && input.score.accuracy > 0) {
    const rank = input.score.rank > 0 ? ` (#${input.score.rank} on BeatLeader)` : ''
    lines.push(`🎯 Accuracy: ${(input.score.accuracy * 100).toFixed(2)}%${rank}`)
  }
  if (input.player) {
    const platform = input.player.platform === 'beatleader' ? 'BeatLeader' : 'ScoreSaber'
    lines.push(`👤 ${platform} profile: ${input.player.profileUrl}`)
  }
  lines.push('')
  lines.push('Recorded and edited automatically with BeatFrame Studio.')
  if (input.channelName) {
    lines.push('')
    lines.push(`Subscribe to ${cleanupWhitespace(input.channelName)} for more Beat Saber gameplay!`)
  }
  lines.push('')
  lines.push(hashtagsLine(mode))
  return lines.join('\n')
}

export function hashtagsLine(mode: VideoMode): string {
  // YouTube surfaces at most 3 hashtags above the title — never exceed that.
  return mode === 'short' ? '#BeatSaber #Shorts #VR' : '#BeatSaber #VR #Rhythm'
}

export function generateTags(input: MetadataInput): string[] {
  const { map } = input
  const song = cleanupWhitespace(map.songName)
  const artist = cleanupWhitespace(map.songAuthorName)
  const player = displayPlayerName(input)
  const diff = topDifficultyLabel(map)

  const candidates = [
    'beat saber',
    'beat saber gameplay',
    song,
    artist !== 'Unknown Artist' ? artist : '',
    `${song} beat saber`,
    diff ? `beat saber ${diff.toLowerCase()}` : '',
    cleanupWhitespace(map.levelAuthorName),
    player,
    'vr',
    'vr gaming',
    'rhythm game',
    'virtual reality',
    input.mode === 'short' ? 'shorts' : 'full combo',
    ...input.extraKeywords.map(cleanupWhitespace)
  ]

  const seen = new Set<string>()
  const tags: string[] = []
  let total = 0
  for (const raw of candidates) {
    const tag = cleanupWhitespace(raw).slice(0, 100)
    const key = tag.toLowerCase()
    if (!tag || tag.length < 2 || seen.has(key)) continue
    // +2 approximates YouTube counting quoted/comma overhead per tag.
    if (total + tag.length + 2 > TAGS_MAX_TOTAL) break
    seen.add(key)
    tags.push(tag)
    total += tag.length + 2
  }
  return tags
}

// ---------------------------------------------------------------------------

function displayPlayerName(input: MetadataInput): string {
  return cleanupWhitespace(input.playerName || input.player?.name || '')
}

export function topDifficultyLabel(map: BeatSaverMap): string | null {
  const order = ['Expert+', 'Expert', 'Hard', 'Normal', 'Easy']
  const standard = map.difficulties.filter((d) => d.characteristic === 'Standard')
  const pool = standard.length > 0 ? standard : map.difficulties
  for (const name of order) {
    if (pool.some((d) => d.difficulty === name)) return name
  }
  return pool[0]?.difficulty ?? null
}

function cleanupWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}
