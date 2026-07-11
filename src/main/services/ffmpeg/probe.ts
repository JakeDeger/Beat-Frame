import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import { resolveFfprobePath } from './paths'
import type { VideoFileInfo } from '@shared/types'

const execFileAsync = promisify(execFile)

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string; size?: string }
}

export class ProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeError'
  }
}

/** Inspect a video file and return normalized stream information. */
export async function probeVideo(filePath: string): Promise<VideoFileInfo> {
  if (!fs.existsSync(filePath)) {
    throw new ProbeError(`File not found: ${filePath}`)
  }
  const ffprobe = resolveFfprobePath()
  if (!ffprobe) {
    throw new ProbeError('ffprobe binary not found. Set a custom path in Settings → Advanced.')
  }

  let parsed: FfprobeOutput
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
    )
    parsed = JSON.parse(stdout) as FfprobeOutput
  } catch (err) {
    throw new ProbeError(
      `Could not read the video file. It may be corrupt or in an unsupported format. (${err instanceof Error ? err.message.split('\n')[0] : 'unknown error'})`
    )
  }

  const video = parsed.streams?.find((s) => s.codec_type === 'video')
  const audioStreams = parsed.streams?.filter((s) => s.codec_type === 'audio') ?? []
  const audio = audioStreams[0]
  if (!video || !video.width || !video.height) {
    throw new ProbeError('No video stream found in this file.')
  }

  const durationSec = Number(parsed.format?.duration ?? 0)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new ProbeError('Could not determine video duration — the file may be corrupt.')
  }

  return {
    path: filePath,
    durationSec,
    width: video.width,
    height: video.height,
    fps: parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate ?? '0/1'),
    videoCodec: video.codec_name ?? 'unknown',
    audioCodec: audio?.codec_name ?? null,
    audioStreamCount: audioStreams.length,
    sizeBytes: Number(parsed.format?.size ?? 0)
  }
}

export function parseFrameRate(rate: string): number {
  const [num, den] = rate.split('/').map(Number)
  if (!num || !den) return 0
  return Math.round((num / den) * 100) / 100
}
