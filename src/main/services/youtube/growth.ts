import os from 'os'
import path from 'path'
import fs from 'fs'
import { JsonStore } from '../store'
import { createLogger } from '../logger'
import { getSettings } from '../settings'
import { lookupMap } from '../beatsaver'
import { buildCardData } from '../render/renderQueue'
import { thumbnailHtml, type ThumbnailVariant } from '../render/cardsHtml'
import { captureHtmlToJpeg } from '../render/capture'
import { setThumbnail } from './api'
import { getChannelOverview, type ChannelOverview } from './analytics'
import { computeInsights, type Insight } from './insights'

const log = createLogger('growth')

/** The channel milestone this app is currently laser-focused on. */
export const SUBSCRIBER_GOAL = 1000

export interface ChannelInsightsResult {
  overview: ChannelOverview
  insights: Insight[]
  subscriberGoal: number
}

export async function getChannelInsights(): Promise<ChannelInsightsResult> {
  const overview = await getChannelOverview()
  const settings = getSettings()
  const insights = computeInsights(overview, {
    subscriberGoal: SUBSCRIBER_GOAL,
    introDurationSec: settings.template.introDurationSec,
    automationMode: settings.automation.mode,
    shortsSlotCount: settings.schedule.shortsTimes.length
  })
  return { overview, insights, subscriberGoal: SUBSCRIBER_GOAL }
}

// ---------------------------------------------------------------------------
// One-click thumbnail refresh
// ---------------------------------------------------------------------------

let variantStore: JsonStore<Record<string, ThumbnailVariant>> | null = null

function usedVariants(): JsonStore<Record<string, ThumbnailVariant>> {
  variantStore ??= new JsonStore<Record<string, ThumbnailVariant>>('thumbnail-variants.json', {})
  return variantStore
}

/**
 * Regenerate a video's thumbnail in the alternate visual style and swap it on
 * YouTube. Alternates classic <-> bold per video so repeated refreshes keep
 * producing a different look.
 */
export async function refreshThumbnail(videoId: string, mapId: string): Promise<ThumbnailVariant> {
  const settings = getSettings()
  const map = await lookupMap(mapId)
  const data = buildCardData(map, null, null, settings.playerName, settings.template)

  const store = usedVariants()
  const previous = store.get()[videoId] ?? 'classic'
  const next: ThumbnailVariant = previous === 'classic' ? 'bold' : 'classic'

  const tmp = path.join(os.tmpdir(), `beatframe-thumb-refresh-${videoId}.jpg`)
  try {
    await captureHtmlToJpeg(thumbnailHtml(data, next), 1280, 720, tmp)
    await setThumbnail(videoId, tmp, true)
    store.update((d) => {
      d[videoId] = next
    })
    log.info(`thumbnail refreshed for ${videoId} (${next})`)
    return next
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}
