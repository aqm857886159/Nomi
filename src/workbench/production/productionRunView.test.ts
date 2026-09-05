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
      titleKey: 'generationCommon.production.status.running',
      percent: 42,
      primaryAction: 'open-stage',
    })
    const unknown = run({ jobs: [{ ...run().jobs[0], progressPercent: undefined }] })
    expect(buildProductionRunView(unknown, now).percent).toBeUndefined()
  })

  it('A4 情境控制行：running→暂停+取消；paused→继续为主动作+取消；draft/completed→无', () => {
    expect(buildProductionRunView(run(), now).controls).toEqual(['pause', 'cancel'])
    expect(buildProductionRunView(run({ status: 'paused' }), now)).toMatchObject({
      tone: 'attention',
      titleKey: 'generationCommon.production.status.paused',
      primaryAction: 'resume-run',
      controls: ['cancel'],
    })
    expect(buildProductionRunView(run({ status: 'pausing' }), now)).toMatchObject({
      titleKey: 'generationCommon.production.status.pausing',
      primaryAction: null,
      controls: ['cancel'],
    })
    // draft 但阶段还在（历史 run）：没有可暂停的东西，也不催用户取消。
    expect(buildProductionRunView(run({ status: 'draft', jobs: [] }), now).controls).toEqual([])
    expect(buildProductionRunView(run({ status: 'completed', jobs: [] }), now).controls).toEqual([])
  })

  // 2026-08-18 的坑：未实现的 playbook 曾静默建出 draft + 空 stages/gates 的坏 Run。它不会自己往前走，
  // 卡片却挂着「查看当前阶段」——点了只切到一张空画布，还说「确认制作摘要后才会开始」（没有摘要可确认），
  // 且不给取消。现在必须是诚实终态：说清楚推不动 + 只留取消这一个出口。
  it('gives a stalled draft an honest dead-end and the cancel exit instead of a button that goes nowhere', () => {
    const view = buildProductionRunView(run({ status: 'draft', jobs: [], stages: [], gates: [] }), now)

    expect(view).toMatchObject({
      tone: 'danger',
      titleKey: 'generationCommon.production.status.stalledDraft',
      descriptionKey: 'generationCommon.production.description.stalledDraft',
      primaryAction: null,
      controls: ['cancel'],
    })
  })

  it('presents legacy terminal Runs as fully complete even if old stage bookkeeping was partial', () => {
    const view = buildProductionRunView(run({
      status: 'completed',
      jobs: [],
      stages: [
        { stageId: 'direction', title: 'Direction', status: 'awaiting_gate', order: 1 },
        { stageId: 'export', title: 'Export', status: 'completed', order: 2 },
      ],
    }), now)

    expect(view.details).toMatchObject({ completedStages: 2, totalStages: 2 })
    expect(view.details.stages.every((stage) => stage.status === 'completed')).toBe(true)
  })

  it('routes the script-first review pause to the script draft instead of pretending production is running', () => {
    const value = run({
      status: 'awaiting_script_review',
      jobs: [],
      artifacts: [{
        artifactId: 'script-v1',
        stageId: 'script',
        kind: 'script',
        status: 'candidate',
        version: 1,
        reviewStatus: 'waiting',
        projectRelativePath: '.nomi/runs/run-1/script-v1.json',
        createdAt: '2026-08-08T08:09:00.000Z',
      }],
    })

    expect(buildProductionRunView(value, now)).toMatchObject({
      tone: 'attention',
      titleKey: 'generationCommon.production.status.scriptReady',
      descriptionKey: 'generationCommon.production.description.scriptReady',
      primaryAction: 'review-script',
      targetId: 'script-v1',
    })
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
      titleKey: 'generationCommon.production.status.approvalRequired',
      primaryAction: 'open-gate',
      targetId: 'gate-1',
    })
  })

  it('N3 门类分文案：方向/样片门不再说「支出边界」，各说各的一句话', () => {
    const gate = (gateId: string, scope: 'stage' | 'job_set' | 'budget_envelope' | 'export') => ({
      gateId, scope, status: 'waiting' as const, planHash: 'p', jobIds: [],
      title: 'gate', summary: 'summary',
      createdAt: '2026-08-08T08:00:00.000Z', expiresAt: '2026-08-08T09:00:00.000Z',
    })
    const direction = buildProductionRunView(run({ status: 'awaiting_direction', gates: [gate('gate-direction-v1', 'stage')] }), now)
    expect(direction).toMatchObject({
      titleKey: 'generationCommon.production.status.directionGate',
      descriptionKey: 'generationCommon.production.description.directionGate',
      gateKind: 'direction',
      decisionHome: 'origin', // fixture origin=codex → 门首选发起端，Nomi 只指路兜底
    })
    const sample = buildProductionRunView(run({ status: 'running', gates: [gate('gate-sample-v1', 'stage')] }), now)
    expect(sample).toMatchObject({ titleKey: 'generationCommon.production.status.sampleGate', gateKind: 'sample' })
    const contract = buildProductionRunView(run({ status: 'awaiting_contract', gates: [gate('gate-contract-v1', 'budget_envelope')] }), now)
    expect(contract).toMatchObject({ titleKey: 'generationCommon.production.status.approvalRequired', gateKind: 'contract', decisionHome: 'nomi' })
    const shot = buildProductionRunView(run({
      status: 'running',
      jobs: [{ ...run().jobs[0], nodeId: 'shot-1' }],
      gates: [{ ...gate('gate-shot-v1-job', 'job_set'), jobIds: ['job-1'] }],
    }), now)
    expect(shot).toMatchObject({
      titleKey: 'generationCommon.production.status.shotGate',
      descriptionKey: 'generationCommon.production.description.shotGate',
      gateKind: 'shot',
      decisionHome: 'nomi',
      gateJob: { index: 1, nodeId: 'shot-1', provider: 'tapcanvas', model: 'seedance' },
    })
    // origin=nomi（用户自主发起，没有 CLI 可用）→ 门在 Nomi 是主路径
    const own = buildProductionRunView(run({ status: 'awaiting_direction', origin: { host: 'nomi' }, gates: [gate('gate-direction-v1', 'stage')] }), now)
    expect(own.decisionHome).toBe('nomi')
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
      titleKey: 'generationCommon.production.status.roughCutReady',
      primaryAction: 'review-rough-cut',
    })
    expect(buildProductionRunView(run({ status: 'awaiting_export', gates: [exportGate] }), now)).toMatchObject({
      titleKey: 'generationCommon.production.status.exportReady',
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
      titleKey: 'generationCommon.production.status.contractDeclined',
      descriptionKey: 'generationCommon.production.description.contractDeclined',
      primaryAction: null,
    })
  })

  it('stops on submission_unknown and never suggests retry', () => {
    const value = run({ jobs: [{ ...run().jobs[0], status: 'submission_unknown', progressPercent: undefined }] })
    expect(buildProductionRunView(value, now)).toMatchObject({
      tone: 'danger',
      titleKey: 'generationCommon.production.status.submissionUnknown',
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
      titleKey: 'generationCommon.production.status.providerStale',
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
