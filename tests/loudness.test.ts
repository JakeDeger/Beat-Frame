import { describe, expect, it } from 'vitest'
import { candidateOffsets, parseMeanVolume } from '../src/main/services/ffmpeg/loudness'

describe('parseMeanVolume', () => {
  it('parses volumedetect output', () => {
    const stderr = `[Parsed_volumedetect_0 @ 0x55] n_samples: 529200
[Parsed_volumedetect_0 @ 0x55] mean_volume: -17.3 dB
[Parsed_volumedetect_0 @ 0x55] max_volume: -2.1 dB`
    expect(parseMeanVolume(stderr)).toBe(-17.3)
  })
  it('handles integer values and rejects junk', () => {
    expect(parseMeanVolume('mean_volume: -20 dB')).toBe(-20)
    expect(parseMeanVolume('no audio here')).toBeNull()
    expect(parseMeanVolume('')).toBeNull()
  })
})

describe('candidateOffsets', () => {
  it('spaces candidates evenly across the range', () => {
    const offsets = candidateOffsets({ rangeStartSec: 10, rangeEndSec: 110, windowSec: 10, candidates: 5 })
    expect(offsets).toHaveLength(5)
    expect(offsets[0]).toBe(10)
    expect(offsets[4]).toBe(100) // last window fits: 100 + 10 = 110
    for (const o of offsets) {
      expect(o + 10).toBeLessThanOrEqual(110)
    }
  })

  it('collapses to a single candidate when the range barely fits the window', () => {
    const offsets = candidateOffsets({ rangeStartSec: 5, rangeEndSec: 20, windowSec: 18 })
    expect(offsets).toHaveLength(1)
    expect(offsets[0]).toBeGreaterThanOrEqual(0)
    expect(offsets[0] + 18).toBeLessThanOrEqual(23) // clamped near the start
  })

  it('returns nothing for impossible ranges', () => {
    expect(candidateOffsets({ rangeStartSec: -5, rangeEndSec: -1, windowSec: 10 })).toEqual([])
  })
})
