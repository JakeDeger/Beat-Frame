import { spawn, type ChildProcess } from 'child_process'
import { resolveFfmpegPath } from './paths'
import { ProgressParser } from './progress'
import { createLogger } from '../logger'
import type { RenderProgress } from '@shared/types'

const log = createLogger('ffmpeg-run')

export interface RunFfmpegOptions {
  args: string[]
  totalDurationSec: number
  onProgress?: (progress: RenderProgress) => void
  onLog?: (line: string) => void
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly logTail: string[]
  ) {
    super(message)
    this.name = 'FfmpegError'
  }
}

export interface FfmpegHandle {
  promise: Promise<void>
  cancel: () => void
}

/**
 * Spawn ffmpeg with structured progress reporting. `-progress pipe:1` output
 * is parsed from stdout; human-readable log lines stream from stderr.
 */
export function runFfmpeg(options: RunFfmpegOptions): FfmpegHandle {
  const ffmpeg = resolveFfmpegPath()
  if (!ffmpeg) {
    const err = new FfmpegError(
      'FFmpeg binary not found. Install FFmpeg or set a custom path in Settings → Advanced.',
      null,
      []
    )
    return { promise: Promise.reject(err), cancel: () => {} }
  }

  const fullArgs = ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats', ...options.args]
  log.info('spawn:', ffmpeg, fullArgs.join(' '))

  let child: ChildProcess | null = null
  let cancelled = false
  const logTail: string[] = []

  const promise = new Promise<void>((resolve, reject) => {
    child = spawn(ffmpeg, fullArgs, { windowsHide: true })
    const parser = new ProgressParser(options.totalDurationSec)

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      const snapshot = parser.push(chunk)
      if (snapshot) options.onProgress?.(snapshot)
    })

    let stderrBuf = ''
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      let idx: number
      while ((idx = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, idx).trimEnd()
        stderrBuf = stderrBuf.slice(idx + 1)
        if (!line) continue
        logTail.push(line)
        if (logTail.length > 60) logTail.shift()
        options.onLog?.(line)
      }
    })

    child.on('error', (err) => {
      reject(new FfmpegError(`Failed to start FFmpeg: ${err.message}`, null, logTail))
    })

    child.on('close', (code) => {
      if (cancelled) {
        reject(new FfmpegError('Render cancelled', code, logTail))
      } else if (code === 0) {
        resolve()
      } else {
        const hint = logTail.slice(-8).join('\n')
        reject(new FfmpegError(`FFmpeg exited with code ${code}.\n${hint}`, code, logTail))
      }
    })
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      if (child && !child.killed) {
        // Graceful quit first so ffmpeg finalizes/truncates cleanly, then force.
        child.stdin?.write('q')
        setTimeout(() => {
          if (child && !child.killed) child.kill('SIGKILL')
        }, 3000)
      }
    }
  }
}

/**
 * True when the error indicates the selected hardware encoder cannot run on
 * this machine. Callers only consult this when a hardware encoder was in use,
 * so the generic "error while opening encoder" pattern is safe to match.
 * (Verified against a real no-GPU machine: Linux reports
 * "Cannot load libcuda.so.1" + "Error while opening encoder".)
 */
export function isHardwareEncoderFailure(err: unknown): boolean {
  if (!(err instanceof FfmpegError)) return false
  const text = err.logTail.join('\n').toLowerCase()
  return (
    text.includes('cannot load nvcuda') ||
    text.includes('cannot load libcuda') ||
    text.includes('libcuda.so') ||
    text.includes('no nvenc capable devices') ||
    text.includes('openencodesessionex failed') ||
    text.includes('failed to initialise vaapi') ||
    text.includes('error while opening encoder') ||
    (text.includes('error initializing output stream') &&
      (text.includes('nvenc') || text.includes('amf') || text.includes('qsv'))) ||
    text.includes('no capable devices found') ||
    text.includes('failed loading amdvlk') ||
    text.includes('mfx session') ||
    text.includes('device creation failed')
  )
}
