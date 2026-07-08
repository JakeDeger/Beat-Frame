import type { RenderProgress } from '@shared/types'

/**
 * Incremental parser for `ffmpeg -progress pipe:1` key=value output.
 * Pure logic — unit tested in tests/progress.test.ts.
 */
export class ProgressParser {
  private buffer = ''
  private current: Record<string, string> = {}

  constructor(private readonly totalDurationSec: number) {}

  /**
   * Feed a chunk of stdout. Returns a RenderProgress snapshot whenever a
   * full progress block (terminated by the `progress=` key) completes.
   */
  push(chunk: string): RenderProgress | null {
    this.buffer += chunk
    let snapshot: RenderProgress | null = null
    let newlineIdx: number
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim()
      this.buffer = this.buffer.slice(newlineIdx + 1)
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq)
      const value = line.slice(eq + 1)
      this.current[key] = value
      if (key === 'progress') {
        snapshot = this.snapshot()
        this.current = {}
      }
    }
    return snapshot
  }

  private snapshot(): RenderProgress {
    const outTimeUs = Number(this.current['out_time_us'] ?? this.current['out_time_ms'] ?? NaN)
    const outSec = Number.isFinite(outTimeUs) ? outTimeUs / 1_000_000 : parseOutTime(this.current['out_time'])
    const speed = parseSpeed(this.current['speed'])
    const fps = Number(this.current['fps'])
    const done = this.current['progress'] === 'end'

    let percent = 0
    if (done) percent = 100
    else if (this.totalDurationSec > 0 && Number.isFinite(outSec)) {
      percent = Math.min(99.9, (outSec / this.totalDurationSec) * 100)
    }

    let etaSeconds: number | null = null
    if (!done && speed && speed > 0 && this.totalDurationSec > 0 && Number.isFinite(outSec)) {
      etaSeconds = Math.max(0, (this.totalDurationSec - outSec) / speed)
    }

    return {
      percent: Math.round(percent * 10) / 10,
      etaSeconds: etaSeconds === null ? null : Math.round(etaSeconds),
      fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps) : null,
      speed
    }
  }
}

export function parseSpeed(raw: string | undefined): number | null {
  if (!raw) return null
  const v = Number(raw.replace('x', '').trim())
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Parse "HH:MM:SS.micro" style out_time values. */
export function parseOutTime(raw: string | undefined): number {
  if (!raw) return NaN
  const m = raw.trim().match(/^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/)
  if (!m) return NaN
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]))
}
