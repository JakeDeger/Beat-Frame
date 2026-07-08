import { app } from 'electron'
import path from 'path'
import { JsonStore } from './store'
import { mergeSettings } from '@shared/defaults'
import type { AppSettings } from '@shared/types'

let store: JsonStore<AppSettings> | null = null

function ensureStore(): JsonStore<AppSettings> {
  if (!store) {
    store = new JsonStore<AppSettings>('settings.json', mergeSettings(null), (raw) => mergeSettings(raw))
    // Sensible first-run default for the output folder.
    const s = store.get()
    if (!s.outputFolder) {
      store.update((d) => {
        d.outputFolder = path.join(app.getPath('videos'), 'BeatFrame Renders')
      })
    }
  }
  return store
}

export function getSettings(): AppSettings {
  return ensureStore().get()
}

export function setSettings(next: AppSettings): AppSettings {
  ensureStore().set(mergeSettings(next))
  return ensureStore().get()
}

export function updateSettings(mutate: (draft: AppSettings) => void): AppSettings {
  return ensureStore().update(mutate)
}

export function flushSettings(): void {
  store?.flush()
}
