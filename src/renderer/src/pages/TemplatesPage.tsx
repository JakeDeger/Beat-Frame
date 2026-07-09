import { Palette, Type, Image as ImageIcon, Clock } from 'lucide-react'
import { useApp } from '../store'
import { Field, PickerRow, Switch } from '../components/ui'

/**
 * Template customization with a live CSS preview that mirrors the intro-card
 * markup used by the actual title-card renderer.
 */
export default function TemplatesPage(): React.JSX.Element {
  const { settings, saveSettings } = useApp()
  if (!settings) return <div />
  const t = settings.template

  return (
    <div className="page">
      <div className="page-title">Templates</div>
      <div className="page-subtitle">Customize the intro card, end screen and branding used in every render.</div>

      <div className="card">
        <div className="card-title">
          <Palette size={16} /> Preview
        </div>
        <IntroPreview />
      </div>

      <div className="card">
        <div className="card-title">
          <Type size={16} /> Branding
        </div>
        <div className="row">
          <Field label="Channel name" hint="Shown on the intro and end screen.">
            <input
              className="input"
              value={t.channelName}
              onChange={(e) => void saveSettings((d) => void (d.template.channelName = e.target.value))}
              placeholder="Your channel"
            />
          </Field>
          <Field label="Logo" hint="Optional image shown on the end screen.">
            <PickerRow
              value={t.logoPath}
              placeholder="No logo selected"
              onPick={() =>
                void window.api.pickImage().then((f) => {
                  if (f) void saveSettings((d) => void (d.template.logoPath = f))
                })
              }
            />
          </Field>
        </div>
        <div className="row">
          <Field label="Accent color">
            <ColorInput value={t.accentColor} onChange={(v) => void saveSettings((d) => void (d.template.accentColor = v))} />
          </Field>
          <Field label="Secondary accent">
            <ColorInput value={t.accentColorB} onChange={(v) => void saveSettings((d) => void (d.template.accentColorB = v))} />
          </Field>
          <Field label="Background">
            <ColorInput value={t.backgroundColor} onChange={(v) => void saveSettings((d) => void (d.template.backgroundColor = v))} />
          </Field>
        </div>
        <Field label="Font family" hint="Any font installed on this computer, CSS syntax.">
          <input
            className="input"
            value={t.fontFamily}
            onChange={(e) => void saveSettings((d) => void (d.template.fontFamily = e.target.value))}
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="card">
        <div className="card-title">
          <Clock size={16} /> Intro &amp; outro
        </div>
        <div className="row">
          <Field label="Intro layout" hint="Split screen pairs the cover art with the player's avatar.">
            <select
              className="input"
              value={t.introLayout}
              onChange={(e) => void saveSettings((d) => void (d.template.introLayout = e.target.value as typeof t.introLayout))}
            >
              <option value="split">Split screen (cover + player)</option>
              <option value="panel">Classic panel</option>
            </select>
          </Field>
          <Field label="Intro animation">
            <select
              className="input"
              value={t.introStyle}
              onChange={(e) => void saveSettings((d) => void (d.template.introStyle = e.target.value as typeof t.introStyle))}
            >
              <option value="slide-up">Slide up</option>
              <option value="fade">Fade</option>
              <option value="zoom">Slow zoom</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="Intro duration (s)">
            <input
              className="input"
              type="number"
              min={2}
              max={15}
              value={t.introDurationSec}
              onChange={(e) => void saveSettings((d) => void (d.template.introDurationSec = Number(e.target.value) || 6))}
            />
          </Field>
          <Field label="Outro duration (s)">
            <input
              className="input"
              type="number"
              min={3}
              max={20}
              value={t.outroDurationSec}
              onChange={(e) => void saveSettings((d) => void (d.template.outroDurationSec = Number(e.target.value) || 8))}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="End screen headline">
            <input
              className="input"
              value={t.outroHeadline}
              onChange={(e) => void saveSettings((d) => void (d.template.outroHeadline = e.target.value))}
            />
          </Field>
          <Field label="End screen subline">
            <input
              className="input"
              value={t.outroSubline}
              onChange={(e) => void saveSettings((d) => void (d.template.outroSubline = e.target.value))}
            />
          </Field>
        </div>
        <Switch
          on={t.showDifficulty}
          onChange={(on) => void saveSettings((d) => void (d.template.showDifficulty = on))}
          label="Show difficulty on the intro card"
        />
        <Switch
          on={t.blurredBackdrop}
          onChange={(on) => void saveSettings((d) => void (d.template.blurredBackdrop = on))}
          label="Blurred gameplay backdrop"
          desc="Plays a softly blurred clip from a random moment of your gameplay behind the intro and end screen."
        />
      </div>

      <div className="card">
        <div className="card-title">
          <ImageIcon size={16} /> Notes
        </div>
        <div className="hint">
          Title cards are rendered at your output resolution, so changes here apply to the next render. The end screen
          leaves space for YouTube&rsquo;s own end-screen elements (recommended videos and subscribe button) — add them in
          YouTube Studio after upload.
        </div>
      </div>
    </div>
  )
}

