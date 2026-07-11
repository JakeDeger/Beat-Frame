import { create } from 'zustand'
import type {
  AppNotification,
  AppSettings,
  AutomationItem,
  RenderJob,
  UploadJob,
  YouTubeAccount
} from '@shared/types'

export type PageId = 'home' | 'queue' | 'automation' | 'uploads' | 'channel' | 'templates' | 'settings'

interface AppState {
  page: PageId
  settings: AppSettings | null
  renderJobs: RenderJob[]
  uploadJobs: UploadJob[]
  automationItems: AutomationItem[]
  ytAccount: YouTubeAccount | null
  toasts: AppNotification[]

  setPage: (page: PageId) => void
  setSettings: (settings: AppSettings) => void
  saveSettings: (mutate: (draft: AppSettings) => void) => Promise<void>
  pushToast: (toast: AppNotification) => void
  dismissToast: (id: string) => void
  bootstrap: () => Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  page: 'home',
  settings: null,
  renderJobs: [],
  uploadJobs: [],
  automationItems: [],
  ytAccount: null,
  toasts: [],

  setPage: (page) => set({ page }),

  setSettings: (settings) => set({ settings }),

  saveSettings: async (mutate) => {
    const current = get().settings
    if (!current) return
    const draft = structuredClone(current)
    mutate(draft)
    set({ settings: draft }) // optimistic
    try {
      const saved = await window.api.setSettings(draft)
      set({ settings: saved })
    } catch (err) {
      set({ settings: current })
      get().pushToast(toast('error', 'Could not save settings', message(err)))
    }
  },

  pushToast: (t) => {
    set((s) => ({ toasts: [...s.toasts.slice(-4), t] }))
    setTimeout(() => get().dismissToast(t.id), t.level === 'error' ? 9000 : 5000)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  bootstrap: async () => {
    const [settings, renderJobs, uploadJobs, automationItems] = await Promise.all([
      window.api.getSettings(),
      window.api.listRenders(),
      window.api.listUploads(),
      window.api.automationItems()
    ])
    set({ settings, renderJobs, uploadJobs, automationItems })

    window.api.onRenderJobsChanged((jobs) => set({ renderJobs: [...jobs] }))
    window.api.onUploadJobsChanged((jobs) => set({ uploadJobs: [...jobs] }))
    window.api.onAutomationChanged((items) => set({ automationItems: [...items] }))
    window.api.onNotification((n) => get().pushToast(n))

    const refreshAuth = (): void => {
      window.api
        .ytAuthStatus()
        .then((account) => set({ ytAccount: account }))
        .catch(() => set({ ytAccount: null }))
    }
    window.api.onAuthChanged(refreshAuth)
    refreshAuth()
  }
}))

let toastCounter = 0

export function toast(level: AppNotification['level'], title: string, msg: string): AppNotification {
  return { id: `local-${++toastCounter}-${Date.now()}`, level, title, message: msg, createdAt: Date.now() }
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, '0')}m`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
