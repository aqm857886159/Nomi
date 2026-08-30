import { describe, expect, it } from 'vitest'
import { loadUsableVendorKeys, resolveUsableModelForNode, vendorIsUsable } from './usableVendorModel'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'

function vendor(key: string, patch: Partial<ModelCatalogVendorDto> = {}): ModelCatalogVendorDto {
  return { key, name: key, enabled: true, hasApiKey: true, createdAt: '', updatedAt: '', ...patch }
}

function candidateVendor(
  key: string,
  root: string,
  source: string,
  modelKey: string,
): ModelCatalogVendorDto {
  return vendor(key, {
    meta: {
      adapterCandidateRootVendorKey: root,
      adapterCandidateSourceVendorKey: source,
      adapterCandidatePromotionPredecessors: {
        [modelKey]: { vendorKey: source, publishedModes: ['text_to_image'] },
      },
    },
  })
}

function model(modelKey: string, vendorKey: string, archetypeId?: string, kind: ModelCatalogModelDto['kind'] = 'image'): ModelCatalogModelDto {
  return {
    modelKey, vendorKey, labelZh: modelKey, kind, enabled: true, published: true,
    publishedModes: kind === 'video' ? ['text_to_video'] : ['text_to_image'], createdAt: '', updatedAt: '',
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

describe('resolveUsableModelForNode — successor 必须来自同一 lineage', () => {
  const apimartImages = [model('doubao-seedream-4.5', 'apimart', 'seedream'), model('gpt-image-2', 'apimart', 'gpt-image-2')]

  it('精确 modelKey 命中可用供应商 → 直接用', () => {
    const both = [...apimartImages, model('seedream', 'kie', 'seedream')]
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', models: both, usable: new Set(['kie']) })
    expect(match?.vendorKey).toBe('kie')
  })

  it('有源 vendor 但没有 lineage 时，不按 archetypeId 静默跨到独立供应商', () => {
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', meta: {}, models: apimartImages, usable: new Set(['apimart']) })
    expect(match).toBeNull()
  })

  it('有源 vendor 但没有 lineage 时，不按 family 静默跨到独立供应商', () => {
    const videos = [model('doubao-seedance-2.0', 'apimart', 'seedance-2-apimart', 'video')]
    const match = resolveUsableModelForNode({ modelKey: 'bytedance/seedance-2', vendor: 'kie', meta: {}, models: videos, usable: new Set(['apimart']) })
    expect(match).toBeNull()
  })

  it('没有任何可用供应商提供该款 → null（调用方据此报清晰错误）', () => {
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', meta: {}, models: apimartImages, usable: new Set() })
    expect(match).toBeNull()
  })

  it('无关供应商同名模型排在前面时，只选择 source lineage 的 successor', () => {
    const source = vendor('source')
    const successor = candidateVendor('source--candidate-2', 'source', 'source', 'image-v1')
    const unrelated = vendor('unrelated')
    const match = resolveUsableModelForNode({
      modelKey: 'image-v1',
      vendor: 'source',
      models: [model('image-v1', 'unrelated'), model('image-v1', successor.key)],
      vendors: [unrelated, successor, source],
      usable: new Set(['unrelated', successor.key]),
    })
    expect(match?.vendorKey).toBe(successor.key)
  })

  it('多个 published revisions 并存时选择 predecessor 链最深的 active successor', () => {
    const source = vendor('source')
    const first = candidateVendor('source--candidate-1', 'source', 'source', 'image-v1')
    const second = candidateVendor('source--candidate-2', 'source', first.key, 'image-v1')
    const match = resolveUsableModelForNode({
      modelKey: 'image-v1',
      vendor: 'source',
      models: [model('image-v1', first.key), model('image-v1', second.key)],
      vendors: [source, first, second],
      usable: new Set([first.key, second.key]),
    })
    expect(match?.vendorKey).toBe(second.key)
  })

  it('lineage successor disabled 时不回退到无关供应商同名模型', () => {
    const source = vendor('source')
    const successor = candidateVendor('source--candidate-2', 'source', 'source', 'image-v1')
    const unrelated = vendor('unrelated')
    const match = resolveUsableModelForNode({
      modelKey: 'image-v1',
      vendor: 'source',
      models: [model('image-v1', 'unrelated'), { ...model('image-v1', successor.key), enabled: false, published: false }],
      vendors: [source, successor, unrelated],
      usable: new Set(['unrelated']),
    })
    expect(match).toBeNull()
  })

  it('无 vendor 的 legacy 节点只接受唯一精确模型，多个独立供应商同名时保守失败', () => {
    const unique = resolveUsableModelForNode({
      modelKey: 'legacy-image',
      models: [model('legacy-image', 'only')],
      vendors: [vendor('only')],
      usable: new Set(['only']),
    })
    expect(unique?.vendorKey).toBe('only')

    const ambiguous = resolveUsableModelForNode({
      modelKey: 'legacy-image',
      models: [model('legacy-image', 'one'), model('legacy-image', 'two')],
      vendors: [vendor('one'), vendor('two')],
      usable: new Set(['one', 'two']),
    })
    expect(ambiguous).toBeNull()
  })
})
