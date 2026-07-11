import type { ChannelOverview, VideoStats } from './analytics'

/**
 * Rule-based growth insights: every recommendation is derived from the
 * channel's own measurable data and maps to a knob BeatFrame controls
 * (intro length, format mix, thumbnails, publishing cadence). Pure and
 * deliberately transparent — no black-box "AI score".
 */

export type InsightAction =
  | { kind: 'set-intro-duration'; seconds: number }
  | { kind: 'set-mode-both' }
  | { kind: 'add-short-slot'; time: string }
  | { kind: 'refresh-thumbnail'; videoId: string; mapId: string }

export interface Insight {
  id: string
  level: 'good' | 'suggestion' | 'warning'
  title: string
  detail: string
  action?: InsightAction
}

export interface InsightContext {
  subscriberGoal: number
  introDurationSec: number
  automationMode: 'longform' | 'short' | 'both'
  shortsSlotCount: number
}

export function subsEtaDays(current: number, goal: number, gained28d: number): number | null {
  if (current >= goal) return 0
  if (gained28d <= 0) return null
  return Math.ceil((goal - current) / (gained28d / 28))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const DAY_MS = 24 * 3600 * 1000

export function computeInsights(overview: ChannelOverview, ctx: InsightContext): Insight[] {
  const insights: Insight[] = []
  const publicVideos = overview.videos.filter((v) => v.privacyStatus === 'public')
  const longs = publicVideos.filter((v) => !v.isShort)
  const shorts = publicVideos.filter((v) => v.isShort)

  // --- 1. Goal progress -----------------------------------------------------
  const eta = subsEtaDays(overview.subscriberCount, ctx.subscriberGoal, overview.subsGained28d)
  if (overview.subscriberCount >= ctx.subscriberGoal) {
    insights.push({
      id: 'goal-reached',
      level: 'good',
      title: `🎉 ${ctx.subscriberGoal.toLocaleString()} subscribers reached!`,
      detail: `You're at ${overview.subscriberCount.toLocaleString()} — monetization requirements also need 4,000 public watch hours (or 10M Shorts views).`
    })
  } else if (eta !== null) {
    insights.push({
      id: 'goal-eta',
      level: 'good',
      title: `+${overview.subsGained28d} subscribers in the last 28 days`,
      detail: `At this pace you'll hit ${ctx.subscriberGoal.toLocaleString()} in roughly ${eta} days. Consistency is the biggest lever — keep the daily schedule running.`
    })
  } else {
    insights.push({
      id: 'goal-stalled',
      level: 'warning',
      title: 'No subscriber growth in the last 28 days',
      detail: 'The fastest fix is volume + consistency: turn on Autopilot so every session becomes a long-form video and a Short, published daily.'
    })
  }

  // --- 2. Cadence -----------------------------------------------------------
  const now = Date.now()
  const uploads28d = publicVideos.filter((v) => v.publishedAt && now - Date.parse(v.publishedAt) < 28 * DAY_MS)
  if (uploads28d.length < 8 && overview.subscriberCount < ctx.subscriberGoal) {
    insights.push({
      id: 'cadence',
      level: 'suggestion',
      title: `Only ${uploads28d.length} upload${uploads28d.length === 1 ? '' : 's'} in the last 28 days`,
      detail:
        'Small channels grow primarily through upload volume — the algorithm needs shots on goal. Daily Shorts plus regular long-forms is the proven path under 1,000 subs.',
      action: ctx.automationMode !== 'both' ? { kind: 'set-mode-both' } : undefined
    })
  }

  // --- 3. Format comparison ---------------------------------------------------
  const subsPerKView = (vids: VideoStats[]): number | null => {
    const views = vids.reduce((n, v) => n + v.views, 0)
    const subs = vids.reduce((n, v) => n + (v.subscribersGained ?? 0), 0)
    return views >= 200 ? (subs / views) * 1000 : null
  }
  const shortRate = subsPerKView(shorts)
  const longRate = subsPerKView(longs)
  if (shortRate !== null && longRate !== null && shorts.length >= 2 && longs.length >= 2) {
    if (shortRate > longRate * 1.5) {
      insights.push({
        id: 'format-shorts',
        level: 'suggestion',
        title: 'Shorts are your subscriber engine right now',
        detail: `Shorts convert ${shortRate.toFixed(1)} subs per 1,000 views vs ${longRate.toFixed(1)} for long-forms. Consider a second daily Short slot.`,
        action: ctx.shortsSlotCount < 2 ? { kind: 'add-short-slot', time: '17:00' } : undefined
      })
    } else if (longRate > shortRate * 1.5) {
      insights.push({
        id: 'format-longform',
        level: 'good',
        title: 'Long-form videos convert viewers best',
        detail: `Long-forms earn ${longRate.toFixed(1)} subs per 1,000 views vs ${shortRate.toFixed(1)} for Shorts — your end screens and watch time are doing their job.`
      })
    }
  }

  // --- 4. Retention / intro length -------------------------------------------
  const retentions = longs.map((v) => v.averageViewPercentage).filter((r): r is number => r !== null)
  if (retentions.length >= 3) {
    const med = median(retentions)
    if (med < 35 && ctx.introDurationSec > 4) {
      insights.push({
        id: 'retention-intro',
        level: 'suggestion',
        title: `Viewers watch ${Math.round(med)}% of your long-forms on average`,
        detail: `Early drop-off is the usual culprit. Your intro card runs ${ctx.introDurationSec}s — tightening it to 4s gets people to the gameplay faster.`,
        action: { kind: 'set-intro-duration', seconds: 4 }
      })
    } else if (med >= 50) {
      insights.push({
        id: 'retention-good',
        level: 'good',
        title: `Strong retention: ${Math.round(med)}% average watch`,
        detail: 'Well above typical for gaming uploads — your pacing works. Focus energy on titles and thumbnails to grow reach.'
      })
    }
  }

  // --- 5. Thumbnail refresh candidates ----------------------------------------
  const matureLongs = longs.filter((v) => v.publishedAt && now - Date.parse(v.publishedAt) > 7 * DAY_MS)
  if (matureLongs.length >= 3) {
    const med = median(matureLongs.map((v) => v.views))
    const laggard = matureLongs
      .filter((v) => v.views < Math.max(10, med * 0.4) && v.mapId)
      .sort((a, b) => a.views - b.views)[0]
    if (laggard && med >= 25) {
      insights.push({
        id: `thumb-${laggard.videoId}`,
        level: 'suggestion',
        title: `"${truncate(laggard.title, 45)}" is underperforming (${laggard.views} views vs ~${Math.round(med)} typical)`,
        detail: 'A fresh thumbnail is the cheapest second chance — BeatFrame can regenerate it in the alternate style and swap it on YouTube in one click.',
        action: { kind: 'refresh-thumbnail', videoId: laggard.videoId, mapId: laggard.mapId! }
      })
    }
  }

  // --- 6. Celebrate the winner -------------------------------------------------
  const winner = [...publicVideos].sort((a, b) => (b.subscribersGained ?? 0) - (a.subscribersGained ?? 0))[0]
  if (winner && (winner.subscribersGained ?? 0) >= 3) {
    insights.push({
      id: 'winner',
      level: 'good',
      title: `"${truncate(winner.title, 45)}" brought in ${winner.subscribersGained} subscribers`,
      detail: 'More of this: similar song energy, same difficulty tier, same format. Winners are the best briefs for your next uploads.'
    })
  }

  return insights
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…'
}
