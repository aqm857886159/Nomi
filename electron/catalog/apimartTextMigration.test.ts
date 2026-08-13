import { describe, expect, it } from 'vitest'
import type { CatalogState } from './types'
import { applyBuiltinSeeds } from './seedBuiltins'

function catalogWithRetiredModel(): CatalogState {
  return {
    version: 3,
    vendors: [{ key: 'apimart', name: 'APIMart', enabled: true, authType: 'bearer', createdAt: 'a', updatedAt: 'a' }],
    models: [{ modelKey: 'deepseek-v4-pro', vendorKey: 'apimart', labelZh: 'DeepSeek V4 Pro', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' }],
    mappings: [],
    apiKeysByVendor: {},
  }
}

describe('APIMart text model migration', () => {
  it('removes the retired DeepSeek V4 Pro seed and installs a verified V3.1 entry', () => {
    const { state } = applyBuiltinSeeds(catalogWithRetiredModel(), '2026-08-13T00:00:00.000Z')
    expect(state.models.some((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v4-pro')).toBe(false)
    expect(state.models.find((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.1-250821')).toMatchObject({
      labelZh: 'DeepSeek V3.1',
      kind: 'text',
      enabled: true,
    })
  })

  it('does not remove a same-named model from another vendor', () => {
    const catalog = catalogWithRetiredModel()
    catalog.models.push({ modelKey: 'deepseek-v4-pro', vendorKey: 'custom', labelZh: 'Custom V4', kind: 'text', enabled: true, createdAt: 'a', updatedAt: 'a' })
    const { state } = applyBuiltinSeeds(catalog, '2026-08-13T00:00:00.000Z')
    expect(state.models.some((model) => model.vendorKey === 'custom' && model.modelKey === 'deepseek-v4-pro')).toBe(true)
  })
})
