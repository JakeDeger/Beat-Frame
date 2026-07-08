import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

export function Field(props: { label: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

export function Switch(props: {
  on: boolean
  onChange: (on: boolean) => void
  label: string
  desc?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="switch-row">
      <div>
        <div className="switch-label">{props.label}</div>
        {props.desc && <div className="switch-desc">{props.desc}</div>}
      </div>
      <button
        className={`switch ${props.on ? 'on' : ''}`}
        role="switch"
        aria-checked={props.on}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.on)}
      />
    </div>
  )
}

export function ProgressBar(props: { percent: number; indeterminate?: boolean }): React.JSX.Element {
  return (
    <div className="progress-track">
      <div
        className={`progress-fill ${props.indeterminate ? 'indeterminate' : ''}`}
        style={{ width: `${Math.max(0, Math.min(100, props.percent))}%` }}
      />
    </div>
  )
}

export function StatusBadge(props: { status: string; spinning?: boolean }): React.JSX.Element {
  const label = props.status.replace(/_/g, ' ')
  return (
    <span className={`status-badge status-${props.status}`}>
      {props.spinning && <Loader2 size={11} className="spin" />}
      {label}
    </span>
  )
}

export function EmptyState(props: { icon: ReactNode; title: string; desc: string }): React.JSX.Element {
  return (
    <div className="empty-state">
      {props.icon}
      <div className="empty-title">{props.title}</div>
      <div>{props.desc}</div>
    </div>
  )
}

export function PickerRow(props: {
  value: string
  placeholder: string
  onPick: () => void
  onChange?: (value: string) => void
  buttonLabel?: string
}): React.JSX.Element {
  return (
    <div className="input-group">
      <input
        className="input"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange?.(e.target.value)}
        readOnly={!props.onChange}
      />
      <button className="btn" onClick={props.onPick}>
        {props.buttonLabel ?? 'Browse…'}
      </button>
    </div>
  )
}
