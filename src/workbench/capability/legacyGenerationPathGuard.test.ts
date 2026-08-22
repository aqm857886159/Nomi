import { describe, expect, it } from 'vitest'

import { assertLegacyGenerationPayload, handleCapabilityApply, LegacyPathForbiddenError } from './capabilityApplyHandler'

describe('renderer legacy generation path firewall', () => {
  it('accepts the existing driver payload shape without semantic bindings', () => {
    expect(() => assertLegacyGenerationPayload({
      nodeId: 'node-1', maxAttemptsPerJob: 2, retryDirective: 'make the light warmer',
    })).not.toThrow()
  })

  it.each([
    'leaseHandle', 'receiptId', 'contractHash', 'gateKind', 'operationId', 'shotId', 'runtimeTaskId',
    'executionBinding', 'requestFingerprint', 'providerIdempotencyKey', 'runtimeEnvelopeRef',
    'runtimeEnvelopeHash', 'fencingEpoch', 'envelopeState', 'providerTaskId', 'sessionId', 'nonce',
    'baseRevision', 'projectRevision', 'attempt', 'runtimeEnvelope',
  ])
    ('rejects the semantic binding %s with a stable error code', (field) => {
      try {
        assertLegacyGenerationPayload({ nodeId: 'node-1', [field]: 'sealed-value' })
        throw new Error('expected legacy payload to be rejected')
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyPathForbiddenError)
        expect(error).toMatchObject({ code: 'legacy_path_forbidden' })
      }
    })

  it.each(['moduleRef', 'candidate', 'providerId'])('rejects nested canonical wrapper marker %s', (field) => {
    expect(() => assertLegacyGenerationPayload({ nodeId: 'node-1', params: { runtime: { [field]: {} } } }))
      .toThrow(LegacyPathForbiddenError)
  })

  it('runs before production.generate-node can mint a spend grant', async () => {
    await expect(handleCapabilityApply('production.generate-node', {
      nodeId: 'node-1', contractHash: 'sealed-hash', operationId: 'operation-1',
    })).rejects.toMatchObject({ code: 'legacy_path_forbidden' })
  })
})
