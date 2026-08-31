import { describe, expect, it } from 'vitest'

import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import { buildProductionRunView } from './productionRunView'

const now = Date.parse('2026-08-08T08:10:00.000Z')

function run(patch: Partial<ProductionRun> = {}): ProductionRun {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    projectId: 'project-1',
    revision: 1,
    status: 'running',
    stageId: 'production',
    playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' },
    policy: {
      mode: 'balanced',
      trustedHosts: ['codex'],
      allowedProviders: ['tapcanvas'],
      allowedModels: ['seedance'],
      maxSpend: 20,
      maxAttemptsPerJob: 2,
      minimizeUploads: true,
    },
    budget: { currency: 'CNY', authorized: 20, reserved: 5, actual: 3, unsettled: 0 },
    planVersion: 1,
    snapshotCursor: 2,
    stages: [{ stageId: 'production', title: 'Production', status: 'running', order: 1 }],
    gates: [],
    jobs: [{
      jobId: 'job-1',
      stageId: 'production',
      status: 'polling',
      attempt: 1,
      provider: 'tapcanvas',
      model: 'seedance',
      idempotencyKey: 'run-1:job-1:1',
      progressPercent: 42,
      lastVendorStateChangeAt: '2026-08-08T08:09:30.000Z',
      createdAt: '2026-08-08T08:00:00.000Z',
      updatedAt: '2026-08-08T08:09:30.000Z',
    }],
    artifacts: [],
    createdAt: '2026-08-08T08:00:00.000Z',
    updatedAt: '2026-08-08T08:09:30.000Z',
    ...patch,
  }
}

