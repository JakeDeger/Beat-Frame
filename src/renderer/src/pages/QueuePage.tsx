import { useState } from 'react'
import { FolderOpen, ListVideo, Play, ScrollText, Trash2, UploadCloud, X } from 'lucide-react'
import type { RenderJob } from '@shared/types'
import { useApp, formatEta } from '../store'
import { EmptyState, ProgressBar, StatusBadge } from '../components/ui'
import { UploadDialog } from '../components/UploadDialog'

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
  const [uploadOpen, setUploadOpen] = useState(false)
  const active = ACTIVE.has(job.status)
  const title = job.map ? `${job.map.songName} — ${job.map.songAuthorName}` : job.request.videoPath.split(/[\\/]/).pop()

  return (
    <div className="job">
      <div className="job-head">
        {job.map?.coverUrl ? <img className="job-cover" src={job.map.coverUrl} alt="" /> : <div className="job-cover" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="job-title">{title}</div>
          <div className="job-sub">
            {job.request.mode === 'short' ? 'YouTube Short' : 'Long-form'} ·{' '}
            {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {job.score && <> · 🎯 {(job.score.accuracy * 100).toFixed(2)}%</>}
          </div>
        </div>
        <StatusBadge status={job.status} spinning={active && job.status !== 'queued'} />
        <div className="job-actions">
          {job.status === 'completed' && job.outputPath && (
            <>
              <button className="btn btn-sm" title="Play" onClick={() => void window.api.openPath(job.outputPath!)}>
                <Play size={13} />
              </button>
              <button className="btn btn-sm" title="Show in folder" onClick={() => void window.api.showInFolder(job.outputPath!)}>
                <FolderOpen size={13} />
              </button>
              <button className="btn btn-sm" title="Upload to YouTube" onClick={() => setUploadOpen(true)}>
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
        <div className="hint" style={{ color: 'var(--danger)', userSelect: 'text' }}>
          {job.error.split('\n')[0]}
          {job.error.includes('\n') && (
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8, padding: '1px 8px' }} onClick={() => setShowLogs(true)}>
              details
            </button>
          )}
        </div>
      )}
      {showLogs && <div className="log-box">{job.logs.length > 0 ? job.logs.join('\n') : 'No log output yet.'}</div>}
      {uploadOpen && <UploadDialog job={job} onClose={() => setUploadOpen(false)} />}
    </div>
  )
}
