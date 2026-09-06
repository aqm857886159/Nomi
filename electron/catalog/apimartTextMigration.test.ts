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
  it('removes the stale DeepSeek V3.1 seed and installs the verified current text set', () => {
    const { state } = applyBuiltinSeeds(catalogWithRetiredModel(), '2026-08-13T00:00:00.000Z')
    expect(state.models.some((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.1-250821')).toBe(false)
    for (const modelKey of [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v3.2',
      'deepseek-v3.1-terminus',
    ]) {
      expect(state.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === modelKey)).toMatchObject({
        kind: 'text',
        enabled: true,
      })
    }
  })

  it('prunes deepseek-v3.2-think from an existing install (relay still lists it, upstream 400s)', () => {
    // 2026-09-06 实测：它仍在 authenticated /v1/models?category=chat 的返回里，但真打
    // /v1/chat/completions 确定性 400 "not a valid model ID"。目录列表不是可用性证据。
    const catalog = catalogWithRetiredModel()
    catalog.models.push({ modelKey: 'deepseek-v3.2-think', vendorKey: 'apimart', labelZh: 'DeepSeek V3.2 Think', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' })
    const { state } = applyBuiltinSeeds(catalog, '2026-09-06T00:00:00.000Z')
    expect(state.models.some((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.2-think')).toBe(false)
    // 同族仍在售的两条不许被连坐。
    for (const modelKey of ['deepseek-v3.2', 'deepseek-v3.1-terminus']) {
      expect(state.models.some((model) => model.vendorKey === 'apimart' && model.modelKey === modelKey)).toBe(true)
    }
  })

  it('does not remove a same-named model from another vendor', () => {
    const catalog = catalogWithRetiredModel()
    catalog.models.push({ modelKey: 'deepseek-v4-pro', vendorKey: 'custom', labelZh: 'Custom V4', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' })
    const { state } = applyBuiltinSeeds(catalog, '2026-08-13T00:00:00.000Z')
    expect(state.models.some((model) => model.vendorKey === 'custom' && model.modelKey === 'deepseek-v4-pro')).toBe(true)
  })
})
