import { describe, expect, it } from 'vitest'
import {
  deriveModelCatalogStatus,
  filterHiddenOptionsByKind,
  getModelOptionRequestAlias,
  resolveExecutableImageModelFromOptions,
  toCatalogModelOptions,
} from '../../src/config/useModelOptions'
import type { ModelOption } from '../../src/config/models'
import type { ModelCatalogModelDto } from '../../src/workbench/api/modelCatalogApi'

function catalogModel(input: Partial<ModelCatalogModelDto> & Pick<ModelCatalogModelDto, 'modelKey' | 'vendorKey'>): ModelCatalogModelDto {
  return {
    modelKey: input.modelKey,
    vendorKey: input.vendorKey,
    modelAlias: input.modelAlias ?? null,
    labelZh: input.labelZh ?? '',
    kind: input.kind ?? 'image',
    enabled: input.enabled ?? true,
    meta: input.meta ?? {},
    ...(input.pricing ? { pricing: input.pricing } : {}),
    createdAt: input.createdAt ?? '2026-05-05T08:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-05-05T08:00:00.000Z',
  }
}

describe('model catalog option contracts', () => {
  it('builds selectable options only from dynamic catalog rows', () => {
    const options = toCatalogModelOptions([
      catalogModel({ modelKey: 'image-model', vendorKey: 'vendor-a', modelAlias: 'provider/image', labelZh: '图像模型' }),
      catalogModel({ modelKey: 'image-model', vendorKey: 'vendor-a', modelAlias: 'duplicate' }),
      catalogModel({ modelKey: '', vendorKey: 'vendor-a', modelAlias: '' }),
    ])

    expect(options).toEqual([
      expect.objectContaining({
        value: 'image-model',
        label: '图像模型',
        vendor: 'vendor-a',
        modelKey: 'image-model',
        modelAlias: 'provider/image',
      }),
    ])
  })

  it('resolves request aliases from catalog identifiers without hard-coded model fallback', () => {
    const options: ModelOption[] = [
      { value: 'catalog-key', label: 'Catalog Model', vendor: 'vendor-a', modelKey: 'catalog-key', modelAlias: 'provider-model' },
    ]

    expect(getModelOptionRequestAlias(options, 'catalog-key')).toBe('provider-model')
    expect(getModelOptionRequestAlias(options, 'provider-model')).toBe('provider-model')
    expect(() => resolveExecutableImageModelFromOptions([], { kind: 'image', value: '', vendor: null })).toThrow(/未找到可用图片模型/)
    expect(() => resolveExecutableImageModelFromOptions(options, { kind: 'image', value: 'missing-model', vendor: null })).toThrow(/图片模型不可用/)
  })

  it('reports empty, incomplete, and ready catalog states explicitly', () => {
    expect(deriveModelCatalogStatus({
      kind: 'image',
      options: [],
      health: { ok: false, counts: { vendors: 0, enabledVendors: 0, models: 0, enabledModels: 0, mappings: 0, enabledMappings: 0, enabledApiKeys: 0 }, byKind: [], issues: [{ code: 'catalog_empty', severity: 'error', message: 'empty' }] },
      error: null,
      loading: false,
    }).status).toBe('catalog_empty')

    expect(deriveModelCatalogStatus({
      kind: 'video',
      options: [],
      health: { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 1, enabledModels: 1, mappings: 1, enabledMappings: 1, enabledApiKeys: 1 }, byKind: [{ kind: 'video', enabledModels: 0, executableModels: 0 }], issues: [] },
      error: null,
      loading: false,
    })).toEqual({ status: 'kind_empty', message: '没有可用视频模型' })

    expect(deriveModelCatalogStatus({
      kind: 'image',
      options: [{ value: 'image-model', label: 'Image Model' }],
      health: null,
      error: null,
      loading: false,
    })).toEqual({ status: 'ready', message: '模型目录可用' })
  })

  it('hides generated image size aliases unless they point to a real provider alias', () => {
    expect(filterHiddenOptionsByKind([
      { value: 'gemini-2.5-flash-image-landscape', label: 'Landscape' },
      { value: 'gemini-2.5-flash-image-landscape', label: 'Landscape alias', modelAlias: 'models/nano-banana-pro' },
      { value: 'nano-banana-pro', label: 'Nano Banana Pro' },
    ], 'image').map((option) => option.label)).toEqual(['Landscape alias', 'Nano Banana Pro'])
  })
})
