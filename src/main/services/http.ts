import { createLogger } from './logger'

const log = createLogger('http')

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string
  ) {
    super(message ?? `HTTP ${status} from ${url}`)
    this.name = 'HttpError'
  }
}

export interface FetchJsonOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  retries?: number
}

/**
 * fetch wrapper with timeout + exponential-backoff retries for transient
 * failures (network errors, 429, 5xx).
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 2, ...init } = options
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500
        if (retryable && attempt < retries) {
          lastError = new HttpError(res.status, url)
        } else {
          throw new HttpError(res.status, url, await safeBody(res))
        }
      } else {
        return (await res.json()) as T
      }
    } catch (err) {
      if (err instanceof HttpError) throw err
      lastError = err
      if (attempt >= retries) break
    } finally {
      clearTimeout(timer)
    }
    const delay = 1000 * 2 ** attempt
    log.warn(`retrying ${url} in ${delay}ms (attempt ${attempt + 1}/${retries})`)
    await new Promise((r) => setTimeout(r, delay))
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`)
}

async function safeBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return `HTTP ${res.status} from ${res.url}: ${text.slice(0, 300)}`
  } catch {
    return `HTTP ${res.status} from ${res.url}`
  }
}

/** Download a binary file to disk. */
export async function downloadFile(url: string, destPath: string, timeoutMs = 30_000): Promise<void> {
  const fs = await import('fs')
  const path = await import('path')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new HttpError(res.status, url)
    const buf = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, buf)
  } finally {
    clearTimeout(timer)
  }
}
