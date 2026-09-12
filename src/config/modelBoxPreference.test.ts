// 「显示哪些 / 排在哪 / 记住哪家」唯一解析点的直测。
// 这三件事只有这一份实现，所以这里钉住的行为就是全 App 每个模型框的行为。
import { describe, expect, it } from 'vitest'
import { dedupeModelOptions } from './modelIdentity'
import { partitionByModelBoxPreference, rememberedProviderIndex, rememberedVendorFor } from './modelBoxPreference'
import type { ModelOption } from './models'
import type { ModelBoxPreferenceSettings } from '../../electron/shared/contracts/modelBoxPreference'

function option(canonicalId: string, vendor: string, label: string): ModelOption {
  return { value: `${vendor}:${canonicalId}`, label, modelKey: `${vendor}:${canonicalId}`, vendor, kind: 'image', meta: { canonicalModelId: canonicalId } } as ModelOption
}
const deduped = dedupeModelOptions([
  option('gpt-image-2', 'apimart', 'GPT Image 2'),
  option('gpt-image-2', 'kie', 'GPT Image 2'),
  option('nano-banana-2', 'apimart', 'Nano Banana 2'),
  option('nano-banana-2', 'kie', 'Nano Banana 2'),
  option('z-image-turbo', 'apimart', 'Z-Image Turbo'),
])
const preference = (patch: Partial<ModelBoxPreferenceSettings>): ModelBoxPreferenceSettings => ({
  schemaVersion: 1, modelOrder: [], hiddenModelIds: [], preferredVendorByModel: {}, ...patch,
})

describe('partitionByModelBoxPreference', () => {
  it('leaves everything untouched when no preference exists', () => {
    const { visible, hidden } = partitionByModelBoxPreference(deduped, null)
    expect(visible.map((model) => model.canonicalId)).toEqual(['gpt-image-2', 'nano-banana-2', 'z-image-turbo'])
    expect(hidden).toEqual([])
  })

  it('puts hand-ordered models first and keeps the rest in catalog order behind them', () => {
    const { visible } = partitionByModelBoxPreference(deduped, preference({ modelOrder: ['z-image-turbo'] }))
    expect(visible.map((model) => model.canonicalId)).toEqual(['z-image-turbo', 'gpt-image-2', 'nano-banana-2'])
  })

  it('ignores ordered ids that are no longer in the catalog', () => {
    const { visible } = partitionByModelBoxPreference(deduped, preference({ modelOrder: ['gone-model', 'nano-banana-2'] }))
    expect(visible.map((model) => model.canonicalId)).toEqual(['nano-banana-2', 'gpt-image-2', 'z-image-turbo'])
  })

  it('moves hidden models out of the visible list without losing them', () => {
    const { visible, hidden } = partitionByModelBoxPreference(deduped, preference({ hiddenModelIds: ['gpt-image-2'] }))
    expect(visible.map((model) => model.canonicalId)).toEqual(['nano-banana-2', 'z-image-turbo'])
    expect(hidden.map((model) => model.canonicalId)).toEqual(['gpt-image-2'])
  })
})

describe('rememberedVendorFor', () => {
  const nanoBanana = deduped.find((model) => model.canonicalId === 'nano-banana-2')!

  it('returns the hand-picked provider for that model only', () => {
    const pref = preference({ preferredVendorByModel: { 'nano-banana-2': 'kie' } })
    expect(rememberedVendorFor(nanoBanana, pref)).toBe('kie')
    expect(rememberedVendorFor(deduped[0], pref)).toBeNull()
  })

  // 卡点表③：记住的那家后来被删/被禁时必须优雅回落，不是报错也不是把行卡住。
  it('falls back to null when the remembered provider is gone', () => {
    expect(rememberedVendorFor(nanoBanana, preference({ preferredVendorByModel: { 'nano-banana-2': 'runninghub' } }))).toBeNull()
  })

  it('matches provider keys case-insensitively (catalog keys derive from base URLs)', () => {
    expect(rememberedVendorFor(nanoBanana, preference({ preferredVendorByModel: { 'nano-banana-2': 'KIE' } }))).toBe('kie')
  })
})

describe('rememberedProviderIndex', () => {
  const nanoBanana = deduped.find((model) => model.canonicalId === 'nano-banana-2')!
  it('locates the remembered provider inside the rendered chip order', () => {
    expect(rememberedProviderIndex(nanoBanana.providers, 'kie')).toBe(1)
    expect(rememberedProviderIndex(nanoBanana.providers, null)).toBe(-1)
    expect(rememberedProviderIndex(nanoBanana.providers, 'runninghub')).toBe(-1)
  })
})
