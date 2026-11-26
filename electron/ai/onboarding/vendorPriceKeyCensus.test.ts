import { describe, expect, it } from 'vitest'
import { applyBuiltinSeeds } from '../../catalog/seedBuiltins'
import { normalizeApimartCanonicalModelId } from '../../catalog/apimartModelIds'
import { classifyPriceKey } from './vendorPriceRequest'

// 线上模型名：和约价运行时一样，带规范化变换的映射先过 normalizeApimartCanonicalModelId。
const wireModel = (m: { modelKey?: string; create?: unknown }) =>
  (m.create as { request_transform?: string } | undefined)?.request_transform === 'apimart-canonical-model-id'
    ? String((normalizeApimartCanonicalModelId({ model: m.modelKey }) as { model: string }).model) : String(m.modelKey)

// 普查：内置目录里 APIMart 每个文生图 / 文生视频映射的请求体模板键，每个都必须被约价登记过。
// 用模板键（create.body 的键）而不是按默认参数渲染：渲染会丢掉没填的可选键，覆盖不全（渲染出的键是模板键的子集）。
// 目录新加一个键、这里没人归类，约价会悄悄变成「不报价」——这条在 CI 先红，点名是哪个模型哪个键。
describe('every request-body key of APIMart text-to-image / text-to-video mappings is classified for price quotes', () => {
  const catalog = applyBuiltinSeeds({ version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, '2026-11-08T00:00:00Z').state
  // 改图里只有图层分离报价（body 读 layer_decomposition 的那几条），它们的键也必须都登记过。
  const priced = (m: (typeof catalog.mappings)[number]) => m.taskKind === 'text_to_image' || m.taskKind === 'text_to_video'
    || (m.taskKind === 'image_edit' && Object.keys((m.create?.body ?? {}) as object).includes('layer_decomposition'))
  const rows = catalog.mappings.filter(m => m.vendorKey === 'apimart' && priced(m) && m.create)
  it('covers a real catalog (not an empty loop)', () => {
    expect(rows.length).toBeGreaterThan(40)
    expect(rows.filter(m => m.taskKind === 'image_edit').map(m => m.modelKey).sort()).toEqual(['doubao-seedream-5-0-pro', 'seedream-5-5'])
  })
  it('leaves no unclassified key', () => {
    const unclassified = rows.flatMap(m => Object.keys((m.create!.body ?? {}) as object)
      .filter(key => classifyPriceKey(wireModel(m), key) === 'unclassified').map(key => `${m.modelKey} (${m.taskKind}) 的键 ${key}`))
    // 会改价就进 PRICE_QUERY_KEYS 并让查询读出来；核过计费说明不改价进 PRICE_IGNORED_KEYS(_BY_WIRE_MODEL)；说不清进 PRICE_UNQUOTABLE_KEYS。
    expect(unclassified).toEqual([])
  })
})