/** Miniature CSS mock of the intro card, mirroring the real card layouts. */
function IntroPreview(): React.JSX.Element {
  const { settings } = useApp()
  const t = settings!.template
  const grad = `linear-gradient(135deg, ${t.accentColor}, ${t.accentColorB})`
  // Fake "blurred gameplay" backdrop: soft moving-color blobs.
  const backdrop = t.blurredBackdrop
    ? `radial-gradient(60% 80% at 25% 30%, ${t.accentColorB}33, transparent 70%), radial-gradient(50% 70% at 75% 65%, ${t.accentColor}2e, transparent 70%), #0a0d15`
    : '#0a0d15'

  const accentBar = (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg, ${t.accentColor}, ${t.accentColorB})`, zIndex: 3 }} />
  )
  const brand = t.channelName ? (
    <div style={{ position: 'absolute', bottom: '4%', left: 0, right: 0, textAlign: 'center', fontSize: 9, letterSpacing: '0.35em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', zIndex: 3 }}>
      {t.channelName}
    </div>
  ) : null

  if (t.introLayout === 'split') {
    return (
      <div className="preview-frame" style={{ background: backdrop, fontFamily: t.fontFamily }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <div style={{ width: '50%', position: 'relative', background: grad }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(5,7,12,0.15) 30%, rgba(5,7,12,0.9) 100%)' }} />
            <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: '12%' }}>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', background: `linear-gradient(90deg, ${t.accentColor}, ${t.accentColorB})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>
                Now Playing
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>Song Title</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 3 }}>Artist Name</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
                Mapped by <b style={{ color: 'rgba(255,255,255,0.9)' }}>Mapper</b>
              </div>
            </div>
          </div>
          <div style={{ width: 3, background: `linear-gradient(180deg, ${t.accentColor}, ${t.accentColorB})`, zIndex: 2 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(5,7,12,0.45)' }}>
            <div style={{ width: 74, height: 74, borderRadius: '50%', background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 900, color: '#fff', boxShadow: '0 8px 26px rgba(0,0,0,0.5)' }}>
              P
            </div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>PlayerName</div>
            <div style={{ fontSize: 9, padding: '2px 9px', borderRadius: 99, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>Expert+</div>
          </div>
        </div>
        {accentBar}
        {brand}
      </div>
    )
  }

  return (
    <div className="preview-frame" style={{ fontFamily: t.fontFamily }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(180deg, rgba(5,7,12,${t.blurredBackdrop ? 0.55 : 0.85}), rgba(5,7,12,${t.blurredBackdrop ? 0.4 : 0.65})), ${backdrop}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4%', padding: '4% 5%', borderRadius: 14, background: 'rgba(10,13,22,0.6)', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '80%' }}>
          <div style={{ width: 92, height: 92, borderRadius: 10, flex: 'none', background: grad }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', background: `linear-gradient(90deg, ${t.accentColor}, ${t.accentColorB})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>
              Now Playing
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>Song Title</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>Artist Name</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 8 }}>
              Mapped by <b style={{ color: 'rgba(255,255,255,0.85)' }}>Mapper</b>
            </div>
          </div>
        </div>
        {accentBar}
        {brand}
      </div>
    </div>
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <div className="input-group">
      <span className="color-swatch">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  )
}
