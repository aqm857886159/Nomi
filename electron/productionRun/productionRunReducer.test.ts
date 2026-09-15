import { describe, expect, it } from 'vitest'

import { applyProductionCommand } from './productionRunReducer'
import type { ProductionRun } from './productionRunTypes'
import { createProductionExecutionBinding } from './productionExecutionBinding'

const now = '2026-08-21T00:00:00.000Z'

function runWithCandidateScript(): ProductionRun {
  return {
    schemaVersion: 1, runId: 'run-review', projectId: 'project-review', revision: 1,
    status: 'awaiting_script_review', stageId: 'script', playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' }, brief: { goal: 'review fixture' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 }, planVersion: 1, snapshotCursor: 1,
    stages: ['brief', 'direction', 'script', 'storyboard'].map((stageId, order) => ({ stageId, title: stageId, status: 'completed' as const, order })),
    gates: [], jobs: [], artifacts: [{
      artifactId: 'artifact-script-v1', stageId: 'script', kind: 'script', status: 'candidate', version: 1,
      source: 'nomi-agent', contentHash: 'hash-v1', reviewStatus: 'waiting', createdAt: now,
    }], createdAt: now, updatedAt: now,
  }
}

describe('production run script review reducer', () => {
  it('adopts a script only after an approved review', () => {
    const effect = applyProductionCommand(runWithCandidateScript(), {
      commandId: 'script-review-approved', expectedRevision: 1, type: 'script.review',
      payload: { artifactId: 'artifact-script-v1', decision: 'approved' }, issuedAt: now,
    }, now)

    expect(effect.run.artifacts[0]).toMatchObject({ status: 'adopted', reviewStatus: 'approved', adoptedAt: now })
    expect(effect.run.stageId).toBe('storyboard')
    expect(effect.run.status).toBe('running')
  })

  it('keeps request-changes in review without creating paid jobs', () => {
    const effect = applyProductionCommand(runWithCandidateScript(), {
      commandId: 'script-review-changes', expectedRevision: 1, type: 'script.review',
      payload: { artifactId: 'artifact-script-v1', decision: 'changes_requested' }, issuedAt: now,
    }, now)

    expect(effect.run.artifacts[0]).toMatchObject({ status: 'candidate', reviewStatus: 'changes_requested' })
    expect(effect.run.jobs).toHaveLength(0)
    expect(effect.run.budget.actual).toBe(0)
  })
})

describe('production run execution binding reducer boundary', () => {
  const binding = createProductionExecutionBinding({
    immutableProjectUuid: 'project-uuid-1', projectGeneration: 4, runId: 'run-review', shotId: 'shot-1',
    contractHash: 'a'.repeat(64), runtimeTaskId: 'task-1', providerNamespace: 'provider.image',
    providerIdempotencyKey: 'run-review:shot-1:attempt-1', requestFingerprint: 'b'.repeat(64),
    runtimeEnvelopeRef: '.nomi/runs/run-review/envelopes/task-1.json', fencingEpoch: 1,
  })

  function job(status: 'authorization_required' | 'planned' = 'authorization_required') {
    return {
      jobId: 'job-1', stageId: 'generate', status, attempt: 0, provider: 'provider.image', model: 'model.image.v1',
      idempotencyKey: binding.providerIdempotencyKey, executionBinding: binding,
      createdAt: now, updatedAt: now,
    } as const
  }

  it('accepts a binding owned by this Run and matching the provider idempotency key', () => {
    const effect = applyProductionCommand(runWithCandidateScript(), {
      commandId: 'job-add-valid', expectedRevision: 1, type: 'job.add', payload: { job: job() }, issuedAt: now,
    }, now)
    expect(effect.run.jobs[0]?.executionBinding).toEqual(binding)
  })

  it('rejects a foreign Run binding or a mismatched provider key before persistence', () => {
    expect(() => applyProductionCommand(runWithCandidateScript(), {
      commandId: 'job-add-foreign', expectedRevision: 1, type: 'job.add', payload: { job: { ...job(), executionBinding: { ...binding, runId: 'foreign-run' } } }, issuedAt: now,
    }, now)).toThrow(/execution binding/)
    expect(() => applyProductionCommand(runWithCandidateScript(), {
      commandId: 'job-add-key', expectedRevision: 1, type: 'job.add', payload: { job: { ...job(), idempotencyKey: 'different-key' } }, issuedAt: now,
    }, now)).toThrow(/idempotency/)
  })

  it('records provider observations without forcing an illegal same-status transition', () => {
    const current = { ...runWithCandidateScript(), jobs: [{ ...job(), status: 'provider_accepted' as const }] }
    const effect = applyProductionCommand(current, {
      commandId: 'job-poll-observation', expectedRevision: 1, type: 'job.patch',
      payload: { jobId: 'job-1', patch: { providerStatus: 'completed', lastPollAt: now } }, issuedAt: now,
    }, now)
    expect(effect.run.jobs[0]).toMatchObject({ status: 'provider_accepted', providerStatus: 'completed', lastPollAt: now })
  })
})
