import { describe, expect, it } from 'vitest'
import { applyBuiltinSeeds } from '../../catalog/seedBuiltins'
import { priceQueryFromRequest } from './vendorPriceRequest'
import type { VendorPriceRequest } from '../../shared/contracts/vendorPricePreview'
import { createGenerationNode } from '../../../src/workbench/generationCanvas/model/graphOps'
import { priceRequest } from '../../../src/workbench/generationCanvas/spend/useNodePricePreview'

const seeded = () => applyBuiltinSeeds({ version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, '2026-11-08T00:00:00Z').state
const mini: VendorPriceRequest = {
  vendorKey: 'apimart',
  request: { kind: 'text_to_video', prompt: '', extras: {
    modelKey: 'doubao-seedance-2.0', archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'mini' },
    archetypeInput: { resolution: '720p', duration: 5, generate_audio: false },
  } },
}
describe('public price preview uses the selected production mapping', () => {
  it('prices only the canonical Mini wire model and selected output parameters', () => {
    expect(priceQueryFromRequest(mini, seeded())).toMatchObject({
      modelId: 'seedance-2.0-mini', resolution: '720p', durationSec: 5, count: 1, referenceCount: 0,
    })
  })
  it('refuses other connections, input media, custom transforms and disabled mappings', () => {
    expect(priceQueryFromRequest({ ...mini, vendorKey: 'kie' }, seeded())).toBeNull()
    expect(priceQueryFromRequest({ ...mini, request: { ...mini.request, kind: 'image_to_video' } }, seeded())).toBeNull()
    const catalog = seeded()
    const mapping = catalog.mappings.find(m => m.vendorKey === mini.vendorKey && m.modelKey === mini.request.extras?.modelKey && m.taskKind === mini.request.kind)!
    mapping.create!.request_transform = 'custom-price-changing-operation'
    expect(priceQueryFromRequest(mini, catalog)).toBeNull()
    mapping.enabled = false
    expect(priceQueryFromRequest(mini, catalog)).toBeNull()
  })
})

it('projects the shipped GPT Image 2.6 Flare mapping for an explicit output size', () => {
  const catalog = seeded()
  const request: VendorPriceRequest = { vendorKey: 'apimart', request: {
    kind: 'text_to_image', prompt: 'A calico cat on a windowsill',
    extras: { modelKey: 'gpt-image-2.6-flare', archetype: { id: 'gpt-image-2.6-flare', modeId: 't2i' },
      archetypeInput: { size: '1:1', resolution: '1K', quality: 'medium', background: 'auto' } },
  } }
  expect(priceQueryFromRequest(request, catalog)).toMatchObject({ kind: 'image', modelId: 'gpt-image-2.6-flare',
    size: '1:1', resolution: '1k', quality: 'medium', count: 1 })
  const mapping = catalog.mappings.find(m => m.vendorKey === 'apimart' && m.modelKey === 'gpt-image-2.6-flare' && m.taskKind === 'text_to_image')!
  const body = mapping.create!.body as Record<string, unknown>
  for (const extra of [{ background: 'transparent' }, { image_urls: ['reference.png'] }]) {
    mapping.create!.body = { ...body, ...extra }
    expect(priceQueryFromRequest(request, catalog)).toBeNull()
  }
})

