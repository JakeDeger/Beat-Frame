import { useState } from 'react'
import { FolderOpen, ListVideo, ScrollText, Trash2, UploadCloud, X } from 'lucide-react'
import type { RenderJob } from '@shared/types'
import { useApp, formatEta, toast, message } from '../store'
import { EmptyState, ProgressBar, StatusBadge } from '../components/ui'

const ACTIVE = new Set(['queued', 'preparing', 'rendering', 'finalizing'])

export default function QueuePage(): React.JSX.Element {
  const { renderJobs } = useApp()
  const hasFinished = renderJobs.some((j) => !ACTIVE.has(j.status))

  return (
    <div className="page">
      <div className="page-title">Render queue</div>
      <div className="page-subtitle">Renders run one at a time for maximum encoding speed.</div>

      {renderJobs.length === 0 ? (
        <EmptyState
          icon={<ListVideo size={40} />}
          title="Nothing in the queue"
          desc="Renders you start from Home or Automation appear here."
        />
      ) : (
        <>
          {hasFinished && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button className="btn btn-sm" onClick={() => void window.api.clearFinishedRenders()}>
                <Trash2 size={13} /> Clear finished
              </button>
            </div>
          )}
          {[...renderJobs].reverse().map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </>
      )}
    </div>
  )
}

function JobRow({ job }: { job: RenderJob }): React.JSX.Element {
  const [showLogs, setShowLogs] = useState(false)
  const { pushToast, setPage } = useApp()
  const active = ACTIVE.has(job.status)
  const title = job.map ? `${job.map.songName} — ${job.map.songAuthorName}` : job.request.videoPath.split(/[\\/]/).pop()

  const upload = async (): Promise<void> => {
    // Pre-fill an upload with generated metadata and send it to the Uploads page.
    try {
      if (!job.map || !job.outputPath) return
      const settings = useApp.getState().settings!
      const metadata = await window.api.generateMetadata({
        map: job.map,
        player: job.player,
        playerName: job.request.playerName,
        mode: job.request.mode,
        extraKeywords: settings.extraKeywords,
        channelName: settings.template.channelName
      })
      await window.api.enqueueUpload({
        videoPath: job.outputPath,
        thumbnailPath: job.request.mode === 'longform' ? job.thumbnailPath : null,
        metadata,
        privacy: 'private',
        publishAt: null,
        playlistId: null,
        isShort: job.request.mode === 'short'
      })
      pushToast(toast('success', 'Upload queued', 'Uploading as Private — publish it from YouTube Studio when ready.'))
      setPage('uploads')
    } catch (err) {
      pushToast(toast('error', 'Could not queue upload', message(err)))
    }
  }

  return (
    <div className="job">
      <div className="job-head">
        {job.map?.coverUrl ? <img className="job-cover" src={job.map.coverUrl} alt="" /> : <div className="job-cover" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="job-title">{title}</div>
          <div className="job-sub">
            {job.request.mode === 'short' ? 'YouTube Short' : 'Long-form'} ·{' '}
            {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <StatusBadge status={job.status} spinning={active && job.status !== 'queued'} />
        <div className="job-actions">
          {job.status === 'completed' && job.outputPath && (
            <>
              <button className="btn btn-sm" title="Show in folder" onClick={() => void window.api.showInFolder(job.outputPath!)}>
                <FolderOpen size={13} />
              </button>
              <button className="btn btn-sm" title="Upload to YouTube" onClick={() => void upload()}>
                <UploadCloud size={13} />
              </button>
            </>
          )}
          <button className="btn btn-sm btn-ghost" title="Logs" onClick={() => setShowLogs(!showLogs)}>
            <ScrollText size={13} />
          </button>
          {active ? (
            <button className="btn btn-sm btn-danger" title="Cancel" onClick={() => void window.api.cancelRender(job.id)}>
              <X size={13} />
            </button>
          ) : (
            <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => void window.api.removeRender(job.id)}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {(job.status === 'rendering' || job.status === 'finalizing') && (
        <>
          <ProgressBar percent={job.progress.percent} indeterminate={job.status === 'finalizing'} />
          <div className="job-meta">
            <span>{job.progress.percent.toFixed(1)}%</span>
            <span>ETA {formatEta(job.progress.etaSeconds)}</span>
            {job.progress.fps && <span>{job.progress.fps} fps</span>}
            {job.progress.speed && <span>{job.progress.speed.toFixed(2)}× realtime</span>}
          </div>
        </>
      )}
      {job.status === 'preparing' && <ProgressBar percent={100} indeterminate />}
      {job.status === 'failed' && job.error && (
        <div className="hint" style={{ color: 'var(--danger)', whiteSpace: 'pre-wrap', userSelect: 'text' }}>{job.error}</div>
      )}
      {showLogs && <div className="log-box">{job.logs.length > 0 ? job.logs.join('\n') : 'No log output yet.'}</div>}
    </div>
  )
}
