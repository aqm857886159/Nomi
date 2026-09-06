import { getDesktopBridge } from '../../desktop/bridge'
import { DEFAULT_VENDOR_PREFERENCE_SETTINGS, normalizeVendorPreferenceSettings, type VendorPreferenceSettings } from '../../../electron/shared/contracts/vendorPreference'
export async function getVendorPreference(): Promise<VendorPreferenceSettings> {
  try { return normalizeVendorPreferenceSettings(await getDesktopBridge()?.settings?.vendorPreference?.get()) } catch { return DEFAULT_VENDOR_PREFERENCE_SETTINGS }
}
export async function setVendorPreference(orderedVendorKeys: readonly string[]): Promise<VendorPreferenceSettings> {
  const value = normalizeVendorPreferenceSettings({ schemaVersion: 1, orderedVendorKeys })
  const bridge = getDesktopBridge()?.settings?.vendorPreference
  if (!bridge) return value
  return normalizeVendorPreferenceSettings(await bridge.set(value))
}
