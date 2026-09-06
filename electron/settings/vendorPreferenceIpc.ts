import { ipcMain } from 'electron'
import { assertTrustedSender } from '../ipcSenderGuard'
import { readVendorPreferenceSettings, writeVendorPreferenceSettings } from './vendorPreferenceSettings'
import type { VendorPreferenceSettings } from './vendorPreferenceContract'
export type VendorPreferenceStore = { read: () => VendorPreferenceSettings; write: (value: unknown) => VendorPreferenceSettings }
export function registerVendorPreferenceIpc(store: VendorPreferenceStore = { read: readVendorPreferenceSettings, write: writeVendorPreferenceSettings }): void {
  ipcMain.handle('nomi:settings:vendor-preference-get', async (event) => { assertTrustedSender(event); return store.read() })
  ipcMain.handle('nomi:settings:vendor-preference-set', async (event, payload: unknown) => { assertTrustedSender(event); return store.write(payload) })
}
