import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-driver-'))
}

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('ProductionRunService driver round 1', () => {
  it('initializes direction gate and never calls the renderer or provider at draft time', () => {
    const root = makeRoot()
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const requestRenderer = async () => { throw new Error('must not run before direction approval') }
    const service = createProductionRunService({ repository, projectRootResolver: () => root, requestRenderer })

    const run = service.createDraft({
      runId: 'run-driver-1',
      projectId: 'project-1',
      playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex', actorId: 'codex' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 60, sellingPoints: ['local-first'] },
    })

    expect(run.status).toBe('awaiting_direction')
    expect(run.gates).toHaveLength(1)
    expect(run.jobs).toHaveLength(0)
    expect(run.budget.authorized).toBe(0)
    expect(fs.existsSync(path.join(root, '.nomi/runs/run-driver-1/brief-v1.json'))).toBe(true)
  })

  it('plans once after direction approval, persists skill evidence, and attaches a contract without paid work', async () => {
    const root = makeRoot()
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const requestRenderer = async (op: string) => {
      expect(op).toBe('production.plan-storyboard')
      return { text: '已完成分镜规划', plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
    }
    let policy = { allowedProviders: [] as string[], allowedModels: [] as string[], maxSpend: null as number | null }
    const service = createProductionRunService({ repository, projectRootResolver: () => root, requestRenderer, policyResolver: () => policy })
    service.createDraft({
      runId: 'run-driver-2',
      projectId: 'project-1',
      playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 60 },
    })
    const approved = await service.command('project-1', 'run-driver-2', {
      commandId: 'user-direction-1', expectedRevision: 0, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(approved.run.status).toBe('running')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const planned = service.readFull('project-1', 'run-driver-2')
    expect(planned.status).toBe('awaiting_storyboard_review')
    expect(planned.artifacts.map((item) => item.kind)).toEqual(expect.arrayContaining(['script', 'storyboard']))
    expect(repository.readEvents('project-1', 'run-driver-2').some((event) => event.type === 'skill.loaded')).toBe(true)
    expect(planned.budget.authorized).toBe(0)

    const attached = await service.command('project-1', 'run-driver-2', {
      commandId: 'user-plan-1', expectedRevision: planned.revision, type: 'plan.attach',
      payload: {
        artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId,
        bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }],
      }, issuedAt: new Date().toISOString(),
    })
    expect(attached.run.status).toBe('awaiting_contract')
    expect(attached.run.jobs).toHaveLength(1)
    expect(attached.run.gates.find((gate) => gate.scope === 'budget_envelope')?.status).toBe('waiting')
    expect(attached.run.budget.authorized).toBe(0)

    const replay = await service.command('project-1', 'run-driver-2', {
      commandId: 'user-plan-1', expectedRevision: 0, type: 'plan.attach', payload: {}, issuedAt: new Date().toISOString(),
    })
    expect(replay.run.revision).toBe(attached.run.revision)

    policy = { allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 25 }
    const refreshed = await service.command('project-1', 'run-driver-2', {
      commandId: 'refresh-policy-1', expectedRevision: attached.run.revision, type: 'policy.refresh', payload: {}, issuedAt: new Date().toISOString(),
    })
    expect(refreshed.run.policy.maxSpend).toBe(25)
    expect(refreshed.run.gates.find((gate) => gate.scope === 'budget_envelope')?.status).toBe('waiting')
    expect(refreshed.run.budget.authorized).toBe(0)

    const rejected = await service.command('project-1', 'run-driver-2', {
      commandId: 'reject-contract-1', expectedRevision: refreshed.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'rejected' }, issuedAt: new Date().toISOString(),
    })
    expect(rejected.run.gates.find((gate) => gate.gateId === 'gate-contract-v1')?.status).toBe('rejected')
    expect(rejected.run.budget).toMatchObject({ authorized: 0, reserved: 0, actual: 0, unsettled: 0 })
  })

  it('drives approved jobs through local artifacts, rough-cut review, and an approved export only', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
    fs.mkdirSync(path.join(root, 'exports'), { recursive: true })
    const calls: string[] = []
    const requestRenderer = async (op: string) => {
      calls.push(op)
      if (op === 'production.plan-storyboard') return { plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
      if (op === 'production.generate-node') return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
      if (op === 'production.arrange') return { arranged: 1, total: 1 }
      if (op === 'production.export') {
        fs.writeFileSync(path.join(root, 'exports/nomi-run-driver-3.mp4'), 'mp4', 'utf8')
        return { relativePath: 'exports/nomi-run-driver-3.mp4', size: 3 }
      }
      throw new Error(`unexpected renderer op: ${op}`)
    }
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer,
      policyResolver: () => ({ trustedHosts: ['nomi', 'codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1 }),
    })
    service.createDraft({
      runId: 'run-driver-3', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'codex' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 60 },
    })
    await service.command('project-1', 'run-driver-3', { commandId: 'direction-3', expectedRevision: 0, type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitFor(() => calls.includes('production.plan-storyboard'))
    const planned = service.readFull('project-1', 'run-driver-3')
    const attached = await service.command('project-1', 'run-driver-3', {
      commandId: 'attach-3', expectedRevision: planned.revision, type: 'plan.attach',
      payload: { artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId, bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }] }, issuedAt: new Date().toISOString(),
    })
    expect(calls).not.toContain('production.generate-node')
    const contract = await service.command('project-1', 'run-driver-3', { commandId: 'contract-3', expectedRevision: attached.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    expect(contract.run.budget.authorized).toBe(10)
    await waitFor(() => calls.includes('production.arrange'))
    const roughCut = service.readFull('project-1', 'run-driver-3')
    expect(roughCut.status).toBe('awaiting_rough_cut_review')
    expect(roughCut.jobs[0].status).toBe('adopted')
    expect(roughCut.artifacts.map((item) => item.kind)).toEqual(expect.arrayContaining(['video', 'timeline']))
    const videoProjection = service.readProjection('project-1', 'run-driver-3').artifacts.find((item) => item.kind === 'video')
    expect(videoProjection?.artifactId).toMatch(/^artifact-job-[A-Za-z0-9._-]+-[0-9a-f]{10}$/)
    expect(service.readArtifactProjection('project-1', 'run-driver-3', videoProjection?.artifactId || '').openInNomi).toMatch(/^nomi:\/\/project\/project-1\/run\/run-driver-3\?artifact=[A-Za-z0-9._-]+$/)
    expect(calls).toEqual(expect.arrayContaining(['production.plan-storyboard', 'production.generate-node', 'production.arrange']))
    const exportGate = roughCut.gates.find((gate) => gate.scope === 'export')
    expect(exportGate?.status).toBe('waiting')
    await expect(service.command('project-1', 'run-driver-3', { commandId: 'export-too-early-3', expectedRevision: roughCut.revision, type: 'gate.decide', payload: { gateId: exportGate?.gateId, status: 'approved' }, issuedAt: new Date().toISOString() })).rejects.toThrow(/粗剪/)
    const reviewed = await service.command('project-1', 'run-driver-3', { commandId: 'rough-cut-3', expectedRevision: roughCut.revision, type: 'run.status', payload: { status: 'awaiting_export' }, issuedAt: new Date().toISOString() })
    await service.command('project-1', 'run-driver-3', { commandId: 'export-3', expectedRevision: reviewed.run.revision, type: 'gate.decide', payload: { gateId: exportGate?.gateId, status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitFor(() => calls.includes('production.export'))
    await waitFor(() => service.readFull('project-1', 'run-driver-3').status === 'completed')
    const completed = service.readFull('project-1', 'run-driver-3')
    expect(completed.status).toBe('completed')
    expect(completed.artifacts.find((item) => item.kind === 'export')?.projectRelativePath).toBe('exports/nomi-run-driver-3.mp4')
  })

  it('turns a submission in progress into submission_unknown after recovery instead of resubmitting', async () => {
    const root = makeRoot()
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const created = repository.create({
      runId: 'run-driver-recovery', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'codex' }, brief: { goal: 'recovery test' },
    })
    const directionApproved = repository.execute('project-1', 'run-driver-recovery', { commandId: 'recovery-direction', expectedRevision: 0, type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: created.createdAt })
    const job = { jobId: 'job-recovery', stageId: 'generate', status: 'planned' as const, attempt: 0, provider: 'local', model: 'demo-video', idempotencyKey: 'idem-recovery', providerTaskId: 'provider-task-1', taskKind: 'text_to_video', createdAt: created.createdAt, updatedAt: created.createdAt }
    let revision = directionApproved.run.revision
    for (const command of [
      { type: 'job.add', payload: { job } },
      { type: 'job.status', payload: { jobId: job.jobId, status: 'authorization_required' } },
      { type: 'job.status', payload: { jobId: job.jobId, status: 'authorized' } },
      { type: 'job.status', payload: { jobId: job.jobId, status: 'submit_intent_persisted' } },
      { type: 'job.status', payload: { jobId: job.jobId, status: 'submitting' } },
    ]) {
      const result = repository.execute('project-1', 'run-driver-recovery', { commandId: `recovery-seed-${revision}`, expectedRevision: revision, ...command, issuedAt: created.createdAt })
      revision = result.run.revision
    }
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/recovered.mp4'), 'video', 'utf8')
    const rendererCalls: string[] = []
    const requestRenderer = async (op: string) => {
      rendererCalls.push(op)
      if (op === 'production.arrange') return { arranged: 1, total: 1 }
      throw new Error('recovery must not resubmit')
    }
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer,
      reconcileProviderTask: async () => ({ status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/recovered.mp4' }] }),
    })
    await service.resumeUnfinishedRuns('project-1')
    const recovered = service.readFull('project-1', 'run-driver-recovery')
    expect(recovered.jobs[0].status).toBe('submission_unknown')
    expect(recovered.jobs[0].errorCode).toBe('restart_recovery_required')
    expect(recovered.status).toBe('needs_attention')

    await service.command('project-1', 'run-driver-recovery', {
      commandId: 'reconcile-found-1', expectedRevision: recovered.revision, type: 'job.reconcile', payload: { jobId: 'job-recovery', outcome: 'found' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', 'run-driver-recovery').jobs[0].status === 'adopted')
    expect(service.readFull('project-1', 'run-driver-recovery').artifacts.some((artifact) => artifact.kind === 'video')).toBe(true)
    expect(rendererCalls).not.toContain('production.generate-node')
  })
})