describe('Seedance 2.5 text-to-video shows a price (output_format / return_last_frame / nsfw_check do not change it)', () => {
  const seedance25: VendorPriceRequest = { vendorKey: 'apimart', request: { kind: 'text_to_video', prompt: '',
    extras: { modelKey: 'doubao-seedance-2.5', archetype: { id: 'seedance-2.5-apimart', modeId: 't2v' },
      archetypeInput: { resolution: '720p', duration: 5, generate_audio: true } } } }
  const create25 = (catalog: ReturnType<typeof seeded>) =>
    catalog.mappings.find(m => m.vendorKey === 'apimart' && m.modelKey === 'doubao-seedance-2.5' && m.taskKind === 'text_to_video')!.create!

  it('prices the body the catalog really renders for 2.5', () => {
    const catalog = seeded()
    // 前提：2.5 真的会把这三个键发给供应商（否则这条测试量不到目标）。
    expect(Object.keys(create25(catalog).body as object)).toEqual(expect.arrayContaining(['output_format', 'return_last_frame', 'nsfw_check']))
    expect(priceQueryFromRequest(seedance25, catalog)).toMatchObject({
      modelId: 'seedance-2.5', kind: 'video', resolution: '720p', durationSec: 5, hasAudio: true, count: 1, referenceCount: 0 })
  })

  it.each([
    ['reference images (changes the price)', { image_urls: ['reference.png'] }],
    ['a key nobody classified (invented, in no list)', { zz_new_catalog_key: '{{request.params.zz}}' }],
  ])('still refuses a 2.5 body that also carries %s', (_label, extra) => {
    const catalog = seeded()
    const create = create25(catalog)
    create.body = { ...(create.body as object), ...extra }
    expect(priceQueryFromRequest(seedance25, catalog)).toBeNull()
  })

  it('does not widen the allowance to a model that carries the same keys without a checked billing page', () => {
    const catalog = seeded()
    const modelKey = 'doubao-seedream-5-0-pro'
    const mapping = catalog.mappings.find(m => m.vendorKey === 'apimart' && m.modelKey === modelKey && m.taskKind === 'text_to_image')!
    expect(Object.keys(mapping.create!.body as object)).toEqual(expect.arrayContaining(['output_format', 'nsfw_check']))
    const request: VendorPriceRequest = { vendorKey: 'apimart', request: { kind: 'text_to_image', prompt: 'x',
      extras: { modelKey, archetype: { id: modelKey, modeId: 't2i' }, archetypeInput: { size: '1:1', resolution: '2K' } } } }
    expect(priceQueryFromRequest(request, catalog)).toBeNull()
  })
})

// 图层分离（设计卡 docs/plan/2026-11-26-layer-split.md ★9 第 8 条）：请求从渲染层发送键那一个取数口（priceRequest）来，
// 不手拼——节点 meta 怎么存、参考怎么解，和真发送同一条。
// 反例：把 priceQueryFromRequest 里「改图只有图层分离能算」那一行删掉 → 普通改图也去问价（第三条红）；
// 把层数上限的读法删掉 → 查询里没有 layerSplit（第一条红）。
describe('layer split asks for the reservation quote (layer cap + input image), nothing else in image edit does', () => {
  const layerNode = (meta: Record<string, unknown>) => {
    const node = createGenerationNode({ id: 'layer-node', kind: 'image', prompt: '' })
    node.meta = { modelVendor: 'apimart', vendor: 'apimart', referenceImageUrls: ['nomi-local://asset/source.png'], ...meta }
    return priceRequest(node, { nodes: [node], edges: [] })!
  }
  const seedream55 = { modelKey: 'seedream-5-5', archetype: { id: 'seedream-5-5', modeId: 'layers' } }

  it('defaults: 30 layers, auto tier, one input image', () => {
    const query = priceQueryFromRequest(layerNode(seedream55), seeded())
    expect(query).toMatchObject({ kind: 'image', modelId: 'seedream-5-5', size: 'auto', count: 1, referenceCount: 1, layerSplit: { maxImages: 30 } })
  })

  it('0 images yet (reference removed): still a layer-split query, so the greyed send key keeps its price', () => {
    const node = createGenerationNode({ id: 'layer-node', kind: 'image', prompt: '' })
    node.meta = { modelVendor: 'apimart', vendor: 'apimart', ...seedream55 }
    const query = priceQueryFromRequest(priceRequest(node, { nodes: [node], edges: [] })!, seeded())
    expect(query).toMatchObject({ kind: 'image', modelId: 'seedream-5-5', referenceCount: 1, layerSplit: { maxImages: 30 } })
  })

  it('reads the chosen layer cap and tier', () => {
    const query = priceQueryFromRequest(layerNode({ ...seedream55, layer_count: 8, layer_size: '1.5K' }), seeded())
    expect(query).toMatchObject({ size: '1.5K', layerSplit: { maxImages: 8 } })
  })

  it('a plain edit with an input image, and 5.0 Pro layer split (no layer cap in the request), ask for no quote', () => {
    expect(priceQueryFromRequest(layerNode({ ...seedream55, archetype: { id: 'seedream-5-5', modeId: 'edit' } }), seeded())).toBeNull()
    const pro = layerNode({ modelKey: 'doubao-seedream-5-0-pro', archetype: { id: 'seedream-5-pro', modeId: 'layers' } })
    expect(pro.request.kind).toBe('image_edit')
    expect(priceQueryFromRequest(pro, seeded())).toBeNull()
  })
})
