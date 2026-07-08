import { describe, expect, it } from 'vitest'
import { ProgressParser, parseOutTime, parseSpeed } from '../src/main/services/ffmpeg/progress'

describe('ProgressParser', () => {
  it('emits a snapshot per progress block', () => {
    const parser = new ProgressParser(100)
    const none = parser.push('frame=10\nfps=60\n')
    expect(none).toBeNull()
    const snap = parser.push('out_time_us=25000000\nspeed=2.5x\nprogress=continue\n')
    expect(snap).not.toBeNull()
    expect(snap!.percent).toBe(25)
    expect(snap!.speed).toBe(2.5)
    expect(snap!.etaSeconds).toBe(30) // (100-25)/2.5
  })

  it('handles chunks split mid-line', () => {
    const parser = new ProgressParser(200)
    parser.push('out_time_')
    parser.push('us=100000000\nspeed=1x\nprog')
    const snap = parser.push('ress=continue\n')
    expect(snap!.percent).toBe(50)
  })

  it('reports 100% on end', () => {
    const parser = new ProgressParser(100)
    const snap = parser.push('out_time_us=99500000\nprogress=end\n')
    expect(snap!.percent).toBe(100)
  })

  it('never exceeds 99.9% before end', () => {
    const parser = new ProgressParser(50)
    const snap = parser.push('out_time_us=60000000\nspeed=1x\nprogress=continue\n')
    expect(snap!.percent).toBeLessThanOrEqual(99.9)
  })

  it('survives N/A values without crashing', () => {
    const parser = new ProgressParser(100)
    const snap = parser.push('out_time_us=N/A\nspeed=N/A\nfps=N/A\nprogress=continue\n')
    expect(snap).not.toBeNull()
    expect(snap!.speed).toBeNull()
    expect(snap!.fps).toBeNull()
  })
})

describe('parseOutTime', () => {
  it('parses HH:MM:SS.micro', () => {
    expect(parseOutTime('00:01:30.500000')).toBe(90.5)
    expect(parseOutTime('01:00:00.000000')).toBe(3600)
  })
  it('returns NaN for junk', () => {
    expect(Number.isNaN(parseOutTime('N/A'))).toBe(true)
    expect(Number.isNaN(parseOutTime(undefined))).toBe(true)
  })
})

describe('parseSpeed', () => {
  it('parses ffmpeg speed values', () => {
    expect(parseSpeed('2.31x')).toBe(2.31)
    expect(parseSpeed(' 0.5x ')).toBe(0.5)
    expect(parseSpeed('N/A')).toBeNull()
    expect(parseSpeed(undefined)).toBeNull()
  })
})
