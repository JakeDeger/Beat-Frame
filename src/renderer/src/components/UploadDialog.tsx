import { useEffect, useState } from 'react'
import { Loader2, UploadCloud, X } from 'lucide-react'
import type { RenderJob, UploadPrivacy, VideoMetadata, YouTubePlaylist } from '@shared/types'
import { useApp, toast, message } from '../store'
import { Field } from './ui'

/**
 * Review-and-edit dialog shown before a manual upload from the render queue:
 * generated metadata is prefilled and everything (title, description, tags,
 * privacy, playlist, schedule) can be adjusted before enqueueing.
 */
export function UploadDialog({ job, onClose }: { job: RenderJob; onClose: () => void }): React.JSX.Element {
  const { settings, ytAccount, pushToast, setPage } = useApp()
  const [meta, setMeta] = useState<VideoMetadata | null>(null)
  const [privacy, setPrivacy] = useState<UploadPrivacy>('private')
  const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([])
  const [playlistId, setPlaylistId] = useState('')
  const [publishAt, setPublishAt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!job.map || !settings) return
    window.api
      .generateMetadata({
        map: job.map,
        player: job.player,
        playerName: job.request.playerName,
        mode: job.request.mode,
        extraKeywords: settings.extraKeywords,
        channelName: settings.template.channelName,
        score: job.score ?? null
      })
      .then(setMeta)
      .catch((err) => pushToast(toast('error', 'Could not generate metadata', message(err))))
    if (ytAccount) {
      window.api.ytPlaylists().then(setPlaylists).catch(() => setPlaylists([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])

  const upload = async (): Promise<void> => {
    if (!meta || !job.outputPath) return
    setSubmitting(true)
    try {
      await window.api.enqueueUpload({
        videoPath: job.outputPath,
        thumbnailPath: job.request.mode === 'longform' ? job.thumbnailPath : null,
        metadata: meta,
        privacy,
        publishAt: publishAt ? new Date(publishAt).toISOString() : null,
        playlistId: playlistId || null,
        isShort: job.request.mode === 'short'
      })
      pushToast(toast('success', 'Upload queued', publishAt ? `Scheduled for ${new Date(publishAt).toLocaleString()}` : `Uploading as ${privacy}.`))
      onClose()
      setPage('uploads')
    } catch (err) {
      pushToast(toast('error', 'Could not queue upload', message(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(3,5,10,0.65)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card" style={{ width: 640, maxHeight: '88vh', overflowY: 'auto', margin: 0, boxShadow: 'var(--shadow)' }}>
        <div className="card-title" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UploadCloud size={16} /> Upload to YouTube
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {!ytAccount && (
          <div className="hint" style={{ color: 'var(--warning)', marginBottom: 12 }}>
            No YouTube account connected — the upload will wait in the queue until you connect one in Settings.
          </div>
        )}

        {!meta ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--text-dim)' }}>
            <Loader2 className="spin" size={16} /> Generating metadata…
          </div>
        ) : (
          <>
            <Field label={`Title (${meta.title.length}/100)`}>
              <input className="input" maxLength={100} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
            </Field>
            <Field label="Description">
              <textarea className="input" rows={8} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
            </Field>
            <Field label="Tags" hint="Comma-separated.">
              <input
                className="input"
                value={meta.tags.join(', ')}
                onChange={(e) => setMeta({ ...meta, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              />
            </Field>
            <div className="row">
              <Field label="Visibility">
                <select className="input" value={privacy} onChange={(e) => setPrivacy(e.target.value as UploadPrivacy)}>
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </Field>
              <Field label="Playlist">
                <select className="input" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                  <option value="">None</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Schedule (optional)" hint="Stays private until this time.">
                <input className="input" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
              </Field>
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={submitting} onClick={() => void upload()}>
              {submitting ? <Loader2 className="spin" size={15} /> : <UploadCloud size={15} />}
              {publishAt ? 'Schedule upload' : 'Queue upload'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
