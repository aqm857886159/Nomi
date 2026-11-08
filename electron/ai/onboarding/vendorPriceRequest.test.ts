import { describe, expect, it } from 'vitest'
import { applyBuiltinSeeds } from '../../catalog/seedBuiltins'
import { priceQueryFromRequest } from './vendorPriceRequest'
import type { VendorPriceRequest } from '../../shared/contracts/vendorPricePreview'

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
