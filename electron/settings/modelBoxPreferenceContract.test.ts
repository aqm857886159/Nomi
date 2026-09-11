import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS,
  MODEL_BOX_PREFERENCE_ID_MAX_LENGTH,
  MODEL_BOX_PREFERENCE_MAX_ENTRIES,
  normalizeModelBoxPreferenceSettings,
} from './modelBoxPreferenceContract'

describe('normalizeModelBoxPreferenceSettings', () => {
  it('trims, deduplicates and preserves the user order in both lists', () => {
    expect(normalizeModelBoxPreferenceSettings({
      schemaVersion: 1,
      modelOrder: [' nano-banana-2 ', 'gpt-image-2', 'nano-banana-2', '', 42, null],
      hiddenModelIds: ['z-image-turbo', ' z-image-turbo ', 'seedream-lite'],
      preferredVendorByModel: { 'nano-banana-2': ' kie ', 'gpt-image-2': '', '': 'kie', bad: 7 },
    })).toEqual({
      schemaVersion: 1,
      modelOrder: ['nano-banana-2', 'gpt-image-2'],
      hiddenModelIds: ['z-image-turbo', 'seedream-lite'],
      preferredVendorByModel: { 'nano-banana-2': 'kie' },
    })
  })

  it('round-trips a normalized value unchanged', () => {
    const once = normalizeModelBoxPreferenceSettings({
      modelOrder: ['a', 'b'],
      hiddenModelIds: ['c'],
      preferredVendorByModel: { a: 'apimart' },
    })
    expect(normalizeModelBoxPreferenceSettings(once)).toEqual(once)
  })

  // 版本号不由输入决定：写坏的 schemaVersion 不该让它伪装成另一个版本的数据。
  it('forces the current schema version whatever the input claims', () => {
    expect(normalizeModelBoxPreferenceSettings({ schemaVersion: 99, modelOrder: ['a'] }).schemaVersion).toBe(1)
    expect(normalizeModelBoxPreferenceSettings({ schemaVersion: 'nope' }).schemaVersion).toBe(1)
  })

  it('drops overlong ids and survives malformed settings instead of throwing', () => {
    const tooLong = 'x'.repeat(MODEL_BOX_PREFERENCE_ID_MAX_LENGTH + 1)
    expect(normalizeModelBoxPreferenceSettings({
      modelOrder: [tooLong],
      hiddenModelIds: [tooLong],
      preferredVendorByModel: { [tooLong]: 'kie', ok: tooLong },
    })).toEqual(DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS)
    for (const input of [undefined, null, 42, 'text', [], { modelOrder: 'not-an-array' }]) {
      expect(normalizeModelBoxPreferenceSettings(input)).toEqual(DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS)
    }
  })

  it('caps each list so a corrupt file cannot grow without bound', () => {
    const huge = Array.from({ length: MODEL_BOX_PREFERENCE_MAX_ENTRIES + 10 }, (_, index) => `m${index}`)
    const value = normalizeModelBoxPreferenceSettings({ modelOrder: huge, hiddenModelIds: huge })
    expect(value.modelOrder).toHaveLength(MODEL_BOX_PREFERENCE_MAX_ENTRIES)
    expect(value.hiddenModelIds).toHaveLength(MODEL_BOX_PREFERENCE_MAX_ENTRIES)
  })
})
