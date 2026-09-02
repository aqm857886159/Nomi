import { describe, expect, it } from 'vitest'

import { GENERATION_BINDING_MARKERS, hasGenerationBinding } from './generationBindingGuard'

describe('shared generation binding guard', () => {
  it('owns canonical wrapper and execution-binding markers in one set', () => {
    for (const marker of [
      'executionBinding',
      'providerRecoveryCapabilities',
      'model',
      'authorizationEnvelope',
      'authorizationDigest',
      'authorizationGateId',
      'providerWirePayloadHash',
      'pricingSnapshotHash',
      'gateId',
    ]) {
      expect(GENERATION_BINDING_MARKERS.has(marker), marker).toBe(true)
    }
    expect(GENERATION_BINDING_MARKERS.has('modelKey')).toBe(false)
    expect(GENERATION_BINDING_MARKERS.has('vendor')).toBe(false)
  })

  it('scans nested objects and arrays', () => {
    expect(hasGenerationBinding({ params: [{ safe: true }, { execution: { providerId: 'p' } }] })).toBe(true)
    expect(hasGenerationBinding({ params: [{ safe: true }, { modelKey: 'legacy-model', vendor: 'legacy-vendor' }] })).toBe(false)
  })

  it('fails closed for excessively deep payloads without recursive stack growth', () => {
    let value: Record<string, unknown> = { leaf: true }
    for (let index = 0; index < 40; index += 1) value = { nested: value }
    expect(hasGenerationBinding(value)).toBe(true)
  })
})
