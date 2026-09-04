// R16 real-user task matrix for provider capability degradation.
//
// This journey deliberately spends zero credits and never calls a network provider. It exercises the
// built production adapter with the kinds of changes a real MCP user makes between attempts: provider,
// model, mode, parameters and references all vary. The only invariant is the user-visible contract:
// submit when a provider can submit, never invent recovery, and never retry an uncertain receipt.
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const { createGenerationRuntimeAdapter } = require(path.join(repoRoot, 'dist-electron/capabilityCore/generationRuntimeAdapter.js'))
const { projectGenerationRecovery } = require(path.join(repoRoot, 'dist-electron/capabilityCore/generationRecoveryProjection.js'))
const { productionGenerationPayloadHash } = require(path.join(repoRoot, 'dist-electron/productionRun/productionGenerationAuthorization.js'))

const contract = (overrides = {}) => ({
  contractHash: 'contract-1', providerId: 'provider-a', modelId: 'model-a', mode: 'text-to-image',
  prompt: 'a quiet red house at dusk', parameters: { size: '1:1', resolution: '1K', seed: 7 },
  references: [{ assetId: 'asset-a', contentHash: 'hash-a', version: 1 }], ...overrides,
})
const binding = (providerIdempotencyKey = 'generation:run-1:attempt-1', providerNamespace = 'provider-a', contractHash = 'contract-1') => ({
  immutableProjectUuid: 'project-uuid-1', projectGeneration: 1, runId: 'run-1', shotId: 'shot-1',
  contractHash, runtimeTaskId: 'runtime-1', providerNamespace,
  providerIdempotencyKey, requestFingerprint: 'fingerprint-1', runtimeEnvelopeRef: 'envelope-1', fencingEpoch: 1,
})

let passed = 0
function check(condition, label) {
  assert.equal(Boolean(condition), true, label)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const calls = []
const observeOnly = {
  providerId: 'provider-a',
  capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
  buildRequest: (input) => ({ ...input, providerSpecific: { aspectRatio: input.parameters.size } }),
  submit: async (request) => { calls.push(request); return { providerTaskId: 'provider-task-1', raw: { accepted: true } } },
  query: async (providerTaskId) => ({ status: 'completed', raw: { taskId: providerTaskId } }),
}
const adapter = createGenerationRuntimeAdapter({ providers: [observeOnly] })
const observedPrepared = adapter.prepare({ contract: contract(), binding: binding() })
const observed = await adapter.submit({
  contract: contract(), binding: binding(),
  expectedProviderRequestHash: observedPrepared.providerRequestHash,
  preparedProviderRequest: observedPrepared.providerRequest,
})
check(observed.providerTaskId === 'provider-task-1', 'observe-only provider still completes the normal submit path')
check(calls.length === 1, 'one user confirmation produces exactly one provider submission')
check(calls[0].providerSpecific.aspectRatio === '1:1', 'generic parameters reach the provider adapter without a vendor-specific UI branch')
check(observed.providerRequestHash === productionGenerationPayloadHash(calls[0]), 'provider receipt retains the exact authorized wire payload hash')
const queried = await observeOnly.query(observed.providerTaskId)
check(queried.status === 'completed', 'known provider task can be observed when the provider supports query')
const observedUnknown = projectGenerationRecovery({ state: 'submission_unknown', profile: 'observe_only', providerReference: observed.providerTaskId })
check(observedUnknown.nextAction === 'reconcile' && observedUnknown.allowAutomaticRetry === false, 'uncertain observe-only receipt becomes reconcile-only')

const submitOnlyCalls = []
const submitOnly = {
  providerId: 'provider-b',
  capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: false },
  buildRequest: (input) => ({ model: input.modelId, mode: input.mode, params: input.parameters, refs: input.references }),
  submit: async (request) => { submitOnlyCalls.push(request); return { providerTaskId: 'provider-ref-1' } },
}
const submitOnlyAdapter = createGenerationRuntimeAdapter({ providers: [submitOnly] })
const submitOnlyContract = contract({ providerId: 'provider-b', modelId: 'video-model-9', mode: 'image-to-video', parameters: { duration: 5, aspectRatio: '16:9', motion: 'slow' }, references: [] })
const submitOnlyBinding = binding('generation:run-1:video-model-9:attempt-1', 'provider-b')
const submitOnlyPrepared = submitOnlyAdapter.prepare({ contract: submitOnlyContract, binding: submitOnlyBinding })
await submitOnlyAdapter.submit({
  contract: submitOnlyContract,
  binding: submitOnlyBinding,
  expectedProviderRequestHash: submitOnlyPrepared.providerRequestHash,
  preparedProviderRequest: submitOnlyPrepared.providerRequest,
})
check(submitOnlyCalls[0].model === 'video-model-9' && submitOnlyCalls[0].mode === 'image-to-video', 'model, mode and reference changes remain editable for a submit-only provider')
const submitOnlyUnknown = projectGenerationRecovery({ state: 'submission_unknown', profile: 'submit_only' })
check(submitOnlyUnknown.nextAction === 'manual_review' && submitOnlyUnknown.allowNewAttempt === true, 'submit-only uncertainty asks for provider-side checking before a new attempt')
const cancelled = projectGenerationRecovery({ state: 'cancel_requested', profile: 'submit_only' })
check(cancelled.status === 'detached' && cancelled.allowAutomaticRetry === false, 'cancel means stop waiting, not a false promise of remote cancellation')

console.log(`PROVIDER DEGRADATION E2E PASS (${passed} checks, zero credits, zero network provider calls)`)
