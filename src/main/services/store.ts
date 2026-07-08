import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Tiny persistent JSON store with atomic writes and debounced flushing.
 * Deliberately dependency-free so the persistence layer never breaks on
 * upstream ESM/CJS churn.
 */
export class JsonStore<T> {
  private readonly filePath: string
  private data: T
  private writeTimer: NodeJS.Timeout | null = null

  constructor(fileName: string, defaults: T, migrate?: (raw: unknown) => T) {
    this.filePath = path.join(app.getPath('userData'), fileName)
    this.data = defaults
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      this.data = migrate ? migrate(raw) : { ...defaults, ...(raw as object) }
    } catch {
      // missing or corrupt file -> keep defaults; corrupt files are backed up
      if (fs.existsSync(this.filePath)) {
        try {
          fs.copyFileSync(this.filePath, this.filePath + '.corrupt')
        } catch {
          /* ignore */
        }
      }
    }
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    this.scheduleFlush()
  }

  update(mutate: (draft: T) => void): T {
    mutate(this.data)
    this.scheduleFlush()
    return this.data
  }

  /** Write immediately (used on app quit). */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.writeNow()
  }

  private scheduleFlush(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.writeNow()
    }, 250)
  }

  private writeNow(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmp = this.filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fs.renameSync(tmp, this.filePath)
    } catch {
      // Persistence failures must never crash the app; next flush retries.
    }
  }
}
