import { describe, expect, it } from 'vitest'
import { loadUsableVendorKeys, resolveUsableModelForNode, vendorIsUsable } from './usableVendorModel'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'

function vendor(key: string, patch: Partial<ModelCatalogVendorDto> = {}): ModelCatalogVendorDto {
  return { key, name: key, enabled: true, hasApiKey: true, createdAt: '', updatedAt: '', ...patch }
}

function model(modelKey: string, vendorKey: string, archetypeId?: string, kind: ModelCatalogModelDto['kind'] = 'image'): ModelCatalogModelDto {
  return {
    modelKey, vendorKey, labelZh: modelKey, kind, enabled: true, createdAt: '', updatedAt: '',
    ...(archetypeId ? { meta: { archetypeId } } : {}),
  }
}

describe('vendorIsUsable —「能用」由 hasApiKey 派生，不只看 enabled', () => {
  it('启用 + 有 key → 可用', () => expect(vendorIsUsable(vendor('kie'))).toBe(true))
  it('启用 + 无 key（断开后）→ 不可用', () => expect(vendorIsUsable(vendor('kie', { hasApiKey: false }))).toBe(false))
  it('禁用 → 不可用', () => expect(vendorIsUsable(vendor('kie', { enabled: false }))).toBe(false))
  it('免鉴权（authType=none）→ 可用，即便无 key', () => expect(vendorIsUsable(vendor('local', { authType: 'none', hasApiKey: false }))).toBe(true))
})

describe('loadUsableVendorKeys', () => {
  it('只收 enabled && 有 key 的供应商', async () => {
    const set = await loadUsableVendorKeys(async () => [
      vendor('apimart', { hasApiKey: true }),
      vendor('kie', { hasApiKey: false }),
    ])
    expect(set.has('apimart')).toBe(true)
    expect(set.has('kie')).toBe(false)
  })
})

describe('resolveUsableModelForNode — 断开 kie 连 apimart 后老节点的解析', () => {
  const apimartImages = [model('doubao-seedream-4.5', 'apimart', 'seedream'), model('gpt-image-2', 'apimart', 'gpt-image-2')]

  it('精确 modelKey 命中可用供应商 → 直接用', () => {
    const both = [...apimartImages, model('seedream', 'kie', 'seedream')]
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', models: both, usable: new Set(['kie']) })
    expect(match?.vendorKey).toBe('kie')
  })

  it('kie 的 seedream 断开 → 按 archetypeId 落到 apimart 的 doubao-seedream-4.5', () => {
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', meta: {}, models: apimartImages, usable: new Set(['apimart']) })
    expect(match?.vendorKey).toBe('apimart')
    expect(match?.modelKey).toBe('doubao-seedream-4.5')
  })

  it('Seedance：archetypeId 不同（seedance-2 vs seedance-2-apimart）→ 按 family 兜底落 apimart', () => {
    const videos = [model('doubao-seedance-2.0', 'apimart', 'seedance-2-apimart', 'video')]
    const match = resolveUsableModelForNode({ modelKey: 'bytedance/seedance-2', vendor: 'kie', meta: {}, models: videos, usable: new Set(['apimart']) })
    expect(match?.vendorKey).toBe('apimart')
    expect(match?.modelKey).toBe('doubao-seedance-2.0')
  })

  it('没有任何可用供应商提供该款 → null（调用方据此报清晰错误）', () => {
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', meta: {}, models: apimartImages, usable: new Set() })
    expect(match).toBeNull()
  })

  it('code-newcli-com 密钥不可用 → 同款 gpt-image-2 自动落到 apimart', () => {
    const models = [
      model('gpt-image-2', 'code-newcli-com', 'gpt-image-2'),
      model('gpt-image-2', 'apimart', 'gpt-image-2'),
    ]
    const match = resolveUsableModelForNode({
      modelKey: 'gpt-image-2',
      vendor: 'code-newcli-com',
      meta: { archetypeId: 'gpt-image-2' },
      models,
      usable: new Set(['apimart']),
    })
    expect(match?.vendorKey).toBe('apimart')
    expect(match?.modelKey).toBe('gpt-image-2')
  })
})
