import { BrowserWindow, Notification } from 'electron'
import { EVENTS } from '@shared/ipc'
import type { AppNotification } from '@shared/types'
import { randomUUID } from 'crypto'

/** Push an event payload to every open window. */
export function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

/** In-app toast + OS notification for important pipeline events. */
export function notify(level: AppNotification['level'], title: string, message: string, osNotification = false): void {
  const n: AppNotification = { id: randomUUID(), level, title, message, createdAt: Date.now() }
  broadcast(EVENTS.NOTIFICATION, n)
  if (osNotification && Notification.isSupported()) {
    new Notification({ title, body: message }).show()
  }
}
