import { describe, expect, it } from 'vitest'
import { generateMetadata, generateTitle, generateTags, topDifficultyLabel } from '../src/main/services/metadata'
import { makeMap } from './helpers'
import type { MetadataInput } from '../src/main/services/metadata'
import type { PlayerProfile } from '../src/shared/types'

const player: PlayerProfile = {
  platform: 'beatleader',
  id: '123',
  name: 'TestPlayer',
  avatarUrl: '',
  country: 'US',
  rank: 42,
  profileUrl: 'https://beatleader.xyz/u/123'
}

function input(overrides: Partial<MetadataInput> = {}): MetadataInput {
  return {
    map: makeMap(),
    player,
    playerName: '',
    mode: 'longform',
    extraKeywords: [],
    channelName: 'MyChannel',
    ...overrides
  }
}

describe('generateTitle', () => {
  it('front-loads song and artist and stays under 100 chars', () => {
    const title = generateTitle(input())
    expect(title.startsWith('Beat It - Michael Jackson')).toBe(true)
    expect(title).toContain('Beat Saber')
    expect(title).toContain('TestPlayer')
    expect(title.length).toBeLessThanOrEqual(100)
  })

  it('appends #shorts for shorts', () => {
    expect(generateTitle(input({ mode: 'short' }))).toContain('#shorts')
  })

  it('degrades gracefully for absurdly long song names', () => {
    const longMap = makeMap({ songName: 'A'.repeat(150), songAuthorName: 'B'.repeat(60) })
    const title = generateTitle(input({ map: longMap }))
    expect(title.length).toBeLessThanOrEqual(100)
    expect(title).toContain('Beat Saber')
  })

  it('prefers the explicit player name over the profile name', () => {
    expect(generateTitle(input({ playerName: 'Override' }))).toContain('Override')
  })

  it('omits unknown artists', () => {
    const title = generateTitle(input({ map: makeMap({ songAuthorName: 'Unknown Artist' }) }))
    expect(title).not.toContain('Unknown Artist')
  })
})

describe('generateMetadata / description', () => {
  it('includes map link, mapper credit and at most 3 hashtags', () => {
    const meta = generateMetadata(input())
    expect(meta.description).toContain('https://beatsaver.com/maps/25f')
    expect(meta.description).toContain('GreatYazer')
    expect(meta.description).toContain('BeatLeader profile: https://beatleader.xyz/u/123')
    const hashtags = meta.description.match(/#\w+/g) ?? []
    expect(hashtags.length).toBeLessThanOrEqual(3)
    expect(meta.categoryId).toBe('20') // Gaming
  })

  it('mentions the channel when configured', () => {
    expect(generateMetadata(input()).description).toContain('MyChannel')
    expect(generateMetadata(input({ channelName: '' })).description).not.toContain('Subscribe to')
  })

  it('includes the accuracy line only when a score exists', () => {
    const withScore = generateMetadata(input({ score: { accuracy: 0.97423, rank: 12 } }))
    expect(withScore.description).toContain('🎯 Accuracy: 97.42% (#12 on BeatLeader)')
    const noRank = generateMetadata(input({ score: { accuracy: 0.5, rank: 0 } }))
    expect(noRank.description).toContain('🎯 Accuracy: 50.00%')
    expect(noRank.description).not.toContain('(#')
    expect(generateMetadata(input()).description).not.toContain('🎯')
  })
})

describe('generateTags', () => {
  it('produces deduplicated, relevant tags under the 500-char budget', () => {
    const tags = generateTags(input({ extraKeywords: ['beat saber', 'vr rhythm'] }))
    expect(tags).toContain('beat saber')
    expect(tags).toContain('Beat It')
    expect(tags).toContain('vr rhythm')
    // no duplicates (case-insensitive)
    const lower = tags.map((t) => t.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
    const total = tags.reduce((n, t) => n + t.length + 2, 0)
    expect(total).toBeLessThanOrEqual(480)
  })

  it('includes difficulty-flavored tag', () => {
    expect(generateTags(input())).toContain('beat saber expert')
  })
})

describe('topDifficultyLabel', () => {
  it('picks the hardest standard difficulty', () => {
    expect(topDifficultyLabel(makeMap())).toBe('Expert')
    expect(
      topDifficultyLabel(
        makeMap({
          difficulties: [
            { characteristic: 'Standard', difficulty: 'Expert+', njs: 16, nps: 6 },
            { characteristic: 'Standard', difficulty: 'Easy', njs: 8, nps: 1 }
          ]
        })
      )
    ).toBe('Expert+')
  })

  it('returns null when there are no difficulties', () => {
    expect(topDifficultyLabel(makeMap({ difficulties: [] }))).toBeNull()
  })
})
