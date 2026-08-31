import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService, type ProductionRunService } from './productionRunService'

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-driver-'))
}

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
}

async function prepareContract(
  service: ProductionRunService,
  runId: string,
  bindings = [{ nodeId: 'shot-1', provider: 'broken-relay', model: 'same-model', stageId: 'generate' }],
) {
  service.createDraft({
    runId,
    projectId: 'project-1',
    playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' },
    brief: { goal: 'Provider recovery test', durationSeconds: 60 },
  })
  await service.command('project-1', runId, {
    commandId: `${runId}-direction`, expectedRevision: 0, type: 'gate.decide',
    payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
  })
  await waitFor(() => service.readFull('project-1', runId).status === 'awaiting_storyboard_review')
  const planned = service.readFull('project-1', runId)
  return service.command('project-1', runId, {
    commandId: `${runId}-attach`, expectedRevision: planned.revision, type: 'plan.attach',
    payload: { artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId, bindings },
    issuedAt: new Date().toISOString(),
  })
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

    await expect(service.command('project-1', 'run-driver-2', {
      commandId: 'incomplete-contract-1', expectedRevision: attached.run.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })).rejects.toThrow(/未设置本次制作授权上限.*供应商「local」.*模型「demo-video」/)
    expect(service.readFull('project-1', 'run-driver-2')).toMatchObject({
      revision: attached.run.revision,
      status: 'awaiting_contract',
      budget: { authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    })

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
      if (op === 'production.generate-node') return { providerTaskId: 'provider-shot-1', assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
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
      preflightProviderModel: () => undefined,
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

  it('rejects an unavailable provider before contract approval and leaves the gate waiting', async () => {
    const root = makeRoot()
    const calls: string[] = []
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer: async (op) => {
        calls.push(op)
        if (op === 'production.plan-storyboard') return { plan: { shots: [{ index: 1, prompt: 'shot' }] } }
        throw new Error(`unexpected renderer op: ${op}`)
      },
      preflightProviderModel: () => { throw new Error('API key missing: broken-relay') },
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['broken-relay'], allowedModels: ['same-model'], maxSpend: 10 }),
    })
    const attached = await prepareContract(service, 'run-preflight-before-approval')

    await expect(service.command('project-1', attached.run.runId, {
      commandId: 'approve-broken-provider', expectedRevision: attached.run.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })).rejects.toThrow(/broken-relay.*same-model.*API key missing/)

    const blocked = service.readFull('project-1', attached.run.runId)
    expect(blocked.gates.find((gate) => gate.gateId === 'gate-contract-v1')?.status).toBe('waiting')
    expect(blocked.jobs[0].status).toBe('authorization_required')
    expect(blocked.budget).toMatchObject({ authorized: 0, reserved: 0, actual: 0, unsettled: 0 })
    expect(calls).not.toContain('production.generate-node')
  })

  it('records a provider that becomes unavailable after approval as not_dispatched', async () => {
    const root = makeRoot()
    const calls: string[] = []
    let preflightCalls = 0
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer: async (op) => {
        calls.push(op)
        if (op === 'production.plan-storyboard') return { plan: { shots: [{ index: 1, prompt: 'shot' }] } }
        throw new Error(`unexpected renderer op: ${op}`)
      },
      preflightProviderModel: () => {
        preflightCalls += 1
        if (preflightCalls > 1) throw new Error('API key missing: broken-relay')
      },
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['broken-relay'], allowedModels: ['same-model'], maxSpend: 10 }),
    })
    const attached = await prepareContract(service, 'run-preflight-after-approval')
    await service.command('project-1', attached.run.runId, {
      commandId: 'approve-then-key-removed', expectedRevision: attached.run.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', attached.run.runId).jobs[0].status === 'not_dispatched')

    const blocked = service.readFull('project-1', attached.run.runId)
    expect(blocked.status).toBe('needs_attention')
    expect(blocked.jobs[0]).toMatchObject({ status: 'not_dispatched', errorCode: 'provider_preflight_failed' })
    expect(calls).not.toContain('production.generate-node')
    const projectedEvents = await service.readEvents('project-1', attached.run.runId)
    expect(projectedEvents.events.some((event) => event.type === 'job.not_dispatched')).toBe(true)
  })

  it('preserves renderer not_dispatched state and forwards the durable idempotency key', async () => {
    const root = makeRoot()
    const generationPayloads: Array<Record<string, unknown>> = []
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer: async (op, payload) => {
        if (op === 'production.plan-storyboard') return { plan: { shots: [{ index: 1, prompt: 'shot' }] } }
        if (op === 'production.generate-node') {
          generationPayloads.push(payload as Record<string, unknown>)
          expect(repository.read('project-1', 'run-renderer-not-dispatched')?.jobs[0].status).toBe('submitting')
          expect(repository.read('project-1', 'run-renderer-not-dispatched')?.budget.reserved).toBe(10)
          throw Object.assign(new Error('API key missing: broken-relay'), {
            code: 'api_key_missing',
            dispatchState: 'not_dispatched',
          })
        }
        throw new Error(`unexpected renderer op: ${op}`)
      },
      preflightProviderModel: () => undefined,
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['broken-relay'], allowedModels: ['same-model'], maxSpend: 10 }),
    })
    const attached = await prepareContract(service, 'run-renderer-not-dispatched')
    const durableKey = attached.run.jobs[0].idempotencyKey
    await service.command('project-1', attached.run.runId, {
      commandId: 'approve-renderer-local-failure', expectedRevision: attached.run.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', attached.run.runId).jobs[0].status === 'not_dispatched')

    const blocked = service.readFull('project-1', attached.run.runId)
    expect(blocked.jobs[0]).toMatchObject({ status: 'not_dispatched', errorCode: 'api_key_missing' })
    expect(blocked.jobs.some((job) => job.status === 'submission_unknown')).toBe(false)
    expect(generationPayloads).toEqual([expect.objectContaining({
      idempotencyKey: durableKey,
      provider: 'broken-relay',
      model: 'same-model',
    })])
  })

  it('revokes the old approval and creates an unapproved replacement contract without resubmitting', async () => {
    const root = makeRoot()
    const calls: string[] = []
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer: async (op, payload) => {
        calls.push(op)
        if (op === 'production.plan-storyboard') return { plan: { shots: [{ index: 1, prompt: 'shot' }, { index: 2, prompt: 'shot' }] } }
        if (op === 'production.generate-node') throw Object.assign(new Error('API key missing: broken-relay'), {
          code: 'api_key_missing',
          dispatchState: 'not_dispatched',
        })
        if (op === 'production.rebind-nodes') return { previousBindings: [] }
        throw new Error(`unexpected renderer op: ${op}`)
      },
      preflightProviderModel: () => undefined,
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['broken-relay', 'healthy-relay'], allowedModels: ['same-model', 'other-model'], maxSpend: 10 }),
    })
    const attached = await prepareContract(service, 'run-provider-rebind', [
      { nodeId: 'shot-1', provider: 'broken-relay', model: 'same-model', stageId: 'generate' },
      { nodeId: 'shot-2', provider: 'healthy-relay', model: 'other-model', stageId: 'generate' },
    ])
    await service.command('project-1', attached.run.runId, {
      commandId: 'approve-old-contract', expectedRevision: attached.run.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', attached.run.runId).jobs[0].status === 'not_dispatched')
    const failed = service.readFull('project-1', attached.run.runId)
    expect(failed.jobs.map((job) => job.status)).toEqual(['not_dispatched', 'authorized'])
    expect(failed.budget.authorized).toBe(10)
    expect(failed.budget.reserved).toBe(0)
    expect(calls.filter((op) => op === 'production.generate-node')).toHaveLength(1)

    const rebound = await service.command('project-1', failed.runId, {
      commandId: 'replace-broken-provider', expectedRevision: failed.revision, type: 'plan.rebind-provider',
      payload: {
        replacements: [{ jobId: failed.jobs[0].jobId, provider: 'apimart', model: 'same-model' }],
      },
      issuedAt: new Date().toISOString(),
    })

    expect(rebound.run).toMatchObject({ planVersion: 2, status: 'awaiting_contract' })
    expect(rebound.run.jobs.slice(0, 2).map((job) => job.status)).toEqual(['detached', 'detached'])
    expect(rebound.run.jobs.slice(2).map((job) => ({ status: job.status, provider: job.provider }))).toEqual([
      { status: 'authorization_required', provider: 'apimart' },
      { status: 'authorization_required', provider: 'healthy-relay' },
    ])
    expect(rebound.run.gates.find((gate) => gate.gateId === 'gate-contract-v1')?.status).toBe('revoked')
    expect(rebound.run.gates.find((gate) => gate.gateId === 'gate-contract-v2')?.status).toBe('waiting')
    expect(rebound.run.budget).toMatchObject({ authorized: 0, reserved: 0, actual: 0, unsettled: 0 })
    expect(repository.readApprovals('project-1', failed.runId).find((approval) => approval.approvalId === 'approval:gate-contract-v1')?.revokedAt).toBeTruthy()
    expect(repository.readApprovals('project-1', failed.runId).some((approval) => approval.approvalId === 'approval:gate-contract-v2')).toBe(false)
    expect(calls.filter((op) => op === 'production.generate-node')).toHaveLength(1)
    expect(rebound.run.jobs.slice(2).map((job) => job.idempotencyKey)).toEqual([
      `production:${failed.runId}:v2:shot-1`,
      `production:${failed.runId}:v2:shot-2`,
    ])
    const events = await service.readEvents('project-1', failed.runId)
    expect(events.events.some((event) => event.type === 'plan.rebound')).toBe(true)
  })

  it('rejects a contract whose visible gate omits an active executable job', async () => {
    const root = makeRoot()
    const calls: string[] = []
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer: async (op) => {
        calls.push(op)
        if (op === 'production.plan-storyboard') return { plan: { shots: [{ index: 1, prompt: 'shot' }] } }
        throw new Error(`unexpected renderer op: ${op}`)
      },
      preflightProviderModel: () => undefined,
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['relay'], allowedModels: ['model'], maxSpend: 10 }),
    })
    const attached = await prepareContract(service, 'run-incomplete-gate', [
      { nodeId: 'shot-1', provider: 'relay', model: 'model', stageId: 'generate' },
    ])
    const withHiddenJob = repository.execute('project-1', attached.run.runId, {
      commandId: 'inject-hidden-active-job',
      expectedRevision: attached.run.revision,
      type: 'job.add',
      payload: {
        job: {
          jobId: 'job:hidden', stageId: 'generate', status: 'authorization_required', attempt: 0,
          provider: 'relay', model: 'model', idempotencyKey: 'hidden-job-key', nodeId: 'shot-hidden',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      },
      issuedAt: new Date().toISOString(),
    })

    await expect(service.command('project-1', attached.run.runId, {
      commandId: 'approve-incomplete-gate', expectedRevision: withHiddenJob.run.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })).rejects.toThrow(/任务范围不完整/)
    expect(calls).not.toContain('production.generate-node')
  })

  it('never switches provider while a submission receipt is genuinely unknown', async () => {
    const root = makeRoot()
    const calls: string[] = []
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer: async (op) => {
        calls.push(op)
        if (op === 'production.plan-storyboard') return { plan: { shots: [{ index: 1, prompt: 'shot' }] } }
        if (op === 'production.generate-node') throw new Error('connection lost after dispatch boundary')
        if (op === 'production.rebind-nodes') return { previousBindings: [] }
        throw new Error(`unexpected renderer op: ${op}`)
      },
      preflightProviderModel: () => undefined,
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['relay'], allowedModels: ['model'], maxSpend: 10 }),
    })
    const attached = await prepareContract(service, 'run-unknown-no-switch', [
      { nodeId: 'shot-1', provider: 'relay', model: 'model', stageId: 'generate' },
    ])
    await service.command('project-1', attached.run.runId, {
      commandId: 'approve-unknown', expectedRevision: attached.run.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', attached.run.runId).jobs[0].status === 'submission_unknown')
    const unknown = service.readFull('project-1', attached.run.runId)

    await expect(service.command('project-1', unknown.runId, {
      commandId: 'unsafe-switch', expectedRevision: unknown.revision, type: 'plan.rebind-provider',
      payload: { replacements: [{ jobId: unknown.jobs[0].jobId, provider: 'other-relay', model: 'model' }] },
      issuedAt: new Date().toISOString(),
    })).rejects.toThrow(/不能安全换供应商|cannot be safely/i)
    expect(calls.filter((op) => op === 'production.generate-node')).toHaveLength(1)
    expect(calls).not.toContain('production.rebind-nodes')
  })
})
