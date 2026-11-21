import { describe, expect, it, vi } from 'vitest'
import { latestJobForShot, hasUnresolvedShotSubmission, isUnsubmittedJobStatus, jobMayHaveReachedProvider, jobEndedBeforeAcceptance, jobEndedAfterProviderAnswer } from './productionShotJobs'
import { deriveProductionShotState } from './productionShotPhase'
import { buildQaRetryPlans } from '../productionRun/productionQaVerdict'
import { latestJob } from '../capabilityCore/canvasShotResult'
import { settleFromRun } from '../capabilityCore/canvasShotHandover'
import { shotLandingFacts, shotStopFacts, shotsAwaitingDispatch } from '../productionRun/shotLandingAdmission'
import { shotHandoverPhase } from '../productionRun/shotProviderHandover'
import { decideShotClaim, lastShotEngine } from './decideShotClaim'
import { resumeOutlook } from '../productionRun/resumeOutlook'
import type { ProductionGenerationPlan, ProductionJob, ProductionRun } from '../productionRun/productionRunTypes'

const t1 = '2026-11-17T10:00:00.000Z'
const t2 = '2026-11-17T11:00:00.000Z'
const t3 = '2026-11-17T12:00:00.000Z'
const candidate: ProductionGenerationPlan['candidate'] = {
  candidateId: 's', revision: 1, moduleId: 'm', providerId: 'local', modelId: 'm',
  mode: 't2v', prompt: '', parameters: {}, references: [],
}
const job = (jobId: string, extra: Partial<ProductionJob> = {}): ProductionJob => ({
  jobId, stageId: 'generate', status: 'ready', attempt: 1, nodeId: 'n', metadata: { shotId: 's' },
  provider: 'local', model: 'm', idempotencyKey: jobId, createdAt: t1, updatedAt: t1, ...extra,
})
function run(jobs: ProductionJob[], shape: 'multi' | 'single' | 'no-plan' = 'multi'): ProductionRun {
  return {
    schemaVersion: 1, runId: 'r', projectId: 'p', revision: 1, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1' }, origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 100, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs, artifacts: [], createdAt: t1, updatedAt: t1,
    ...(shape === 'no-plan' ? {} : { generationPlan: { operationId: 'r', state: 'submitted', candidate, nodeId: 'n', updatedAt: t1,
      ...(shape === 'single' ? {} : { shots: [{ shotId: 's', nodeId: 'n', candidate, updatedAt: t1 },
        { shotId: 'other', nodeId: 'other-node', candidate: { ...candidate, candidateId: 'other' }, updatedAt: t1 }] }) } }),
  }
}

// Each losing job has a different visible status: selecting it changes the final output, not only an internal call.
const cases = [
  { name: 'U1 generation beats newer QA / larger attempt', jobs: [job('generation'), job('qa', { stageId: 'qa', status: 'authorized', attempt: 99, createdAt: t3 })], expected: 'generation' },
  { name: 'U2 attempt beats creation', jobs: [job('attempt-two', { attempt: 2 }), job('newer', { status: 'authorized', createdAt: t3 })], expected: 'attempt-two' },
  { name: 'U3 complete tie retains first', jobs: [job('first'), job('last', { status: 'authorized' })], expected: 'first' },
  { name: 'U4 creation beats update and ledger tail', jobs: [job('created', { createdAt: t2 }), job('updated-tail', { status: 'authorized', updatedAt: t3 })], expected: 'created' },
  { name: 'U5 legacy without shotId / nodeId ignores QA', shape: 'single', jobs: [job('legacy', { metadata: undefined, nodeId: undefined }), job('legacy-qa', { metadata: undefined, nodeId: undefined, stageId: 'qa', attempt: 99, status: 'authorized' })], expected: 'legacy' },
  { name: 'U6 legacy creation tie-break', shape: 'single', jobs: [job('old', { metadata: undefined, nodeId: undefined, status: 'authorized', updatedAt: t3 }), job('new', { metadata: undefined, nodeId: undefined, createdAt: t2 })], expected: 'new' },
  { name: 'U7 legacy QA only', shape: 'single', jobs: [job('qa-only', { stageId: 'qa', metadata: undefined, nodeId: undefined, status: 'polling', providerTaskId: 'qa-task' })] },
  { name: 'no task', jobs: [] },
  { name: 'other shot cannot substitute', jobs: [job('other', { nodeId: 'other-node', metadata: { shotId: 'other' } })] },
  { name: 'authorized latest is dispatchable', jobs: [job('old'), job('authorized', { attempt: 2, status: 'authorized' })], expected: 'authorized' },
  { name: 'in flight with provider task', jobs: [job('old', { status: 'authorized' }), job('polling', { attempt: 2, status: 'polling', providerTaskId: 'task' })], expected: 'polling' },
  { name: 'submission intent is still submitting', jobs: [job('intent', { status: 'submit_intent_persisted' })], expected: 'intent' },
  { name: 'explicit rejection writes not_sent', jobs: [job('rejected', { status: 'needs_attention', errorCode: 'provider_rejected' })], expected: 'rejected' },
  { name: 'answered but not landed writes accepted', jobs: [job('answered', { status: 'needs_attention', errorCode: 'output_retrieval_failed' })], expected: 'answered' },
  { name: 'no plan node-only QA parent', shape: 'no-plan', jobs: [job('parent', { metadata: undefined }), job('qa', { stageId: 'qa', attempt: 99, status: 'authorized' })], expected: 'parent' },
  { name: 'no plan QA only', shape: 'no-plan', jobs: [job('qa-only', { stageId: 'qa' })] },
] satisfies Array<{ name: string; jobs: ProductionJob[]; shape?: 'multi' | 'single' | 'no-plan'; expected?: string }>

