import { describe, expect, it } from 'vitest'
import {
  dedupeModelOptions,
  deriveCanonicalModelId,
  modelCatalogLifecycle,
  normalizeModelLabel,
  resolveBestProvider,
  sortDedupedModelsByVendorPreference,
  sortModelProviders,
  sortModelsByCatalogLifecycle,
  vendorTier,
} from './modelIdentity'
import type { ModelOption } from './models'

const opt = (o: Partial<ModelOption>): ModelOption => ({ value: '', label: '', ...o })

describe('modelIdentity · canonical id 派生', () => {
  it('显式 meta.canonicalModelId 优先（跨供应商同模型的唯一真相）', () => {
    expect(deriveCanonicalModelId(opt({ label: '可灵 v3', meta: { canonicalModelId: 'kling-3.0' } }))).toBe('kling-3.0')
    expect(deriveCanonicalModelId(opt({ label: '可灵 3.0', meta: { canonicalModelId: 'kling-3.0' } }))).toBe('kling-3.0')
  })

  it('规范化 labelZh：去能力后缀 + 大小写 + 空格（GPT Image 2 三行 → 一个身份）', () => {
    expect(normalizeModelLabel('GPT Image 2 · 文生图')).toBe('gpt image 2')
    expect(normalizeModelLabel('GPT Image 2 · 图生图')).toBe('gpt image 2')
    expect(normalizeModelLabel('GPT Image 2')).toBe('gpt image 2')
  })

  it('认不出的中转模型兜底用 value，不会被错误合并', () => {
    expect(deriveCanonicalModelId(opt({ value: 'random-relay-model', label: '' }))).toBe('random-relay-model')
  })
})

