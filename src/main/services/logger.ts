import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Minimal rotating file logger. Writes to <userData>/logs/beatframe.log and
 * mirrors to stdout in development. Rotates at 5 MB, keeping one backup.
 */

const MAX_LOG_BYTES = 5 * 1024 * 1024

let logDir: string | null = null
let stream: fs.WriteStream | null = null

function ensureStream(): fs.WriteStream | null {
  if (stream) return stream
  try {
    logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const file = path.join(logDir, 'beatframe.log')
    try {
      const stat = fs.statSync(file)
      if (stat.size > MAX_LOG_BYTES) {
        fs.rmSync(path.join(logDir, 'beatframe.old.log'), { force: true })
        fs.renameSync(file, path.join(logDir, 'beatframe.old.log'))
      }
    } catch {
      // file does not exist yet
    }
    stream = fs.createWriteStream(file, { flags: 'a' })
    return stream
  } catch {
    return null
  }
}

function write(level: string, scope: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : safeJson(a)))
    .join(' ')}`
  ensureStream()?.write(line + '\n')
  if (!app.isPackaged) {
    // eslint-disable-next-line no-console
    console.log(line)
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function getLogDirectory(): string {
  ensureStream()
  return logDir ?? path.join(app.getPath('userData'), 'logs')
}

export function createLogger(scope: string) {
  return {
    info: (...args: unknown[]) => write('INFO', scope, args),
    warn: (...args: unknown[]) => write('WARN', scope, args),
    error: (...args: unknown[]) => write('ERROR', scope, args),
    debug: (...args: unknown[]) => {
      if (!app.isPackaged) write('DEBUG', scope, args)
    }
  }
}

export type Logger = ReturnType<typeof createLogger>
