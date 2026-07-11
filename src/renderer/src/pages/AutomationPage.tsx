import { useEffect, useState } from 'react'
import { CalendarClock, Check, CheckCircle2, FolderInput, RefreshCw, Rocket, SkipForward, XCircle, Zap } from 'lucide-react'
import type { AutomationItem, VideoMetadata } from '@shared/types'
import { useApp, toast, message } from '../store'
import { EmptyState, Field, PickerRow, StatusBadge, Switch } from '../components/ui'

interface AutomationStatus {
  watching: boolean
  signedIn: boolean
  upcoming: Array<{ iso: string; mode: 'longform' | 'short'; title: string }>
}

export default function AutomationPage(): React.JSX.Element {
  const { settings, saveSettings, automationItems, ytAccount, setPage, uploadJobs } = useApp()
  const [status, setStatus] = useState<AutomationStatus | null>(null)

  useEffect(() => {
    const refresh = (): void => void window.api.automationStatus().then(setStatus).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 15_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationItems, uploadJobs, settings])

  if (!settings) return <div />
  const auto = settings.automation
  const schedule = settings.schedule

  // Autopilot = every piece of the hands-off pipeline enabled at once.
  const autopilotOn =
    auto.enabled && !!auto.inputFolder && auto.autoUpload && !auto.requireReview && schedule.enabled

  const setAutopilot = (on: boolean): void => {
    void saveSettings((d) => {
      d.automation.enabled = on
      d.automation.autoUpload = on
      if (on) {
        d.automation.requireReview = false
        d.automation.mode = 'both'
        d.schedule.enabled = true
        if (d.schedule.shortsTimes.length === 0) d.schedule.shortsTimes = ['12:00']
      }
    })
  }

  const pending = automationItems.filter((i) => !['uploaded', 'archived', 'skipped'].includes(i.status))
  const done = automationItems.filter((i) => ['uploaded', 'archived', 'skipped'].includes(i.status))

  return (
    <div className="page">
      <div className="page-title">Automation</div>
      <div className="page-subtitle">
        Drop recordings into a folder — BeatFrame renders, generates metadata, uploads and archives them.
      </div>

      <div className="card" style={autopilotOn ? { borderColor: 'rgba(47,212,131,0.4)' } : undefined}>
        <div className="card-title">
          <Rocket size={16} /> Autopilot
        </div>
        <Switch
          on={autopilotOn}
          onChange={setAutopilot}
          label="Fully hands-off publishing"
          desc="Record → drop in the folder → BeatFrame renders a video AND a Short, uploads them, and YouTube publishes each at its daily slot time — even if this PC is off by then."
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, fontSize: 13 }}>
          <ReadyRow ok={!!auto.inputFolder && auto.enabled} label={auto.inputFolder ? `Watching ${auto.inputFolder}` : 'Pick an input folder below'} />
          <ReadyRow
            ok={!!ytAccount}
            label={ytAccount ? `YouTube: ${ytAccount.channelTitle}` : 'Connect your YouTube account'}
            action={!ytAccount ? () => setPage('settings') : undefined}
          />
          <ReadyRow
            ok={schedule.enabled}
            label={`Daily slots: long-form ${schedule.longformTime}${schedule.shortsTimes.length > 0 ? ` · Shorts ${schedule.shortsTimes.join(', ')}` : ''}`}
          />
        </div>
        {status && status.upcoming.length > 0 && (
          <>
            <hr className="divider" />
            <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
              <CalendarClock size={14} style={{ color: 'var(--accent-b)' }} /> Upcoming publishes
            </div>
            {status.upcoming.map((u) => (
              <div key={u.iso + u.title} className="job-sub" style={{ padding: '3px 0' }}>
                {new Date(u.iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {' · '}
                {u.mode === 'short' ? 'Short' : 'Long-form'} · <span style={{ color: 'var(--text)' }}>{u.title}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <FolderInput size={16} /> Watch folder
        </div>
        <Switch
          on={auto.enabled}
          onChange={(on) => void saveSettings((d) => void (d.automation.enabled = on))}
          label="Enable folder automation"
          desc="New videos in the input folder are processed automatically."
        />
        <div className="row" style={{ marginTop: 8 }}>
          <Field label="Input folder">
            <PickerRow
              value={auto.inputFolder}
              placeholder="Folder to watch for new recordings"
              onPick={() =>
                void window.api.pickFolder('Choose input folder').then((f) => {
                  if (f) void saveSettings((d) => void (d.automation.inputFolder = f))
                })
              }
            />
          </Field>
          <Field label="Archive folder" hint="Originals are moved here after a successful upload.">
            <PickerRow
              value={auto.archiveFolder}
              placeholder="Optional archive folder"
              onPick={() =>
                void window.api.pickFolder('Choose archive folder').then((f) => {
                  if (f) void saveSettings((d) => void (d.automation.archiveFolder = f))
                })
              }
            />
          </Field>
        </div>
        <div className="row">
          <Field label="Create" hint="What to produce for each recording.">
            <select
              className="input"
              value={auto.mode}
              onChange={(e) => void saveSettings((d) => void (d.automation.mode = e.target.value as typeof auto.mode))}
            >
              <option value="longform">Long-form video</option>
              <option value="short">YouTube Short</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <Field label="Upload visibility">
            <select
              className="input"
              value={auto.defaultPrivacy}
              onChange={(e) => void saveSettings((d) => void (d.automation.defaultPrivacy = e.target.value as typeof auto.defaultPrivacy))}
            >
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
          </Field>
        </div>
        <Switch
          on={auto.autoUpload}
          onChange={(on) => void saveSettings((d) => void (d.automation.autoUpload = on))}
          label="Upload to YouTube automatically"
          desc="Requires a connected YouTube account in Settings."
        />
        <Switch
          on={auto.requireReview}
          onChange={(on) => void saveSettings((d) => void (d.automation.requireReview = on))}
          label="Review metadata before upload"
          desc="Pause each video here so you can check title, description and tags. Turn off for fully hands-off operation."
          disabled={!auto.autoUpload}
        />
        <Switch
          on={auto.generateThumbnail}
          onChange={(on) => void saveSettings((d) => void (d.automation.generateThumbnail = on))}
          label="Generate thumbnails"
          desc="A thumbnail image is created from the cover art and applied to long-form uploads."
        />
      </div>

      <div className="card">
        <div className="card-title">
          <Zap size={16} /> Daily schedule
        </div>
        <Switch
          on={schedule.enabled}
          onChange={(on) => void saveSettings((d) => void (d.schedule.enabled = on))}
          label="Publish on a daily schedule"
          desc="Videos upload as soon as they're rendered and YouTube publishes each one at its slot time (scheduled videos always go live as Public). Your PC doesn't need to be on at publish time."
        />
        {schedule.enabled && (
          <div className="row" style={{ marginTop: 8 }}>
            <Field label="Long-form upload time">
              <input
                className="input"
                type="time"
                value={schedule.longformTime}
                onChange={(e) => void saveSettings((d) => void (d.schedule.longformTime = e.target.value))}
              />
            </Field>
            <Field label="Shorts upload times" hint="Comma-separated, e.g. 12:00, 17:30">
              <input
                className="input"
                value={schedule.shortsTimes.join(', ')}
                onChange={(e) =>
                  void saveSettings(
                    (d) =>
                      void (d.schedule.shortsTimes = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter((s) => /^\d{1,2}:\d{2}$/.test(s)))
                  )
                }
                placeholder="12:00"
              />
            </Field>
          </div>
        )}
        <Switch
          on={schedule.notifyOnEmptyQueue}
          onChange={(on) => void saveSettings((d) => void (d.schedule.notifyOnEmptyQueue = on))}
          label="Notify when the queue runs empty"
        />
      </div>

      <div className="card">
        <div className="card-title">Pipeline</div>
        {pending.length === 0 ? (
          <EmptyState
            icon={<Zap size={36} />}
            title="Nothing in the pipeline"
            desc={auto.enabled ? 'Waiting for new recordings in the input folder…' : 'Enable automation and pick an input folder to get started.'}
          />
        ) : (
          pending.map((item) => <ItemRow key={item.id} item={item} />)
        )}
        {done.length > 0 && (
          <>
            <hr className="divider" />
            <div className="hint" style={{ marginBottom: 8 }}>Completed</div>
            {done.slice(-10).reverse().map((item) => (
              <ItemRow key={item.id} item={item} compact />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function ReadyRow({ ok, label, action }: { ok: boolean; label: string; action?: () => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ok ? 'var(--text-dim)' : 'var(--warning)' }}>
      {ok ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> : <XCircle size={14} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {action && (
        <button className="btn btn-sm" onClick={action}>
          Fix
        </button>
      )}
    </div>
  )
}

function ItemRow({ item, compact }: { item: AutomationItem; compact?: boolean }): React.JSX.Element {
  const { pushToast } = useApp()
  const [mapIdDraft, setMapIdDraft] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [meta, setMeta] = useState<VideoMetadata | null>(item.metadata)

  // Generated metadata arrives asynchronously once the render finishes; only
  // adopt it while the user hasn't opened the editor (avoid clobbering edits).
  useEffect(() => {
    if (!reviewOpen) setMeta(item.metadata)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.metadata])

  const busy = ['queued', 'rendering', 'uploading'].includes(item.status)

  const submitMapId = async (): Promise<void> => {
    if (!mapIdDraft.trim()) return
    try {
      await window.api.automationSetMapId(item.id, mapIdDraft.trim())
    } catch (err) {
      pushToast(toast('error', 'Invalid map ID', message(err)))
    }
  }

  const approve = async (): Promise<void> => {
    try {
      await window.api.automationApprove(item.id, meta)
      setReviewOpen(false)
      pushToast(toast('success', 'Approved', 'The video is queued for upload.'))
    } catch (err) {
      pushToast(toast('error', 'Could not approve', message(err)))
    }
  }

  return (
    <div className="job" style={compact ? { padding: 10, opacity: 0.7 } : undefined}>
      <div className="job-head" style={{ marginBottom: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="job-title">{item.fileName}</div>
          <div className="job-sub">
            {item.mode === 'short' ? 'Short' : 'Long-form'}
            {item.mapId && <> · map {item.mapId}</>}
          </div>
        </div>
        <StatusBadge status={item.status} spinning={busy} />
        {!compact && (
          <div className="job-actions">
            {item.status === 'awaiting_review' && (
              <button className="btn btn-sm btn-primary" onClick={() => setReviewOpen(!reviewOpen)}>
                Review
              </button>
            )}
            {item.status === 'failed' && (
              <button className="btn btn-sm" title="Retry" onClick={() => void window.api.automationRetry(item.id)}>
                <RefreshCw size={13} />
              </button>
            )}
            {!busy && item.status !== 'awaiting_review' && (
              <button className="btn btn-sm btn-ghost" title="Skip" onClick={() => void window.api.automationSkip(item.id)}>
                <SkipForward size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {item.status === 'needs_map_id' && !compact && (
        <div className="input-group" style={{ marginTop: 10 }}>
          <input
            className="input"
            placeholder="Enter the BeatSaver map ID for this recording (e.g. 25f)"
            value={mapIdDraft}
            onChange={(e) => setMapIdDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitMapId()}
          />
          <button className="btn" onClick={() => void submitMapId()}>
            Set
          </button>
        </div>
      )}

      {item.status === 'failed' && item.error && (
        <div className="hint" style={{ color: 'var(--danger)', marginTop: 8, userSelect: 'text' }}>{item.error}</div>
      )}

      {reviewOpen && meta && (
        <div style={{ marginTop: 12 }}>
          <Field label="Title">
            <input
              className="input"
              value={meta.title}
              maxLength={100}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              className="input"
              rows={7}
              value={meta.description}
              onChange={(e) => setMeta({ ...meta, description: e.target.value })}
            />
          </Field>
          <Field label="Tags" hint="Comma-separated.">
            <input
              className="input"
              value={meta.tags.join(', ')}
              onChange={(e) => setMeta({ ...meta, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
            />
          </Field>
          <button className="btn btn-primary" onClick={() => void approve()}>
            <Check size={15} /> Approve &amp; queue upload
          </button>
        </div>
      )}
    </div>
  )
}
