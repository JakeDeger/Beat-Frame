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
        <div className="preview-frame">
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(180deg, rgba(5,7,12,0.85), rgba(5,7,12,0.65))'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4%',
                padding: '4% 5%',
                borderRadius: 14,
                background: 'rgba(10,13,22,0.6)',
                border: '1px solid rgba(255,255,255,0.1)',
                maxWidth: '80%',
                fontFamily: t.fontFamily
              }}
            >
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: 10,
                  flex: 'none',
                  background: `linear-gradient(135deg, ${t.accentColor}, ${t.accentColorB})`
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.35em',
                    textTransform: 'uppercase',
                    background: `linear-gradient(90deg, ${t.accentColor}, ${t.accentColorB})`,
                    WebkitBackgroundClip: 'text',
                    color: 'transparent'
                  }}
                >
                  Now Playing
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>Song Title</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>Artist Name</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 8 }}>
                  Mapped by <b style={{ color: 'rgba(255,255,255,0.85)' }}>Mapper</b>
                </div>
              </div>
            </div>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: `linear-gradient(90deg, ${t.accentColor}, ${t.accentColorB})`
              }}
            />
            {t.channelName && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '5%',
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontSize: 9,
                  letterSpacing: '0.35em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.55)'
                }}
              >
                {t.channelName}
              </div>
            )}
          </div>
        </div>
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
