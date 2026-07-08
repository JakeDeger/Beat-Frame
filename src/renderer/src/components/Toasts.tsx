import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { useApp } from '../store'

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle
} as const

export function Toasts(): React.JSX.Element {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = ICONS[t.level]
        return (
          <div key={t.id} className={`toast ${t.level}`}>
            <Icon size={18} style={{ flex: 'none', marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-title">{t.title}</div>
              <div className="toast-msg">{t.message}</div>
            </div>
            <button className="btn-ghost btn btn-sm" style={{ padding: 2, height: 22 }} onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
