/**
 * Minimal Electron stub so pure functions living in Electron-adjacent modules
 * can be unit tested under Node. Only surfaces referenced at import time (or
 * used by the functions under test) are stubbed.
 */
import os from 'os'
import path from 'path'

export const app = {
  getPath: (name: string): string => path.join(os.tmpdir(), 'beatframe-test', name),
  getVersion: (): string => '0.0.0-test',
  isPackaged: true
}

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return []
  }
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s),
  decryptString: (b: Buffer): string => b.toString()
}

export const shell = {
  openExternal: async (): Promise<void> => {},
  openPath: async (): Promise<string> => '',
  showItemInFolder: (): void => {}
}

export class Notification {
  static isSupported(): boolean {
    return false
  }
  show(): void {}
}

export const ipcMain = {
  handle: (): void => {}
}

export const dialog = {}

export default { app, BrowserWindow, safeStorage, shell, Notification, ipcMain, dialog }
