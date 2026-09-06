import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VENDOR_PREFERENCE_SETTINGS,
  VENDOR_PREFERENCE_KEY_MAX_LENGTH,
  normalizeVendorPreferenceSettings,
} from './vendorPreferenceContract'

describe('normalizeVendorPreferenceSettings', () => {
  it('trims, deduplicates and preserves the user order', () => {
    expect(normalizeVendorPreferenceSettings({ orderedVendorKeys: [' kie ', 'apimart', 'kie', '', 42] })).toEqual({
      schemaVersion: 1,
      orderedVendorKeys: ['kie', 'apimart'],
    })
  })

  it('drops overlong keys and survives malformed settings', () => {
    expect(normalizeVendorPreferenceSettings({ orderedVendorKeys: ['x'.repeat(VENDOR_PREFERENCE_KEY_MAX_LENGTH + 1)] })).toEqual(DEFAULT_VENDOR_PREFERENCE_SETTINGS)
    for (const input of [undefined, null, 42, 'text', []]) expect(normalizeVendorPreferenceSettings(input)).toEqual(DEFAULT_VENDOR_PREFERENCE_SETTINGS)
  })
})
