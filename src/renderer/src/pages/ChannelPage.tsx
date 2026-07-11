import { useCallback, useEffect, useState } from 'react'
import { BarChart3, CheckCircle2, Lightbulb, Loader2, RefreshCw, TrendingUp, Youtube } from 'lucide-react'
import { useApp, toast, message } from '../store'
import { EmptyState, ProgressBar } from '../components/ui'

type InsightsResult = Awaited<ReturnType<typeof window.api.ytInsights>>
type Insight = InsightsResult['insights'][number]

/**
 * Channel growth dashboard: subscriber-goal tracker, data-driven insights
 * with one-click actions, and per-video performance for recent uploads.
 */
export default function ChannelPage(): React.JSX.Element {
  const { ytAccount, pushToast, saveSettings } = useApp()
  const [data, setData] = useState<InsightsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!ytAccount) return
    setLoading(true)
    setError('')
    try {
      setData(await window.api.ytInsights())
    } catch (err) {
      setError(message(err))
    } finally {
      setLoading(false)
    }
  }, [ytAccount])

  useEffect(() => {
    void load()
  }, [load])

  const applyAction = async (insight: Insight): Promise<void> => {
    const action = insight.action
    if (!action) return
    setApplying(insight.id)
    try {
      if (action.kind === 'set-intro-duration') {
        await saveSettings((d) => void (d.template.introDurationSec = action.seconds))
        pushToast(toast('success', 'Intro shortened', `New renders use a ${action.seconds}s intro.`))
      } else if (action.kind === 'set-mode-both') {
        await saveSettings((d) => void (d.automation.mode = 'both'))
        pushToast(toast('success', 'Automation updated', 'Each recording now produces a long-form video and a Short.'))
      } else if (action.kind === 'add-short-slot') {
        await saveSettings((d) => {
          if (!d.schedule.shortsTimes.includes(action.time)) d.schedule.shortsTimes.push(action.time)
        })
        pushToast(toast('success', 'Slot added', `Daily Short slot at ${action.time} added to your schedule.`))
      } else if (action.kind === 'refresh-thumbnail') {
        const variant = await window.api.ytRefreshThumbnail(action.videoId, action.mapId)
        pushToast(toast('success', 'Thumbnail refreshed', `New "${variant}" style thumbnail is live on YouTube.`))
        void load()
      }
    } catch (err) {
      pushToast(toast('error', 'Could not apply', message(err)))
    } finally {
      setApplying(null)
    }
  }

  if (!ytAccount) {
    return (
      <div className="page">
        <div className="page-title">Channel</div>
        <div className="page-subtitle">Growth insights for your YouTube channel.</div>
        <EmptyState
          icon={<Youtube size={40} />}
          title="Connect YouTube to see channel insights"
          desc="Connect your account in Settings → YouTube, then come back here."
        />
      </div>
    )
  }

  const overview = data?.overview
  const goal = data?.subscriberGoal ?? 1000
  const progress = overview ? Math.min(100, (overview.subscriberCount / goal) * 100) : 0

  return (
    <div className="page">
      <div className="page-title">Channel</div>
      <div className="page-subtitle">
        What your numbers say, and one-click fixes. (Impressions/CTR are Studio-only — YouTube doesn&rsquo;t expose them
        to apps, so insights use views, watch % and subscribers gained.)
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'rgba(255,85,99,0.4)' }}>
          <div style={{ color: 'var(--danger)', userSelect: 'text' }}>{error}</div>
          {/reconnect/i.test(error) && (
            <div className="hint" style={{ marginTop: 8 }}>
              Settings → YouTube → Disconnect, then Connect again — the new sign-in includes analytics permission.
            </div>
          )}
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => void load()}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-dim)' }}>
          <Loader2 className="spin" size={16} /> Crunching your channel data…
        </div>
      )}

      {overview && (
        <>
          <div className="card">
            <div className="card-title">
              <TrendingUp size={16} /> Road to {goal.toLocaleString()} subscribers
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 34, fontWeight: 800 }}>{overview.subscriberCount.toLocaleString()}</span>
              <span className="hint">of {goal.toLocaleString()}</span>
              <span style={{ marginLeft: 'auto', color: overview.subsGained28d > 0 ? 'var(--success)' : 'var(--text-faint)', fontWeight: 700 }}>
                {overview.subsGained28d >= 0 ? '+' : ''}
                {overview.subsGained28d} / 28 days
              </span>
            </div>
            <ProgressBar percent={progress} />
            <div className="job-meta">
              <span>{overview.videoCount} videos</span>
              <span>{overview.views28d.toLocaleString()} views (28d)</span>
              <span>{overview.totalViews.toLocaleString()} lifetime views</span>
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => void load()} disabled={loading}>
                <RefreshCw size={12} className={loading ? 'spin' : undefined} /> Refresh
              </button>
            </div>
          </div>

          {data && data.insights.length > 0 && (
            <div className="card">
              <div className="card-title">
                <Lightbulb size={16} /> Insights
              </div>
              {data.insights.map((insight) => (
                <div key={insight.id} className="job" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {insight.level === 'good' ? (
                      <CheckCircle2 size={17} style={{ color: 'var(--success)', flex: 'none', marginTop: 2 }} />
                    ) : (
                      <Lightbulb size={17} style={{ color: insight.level === 'warning' ? 'var(--danger)' : 'var(--warning)', flex: 'none', marginTop: 2 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{insight.title}</div>
                      <div className="hint" style={{ marginTop: 3 }}>{insight.detail}</div>
                    </div>
                    {insight.action && (
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ flex: 'none', alignSelf: 'center' }}
                        disabled={applying !== null}
                        onClick={() => void applyAction(insight)}
                      >
                        {applying === insight.id ? <Loader2 className="spin" size={13} /> : null} Apply
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title">
              <BarChart3 size={16} /> Recent uploads
            </div>
            {overview.videos.length === 0 ? (
              <div className="hint">No uploads yet — your first renders will show up here with their performance.</div>
            ) : (
              overview.videos.map((v) => (
                <div key={v.videoId} className="job" style={{ padding: 12 }}>
                  <div className="job-head" style={{ marginBottom: 0 }}>
                    {v.thumbnailUrl ? <img className="job-cover" src={v.thumbnailUrl} alt="" style={{ width: 66, borderRadius: 6 }} /> : <div className="job-cover" />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="job-title" style={{ fontSize: 13.5 }}>{v.title}</div>
                      <div className="job-sub">
                        {v.isShort ? 'Short' : 'Long-form'} · {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '—'}
                        {v.privacyStatus !== 'public' && <> · {v.privacyStatus}</>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 18, flex: 'none', fontSize: 12.5, color: 'var(--text-dim)', textAlign: 'right' }}>
                      <Metric label="views" value={v.views.toLocaleString()} />
                      <Metric label="avg watch" value={v.averageViewPercentage !== null ? `${v.averageViewPercentage}%` : '—'} />
                      <Metric label="subs" value={v.subscribersGained !== null ? `+${v.subscribersGained}` : '—'} />
                    </div>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Open on YouTube"
                      onClick={() => void window.api.openExternal(`https://youtu.be/${v.videoId}`)}
                    >
                      <Youtube size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ minWidth: 54 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{label}</div>
    </div>
  )
}
