import { ipcMain } from 'electron'
import { assertTrustedSender } from '../ipcSenderGuard'
import { readModelBoxPreferenceSettings, writeModelBoxPreferenceSettings } from './modelBoxPreferenceSettings'
import type { ModelBoxPreferenceSettings } from './modelBoxPreferenceContract'
export type ModelBoxPreferenceStore = { read: () => ModelBoxPreferenceSettings; write: (value: unknown) => ModelBoxPreferenceSettings }
export function registerModelBoxPreferenceIpc(store: ModelBoxPreferenceStore = { read: readModelBoxPreferenceSettings, write: writeModelBoxPreferenceSettings }): void {
  ipcMain.handle('nomi:settings:model-box-preference-get', async (event) => { assertTrustedSender(event); return store.read() })
  ipcMain.handle('nomi:settings:model-box-preference-set', async (event, payload: unknown) => { assertTrustedSender(event); return store.write(payload) })
}