describe('modelIdentity · 去重聚合', () => {
  it('同一模型跨 3 供应商 → 合并成 1 条，收集 3 个 providers', () => {
    const result = dedupeModelOptions([
      opt({ value: 'doubao-seedream-5-0-260128', label: 'Seedream 4.5', vendor: 'volcengine', modelKey: 'doubao-seedream-5-0-260128', meta: { archetypeId: 'volcengine-seedream' } }),
      opt({ value: 'doubao-seedream-4.5', label: 'Seedream 4.5', vendor: 'apimart', modelKey: 'doubao-seedream-4.5', meta: { archetypeId: 'seedream' } }),
      opt({ value: 'seedream', label: 'Seedream 4.5', vendor: 'kie', modelKey: 'seedream', meta: { archetypeId: 'seedream' } }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].canonicalId).toBe('seedream 4.5')
    expect(result[0].providers).toHaveLength(3)
    expect(result[0].providers.map((p) => p.vendor)).toEqual(['volcengine', 'apimart', 'kie'])
    expect(result[0].recognized).toBe(true)
  })

  it('不同版本不合并（Seedream 5.0 vs 4.5 各留）', () => {
    const result = dedupeModelOptions([
      opt({ value: 'a', label: 'Seedream 5.0', vendor: 'volcengine', modelKey: 'a' }),
      opt({ value: 'b', label: 'Seedream 4.5', vendor: 'volcengine', modelKey: 'b' }),
    ])
    expect(result).toHaveLength(2)
  })

  it('GPT Image 2 三行（apimart 1 + kie 2 拆能力）→ 1 条 3 providers', () => {
    const result = dedupeModelOptions([
      opt({ value: 'gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', modelKey: 'gpt-image-2' }),
      opt({ value: 'gpt-image-2-text-to-image', label: 'GPT Image 2 · 文生图', vendor: 'kie', modelKey: 'gpt-image-2-text-to-image' }),
      opt({ value: 'gpt-image-2-image-to-image', label: 'GPT Image 2 · 图生图', vendor: 'kie', modelKey: 'gpt-image-2-image-to-image' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].providers).toHaveLength(3)
  })

  it('同 vendor+modelKey 重复输入 → providers 去重', () => {
    const result = dedupeModelOptions([
      opt({ value: 'x', label: 'Sora 2', vendor: 'apimart', modelKey: 'sora-2' }),
      opt({ value: 'x', label: 'Sora 2', vendor: 'apimart', modelKey: 'sora-2' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].providers).toHaveLength(1)
  })

  it('认不出的中转模型各自独立（不合并）', () => {
    const result = dedupeModelOptions([
      opt({ value: 'relay-foo', label: 'foo', vendor: 'myrelay', modelKey: 'relay-foo' }),
      opt({ value: 'relay-bar', label: 'bar', vendor: 'myrelay', modelKey: 'relay-bar' }),
    ])
    expect(result).toHaveLength(2)
    expect(result.every((m) => m.recognized === false)).toBe(true)
  })
})

describe('modelIdentity · resolveBestProvider 自动选最优', () => {
  const model = dedupeModelOptions([
    opt({ value: 'a', label: 'Seedream 4.5', vendor: 'apimart', modelKey: 'a' }),
    opt({ value: 'b', label: 'Seedream 4.5', vendor: 'volcengine', modelKey: 'b' }),
    opt({ value: 'c', label: 'Seedream 4.5', vendor: 'myrelay', modelKey: 'c' }),
  ])[0]

  it('vendorTier：官方0 < 内置中转1 < 未知2', () => {
    expect(vendorTier('volcengine')).toBe(0)
    expect(vendorTier('apimart')).toBe(1)
    expect(vendorTier('myrelay')).toBe(2)
  })

  it('默认选官方（volcengine）而非中转', () => {
    expect(resolveBestProvider(model)?.vendor).toBe('volcengine')
  })

  it('锁定供应商优先（可用时）', () => {
    expect(resolveBestProvider(model, { lockedVendorKey: 'apimart' })?.vendor).toBe('apimart')
  })

  it('锁定家不可用 → 回落自动选最优', () => {
    expect(resolveBestProvider(model, { lockedVendorKey: 'nope', usableVendorKeys: new Set(['apimart', 'myrelay']) })?.vendor).toBe('apimart')
  })

  it('过滤到可用供应商集；全不可用返回 null', () => {
    expect(resolveBestProvider(model, { usableVendorKeys: new Set(['myrelay']) })?.vendor).toBe('myrelay')
    expect(resolveBestProvider(model, { usableVendorKeys: new Set(['x']) })).toBeNull()
  })

  it('同级保持 catalog 顺序（稳定）', () => {
    const m = dedupeModelOptions([
      opt({ value: '1', label: 'X', vendor: 'apimart', modelKey: '1' }),
      opt({ value: '2', label: 'X', vendor: 'kie', modelKey: '2' }),
    ])[0]
    expect(resolveBestProvider(m)?.vendor).toBe('apimart')
  })
})

describe('modelIdentity · catalog lifecycle ordering', () => {
  const lifecycleOption = (value: string, catalogLifecycle?: string): ModelOption => opt({
    value,
    label: value,
    modelKey: value,
    vendor: 'provider',
    ...(catalogLifecycle ? { meta: { catalogLifecycle } } : {}),
  })

  it('显式旗舰/性价比在前、兼容旧款在后，同档保持目录顺序', () => {
    const models = dedupeModelOptions([
      lifecycleOption('custom-a'),
      lifecycleOption('old', 'legacy'),
      lifecycleOption('flagship-a', 'flagship'),
      lifecycleOption('custom-b'),
      lifecycleOption('value', 'value'),
      lifecycleOption('flagship-b', 'flagship'),
    ])
    expect(models.map((model) => model.canonicalId)).toEqual([
      'flagship-a',
      'flagship-b',
      'value',
      'custom-a',
      'custom-b',
      'old',
    ])
  })

  it('绝不从未知自建模型名称猜代际', () => {
    const [model] = dedupeModelOptions([lifecycleOption('obviously-best-v99-ultra')])
    expect(modelCatalogLifecycle(model)).toBeNull()
    expect(sortModelsByCatalogLifecycle([model])).toEqual([model])
  })

  it('同一模型多条线路时采用最强的显式生命周期', () => {
    const [model] = dedupeModelOptions([
      { ...lifecycleOption('relay:model'), value: 'relay:model', label: 'Shared', vendor: 'relay', meta: { catalogLifecycle: 'legacy' } },
      { ...lifecycleOption('official:model'), value: 'official:model', label: 'Shared', vendor: 'official', meta: { catalogLifecycle: 'flagship' } },
    ])
    expect(modelCatalogLifecycle(model)).toBe('flagship')
  })
})

describe('modelIdentity · vendor preference ordering', () => {
  it('preferred configured vendor first, unconfigured providers last, equal names stable', () => {
    const models = dedupeModelOptions([
      opt({ value: 'shared-kie', label: 'Shared', vendor: 'kie', modelKey: 'shared', configured: true, vendorName: 'Kie' }),
      opt({ value: 'shared-z', label: 'Shared', vendor: 'relay-z', modelKey: 'shared', configured: false, vendorName: 'Z relay' }),
      opt({ value: 'shared-a', label: 'Shared', vendor: 'relay-a', modelKey: 'shared', configured: true, vendorName: 'A relay' }),
    ])
    const ordered = sortModelProviders(models[0].providers, ['relay-a', 'kie'])
    expect(ordered.map((provider) => provider.vendor)).toEqual(['relay-a', 'kie', 'relay-z'])
  })

  it('configured model families stay above all-unconfigured families with stable order', () => {
    const models = dedupeModelOptions([
      opt({ value: 'unconfigured', label: 'Unconfigured', vendor: 'z', modelKey: 'z', configured: false }),
      opt({ value: 'configured', label: 'Configured', vendor: 'a', modelKey: 'a', configured: true }),
      opt({ value: 'unconfigured-2', label: 'Unconfigured 2', vendor: 'y', modelKey: 'y', configured: false }),
    ])
    expect(sortDedupedModelsByVendorPreference(models, []).map((model) => model.label)).toEqual(['Configured', 'Unconfigured', 'Unconfigured 2'])
  })
})
