import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as owner from './productionShotJobs'
import { deriveProductionShotState } from './productionShotPhase'
import { buildQaRetryPlans } from '../productionRun/productionQaVerdict'
import { latestJob } from '../capabilityCore/canvasShotResult'
import { settleFromRun } from '../capabilityCore/canvasShotHandover'
import { shotLandingFacts } from '../productionRun/shotLandingAdmission'
import { shotHandoverPhase } from '../productionRun/shotProviderHandover'
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
function run(jobs: ProductionJob[], single = false): ProductionRun {
  return {
    schemaVersion: 1, runId: 'r', projectId: 'p', revision: 1, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1' }, origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 9, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs, artifacts: [], createdAt: t1, updatedAt: t1,
    generationPlan: { operationId: 'r', state: 'submitted', candidate, nodeId: 'n', updatedAt: t1,
      ...(single ? {} : { shots: [{ shotId: 's', nodeId: 'n', candidate, updatedAt: t1 },
        { shotId: 'other', nodeId: 'other-node', candidate: { ...candidate, candidateId: 'other' }, updatedAt: t1 }] }) },
  }
}
const verdict = [{ shotNodeId: 'n', passed: false, flagged: [{ score: 2 }] }]
afterEach(() => vi.restoreAllMocks())

const cases = [
  ['U1 generation excludes QA', [job('J'), job('Q', { stageId: 'qa', attempt: 2, status: 'polling', createdAt: t2, updatedAt: t2 })], 'J', false],
  ['U2 attempt before creation', [job('J', { attempt: 2 }), job('K', { status: 'polling', createdAt: t2, updatedAt: t2 })], 'J', false],
  ['U3 stable complete tie', [job('J'), job('K', { status: 'polling' })], 'J', false],
  ['U4 creation before update', [job('J', { updatedAt: t3 }), job('K', { status: 'polling', createdAt: t2, updatedAt: t2 })], 'K', false],
  ['U5 legacy generation excludes QA', [job('J', { metadata: undefined }), job('Q', { metadata: undefined, stageId: 'qa', attempt: 2, status: 'polling', createdAt: t2, updatedAt: t2 })], 'J', true],
  ['U6 legacy creation breaks attempt tie', [job('J', { metadata: undefined }), job('K', { metadata: undefined, status: 'polling', createdAt: t2, updatedAt: t2 })], 'K', true],
] as const

describe('one ledger through seven real exits', () => {
  for (const [name, jobs, expected, single] of cases) {
    it(name, () => {
      const r = run(jobs.map((entry) => ({ ...entry, nodeId: undefined })), single)
      const before = structuredClone(r)
      expect(owner.latestJobForShot(r, 's')?.jobId).toBe(expected)
      expect(deriveProductionShotState(r, 's')?.job?.jobId).toBe(expected)
      expect(buildQaRetryPlans(r, verdict)[0]?.parentJobId).toBe(expected)
      // Canvas exits also accept an explicit address; their existing callers are single-shot Runs.
      expect(latestJob(r, 's')?.jobId).toBe(expected)
      const selected = vi.spyOn(owner, 'latestJobForShot')
      const writeBack = vi.fn()
      settleFromRun({ projectId: 'p', link: { runId: 'parent', shotId: 's' }, canvasRunId: 'r', shotId: 's',
        error: new Error('failed'), readRun: () => r, writeBack, now: () => t2 })
      expect(selected.mock.results.at(-1)?.value?.jobId).toBe(expected)
      expect(writeBack).toHaveBeenCalledOnce()
      selected.mockClear()
      shotLandingFacts(r)
      expect(selected.mock.results[0]?.value?.jobId).toBe(expected)
      selected.mockClear()
      shotHandoverPhase(r, 's')
      expect(selected.mock.results[0]?.value?.jobId).toBe(expected)
      expect(r).toEqual(before)
    })
  }

  it('U7 legacy QA-only means already sent, never permission to submit again', () => {
    const r = run([job('Q', { stageId: 'qa', metadata: undefined, status: 'polling', providerTaskId: 'task-q' })], true)
    expect(owner.latestJobForShot(r, 's')).toBeUndefined()
    expect(deriveProductionShotState(r, 's')?.job).toBeUndefined()
    expect(buildQaRetryPlans(r, verdict)).toEqual([])
    expect(latestJob(r)).toBeUndefined()
    expect(shotLandingFacts(r).sent).toHaveLength(1)
    expect(shotHandoverPhase(r, undefined)).toBe('settled_without_acceptance')
    expect(shotHandoverPhase(r, 's')).toBe('settled_without_acceptance')
    const writeBack = vi.fn()
    settleFromRun({ projectId: 'p', link: { runId: 'parent', shotId: 's' }, canvasRunId: 'r',
      error: new Error('failed'), readRun: () => r, writeBack, now: () => t2 })
    expect(writeBack.mock.calls[0][0].settlement.outcome).toBe('unknown')
  })

  it('unmapped legacy addresses fail closed without inventing a current job', () => {
    const r = run([job('old', { metadata: undefined })], true)
    expect(owner.latestJobForShot(r, 'unknown-old-address')).toBeUndefined()
    expect(owner.hasUnresolvedShotSubmission(r, 'unknown-old-address')).toBe(true)
    expect(shotHandoverPhase(r, 'unknown-old-address')).toBe('settled_without_acceptance')
    expect(owner.hasUnresolvedShotSubmission(run([], true), 's')).toBe(false)
    expect(owner.hasUnresolvedShotSubmission(run([job('other')]), 's')).toBe(false)
  })

  it('owner accepts only an address, with no ordering option', () => {
    expect(owner.latestJobForShot.length).toBe(2)
    expect(owner.jobsForShot.length).toBe(2)
    const r = run([job('old', { updatedAt: t3 }), job('new', { createdAt: t2, updatedAt: t2 })])
    const addressWithUnsupportedOrder = { nodeId: 'n', orderBy: 'updatedAt' }
    expect(owner.latestJobForShot(r, addressWithUnsupportedOrder)?.jobId).toBe('new')
    expectTypeOf<Parameters<typeof owner.latestJobForShot>>().toEqualTypeOf<[ProductionRun, (string | Readonly<{ nodeId: string }>)?]>()
  })

  it('legacy QA node-only parents use attempt, creation and stable ties', () => {
    const r = run([job('old', { metadata: undefined, updatedAt: t3 }), job('new', { metadata: undefined, createdAt: t2, updatedAt: t2 })])
    expect(buildQaRetryPlans(r, verdict)[0]?.parentJobId).toBe('new')
    delete r.generationPlan
    expect(buildQaRetryPlans(r, verdict)[0]?.parentJobId).toBe('new')
    r.jobs.push(job('higher', { metadata: undefined, attempt: 2, createdAt: '2026-11-16T00:00:00.000Z' }))
    expect(buildQaRetryPlans(r, verdict)[0]?.parentJobId).toBe('higher')
  })

  it('no task stays absent and another shot cannot substitute', () => {
    const r = run([job('other', { nodeId: 'other-node', metadata: { shotId: 'other' } })])
    expect(owner.latestJobForShot(r, 's')).toBeUndefined()
    expect(deriveProductionShotState(r, 's')?.job).toBeUndefined()
    expect(buildQaRetryPlans(r, verdict)).toEqual([])
    expect(latestJob(r, 's')).toBeUndefined()
    expect(shotLandingFacts(r).sent).toEqual([{ shotId: 'other', index: 2 }])
    expect(shotHandoverPhase(r, 's')).toBe('waiting_dispatch')
  })
})
