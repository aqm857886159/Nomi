import { ipcMain } from 'electron'
import { assertTrustedSender } from '../ipcSenderGuard'
import { readCanvasMenuPreferenceSettings, writeCanvasMenuPreferenceSettings } from './canvasMenuPreferenceSettings'
import type { CanvasMenuPreferenceSettings } from '../shared/contracts/canvasMenuPreference'
export type CanvasMenuPreferenceStore = { read: () => CanvasMenuPreferenceSettings; write: (value: unknown) => CanvasMenuPreferenceSettings }
export function registerCanvasMenuPreferenceIpc(store: CanvasMenuPreferenceStore = { read: readCanvasMenuPreferenceSettings, write: writeCanvasMenuPreferenceSettings }): void {
  ipcMain.handle('nomi:settings:canvas-menu-preference-get', async (event) => { assertTrustedSender(event); return store.read() })
  ipcMain.handle('nomi:settings:canvas-menu-preference-set', async (event, payload: unknown) => { assertTrustedSender(event); return store.write(payload) })
}
