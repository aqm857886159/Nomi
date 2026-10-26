import { describe, expect, it } from 'vitest'
import type { CatalogState } from './types'
import { applyBuiltinSeeds } from './seedBuiltins'

function catalogWithRetiredModel(): CatalogState {
  return {
    version: 3,
    vendors: [{ key: 'apimart', name: 'APIMart', enabled: true, authType: 'bearer', createdAt: 'a', updatedAt: 'a' }],
    models: [{ modelKey: 'deepseek-v3.1-250821', vendorKey: 'apimart', labelZh: 'DeepSeek V3.1', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' }],
    mappings: [],
    apiKeysByVendor: {},
  }
}

describe('APIMart text model migration', () => {
  it('marks the stale DeepSeek V3.1 seed unlisted without touching the user enable decision, and installs the verified current text set', () => {
    // 2026-09-21：这条以前钉的是 `enabled: false`——种子替用户停用。现在只落旁注（unlisted），
    // 用户的启用决定原样保留（停不停用他自己看着办，界面上会写「供应商清单里暂时没有它」）。
    const { state } = applyBuiltinSeeds(catalogWithRetiredModel(), '2026-08-13T00:00:00.000Z')
    expect(state.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.1-250821')).toMatchObject({ enabled: true, unlisted: true })
    for (const modelKey of [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v3.1-terminus',
    ]) {
      expect(state.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === modelKey)).toMatchObject({
        kind: 'text',
        enabled: true,
      })
    }
  })

  it('marks deepseek-v3.2-think unlisted on an existing install (relay still lists it, upstream 400s)', () => {
    // 2026-09-06 实测：它仍在 authenticated /v1/models?category=chat 的返回里，但真打
    // /v1/chat/completions 确定性 400 "not a valid model ID"。目录列表不是可用性证据。
    const catalog = catalogWithRetiredModel()
    catalog.models.push({ modelKey: 'deepseek-v3.2-think', vendorKey: 'apimart', labelZh: 'DeepSeek V3.2 Think', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' })
    const { state } = applyBuiltinSeeds(catalog, '2026-09-06T00:00:00.000Z')
    expect(state.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.2-think')).toMatchObject({ enabled: true, unlisted: true })
    // 同族仍在售的不许被连坐。
    expect(state.models.some((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.1-terminus')).toBe(true)
  })

  it('marks deepseek-v3.2 unlisted + legacy on an existing install and keeps the user enable decision (relay still lists it, upstream 404s)', () => {
    // 2026-10-18 付费走查实录：它仍在 APIMart 的 /v1/models 里，真打 /v1/chat/completions 确定性 404 model_not_found。
    // 照 09-06 deepseek-v3.2-think 的先例：种子删行 + 进退役清单 + 存量只落旁注，停不停用由用户自己决定。
    const catalog = catalogWithRetiredModel()
    catalog.models.push(
      { modelKey: 'deepseek-v3.2', vendorKey: 'apimart', labelZh: 'DeepSeek V3.2', kind: 'text', enabled: true, meta: { note: 'keep' }, createdAt: 'a', updatedAt: 'a' },
      { modelKey: 'deepseek-v3.1-terminus', vendorKey: 'apimart', labelZh: 'DeepSeek V3.1 Terminus', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' },
      { modelKey: 'deepseek-v3.2', vendorKey: 'custom', labelZh: 'Custom V3.2', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' },
    )
    const { state } = applyBuiltinSeeds(catalog, '2026-10-27T00:00:00.000Z')
    expect(state.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.2'))
      .toMatchObject({ enabled: true, unlisted: true, meta: { note: 'keep', catalogLifecycle: 'legacy' } })
    // 同族在售的、别家同名的都不许被连坐。
    expect(state.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.1-terminus')?.unlisted).toBeUndefined()
    expect(state.models.find((model) => model.vendorKey === 'custom' && model.modelKey === 'deepseek-v3.2'))
      .toMatchObject({ enabled: true, labelZh: 'Custom V3.2' })
    expect(state.models.find((model) => model.vendorKey === 'custom' && model.modelKey === 'deepseek-v3.2')?.unlisted).toBeUndefined()
    // 一次性：再播一遍不再改它。
    expect(applyBuiltinSeeds(state, '2026-10-28T00:00:00.000Z').state.models
      .find((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.2')?.updatedAt).toBe('2026-10-27T00:00:00.000Z')
  })

  it('does not remove a same-named model from another vendor', () => {
    const catalog = catalogWithRetiredModel()
    catalog.models.push({ modelKey: 'deepseek-v4-pro', vendorKey: 'custom', labelZh: 'Custom V4', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' })
    const { state } = applyBuiltinSeeds(catalog, '2026-08-13T00:00:00.000Z')
    expect(state.models.some((model) => model.vendorKey === 'custom' && model.modelKey === 'deepseek-v4-pro')).toBe(true)
  })
})

it('retired migration is one-time and preserves user re-enabling after inspection', () => {
  const first = applyBuiltinSeeds(catalogWithRetiredModel(), '2026-09-08').state
  const retired = first.models.find((model) => model.modelKey === 'deepseek-v3.1-250821')!
  retired.enabled = true
  retired.unlisted = false
  retired.labelZh = 'User label'
  const second = applyBuiltinSeeds(first, '2026-09-09').state
  expect(second.models.find((model) => model.modelKey === retired.modelKey)).toMatchObject({ enabled: true, unlisted: false, labelZh: 'User label' })
})

it('a user-suppressed seeded identity stays absent across repeated seeding without affecting another vendor', () => {
  const first = applyBuiltinSeeds(catalogWithRetiredModel(), '2026-09-08').state
  first.suppressedBuiltinModels = [{ vendorKey: 'apimart', modelKey: 'deepseek-v4-flash' }]
  first.models = first.models.filter((model) => !(model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v4-flash'))
  first.models.push({ vendorKey: 'custom', modelKey: 'deepseek-v4-flash', labelZh: 'Custom', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' })
  const second = applyBuiltinSeeds(first, '2026-09-09').state
  expect(second.models.some((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v4-flash')).toBe(false)
  expect(second.models.some((model) => model.vendorKey === 'custom' && model.modelKey === 'deepseek-v4-flash')).toBe(true)
  expect(applyBuiltinSeeds(second, '2026-09-10').changed).toBe(false)
})
