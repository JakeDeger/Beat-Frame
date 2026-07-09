import { useEffect, useState } from 'react'
import { Cpu, FileVideo, KeyRound, ScrollText, Volume2, Youtube } from 'lucide-react'
import type { EncoderSupport } from '@shared/types'
import { useApp, toast, message } from '../store'
import { Field, Switch } from '../components/ui'

export default function SettingsPage(): React.JSX.Element {
  const { settings, saveSettings, ytAccount, pushToast } = useApp()
  const [encoders, setEncoders] = useState<EncoderSupport | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    // Cached on mount; the button below forces a full re-verification.
    void detect(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const detect = async (force: boolean): Promise<void> => {
    setDetecting(true)
    try {
      setEncoders(await window.api.detectEncoders(force))
    } catch (err) {
      pushToast(toast('error', 'Encoder detection failed', message(err)))
    } finally {
      setDetecting(false)
    }
  }

  if (!settings) return <div />
  const r = settings.render

  const hwOptions = [
    { value: 'auto', label: 'Automatic (recommended)' },
    { value: 'nvenc', label: 'NVIDIA NVENC' },
    { value: 'amf', label: 'AMD AMF' },
    { value: 'qsv', label: 'Intel QuickSync' },
    { value: 'none', label: 'Software only (CPU)' }
  ]

  const signIn = async (): Promise<void> => {
    setSigningIn(true)
    try {
      await window.api.ytSignIn()
      pushToast(toast('success', 'Connected', 'YouTube account connected.'))
    } catch (err) {
      pushToast(toast('error', 'Sign-in failed', message(err)))
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div className="page">
      <div className="page-title">Settings</div>
      <div className="page-subtitle">Rendering, YouTube and app preferences. Everything saves automatically.</div>

      <div className="card">
        <div className="card-title">
          <FileVideo size={16} /> Video output
        </div>
        <div className="row">
          <Field label="Resolution">
            <select className="input" value={r.resolution} onChange={(e) => void saveSettings((d) => void (d.render.resolution = e.target.value as typeof r.resolution))}>
              <option value="source">Same as recording</option>
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
              <option value="2160p">4K (2160p)</option>
            </select>
          </Field>
          <Field label="Frame rate">
            <select className="input" value={String(r.frameRate)} onChange={(e) => void saveSettings((d) => void (d.render.frameRate = e.target.value === 'source' ? 'source' : (Number(e.target.value) as 30 | 60)))}>
              <option value="source">Same as recording</option>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
            </select>
          </Field>
          <Field label="Codec">
            <select className="input" value={r.codec} onChange={(e) => void saveSettings((d) => void (d.render.codec = e.target.value as typeof r.codec))}>
              <option value="h264">H.264 (most compatible)</option>
              <option value="h265">H.265 / HEVC</option>
              <option value="av1">AV1</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="Quality preset" hint="Balanced is a good default; Quality is slower but sharper.">
            <select className="input" value={r.quality} onChange={(e) => void saveSettings((d) => void (d.render.quality = e.target.value as typeof r.quality))}>
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="quality">Quality</option>
            </select>
          </Field>
          <Field label="Video bitrate (kbps)" hint="0 = automatic, based on resolution and codec.">
            <input className="input" type="number" min={0} step={500} value={r.videoBitrateKbps} onChange={(e) => void saveSettings((d) => void (d.render.videoBitrateKbps = Math.max(0, Number(e.target.value) || 0)))} />
          </Field>
          <Field label="Audio bitrate (kbps)">
            <select className="input" value={r.audioBitrateKbps} onChange={(e) => void saveSettings((d) => void (d.render.audioBitrateKbps = Number(e.target.value)))}>
              <option value={128}>128</option>
              <option value={192}>192</option>
              <option value={256}>256</option>
              <option value={320}>320</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Cpu size={16} /> Hardware acceleration
        </div>
        <Field label="GPU encoder">
          <select className="input" value={r.hwAccel} onChange={(e) => void saveSettings((d) => void (d.render.hwAccel = e.target.value as typeof r.hwAccel))}>
            {hwOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        {encoders && (
          <div className="hint" style={{ userSelect: 'text' }}>
            {encoders.ffmpegPath ? (
              <>
                FFmpeg {encoders.ffmpegVersion ?? ''} detected. Verified encoders:{' '}
                {Object.entries(encoders.encoders).filter(([, ok]) => ok).map(([name]) => name).join(', ') || 'none found'}
                . Hardware encoders are test-verified on this machine; if one still fails mid-render, BeatFrame
                automatically falls back to software encoding.
              </>
            ) : (
              <span style={{ color: 'var(--danger)' }}>
                FFmpeg was not found. Install FFmpeg or set a custom path below.
              </span>
            )}
          </div>
        )}
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => void detect(true)} disabled={detecting}>
          {detecting ? 'Verifying encoders…' : 'Re-detect encoders'}
        </button>
      </div>

      <div className="card">
        <div className="card-title">
          <Volume2 size={16} /> Audio
        </div>
        <Switch
          on={r.normalizeAudio}
          onChange={(on) => void saveSettings((d) => void (d.render.normalizeAudio = on))}
          label="Normalize loudness"
          desc="Targets −14 LUFS (YouTube's playback level), so quiet recordings don't stay quiet."
        />
        <Field label="Volume adjustment (dB)" hint="Applied on top of normalization. 0 leaves the mix untouched.">
          <input className="input" type="number" min={-20} max={20} step={0.5} value={r.volumeGainDb} onChange={(e) => void saveSettings((d) => void (d.render.volumeGainDb = Number(e.target.value) || 0))} />
        </Field>
      </div>

      <div className="card">
        <div className="card-title">
          <Youtube size={16} /> YouTube
        </div>
        {ytAccount ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            {ytAccount.thumbnailUrl && <img src={ytAccount.thumbnailUrl} style={{ width: 36, height: 36, borderRadius: '50%' }} alt="" />}
            <div style={{ flex: 1 }}>
              <b>{ytAccount.channelTitle}</b>
              <div className="hint">Connected</div>
            </div>
            <button className="btn btn-sm btn-danger" onClick={() => void window.api.ytSignOut()}>
              Disconnect
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }} className="hint">
              No account connected. Enter your API credentials below, then connect.
            </div>
            <button className="btn btn-primary" onClick={() => void signIn()} disabled={signingIn || !settings.youtubeClientId || !settings.youtubeClientSecret}>
              {signingIn ? 'Waiting for browser…' : 'Connect account'}
            </button>
          </div>
        )}
        <div className="row">
          <Field label="OAuth Client ID">
            <input className="input" value={settings.youtubeClientId} onChange={(e) => void saveSettings((d) => void (d.youtubeClientId = e.target.value.trim()))} spellCheck={false} placeholder="xxxxx.apps.googleusercontent.com" />
          </Field>
          <Field label="OAuth Client Secret">
            <input className="input" type="password" value={settings.youtubeClientSecret} onChange={(e) => void saveSettings((d) => void (d.youtubeClientSecret = e.target.value.trim()))} spellCheck={false} />
          </Field>
        </div>
        <div className="hint">
          Uploading requires your own (free) YouTube API credentials — a one-time, five-minute setup. See{' '}
          <a onClick={(e) => { e.preventDefault(); void window.api.openExternal('https://github.com/JakeDeger/Beat-Editor/blob/main/docs/YOUTUBE_SETUP.md') }} href="#setup">
            the setup guide
          </a>
          . Tokens are stored encrypted on this computer.
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <KeyRound size={16} /> Metadata
        </div>
        <Field label="Extra keywords" hint="Comma-separated. Merged into generated tags for every upload.">
          <input
            className="input"
            value={settings.extraKeywords.join(', ')}
            onChange={(e) => void saveSettings((d) => void (d.extraKeywords = e.target.value.split(',').map((k) => k.trim()).filter(Boolean)))}
            placeholder="beat saber montage, rhythm gaming"
          />
        </Field>
        <Field label="Description footer" hint="Appended to every generated description — channel links, socials, credits.">
          <textarea
            className="input"
            rows={3}
            value={settings.descriptionFooter}
            onChange={(e) => void saveSettings((d) => void (d.descriptionFooter = e.target.value))}
            placeholder={'Discord: discord.gg/…\nTwitch: twitch.tv/…'}
          />
        </Field>
      </div>

      <div className="card">
        <div className="card-title">
          <ScrollText size={16} /> Advanced
        </div>
        <div className="row">
          <Field label="Custom FFmpeg path" hint="Leave empty to use the bundled FFmpeg.">
            <input
              className="input"
              value={r.ffmpegPath}
              placeholder="(bundled)"
              spellCheck={false}
              onChange={(e) => void saveSettings((d) => void (d.render.ffmpegPath = e.target.value))}
            />
          </Field>
          <Field label="Custom FFprobe path">
            <input
              className="input"
              value={r.ffprobePath}
              placeholder="(bundled)"
              spellCheck={false}
              onChange={(e) => void saveSettings((d) => void (d.render.ffprobePath = e.target.value))}
            />
          </Field>
        </div>
        <Switch
          on={settings.checkForUpdates}
          onChange={(on) => void saveSettings((d) => void (d.checkForUpdates = on))}
          label="Check for updates on launch"
        />
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => void window.api.openLogs()}>
          Open log folder
        </button>
      </div>
    </div>
  )
}
