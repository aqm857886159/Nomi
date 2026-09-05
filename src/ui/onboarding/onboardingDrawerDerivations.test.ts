import { describe, expect, it } from 'vitest'
import type { ChipModel } from './ModelChipGroups'
import {
  buildExistingConnectionSummary,
  canAddModelsToConnection,
  groupOtherVendorModels,
  resolveKindGuessGap,
} from './onboardingDrawerDerivations'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'

const model = (vendorKey: string, modelKey: string, kind: ChipModel['kind'] = 'image'): ChipModel => ({
  vendorKey,
  modelKey,
  labelZh: modelKey,
  kind,
  enabled: true,
  published: true,
  adapterState: 'verified',
  canRetype: true,
})

const vendor = (patch: Partial<OnboardingVendorMeta> = {}): OnboardingVendorMeta => ({
  name: 'Gateway',
  hasApiKey: true,
  baseUrl: 'https://gateway.example/v1',
  enabled: true,
  authType: 'bearer',
  customCallOnly: false,
  ...patch,
})

describe('onboarding drawer derivations', () => {
  it('groups custom models by connection without changing their order', () => {
    const models = [model('alpha', 'a-1'), model('beta', 'b-1'), model('alpha', 'a-2')]
    const groups = groupOtherVendorModels(models, new Map([
      ['alpha', vendor({ name: 'Alpha' })],
      ['beta', vendor({ name: 'Beta' })],
    ]))

    expect(groups.map((group) => [group.vendorKey, group.name, group.models.map((item) => item.modelKey)])).toEqual([
      ['alpha', 'Alpha', ['a-1', 'a-2']],
      ['beta', 'Beta', ['b-1']],
    ])
  })

  it('keeps a save-first connection visible before it has any models', () => {
    const meta = new Map([['saved-empty', vendor({ name: 'Saved Empty' })]])

    expect(groupOtherVendorModels([], meta, ['saved-empty'])).toEqual([{
      vendorKey: 'saved-empty',
      name: 'Saved Empty',
      models: [],
    }])
  })

  it('flags a suspicious one-kind import only when useful kinds are still missing', () => {
    const models = ['one', 'two', 'three', 'four'].map((key) => model('gateway', key))
    const meta = new Map([['gateway', vendor()]])

    expect(resolveKindGuessGap(models, meta)).toMatchObject({ dominantKind: 'image', count: 4 })
    expect(resolveKindGuessGap([...models, model('gateway', 'video', 'video')], meta)).not.toBeNull()
    expect(resolveKindGuessGap(models.slice(0, 2), meta)).toBeNull()
  })

  it('builds a keyless-safe existing connection summary and filters unsupported add-model targets', () => {
    const models = [model('gateway', 'image-a'), model('other', 'image-b')]
    const meta = new Map<string, OnboardingVendorMeta>([
      ['gateway', vendor({ hasApiKey: false, authType: 'none' })],
      ['codex-local', vendor()],
      ['comfyui-local', vendor()],
      ['antigravity-cli', vendor({ hasApiKey: false, authType: 'none' })],
    ])

    expect(buildExistingConnectionSummary('gateway', 'Gateway', models, meta)).toEqual({
      vendorKey: 'gateway',
      vendorName: 'Gateway',
      baseUrl: 'https://gateway.example/v1',
      existingModels: [{ modelKey: 'image-a', labelZh: 'image-a', kind: 'image' }],
    })
    expect(canAddModelsToConnection('gateway', meta)).toBe(true)
    expect(canAddModelsToConnection('codex-local', meta)).toBe(false)
    expect(canAddModelsToConnection('comfyui-local', meta)).toBe(false)
    expect(canAddModelsToConnection('antigravity-cli', meta)).toBe(false)
  })

  it('does not mark disabled or unpublished seed rows as already added in the certification picker', () => {
    const models = [
      model('apimart', 'published-model'),
      { ...model('apimart', 'disabled-model'), enabled: false, published: true },
      { ...model('apimart', 'unpublished-model'), enabled: true, published: false },
    ]
    const meta = new Map([['apimart', vendor({ name: 'APIMart' })]])

    expect(buildExistingConnectionSummary('apimart', 'APIMart', models, meta)?.existingModels).toEqual([
      { modelKey: 'published-model', labelZh: 'published-model', kind: 'image' },
    ])
  })
})
