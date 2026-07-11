import { describe, expect, it } from 'vitest'
import { localDateKey, nextFreeSlot, parseHhMm, slotTimesFor } from '../src/main/services/scheduling'
import { DEFAULT_SCHEDULE } from '../src/shared/defaults'
import type { ScheduleSettings } from '../src/shared/types'

function schedule(overrides: Partial<ScheduleSettings> = {}): ScheduleSettings {
  return { ...DEFAULT_SCHEDULE, enabled: true, longformTime: '18:00', shortsTimes: ['12:00', '17:30'], ...overrides }
}

// Wed 2026-07-15, 09:00 local
const NOW = new Date(2026, 6, 15, 9, 0)

describe('parseHhMm / slotTimesFor', () => {
  it('parses valid times and rejects junk', () => {
    expect(parseHhMm('18:00')).toEqual({ h: 18, m: 0 })
    expect(parseHhMm('9:05')).toEqual({ h: 9, m: 5 })
    expect(parseHhMm('25:00')).toBeNull()
    expect(parseHhMm('noon')).toBeNull()
  })
  it('lists slots per mode', () => {
    expect(slotTimesFor(schedule(), 'longform')).toEqual([{ id: 'longform', time: '18:00' }])
    expect(slotTimesFor(schedule(), 'short')).toHaveLength(2)
  })
})

describe('nextFreeSlot', () => {
  it('picks today’s slot when it is still ahead', () => {
    const slot = nextFreeSlot(NOW, schedule(), 'longform', new Set())!
    expect(slot.key).toBe('2026-07-15|longform')
    expect(slot.date.getHours()).toBe(18)
  })

  it('skips claimed slots and rolls to the next day', () => {
    const claimed = new Set(['2026-07-15|longform'])
    const slot = nextFreeSlot(NOW, schedule(), 'longform', claimed)!
    expect(slot.key).toBe('2026-07-16|longform')
  })

  it('fills multiple Shorts slots in time order across days', () => {
    const claimed = new Set<string>()
    const s1 = nextFreeSlot(NOW, schedule(), 'short', claimed)!
    claimed.add(s1.key)
    const s2 = nextFreeSlot(NOW, schedule(), 'short', claimed)!
    claimed.add(s2.key)
    const s3 = nextFreeSlot(NOW, schedule(), 'short', claimed)!
    expect(s1.key).toBe('2026-07-15|short-0') // 12:00 today
    expect(s2.key).toBe('2026-07-15|short-1') // 17:30 today
    expect(s3.key).toBe('2026-07-16|short-0') // tomorrow noon
  })

  it('respects the minimum lead time', () => {
    const almostNoon = new Date(2026, 6, 15, 11, 55)
    const slot = nextFreeSlot(almostNoon, schedule(), 'short', new Set())!
    expect(slot.key).toBe('2026-07-15|short-1') // 12:00 is <10 min away → 17:30
  })

  it('returns null when no valid times exist', () => {
    expect(nextFreeSlot(NOW, schedule({ shortsTimes: [] }), 'short', new Set())).toBeNull()
    expect(nextFreeSlot(NOW, schedule({ longformTime: 'bogus' }), 'longform', new Set())).toBeNull()
  })
})

describe('localDateKey', () => {
  it('formats local dates', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
