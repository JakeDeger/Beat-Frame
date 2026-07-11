import type { ScheduleSettings, VideoMode } from '@shared/types'

/**
 * Pure slot arithmetic for the daily publishing schedule.
 *
 * The scheduler works by CLAIMING slots: when a video is ready, it's uploaded
 * immediately (private) with YouTube's `publishAt` set to the next free daily
 * slot for its format — YouTube then publishes it server-side at that time,
 * even if the creator's PC is off. Claims are persisted per slot key.
 */

export interface PublishSlot {
  /** Stable identity, e.g. "2026-07-10|longform" or "2026-07-10|short-1" */
  key: string
  /** Local wall-clock publish time */
  date: Date
  mode: VideoMode
}

export function slotTimesFor(schedule: ScheduleSettings, mode: VideoMode): Array<{ id: string; time: string }> {
  if (mode === 'longform') return [{ id: 'longform', time: schedule.longformTime }]
  return schedule.shortsTimes.map((t, i) => ({ id: `short-${i}`, time: t }))
}

export function parseHhMm(time: string): { h: number; m: number } | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return { h, m: min }
}

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Next unclaimed slot for `mode` that is at least `minLeadMinutes` in the
 * future, searching up to `horizonDays` ahead. Returns null when the schedule
 * has no valid times configured.
 */
export function nextFreeSlot(
  now: Date,
  schedule: ScheduleSettings,
  mode: VideoMode,
  claimedKeys: ReadonlySet<string>,
  minLeadMinutes = 10,
  horizonDays = 30
): PublishSlot | null {
  const times = slotTimesFor(schedule, mode)
    .map((s) => ({ id: s.id, hm: parseHhMm(s.time) }))
    .filter((s): s is { id: string; hm: { h: number; m: number } } => s.hm !== null)
  if (times.length === 0) return null

  const earliest = new Date(now.getTime() + minLeadMinutes * 60_000)
  for (let day = 0; day <= horizonDays; day++) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day)
    const candidates = times
      .map(({ id, hm }) => ({
        id,
        date: new Date(base.getFullYear(), base.getMonth(), base.getDate(), hm.h, hm.m)
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
    for (const c of candidates) {
      if (c.date < earliest) continue
      const key = `${localDateKey(c.date)}|${c.id}`
      if (claimedKeys.has(key)) continue
      return { key, date: c.date, mode }
    }
  }
  return null
}
