import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { getSettingsRoot } from './settingsRoot'
import { DEFAULT_VENDOR_PREFERENCE_SETTINGS, normalizeVendorPreferenceSettings, type VendorPreferenceSettings } from './vendorPreferenceContract'
const FILE = 'vendor-preference.json'
export function vendorPreferenceSettingsPath(): string { return path.join(getSettingsRoot(), FILE) }
export function readVendorPreferenceSettings(): VendorPreferenceSettings { try { return normalizeVendorPreferenceSettings(readJsonFile(vendorPreferenceSettingsPath())) } catch { return DEFAULT_VENDOR_PREFERENCE_SETTINGS } }
export function writeVendorPreferenceSettings(value: unknown): VendorPreferenceSettings { const next = normalizeVendorPreferenceSettings(value); writeJsonFileAtomic(vendorPreferenceSettingsPath(), next); return next }
