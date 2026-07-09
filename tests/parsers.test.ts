import { describe, expect, it } from 'vitest'
import { extractMapId, isValidMapId, normalizeDifficulty, mapFromApi } from '../src/main/services/beatsaver'
import { parseProfileUrl, difficultyToBeatLeader, formatAccuracy } from '../src/main/services/players'
import { isTimeReached } from '../src/main/services/automation'
import { mergeSettings, DEFAULT_SETTINGS } from '../src/shared/defaults'
import { escapeHtml, hexWithAlpha } from '../src/main/services/render/cardsHtml'
import { compareSemver } from '../src/main/services/updates'

describe('extractMapId', () => {
  it('finds ids in bracketed filenames', () => {
    expect(extractMapId('Beat It [25f].mp4')).toBe('25f')
    expect(extractMapId('gameplay (1e6ff) final.mkv')).toBe('1e6ff')
  })
  it('finds beatsaver URLs and !bsr codes', () => {
    expect(extractMapId('https://beatsaver.com/maps/2FFE0')).toBe('2ffe0')
    expect(extractMapId('come play !bsr 25f now')).toBe('25f')
  })
  it('ignores plain words that happen to be hex', () => {
    expect(extractMapId('my cool video.mp4')).toBeNull()
    expect(extractMapId('gameplay [face].mp4')).toBeNull() // no digit -> likely a word
  })
})

describe('isValidMapId', () => {
  it('accepts short hex codes and rejects junk', () => {
    expect(isValidMapId('25f')).toBe(true)
    expect(isValidMapId('1E6FF')).toBe(true)
    expect(isValidMapId('')).toBe(false)
    expect(isValidMapId('hello!')).toBe(false)
    expect(isValidMapId('123456789')).toBe(false)
  })
})

describe('normalizeDifficulty', () => {
  it('maps BeatSaver difficulty ids to display names', () => {
    expect(normalizeDifficulty('expertPlus')).toBe('Expert+')
    expect(normalizeDifficulty('ExpertPlus')).toBe('Expert+')
    expect(normalizeDifficulty('easy')).toBe('Easy')
    expect(normalizeDifficulty('Lawless')).toBe('Lawless')
  })
})

describe('parseProfileUrl', () => {
  it('parses BeatLeader URLs', () => {
    expect(parseProfileUrl('https://beatleader.xyz/u/76561198012345678')).toEqual({
      platform: 'beatleader',
      id: '76561198012345678'
    })
    expect(parseProfileUrl('https://www.beatleader.com/u/abc123')).toEqual({ platform: 'beatleader', id: 'abc123' })
  })
  it('parses ScoreSaber URLs', () => {
    expect(parseProfileUrl('https://scoresaber.com/u/76561198012345678')).toEqual({
      platform: 'scoresaber',
      id: '76561198012345678'
    })
  })
  it('rejects unrelated URLs', () => {
    expect(parseProfileUrl('https://youtube.com/@someone')).toBeNull()
    expect(parseProfileUrl('')).toBeNull()
  })
})

describe('isTimeReached', () => {
  it('compares local HH:MM correctly', () => {
    const at = (h: number, m: number): Date => new Date(2026, 5, 1, h, m)
    expect(isTimeReached(at(18, 0), '18:00')).toBe(true)
    expect(isTimeReached(at(17, 59), '18:00')).toBe(false)
    expect(isTimeReached(at(23, 30), '18:00')).toBe(true)
    expect(isTimeReached(at(9, 5), '9:05')).toBe(true)
  })
  it('rejects malformed times', () => {
    expect(isTimeReached(new Date(), 'noon')).toBe(false)
  })
})

describe('mergeSettings', () => {
  it('fills new fields with defaults after app updates', () => {
    const merged = mergeSettings({ playerName: 'Jake', render: { codec: 'h265' } })
    expect(merged.playerName).toBe('Jake')
    expect(merged.render.codec).toBe('h265')
    expect(merged.render.audioBitrateKbps).toBe(DEFAULT_SETTINGS.render.audioBitrateKbps)
    expect(merged.template.introDurationSec).toBe(DEFAULT_SETTINGS.template.introDurationSec)
  })
  it('tolerates corrupt input', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings('garbage')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('escapeHtml', () => {
  it('escapes markup in song titles', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quotes'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;'
    )
  })
})

describe('hexWithAlpha', () => {
  it('converts hex to rgba', () => {
    expect(hexWithAlpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)')
    expect(hexWithAlpha('0b0e17', 1)).toBe('rgba(11,14,23,1)')
  })
  it('falls back on invalid input', () => {
    expect(hexWithAlpha('red', 0.2)).toContain('rgba(')
  })
})

describe('mapFromApi', () => {
  it('extracts hash, metadata and normalized difficulties', () => {
    const map = mapFromApi(
      {
        id: '25f',
        name: 'Beat It',
        metadata: { songName: 'Beat It', songAuthorName: 'MJ', levelAuthorName: 'Yazer', bpm: 139, duration: 258 },
        versions: [
          {
            hash: 'ABC123DEF456',
            coverURL: 'https://cdn.beatsaver.com/x.jpg',
            diffs: [{ characteristic: 'Standard', difficulty: 'expertPlus', njs: 16, nps: 5.678 }]
          }
        ]
      },
      '25f'
    )
    expect(map.hash).toBe('abc123def456')
    expect(map.difficulties[0].difficulty).toBe('Expert+')
    expect(map.difficulties[0].nps).toBe(5.68)
    expect(map.songAuthorName).toBe('MJ')
  })

  it('fills safe defaults for sparse responses', () => {
    const map = mapFromApi({ id: 'ff' }, 'ff')
    expect(map.songName).toBe('Unknown Song')
    expect(map.hash).toBe('')
    expect(map.difficulties).toEqual([])
  })
})

describe('difficultyToBeatLeader', () => {
  it('maps display names to API identifiers', () => {
    expect(difficultyToBeatLeader('Expert+')).toBe('ExpertPlus')
    expect(difficultyToBeatLeader('Expert')).toBe('Expert')
    expect(difficultyToBeatLeader('Easy')).toBe('Easy')
  })
})

describe('formatAccuracy', () => {
  it('formats 0..1 fractions as percentages', () => {
    expect(formatAccuracy(0.97423)).toBe('97.42%')
    expect(formatAccuracy(1)).toBe('100.00%')
  })
})

describe('compareSemver', () => {
  it('orders versions', () => {
    expect(compareSemver('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('0.9.0', '1.0.0')).toBeLessThan(0)
  })
})