describe('shot job parity at consumer outputs (canvas, storyboard, Agent and generation list)', () => {
  it.each(cases)('$name', ({ jobs, shape, expected }) => {
    const r = run(jobs, shape)
    const before = structuredClone(r)
    const address = shape === 'no-plan' ? { nodeId: 'n' } : 's'
    const selected = latestJobForShot(r, address)
    expect(selected?.jobId, 'owner fixture remains a positive ordering witness').toBe(expected)

    // Canvas result reader: the actual returned job, including legacy and node-only addresses.
    expect(latestJob(r, address)).toEqual(selected)
    // QA/Agent: the persisted retry plan's parent and attempt, not a spy on the selector.
    const parent = latestJobForShot(r, { nodeId: 'n' })
    const retry = buildQaRetryPlans(r, [{ shotNodeId: 'n', passed: false, flagged: [{ score: 2 }] }])
    expect(retry.map(({ parentJobId, nextAttempt }) => ({ parentJobId, nextAttempt })))
      .toEqual(parent ? [{ parentJobId: parent.jobId, nextAttempt: parent.attempt + 1 }] : [])

    if (shape === 'no-plan') {
      expect(deriveProductionShotState(r, 's')).toBeNull()
      expect(shotLandingFacts(r)).toEqual({ sent: [], notPlaced: [], removed: [] })
      expect(shotStopFacts(r)).toEqual({ sent: [], notSent: [] })
      expect(shotsAwaitingDispatch(r)).toEqual([])
      // QA still has a node address; shot-facing exits cannot invent that missing plan correspondence.
      const addressed = latestJobForShot(r, 's')
      expect(addressed).toBeUndefined()
      const unresolved = hasUnresolvedShotSubmission(r, 's')
      expect(shotHandoverPhase(r, 's')).toBe(unresolved ? 'settled_without_acceptance' : 'waiting_dispatch')
      const writeBack = vi.fn()
      settleFromRun({ projectId: 'p', link: { runId: 'parent', shotId: 's' }, canvasRunId: 'r', shotId: 's',
        error: new Error('failed'), readRun: () => r, writeBack, now: () => t3 })
      expect(writeBack).toHaveBeenCalledOnce()
      expect(writeBack.mock.calls[0][0].settlement.outcome).toBe(unresolved ? 'unknown' : 'not_sent')
      for (const requester of ['canvas', 'production'] as const) {
        expect(decideShotClaim(r, 's', requester)).toEqual(decideShotClaim({ ...r, jobs: [] }, 's', requester))
      }
      expect(lastShotEngine(r, 's')).toBe(addressed ? 'production' : 'canvas')
      expect(resumeOutlook(r)).toEqual({ kind: 'proceed', dispatching: [], notPlaced: [] })
    } else {
      const canonical = { ...r, jobs: r.jobs.filter(entry => entry.stageId !== 'generate')
        .concat((shape === 'single' ? ['s'] : ['s', 'other']).flatMap(id => {
          const current = latestJobForShot(r, id)
          return current ? [current] : []
        })) }
      // Claim/retry and resume return decisions, so compare their final decisions with an owner-canonical ledger.
      expect(decideShotClaim(r, 's', 'canvas')).toEqual(decideShotClaim(canonical, 's', 'canvas'))
      expect(decideShotClaim(r, 's', 'production')).toEqual(decideShotClaim(canonical, 's', 'production'))
      expect(lastShotEngine(r, 's')).toEqual(lastShotEngine(canonical, 's'))
      expect(resumeOutlook(r)).toEqual(resumeOutlook(canonical))
      // Storyboard/canvas/list receive this exact job in the final phase data.
      expect(deriveProductionShotState(r, 's')?.job).toEqual(selected)
      const refs = shape === 'single' ? ['s'] : ['s', 'other']
      const sent = refs.filter(id => {
        const current = latestJobForShot(r, id)
        return current ? jobMayHaveReachedProvider(current) : hasUnresolvedShotSubmission(r, id)
      }).map(shotId => ({ shotId, index: refs.indexOf(shotId) + 1 }))
      expect(shotLandingFacts(r).sent, 'Agent final sent list').toEqual(sent)
      expect(shotStopFacts(r).sent, 'stop receipt final sent list').toEqual(sent)
      expect(shotsAwaitingDispatch(r), 'final dispatch list').toEqual(shape === 'single' ? [] : refs.filter(id => {
        const current = latestJobForShot(r, id)
        return current && isUnsubmittedJobStatus(current.status)
      }))
      const phase = !selected && hasUnresolvedShotSubmission(r, 's') ? 'settled_without_acceptance'
        : !selected || isUnsubmittedJobStatus(selected.status) ? 'waiting_dispatch'
          : selected.status === 'submit_intent_persisted' || selected.status === 'submitting' ? 'submitting'
            : selected.providerTaskId ? 'accepted' : 'settled_without_acceptance'
      expect(shotHandoverPhase(r, 's'), 'card handover final phase').toBe(phase)

      const writeBack = vi.fn()
      settleFromRun({ projectId: 'p', link: { runId: 'parent', shotId: 's' }, canvasRunId: 'r', shotId: 's',
        error: new Error('failed'), readRun: () => r, writeBack, now: () => t3 })
      const outcome = !selected && hasUnresolvedShotSubmission(r, 's') ? 'unknown'
        : !selected || jobEndedBeforeAcceptance(selected) ? 'not_sent'
          : jobEndedAfterProviderAnswer(selected) ? 'accepted' : 'unknown'
      expect(writeBack).toHaveBeenCalledOnce()
      expect(writeBack.mock.calls[0][0].settlement.outcome, 'canvas final durable write-back').toBe(outcome)
    }
    expect(r, 'read exits preserve the ledger').toEqual(before)
  })
})
