import { app } from 'electron'
import { fetchJson } from './http'
import { createLogger } from './logger'
import type { UpdateInfo } from '@shared/types'

const log = createLogger('updates')
const RELEASES_URL = 'https://api.github.com/repos/JakeDeger/Beat-Editor/releases/latest'

/** Best-effort update check against GitHub releases. Never throws. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()
  try {
    const release = await fetchJson<{ tag_name?: string; html_url?: string }>(RELEASES_URL, {
      timeoutMs: 10_000,
      retries: 0,
      headers: { Accept: 'application/vnd.github+json' }
    })
    const latest = (release.tag_name ?? '').replace(/^v/, '')
    return {
      currentVersion,
      latestVersion: latest || null,
      updateAvailable: latest ? compareSemver(latest, currentVersion) > 0 : false,
      releaseUrl: release.html_url ?? null
    }
  } catch (err) {
    log.warn('update check failed', err)
    return { currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: null }
  }
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}
