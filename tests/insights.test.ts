import { describe, expect, it } from 'vitest'
import { computeInsights, subsEtaDays, type InsightContext } from '../src/main/services/youtube/insights'
import { parseIsoDuration, type ChannelOverview, type VideoStats } from '../src/main/services/youtube/analytics'

function video(overrides: Partial<VideoStats> = {}): VideoStats {
  return {
    videoId: 'v' + Math.random().toString(36).slice(2, 8),
    title: 'Song X | Expert+ | Beat Saber',
    publishedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    durationSec: 240,
    isShort: false,
    privacyStatus: 'public',
    views: 100,
    averageViewPercentage: 45,
    subscribersGained: 1,
    mapId: '25f',
    thumbnailUrl: '',
    ...overrides
  }
}

function overview(overrides: Partial<ChannelOverview> = {}): ChannelOverview {
  return {
    channelId: 'c1',
    channelTitle: 'Test',
    subscriberCount: 400,
    totalViews: 20_000,
    videoCount: 30,
    subsGained28d: 60,
    views28d: 4000,
    videos: [],
    ...overrides
  }
}

const ctx: InsightContext = { subscriberGoal: 1000, introDurationSec: 6, automationMode: 'both', shortsSlotCount: 1 }

describe('subsEtaDays', () => {
  it('projects days to goal from the 28-day pace', () => {
    expect(subsEtaDays(400, 1000, 60)).toBe(280) // 600 needed at ~2.14/day
    expect(subsEtaDays(1000, 1000, 0)).toBe(0)
    expect(subsEtaDays(400, 1000, 0)).toBeNull()
  })
})

describe('parseIsoDuration', () => {
  it('parses PT forms', () => {
    expect(parseIsoDuration('PT1M30S')).toBe(90)
    expect(parseIsoDuration('PT2H3M4S')).toBe(7384)
    expect(parseIsoDuration('PT45S')).toBe(45)
    expect(parseIsoDuration('bogus')).toBe(0)
  })
})

describe('computeInsights', () => {
  it('reports pace toward the goal when growing', () => {
    const insights = computeInsights(overview(), ctx)
    const eta = insights.find((i) => i.id === 'goal-eta')
    expect(eta).toBeDefined()
    expect(eta!.title).toContain('+60')
  })

  it('warns when growth is stalled', () => {
    const insights = computeInsights(overview({ subsGained28d: 0 }), ctx)
    expect(insights.some((i) => i.id === 'goal-stalled' && i.level === 'warning')).toBe(true)
  })

  it('celebrates a reached goal', () => {
    const insights = computeInsights(overview({ subscriberCount: 1200 }), ctx)
    expect(insights.some((i) => i.id === 'goal-reached')).toBe(true)
  })

  it('nudges cadence with a set-mode action when uploads are sparse', () => {
    const insights = computeInsights(overview({ videos: [video()] }), { ...ctx, automationMode: 'longform' })
    const cadence = insights.find((i) => i.id === 'cadence')
    expect(cadence).toBeDefined()
    expect(cadence!.action).toEqual({ kind: 'set-mode-both' })
  })

  it('recommends a second Shorts slot when Shorts convert much better', () => {
    const videos = [
      video({ isShort: true, views: 600, subscribersGained: 12 }),
      video({ isShort: true, views: 500, subscribersGained: 9 }),
      video({ views: 400, subscribersGained: 1 }),
      video({ views: 300, subscribersGained: 0 })
    ]
    const insights = computeInsights(overview({ videos }), ctx)
    const fmt = insights.find((i) => i.id === 'format-shorts')
    expect(fmt).toBeDefined()
    expect(fmt!.action).toEqual({ kind: 'add-short-slot', time: '17:00' })
  })

  it('suggests a shorter intro when long-form retention is weak', () => {
    const videos = [
      video({ averageViewPercentage: 25 }),
      video({ averageViewPercentage: 30 }),
      video({ averageViewPercentage: 28 })
    ]
    const insights = computeInsights(overview({ videos }), ctx)
    const retention = insights.find((i) => i.id === 'retention-intro')
    expect(retention).toBeDefined()
    expect(retention!.action).toEqual({ kind: 'set-intro-duration', seconds: 4 })
  })

  it('flags an underperforming video for a thumbnail refresh', () => {
    const videos = [
      video({ views: 200 }),
      video({ views: 180 }),
      video({ views: 150 }),
      video({ videoId: 'lag1', views: 12, mapId: 'abc1' })
    ]
    const insights = computeInsights(overview({ videos }), ctx)
    const thumb = insights.find((i) => i.id === 'thumb-lag1')
    expect(thumb).toBeDefined()
    expect(thumb!.action).toEqual({ kind: 'refresh-thumbnail', videoId: 'lag1', mapId: 'abc1' })
  })

  it('ignores private videos and stays quiet on thin data', () => {
    const videos = [video({ privacyStatus: 'private', views: 0 })]
    const insights = computeInsights(overview({ videos }), ctx)
    expect(insights.some((i) => i.id.startsWith('thumb-'))).toBe(false)
    expect(insights.some((i) => i.id.startsWith('format-'))).toBe(false)
  })
})
