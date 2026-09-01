/**
 * Shared legacy-generation firewall vocabulary.
 *
 * This module is deliberately pure and transport-agnostic: the main-process
 * dispatcher and renderer bridge must use the same marker owner so a new
 * canonical wrapper field cannot silently drift past one side.
 */
export const GENERATION_BINDING_MARKERS: ReadonlySet<string> = new Set([
  'leaseHandle', 'receiptId', 'contractHash', 'gateKind', 'operationId', 'shotId', 'runtimeTaskId',
  'immutableProjectUuid', 'projectGeneration', 'handoff', 'actionNonce',
  'projectSelectionHandle', 'targetHash', 'reservationId',
  'executionBinding', 'requestFingerprint', 'providerIdempotencyKey', 'runtimeEnvelopeRef',
  'runtimeEnvelopeHash', 'fencingEpoch', 'envelopeState', 'providerTaskId', 'sessionId', 'nonce',
  'baseRevision', 'projectRevision', 'attempt', 'runtimeEnvelope',
  'moduleRef', 'operationRef', 'candidate', 'execution', 'resolvedTaskRequest', 'preparedTaskRequest',
  'authorizationEnvelope', 'authorizationDigest', 'authorizationGateId', 'providerWirePayloadHash',
  'pricingSnapshotHash', 'gateId',
  'providerRecoveryCapabilities', 'providerId', 'accountId', 'profileId', 'tenantScope', 'endpoint', 'model',
])

const MAX_BINDING_SCAN_DEPTH = 32

/**
 * Iteratively scans JSON-shaped values. Excessive depth fails closed so an
 * untrusted 8MB payload cannot trigger recursive call-stack exhaustion.
 */
export function hasGenerationBinding(value: unknown): boolean {
  const seen = new WeakSet<object>()
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    if (!frame.value || typeof frame.value !== 'object') continue
    if (seen.has(frame.value)) continue
    seen.add(frame.value)
    if (frame.depth >= MAX_BINDING_SCAN_DEPTH) return true
    if (Array.isArray(frame.value)) {
      for (const item of frame.value) stack.push({ value: item, depth: frame.depth + 1 })
      continue
    }
    for (const [key, child] of Object.entries(frame.value as Record<string, unknown>)) {
      if (GENERATION_BINDING_MARKERS.has(key)) return true
      stack.push({ value: child, depth: frame.depth + 1 })
    }
  }
  return false
}