describe('production run view', () => {
  it('shows real progress when known and omits it when unknown', () => {
    expect(buildProductionRunView(run(), now)).toMatchObject({
      tone: 'working',
      titleKey: 'production.status.running',
      percent: 42,
      primaryAction: 'open-stage',
    })
    const unknown = run({ jobs: [{ ...run().jobs[0], progressPercent: undefined }] })
    expect(buildProductionRunView(unknown, now).percent).toBeUndefined()
  })

  it('prioritizes a pending contextual gate with one approval action', () => {
    const value = run({
      status: 'awaiting_contract',
      gates: [{
        gateId: 'gate-1',
        scope: 'budget_envelope',
        status: 'waiting',
        planHash: 'plan-1',
        jobIds: ['job-1'],
        title: 'Production contract',
        summary: '5 shots',
        createdAt: '2026-08-08T08:00:00.000Z',
        expiresAt: '2026-08-08T09:00:00.000Z',
      }],
    })
    expect(buildProductionRunView(value, now)).toMatchObject({
      tone: 'attention',
      titleKey: 'production.status.approvalRequired',
      primaryAction: 'open-gate',
      targetId: 'gate-1',
    })
  })

  it('requires rough-cut review before exposing the waiting export gate', () => {
    const exportGate = {
      gateId: 'gate-export-v1',
      scope: 'export' as const,
      status: 'waiting' as const,
      planHash: 'export-plan',
      jobIds: [],
      title: 'Export',
      summary: 'Review first',
      createdAt: '2026-08-08T08:00:00.000Z',
      expiresAt: '2026-08-08T09:00:00.000Z',
    }
    expect(buildProductionRunView(run({ status: 'awaiting_rough_cut_review', gates: [exportGate] }), now)).toMatchObject({
      titleKey: 'production.status.roughCutReady',
      primaryAction: 'review-rough-cut',
    })
    expect(buildProductionRunView(run({ status: 'awaiting_export', gates: [exportGate] }), now)).toMatchObject({
      titleKey: 'production.status.exportReady',
      primaryAction: 'open-gate',
      targetId: 'gate-export-v1',
    })
  })

  it('shows a durable contract refusal and states that no spend occurred', () => {
    const value = run({
      status: 'awaiting_contract',
      budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
      gates: [{
        gateId: 'gate-contract-v1', scope: 'budget_envelope', status: 'rejected', planHash: 'plan-1', jobIds: ['job-1'],
        title: 'Production contract', summary: '5 shots', createdAt: '2026-08-08T08:00:00.000Z', expiresAt: '2026-08-08T09:00:00.000Z', decidedAt: '2026-08-08T08:05:00.000Z',
      }],
    })
    expect(buildProductionRunView(value, now)).toMatchObject({
      tone: 'neutral',
      titleKey: 'production.status.contractDeclined',
      descriptionKey: 'production.description.contractDeclined',
      primaryAction: null,
    })
  })

  it('stops on submission_unknown and never suggests retry', () => {
    const value = run({ jobs: [{ ...run().jobs[0], status: 'submission_unknown', progressPercent: undefined }] })
    expect(buildProductionRunView(value, now)).toMatchObject({
      tone: 'danger',
      titleKey: 'production.status.submissionUnknown',
      primaryAction: 'reconcile',
      targetId: 'job-1',
    })
    expect(JSON.stringify(buildProductionRunView(value, now))).not.toContain('retry')
  })

  it('explains stale provider state without inventing failure or ETA', () => {
    const value = run({
      jobs: [{ ...run().jobs[0], progressPercent: undefined, lastVendorStateChangeAt: '2026-08-08T08:00:00.000Z' }],
    })
    const view = buildProductionRunView(value, now, { staleAfterMs: 60_000 })
    expect(view).toMatchObject({
      tone: 'attention',
      titleKey: 'production.status.providerStale',
      primaryAction: 'open-stage',
    })
    expect(view.percent).toBeUndefined()
  })

  it('selects only the latest safe artifact preview', () => {
    const value = run({
      artifacts: [
        { artifactId: 'safe-old', stageId: 'production', kind: 'image', status: 'ready', thumbnailRelativePath: 'assets/old.png', createdAt: '2026-08-08T08:01:00.000Z' },
        { artifactId: 'unsafe-new', stageId: 'production', kind: 'image', status: 'ready', thumbnailRelativePath: '/Users/private/new.png', createdAt: '2026-08-08T08:03:00.000Z' },
        { artifactId: 'safe-new', stageId: 'production', kind: 'video', status: 'ready', thumbnailRelativePath: 'assets/new.jpg', createdAt: '2026-08-08T08:02:00.000Z' },
      ],
    })
    expect(buildProductionRunView(value, now).preview).toEqual({
      artifactId: 'safe-new',
      kind: 'video',
      thumbnailRelativePath: 'assets/new.jpg',
    })
  })

  it('projects a playable video path and auditable stage, skill, and update details', () => {
    const value = run({
      updatedAt: '2026-08-08T08:09:30.000Z',
      stages: [
        { stageId: 'script', title: 'Script', status: 'completed', order: 1 },
        { stageId: 'generate', title: 'Generate', status: 'running', order: 2 },
      ],
      gates: [{
        gateId: 'gate-contract', scope: 'budget_envelope', status: 'approved', planHash: 'plan-1', jobIds: ['job-1'],
        title: 'Production contract', summary: 'One shot', createdAt: '2026-08-08T08:00:00.000Z', expiresAt: '2026-08-08T09:00:00.000Z',
        contract: { specs: {}, claims: [], evidence: [], skills: [{ name: 'director', version: '2.1.0' }] },
      }],
      artifacts: [{
        artifactId: 'video-1', stageId: 'generate', kind: 'video', status: 'ready',
        projectRelativePath: 'assets/generated/shot.mp4', createdAt: '2026-08-08T08:08:00.000Z',
      }],
    })

    expect(buildProductionRunView(value, now)).toMatchObject({
      preview: {
        artifactId: 'video-1',
        kind: 'video',
        projectRelativePath: 'assets/generated/shot.mp4',
      },
      details: {
        updatedAt: '2026-08-08T08:09:30.000Z',
        stages: [
          { stageId: 'script', title: 'Script', status: 'completed' },
          { stageId: 'generate', title: 'Generate', status: 'running' },
        ],
        skills: [{ name: 'director', version: '2.1.0' }],
      },
    })
  })
})
