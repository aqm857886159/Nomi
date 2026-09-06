/** Cross-process contract for model picker provider ordering. */
export const VENDOR_PREFERENCE_SCHEMA_VERSION = 1 as const
export const VENDOR_PREFERENCE_KEY_MAX_LENGTH = 200
export type VendorPreferenceSettings = { schemaVersion: 1; orderedVendorKeys: string[] }
export const DEFAULT_VENDOR_PREFERENCE_SETTINGS: VendorPreferenceSettings = { schemaVersion: 1, orderedVendorKeys: [] }

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }

export function normalizeVendorPreferenceSettings(value: unknown): VendorPreferenceSettings {
  const raw = record(value)
  const values = Array.isArray(raw.orderedVendorKeys) ? raw.orderedVendorKeys : []
  const seen = new Set<string>()
  const orderedVendorKeys: string[] = []
  for (const item of values) {
    if (typeof item !== 'string') continue
    const key = item.trim()
    if (!key || key.length > VENDOR_PREFERENCE_KEY_MAX_LENGTH || seen.has(key)) continue
    seen.add(key); orderedVendorKeys.push(key)
  }
  return { schemaVersion: VENDOR_PREFERENCE_SCHEMA_VERSION, orderedVendorKeys }
}
