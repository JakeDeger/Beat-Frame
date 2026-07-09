import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Film, Loader2, Music2, Smartphone, User, FolderOpen, Wand2 } from 'lucide-react'
import type { BeatSaverMap, PlayerProfile, VideoFileInfo, VideoMode } from '@shared/types'
import { DEFAULT_SHORT, DEFAULT_TRIM } from '@shared/defaults'
import { useApp, toast, message, formatDuration } from '../store'
import { Field, PickerRow } from '../components/ui'

export default function HomePage(): React.JSX.Element {
  const { settings, saveSettings, setPage, pushToast } = useApp()

  const [videoPath, setVideoPath] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoFileInfo | null>(null)
  const [videoError, setVideoError] = useState('')
  const [mapId, setMapId] = useState('')
  const [map, setMap] = useState<BeatSaverMap | null>(null)
  const [mapError, setMapError] = useState('')
  const [mapLoading, setMapLoading] = useState(false)
  const [player, setPlayer] = useState<PlayerProfile | null>(null)
  const [playerError, setPlayerError] = useState('')
  const [mode, setMode] = useState<VideoMode>('longform')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [trimStart, setTrimStart] = useState('0')
  const [trimEnd, setTrimEnd] = useState('0')
  const [shortStart, setShortStart] = useState('0')
  const [shortDuration, setShortDuration] = useState('60')
  const [cropBias, setCropBias] = useState('0')
  const [autoHighlight, setAutoHighlight] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const mapLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playerLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced BeatSaver lookup as the user types the ID.
  useEffect(() => {
    setMap(null)
    setMapError('')
    if (!mapId.trim()) return
    if (mapLookupTimer.current) clearTimeout(mapLookupTimer.current)
    setMapLoading(true)
    mapLookupTimer.current = setTimeout(() => {
      window.api
        .lookupMap(mapId.trim())
        .then((m) => {
          setMap(m)
          setMapError('')
        })
        .catch((err) => setMapError(message(err)))
        .finally(() => setMapLoading(false))
    }, 600)
    return () => {
      if (mapLookupTimer.current) clearTimeout(mapLookupTimer.current)
    }
  }, [mapId])

  // Debounced player profile lookup.
  const profileUrl = settings?.playerProfileUrl ?? ''
  useEffect(() => {
    setPlayer(null)
    setPlayerError('')
    if (!profileUrl.trim()) return
    if (playerLookupTimer.current) clearTimeout(playerLookupTimer.current)
    playerLookupTimer.current = setTimeout(() => {
      window.api
        .lookupPlayer(profileUrl.trim())
        .then((p) => setPlayer(p))
        .catch((err) => setPlayerError(message(err)))
    }, 800)
    return () => {
      if (playerLookupTimer.current) clearTimeout(playerLookupTimer.current)
    }
  }, [profileUrl])

  if (!settings) return <div />

  const loadVideo = async (path: string): Promise<void> => {
    setVideoPath(path)
    setVideoInfo(null)
    setVideoError('')
    try {
      const info = await window.api.probeVideo(path)
      setVideoInfo(info)
      // Try to auto-detect the map ID from the file name.
      if (!mapId) {
        const detected = path.split(/[\\/]/).pop() ?? ''
        const match =
          detected.match(/beatsaver\.com\/maps\/([0-9a-fA-F]{1,8})/i) ??
          detected.match(/[[({]([0-9a-fA-F]{2,8})[\])}]/)
        if (match && /\d/.test(match[1])) setMapId(match[1].toLowerCase())
      }
    } catch (err) {
      setVideoError(message(err))
    }
  }

  const pickVideo = async (): Promise<void> => {
    const path = await window.api.pickVideo()
    if (path) await loadVideo(path)
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!/\.(mp4|mkv|mov|avi|webm)$/i.test(file.name)) {
      pushToast(toast('warning', 'Unsupported file', 'Drop a video file (.mp4, .mkv, .mov, .avi, .webm).'))
      return
    }
    try {
      const path = window.api.pathForFile(file)
      if (path) void loadVideo(path)
    } catch (err) {
      pushToast(toast('error', 'Could not read the dropped file', message(err)))
    }
  }

  const canRender = !!videoPath && !!videoInfo && !!map && !submitting

  const render = async (): Promise<void> => {
    if (!canRender || !map) return
    setSubmitting(true)
    try {
      await window.api.enqueueRender({
        videoPath,
        mapId: map.id,
        mode,
        playerName: settings.playerName,
        playerProfileUrl: settings.playerProfileUrl,
        outputFolder: settings.outputFolder,
        trim: {
          trimStartSec: Number(trimStart) || DEFAULT_TRIM.trimStartSec,
          trimEndSec: Number(trimEnd) || DEFAULT_TRIM.trimEndSec
        },
        short: {
          startOffsetSec: Number(shortStart) || DEFAULT_SHORT.startOffsetSec,
          durationSec: Number(shortDuration) || DEFAULT_SHORT.durationSec,
          cropBias: Math.max(-1, Math.min(1, Number(cropBias) || 0)),
          autoHighlight
        },
        generateThumbnail: mode === 'longform'
      })
      pushToast(toast('success', 'Added to render queue', `${map.songName} (${mode === 'short' ? 'Short' : 'Long-form'})`))
      setPage('queue')
    } catch (err) {
      pushToast(toast('error', 'Could not start render', message(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-title">Create a video</div>
      <div className="page-subtitle">Import a recording, confirm the map, hit render. That&rsquo;s it.</div>

      <div
        className="card"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={dragging ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px rgba(255,45,120,0.15)' } : undefined}
      >
        <div className="card-title">
          <Clapperboard size={16} /> Recording
        </div>
        <Field label="Gameplay video" hint={videoPath ? undefined : 'Tip: you can also drag & drop a video anywhere on this card.'}>
          <PickerRow value={videoPath} placeholder="Choose or drop your Beat Saber recording…" onPick={() => void pickVideo()} />
          {videoInfo && (
            <div className="hint">
              {videoInfo.width}×{videoInfo.height} · {videoInfo.fps} fps · {formatDuration(videoInfo.durationSec)} ·{' '}
              {(videoInfo.sizeBytes / 1024 / 1024).toFixed(0)} MB
            </div>
          )}
          {videoError && <div className="hint" style={{ color: 'var(--danger)' }}>{videoError}</div>}
        </Field>

        <div className="row">
          <Field label="BeatSaver map ID" hint="The short code from beatsaver.com — auto-detected from the filename when possible.">
            <div className="input-group">
              <input
                className="input"
                value={mapId}
                onChange={(e) => setMapId(e.target.value)}
                placeholder="e.g. 25f"
                spellCheck={false}
              />
              {mapLoading && <Loader2 className="spin" size={18} style={{ alignSelf: 'center', color: 'var(--text-dim)' }} />}
            </div>
            {mapError && <div className="hint" style={{ color: 'var(--danger)' }}>{mapError}</div>}
          </Field>
        </div>

        {map && (
          <div className="job" style={{ marginBottom: 0 }}>
            <div className="job-head" style={{ marginBottom: 0 }}>
              {map.coverUrl ? <img className="job-cover" src={map.coverUrl} alt="" /> : <Music2 className="job-cover" />}
              <div style={{ minWidth: 0 }}>
                <div className="job-title">{map.songName}</div>
                <div className="job-sub">
                  {map.songAuthorName} · mapped by {map.levelAuthorName}
                  {map.durationSec > 0 && <> · {formatDuration(map.durationSec)}</>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <User size={16} /> Player
        </div>
        <div className="row">
          <Field label="Player name" hint="Shown on the intro card. Leave empty to use the profile's name.">
            <input
              className="input"
              value={settings.playerName}
              onChange={(e) => void saveSettings((d) => void (d.playerName = e.target.value))}
              placeholder="Your display name"
            />
          </Field>
          <Field label="BeatLeader / ScoreSaber profile" hint="Optional — used for name, avatar and profile link.">
            <input
              className="input"
              value={settings.playerProfileUrl}
              onChange={(e) => void saveSettings((d) => void (d.playerProfileUrl = e.target.value))}
              placeholder="https://beatleader.xyz/u/…  or  https://scoresaber.com/u/…"
              spellCheck={false}
            />
            {player && (
              <div className="hint" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {player.avatarUrl && <img src={player.avatarUrl} style={{ width: 16, height: 16, borderRadius: '50%' }} alt="" />}
                {player.name}
                {player.rank > 0 && <> · #{player.rank}</>}
              </div>
            )}
            {playerError && <div className="hint" style={{ color: 'var(--warning)' }}>{playerError}</div>}
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Film size={16} /> Output
        </div>
        <Field label="Format">
          <div className="mode-toggle">
            <button className={`mode-option ${mode === 'longform' ? 'selected' : ''}`} onClick={() => setMode('longform')}>
              <span className="mode-name">
                <Film size={15} /> Long-form video
              </span>
              <span className="mode-desc">Intro card → untouched gameplay → end screen. 16:9.</span>
            </button>
            <button className={`mode-option ${mode === 'short' ? 'selected' : ''}`} onClick={() => setMode('short')}>
              <span className="mode-name">
                <Smartphone size={15} /> YouTube Short
              </span>
              <span className="mode-desc">Vertical 9:16 smart crop with animated intro. Up to 3 min.</span>
            </button>
          </div>
        </Field>

        <Field label="Output folder">
          <PickerRow
            value={settings.outputFolder}
            placeholder="Where finished videos are saved"
            onPick={() =>
              void window.api.pickFolder('Choose output folder').then((f) => {
                if (f) void saveSettings((d) => void (d.outputFolder = f))
              })
            }
          />
        </Field>

        <button className="btn btn-ghost btn-sm" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? 'Hide' : 'Show'} trim &amp; framing options
        </button>

        {showAdvanced && (
          <div style={{ marginTop: 12 }}>
            <div className="row">
              <Field label="Trim start (seconds)" hint="Dead air to cut from the beginning.">
                <input className="input" type="number" min={0} value={trimStart} onChange={(e) => setTrimStart(e.target.value)} />
              </Field>
              <Field label="Trim end (seconds)" hint="Dead air to cut from the end.">
                <input className="input" type="number" min={0} value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} />
              </Field>
            </div>
            {mode === 'short' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 12px', cursor: 'pointer', fontWeight: 600 }}>
                  <input type="checkbox" checked={autoHighlight} onChange={(e) => setAutoHighlight(e.target.checked)} />
                  Start at the most intense section automatically
                  <span className="hint" style={{ fontWeight: 400 }}>(analyzes the audio for the loudest part)</span>
                </label>
                <div className="row">
                  <Field label="Short starts at (seconds)" hint={autoHighlight ? 'Chosen automatically.' : 'Seconds into the (trimmed) gameplay.'}>
                    <input className="input" type="number" min={0} value={shortStart} disabled={autoHighlight} onChange={(e) => setShortStart(e.target.value)} />
                  </Field>
                  <Field label="Short length (seconds)" hint="Up to 180 seconds.">
                    <input className="input" type="number" min={5} max={180} value={shortDuration} onChange={(e) => setShortDuration(e.target.value)} />
                  </Field>
                  <Field label="Crop position" hint="-1 = left · 0 = center · 1 = right">
                    <input className="input" type="number" min={-1} max={1} step={0.1} value={cropBias} onChange={(e) => setCropBias(e.target.value)} />
                  </Field>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!canRender} onClick={() => void render()}>
        {submitting ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
        Render {mode === 'short' ? 'Short' : 'video'}
      </button>
      {!videoPath && (
        <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
          <FolderOpen size={12} style={{ verticalAlign: -2 }} /> Start by choosing a gameplay recording above.
        </div>
      )}
    </div>
  )
}
