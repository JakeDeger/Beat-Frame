import { useEffect, useState } from 'react'
import {
  BarChart3,
  Home,
  ListVideo,
  Palette,
  Settings as SettingsIcon,
  UploadCloud,
  Zap
} from 'lucide-react'
import { useApp, type PageId } from './store'
import { Toasts } from './components/Toasts'
import HomePage from './pages/HomePage'
import QueuePage from './pages/QueuePage'
import AutomationPage from './pages/AutomationPage'
import UploadsPage from './pages/UploadsPage'
import ChannelPage from './pages/ChannelPage'
import TemplatesPage from './pages/TemplatesPage'
import SettingsPage from './pages/SettingsPage'

const NAV: Array<{ id: PageId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'queue', label: 'Render Queue', icon: ListVideo },
  { id: 'automation', label: 'Automation', icon: Zap },
  { id: 'uploads', label: 'Uploads', icon: UploadCloud },
  { id: 'channel', label: 'Channel', icon: BarChart3 },
  { id: 'templates', label: 'Templates', icon: Palette },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export default function App(): React.JSX.Element {
  const { page, setPage, bootstrap, renderJobs, automationItems, settings } = useApp()
  const [version, setVersion] = useState('')

  useEffect(() => {
    void bootstrap()
    window.api.appVersion().then(setVersion).catch(() => {})
  }, [bootstrap])

  useEffect(() => {
    // Optional non-intrusive update check on launch.
    if (!settings?.checkForUpdates) return
    window.api
      .checkForUpdates()
      .then((info) => {
        if (info.updateAvailable && info.releaseUrl) {
          useApp.getState().pushToast({
            id: 'update-toast',
            level: 'info',
            title: `Update available (v${info.latestVersion})`,
            message: 'A new version of BeatFrame Studio is available on GitHub.',
            createdAt: Date.now()
          })
        }
      })
      .catch(() => {})
  }, [settings?.checkForUpdates])

  const activeRenders = renderJobs.filter((j) =>
    ['queued', 'preparing', 'rendering', 'finalizing'].includes(j.status)
  ).length
  const needsAttention = automationItems.filter((i) =>
    ['needs_map_id', 'awaiting_review'].includes(i.status)
  ).length

  if (!settings) {
    return <div className="app" />
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <div className="logo">B</div>
          BeatFrame
        </div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
            <Icon size={17} />
            {label}
            {id === 'queue' && activeRenders > 0 && <span className="badge">{activeRenders}</span>}
            {id === 'automation' && needsAttention > 0 && <span className="badge">{needsAttention}</span>}
          </button>
        ))}
        <div className="footer">v{version || '…'}</div>
      </nav>
      <main className="main">
        {page === 'home' && <HomePage />}
        {page === 'queue' && <QueuePage />}
        {page === 'automation' && <AutomationPage />}
        {page === 'uploads' && <UploadsPage />}
        {page === 'channel' && <ChannelPage />}
        {page === 'templates' && <TemplatesPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
      <Toasts />
    </div>
  )
}
