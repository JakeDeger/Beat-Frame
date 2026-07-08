import { ExternalLink, RefreshCw, Trash2, UploadCloud, X, Youtube } from 'lucide-react'
import type { UploadJob } from '@shared/types'
import { useApp, toast, message } from '../store'
import { EmptyState, ProgressBar, StatusBadge } from '../components/ui'

export default function UploadsPage(): React.JSX.Element {
  const { uploadJobs, ytAccount, pushToast } = useApp()

  const signIn = async (): Promise<void> => {
    try {
      await window.api.ytSignIn()
      pushToast(toast('success', 'Connected', 'Your YouTube account is connected.'))
    } catch (err) {
      pushToast(toast('error', 'Sign-in failed', message(err)))
    }
  }

  return (
    <div className="page">
      <div className="page-title">Uploads</div>
      <div className="page-subtitle">Upload progress and history for your connected YouTube channel.</div>

      {!ytAccount && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Youtube size={22} style={{ color: 'var(--danger)' }} />
          <div style={{ flex: 1 }}>
            <b>YouTube not connected.</b>
            <div className="hint">Connect your account to upload. API credentials are configured in Settings → YouTube.</div>
          </div>
          <button className="btn btn-primary" onClick={() => void signIn()}>
            Connect
          </button>
        </div>
      )}

      {uploadJobs.length === 0 ? (
        <EmptyState
          icon={<UploadCloud size={40} />}
          title="No uploads yet"
          desc="Finished renders can be uploaded from the Render Queue, or automatically via Automation."
        />
      ) : (
        [...uploadJobs].reverse().map((job) => <UploadRow key={job.id} job={job} />)
      )}
    </div>
  )
}

function UploadRow({ job }: { job: UploadJob }): React.JSX.Element {
  const fileName = job.request.videoPath.split(/[\\/]/).pop()
  return (
    <div className="job">
      <div className="job-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="job-title">{job.request.metadata.title}</div>
          <div className="job-sub">
            {fileName} · {job.request.privacy}
            {job.request.publishAt && <> · scheduled {new Date(job.request.publishAt).toLocaleString()}</>}
          </div>
        </div>
        <StatusBadge status={job.status} spinning={job.status === 'uploading'} />
        <div className="job-actions">
          {job.youtubeVideoId && (
            <button
              className="btn btn-sm"
              title="Open on YouTube"
              onClick={() => void window.api.openExternal(`https://youtu.be/${job.youtubeVideoId}`)}
            >
              <ExternalLink size={13} />
            </button>
          )}
          {job.status === 'failed' && (
            <button className="btn btn-sm" title="Retry" onClick={() => void window.api.retryUpload(job.id)}>
              <RefreshCw size={13} />
            </button>
          )}
          {(job.status === 'pending' || job.status === 'uploading') && (
            <button className="btn btn-sm btn-danger" title="Cancel" onClick={() => void window.api.cancelUpload(job.id)}>
              <X size={13} />
            </button>
          )}
          {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
            <button className="btn btn-sm btn-ghost" title="Remove from history" onClick={() => void window.api.removeUpload(job.id)}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {job.status === 'uploading' && (
        <>
          <ProgressBar percent={job.progress} />
          <div className="job-meta">
            <span>{job.progress.toFixed(1)}%</span>
            <span>attempt {job.attempts}</span>
          </div>
        </>
      )}
      {job.status === 'failed' && job.error && (
        <div className="hint" style={{ color: 'var(--danger)', userSelect: 'text' }}>{job.error}</div>
      )}
    </div>
  )
}
