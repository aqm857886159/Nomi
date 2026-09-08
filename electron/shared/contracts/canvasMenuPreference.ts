/** Cross-process contract for canvas add menu preferences. */
export const CANVAS_MENU_PREFERENCE_SCHEMA_VERSION = 1 as const
const KEY_MAX_LENGTH = 200
export type CanvasMenuPreferenceSettings = { schemaVersion: 1; orderedIntentIds: string[]; hiddenIntentIds: string[] }
export const DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS: CanvasMenuPreferenceSettings = { schemaVersion: 1, orderedIntentIds: [], hiddenIntentIds: [] }

function normalizeKeys(input: unknown): string[] {
  const values = Array.isArray(input) ? input : []
  const seen = new Set<string>()
  for (const item of values) {
    if (typeof item !== 'string') continue
    const key = item.trim()
    if (key && key.length <= KEY_MAX_LENGTH) seen.add(key)
  }
  return [...seen]
}

export function normalizeCanvasMenuPreferenceSettings(value: unknown): CanvasMenuPreferenceSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    schemaVersion: CANVAS_MENU_PREFERENCE_SCHEMA_VERSION,
    orderedIntentIds: normalizeKeys(raw.orderedIntentIds),
    hiddenIntentIds: normalizeKeys(raw.hiddenIntentIds),
  }
}
