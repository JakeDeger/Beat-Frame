import { randomUUID } from 'crypto'
import { EVENTS } from '@shared/ipc'
import type { UploadJob, UploadRequest } from '@shared/types'
import { JsonStore } from '../store'
import { createLogger } from '../logger'
import { broadcast, notify } from '../events'
import { uploadVideo, addToPlaylist, setThumbnail, YouTubeApiError } from './api'
import { isSignedIn } from './auth'

const log = createLogger('upload-queue')
const MAX_AUTO_RETRIES = 3

type UploadDoneListener = (job: UploadJob) => void

class UploadQueue {
  private jobs: UploadJob[] = []
  private processing = false
  private cancelledIds = new Set<string>()
  private store: JsonStore<{ jobs: UploadJob[] }> | null = null
  private doneListeners = new Set<UploadDoneListener>()

  init(): void {
    this.store = new JsonStore<{ jobs: UploadJob[] }>('upload-queue.json', { jobs: [] })
    this.jobs = this.store.get().jobs ?? []
    // Uploads interrupted by an app restart go back to pending (resumable
    // sessions are not persisted; the upload restarts from scratch safely).
    for (const job of this.jobs) {
      if (job.status === 'uploading') {
        job.status = 'pending'
        job.progress = 0
      }
    }
    this.persist()
    void this.pump()
  }

  onUploadDone(listener: UploadDoneListener): () => void {
    this.doneListeners.add(listener)
    return () => this.doneListeners.delete(listener)
  }

  list(): UploadJob[] {
    return this.jobs
  }

  get(id: string): UploadJob | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  enqueue(request: UploadRequest): UploadJob {
    const job: UploadJob = {
      id: randomUUID(),
      request,
      status: 'pending',
      progress: 0,
      attempts: 0,
      error: null,
      youtubeVideoId: null,
      createdAt: Date.now(),
      finishedAt: null
    }
    this.jobs.push(job)
    this.changed()
    void this.pump()
    return job
  }

  retry(id: string): void {
    const job = this.get(id)
    if (!job || job.status !== 'failed') return
    job.status = 'pending'
    job.error = null
    job.progress = 0
    this.changed()
    void this.pump()
  }

  cancel(id: string): void {
    const job = this.get(id)
    if (!job) return
    if (job.status === 'pending') {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      this.changed()
    } else if (job.status === 'uploading') {
      this.cancelledIds.add(id)
    }
  }

  remove(id: string): void {
    this.cancel(id)
    this.jobs = this.jobs.filter((j) => j.id !== id)
    this.changed()
  }

  // -------------------------------------------------------------------------

  private async pump(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      for (;;) {
        const next = this.jobs.find((j) => j.status === 'pending')
        if (!next) break
        await this.process(next)
      }
    } finally {
      this.processing = false
    }
  }

  private async process(job: UploadJob): Promise<void> {
    if (!isSignedIn()) {
      job.status = 'failed'
      job.error = 'Not signed in to YouTube. Connect your account in Settings → YouTube, then retry.'
      job.finishedAt = Date.now()
      this.changed()
      this.emitDone(job)
      return
    }

    job.status = 'uploading'
    job.attempts += 1
    job.error = null
    this.changed()

    try {
      let lastBroadcast = 0
      const videoId = await uploadVideo(
        job.request,
        (uploaded, total) => {
          job.progress = Math.round((uploaded / total) * 1000) / 10
          const now = Date.now()
          if (now - lastBroadcast > 500) {
            lastBroadcast = now
            broadcast(EVENTS.UPLOAD_JOBS_CHANGED, this.jobs)
          }
        },
        () => this.cancelledIds.has(job.id)
      )
      job.youtubeVideoId = videoId

      if (job.request.thumbnailPath) {
        await setThumbnail(videoId, job.request.thumbnailPath)
      }
      if (job.request.playlistId) {
        try {
          await addToPlaylist(job.request.playlistId, videoId)
        } catch (err) {
          log.warn('playlist add failed', err)
        }
      }

      job.status = 'completed'
      job.progress = 100
      job.finishedAt = Date.now()
      notify('success', 'Upload complete', `"${job.request.metadata.title}" is on YouTube.`, true)
    } catch (err) {
      if (this.cancelledIds.has(job.id)) {
        this.cancelledIds.delete(job.id)
        job.status = 'cancelled'
        job.finishedAt = Date.now()
      } else {
        const retryable = err instanceof YouTubeApiError && err.retryable
        if (retryable && job.attempts < MAX_AUTO_RETRIES) {
          log.warn(`upload attempt ${job.attempts} failed, will retry`, err)
          job.status = 'pending'
          job.progress = 0
          this.changed()
          await new Promise((r) => setTimeout(r, Math.min(60_000, 5000 * 2 ** job.attempts)))
          return // pump() picks it up again
        }
        job.status = 'failed'
        job.error = err instanceof Error ? err.message : String(err)
        job.finishedAt = Date.now()
        log.error(`upload ${job.id} failed`, err)
        notify('error', 'Upload failed', job.error.split('\n')[0], true)
      }
    }
    this.changed()
    this.emitDone(job)
  }

  private emitDone(job: UploadJob): void {
    if (job.status === 'pending') return
    for (const listener of this.doneListeners) {
      try {
        listener(job)
      } catch (err) {
        log.error('upload-done listener failed', err)
      }
    }
  }

  private changed(): void {
    this.persist()
    broadcast(EVENTS.UPLOAD_JOBS_CHANGED, this.jobs)
  }

  private persist(): void {
    this.store?.set({ jobs: this.jobs })
  }
}

export const uploadQueue = new UploadQueue()
