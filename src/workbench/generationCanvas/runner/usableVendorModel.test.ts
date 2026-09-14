import { describe, expect, it } from 'vitest'
import { resolveUsableModelForNode } from './usableVendorModel'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'

// 「这一家/这一款现在能不能用」的判据**不在这个文件里**了（2026-09-12 P0-10 根因修复）：
// 它只有一个 owner（`electron/shared/modelAvailability.ts`），结论随每一行模型以 `availability`
// 过 IPC 下发，矩阵覆盖在 `electron/shared/modelAvailability.test.ts` 与
// `src/workbench/ai/modelAvailabilityAgreement.test.ts`。这里只验 lineage 选择本身。

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
    availability: { usable: true },
    publishedModes: kind === 'video' ? ['text_to_video'] : ['text_to_image'], createdAt: '', updatedAt: '',
    ...(archetypeId ? { meta: { archetypeId } } : {}),
  }
}

/** 主进程判出「这一行不可用」的样子（拔了 key 的家最常见的一档）。 */
function unusable(row: ModelCatalogModelDto): ModelCatalogModelDto {
  return { ...row, availability: { usable: false, reason: 'credential_missing' } }
}

describe('resolveUsableModelForNode — successor 必须来自同一 lineage', () => {
  const apimartImages = [model('doubao-seedream-4.5', 'apimart', 'seedream'), model('gpt-image-2', 'apimart', 'gpt-image-2')]

  it('精确 modelKey 命中可用供应商 → 直接用', () => {
    const both = [...apimartImages.map(unusable), model('seedream', 'kie', 'seedream')]
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', models: both })
    expect(match?.vendorKey).toBe('kie')
  })

  it('有源 vendor 但没有 lineage 时，不按 archetypeId 静默跨到独立供应商', () => {
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', meta: {}, models: apimartImages })
    expect(match).toBeNull()
  })

  it('有源 vendor 但没有 lineage 时，不按 family 静默跨到独立供应商', () => {
    const videos = [model('doubao-seedance-2.0', 'apimart', 'seedance-2-apimart', 'video')]
    const match = resolveUsableModelForNode({ modelKey: 'bytedance/seedance-2', vendor: 'kie', meta: {}, models: videos })
    expect(match).toBeNull()
  })

  it('目录里这一款全都不可用 → null（调用方据此报清晰错误）', () => {
    const models = [...apimartImages, model('seedream', 'kie', 'seedream')].map(unusable)
    const match = resolveUsableModelForNode({ modelKey: 'seedream', vendor: 'kie', meta: {}, models })
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
    })
    expect(match?.vendorKey).toBe(second.key)
  })

  it('lineage successor 不可用时不回退到无关供应商同名模型', () => {
    const source = vendor('source')
    const successor = candidateVendor('source--candidate-2', 'source', 'source', 'image-v1')
    const unrelated = vendor('unrelated')
    const match = resolveUsableModelForNode({
      modelKey: 'image-v1',
      vendor: 'source',
      models: [model('image-v1', 'unrelated'), unusable(model('image-v1', successor.key))],
      vendors: [source, successor, unrelated],
    })
    expect(match).toBeNull()
  })

  it('无 vendor 的 legacy 节点只接受唯一精确模型，多个独立供应商同名时保守失败', () => {
    const unique = resolveUsableModelForNode({
      modelKey: 'legacy-image',
      models: [model('legacy-image', 'only')],
      vendors: [vendor('only')],
    })
    expect(unique?.vendorKey).toBe('only')

    const ambiguous = resolveUsableModelForNode({
      modelKey: 'legacy-image',
      models: [model('legacy-image', 'one'), model('legacy-image', 'two')],
      vendors: [vendor('one'), vendor('two')],
    })
    expect(ambiguous).toBeNull()
  })
})
