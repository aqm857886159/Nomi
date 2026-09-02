import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction as waitFor } from './productionRunTestHelpers'
import { compileExecutionContract, type PlanCandidate } from '../capabilityCore/executionContract'
import { createModuleRegistry } from '../capabilityCore/moduleRegistry'
import { sealAndApproveProductionGeneration } from './productionGenerationAuthorizationTestUtils'
import { isRetiredLegacyWriterState, semanticGenerationReadiness } from './productionRunDriverOps'

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-driver-'))
}

const semanticRegistry = createModuleRegistry([{
  moduleId: 'generation.single-shot',
  version: '1.0.0',
  inputKinds: ['text'],
  outputKinds: ['video'],
  modes: ['text-to-video'],
  parameterSchema: {},
  assetInputSchema: { references: { kind: 'image', max: 4 } },
  providers: [{
    providerId: 'fixture-provider',
    models: [{ modelId: 'fixture-video', modes: ['text-to-video'], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }],
  }],
}])

function semanticCandidate(id: string, prompt: string): PlanCandidate {
  return {
    candidateId: id,
    revision: 1,
    moduleId: 'generation.single-shot',
    providerId: 'fixture-provider',
    modelId: 'fixture-video',
    mode: 'text-to-video',
    prompt,
    parameters: {},
    references: [],
  }
}

describe('ProductionRunService driver round 1', () => {
  it('keeps the retired legacy writer guard limited to durable submit states', () => {
    expect(isRetiredLegacyWriterState('submit_intent_persisted')).toBe(true)
    expect(isRetiredLegacyWriterState('submitting')).toBe(true)
    expect(isRetiredLegacyWriterState('authorized')).toBe(false)
    expect(isRetiredLegacyWriterState('adopted')).toBe(false)
  })

  it('initializes direction gate with zero paid work at draft time, safe even if direction planning cannot run', () => {
    const root = makeRoot()
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    // B1：createDraft 会异步试拟方向候选（免费 LLM prompt）。此处让它失败 → 证明「拟方向拿不到也不影响
    // 草稿有效」：仍是等方向 + 兜底 gate + 零任务零预算，没有任何付费/供应商工作。
    const requestRenderer = async () => { throw new Error('direction planner unavailable in this test') }
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

  // 这条覆盖的坑（2026-08-18）：整条流水线只实现了 brand.promo，别的 playbook 名字**静默降级**成一个
  // stages/gates 全空、永远停在 draft 的坏 Run，而 nomi_start_playbook 还回「成功」。上面那条只走
  // brand.promo，所以放跑了它。现在未登记的名字必须当场失败，且**一个字节都不落盘**——不是「建了再删」。
  it('rejects an unimplemented playbook at draft time and persists nothing', () => {
    const root = makeRoot()
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({ repository, projectRootResolver: () => root })

    expect(() => service.createDraft({
      runId: 'run-unknown-playbook',
      projectId: 'project-1',
      playbook: { name: 'film.scene-recreation', version: '1.0.0' },
      origin: { host: 'codex' },
      brief: { goal: 'recreate a scene' },
    })).toThrow(/film\.scene-recreation.*brand\.promo/s)

    expect(fs.existsSync(path.join(root, '.nomi/runs/run-unknown-playbook'))).toBe(false)
    expect(repository.list('project-1')).toHaveLength(0)
    expect(repository.read('project-1', 'run-unknown-playbook')).toBeNull()
  })

  // 同一类 bug 的第二个入口：brand.promo 但没给 brief，原先也掉进空 stages 的 draft。
  it('rejects a briefless draft instead of creating one that can never advance', () => {
    const root = makeRoot()
    const repository = createProductionRunRepository({ projectDirResolver: () => root })

    expect(() => repository.create({
      runId: 'run-no-brief',
      projectId: 'project-1',
      playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' },
    })).toThrow(/brief/)

    expect(repository.list('project-1')).toHaveLength(0)
  })

  it('plans once after direction approval, persists skill evidence, and attaches a contract without paid work', async () => {
    const root = makeRoot()
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const requestRenderer = async (op: string) => {
      // B1：createDraft 会先异步拟方向候选；剧本审阅通过后才走 plan-storyboard。
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'Nomi promo script' }
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
    await approveLatestScript(service, 'project-1', 'run-driver-2')
    const proposed = service.readFull('project-1', 'run-driver-2')
    const proposedStoryboard = proposed.artifacts.find((item) => item.kind === 'storyboard')!
    const persistedStoryboard = JSON.parse(fs.readFileSync(path.join(root, proposedStoryboard.projectRelativePath!), 'utf8')) as {
      planHash: string
      plan: unknown
    }
    const recalculatedPlanHash = crypto.createHash('sha256').update(JSON.stringify(persistedStoryboard.plan)).digest('hex')
    expect(proposedStoryboard.contentHash).toBe(recalculatedPlanHash)
    expect(persistedStoryboard.planHash).toBe(recalculatedPlanHash)
    const legacyRepository = {
      ...repository,
      read: (projectId: string, runId: string) => {
        const stored = repository.read(projectId, runId)
        return stored ? {
          ...stored,
          artifacts: stored.artifacts.map((artifact) => artifact.kind === 'storyboard'
            ? { ...artifact, contentHash: undefined }
            : artifact),
        } : null
      },
    }
    const legacyReader = createProductionRunService({ repository: legacyRepository, projectRootResolver: () => root })
    expect(legacyReader.readFull('project-1', 'run-driver-2').artifacts.find((item) => item.kind === 'storyboard')?.contentHash).toBe(recalculatedPlanHash)
    await approveLatestStoryboard(service, 'project-1', 'run-driver-2')
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
    })).rejects.toThrow(/未设置硬预算上限.*供应商「local」.*模型「demo-video」/)
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
    const requestRenderer = async (op: string, payload: unknown) => {
      calls.push(op)
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'Nomi promo script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
      if (op === 'production.generate-node') return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
      if (op === 'production.arrange') {
        expect((payload as Record<string, unknown>)?.shotNodeIds).toEqual(['shot-1'])
        return { arranged: 1, total: 1 }
      }
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
    await approveLatestScript(service, 'project-1', 'run-driver-3')
    await approveLatestStoryboard(service, 'project-1', 'run-driver-3')
    const planned = service.readFull('project-1', 'run-driver-3')
    const attached = await service.command('project-1', 'run-driver-3', {
      commandId: 'attach-3', expectedRevision: planned.revision, type: 'plan.attach',
      payload: { artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId, bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }] }, issuedAt: new Date().toISOString(),
    })
    expect(calls).not.toContain('production.generate-node')
    const contract = await service.command('project-1', 'run-driver-3', { commandId: 'contract-3', expectedRevision: attached.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    expect(contract.run.budget.authorized).toBe(10)
    // B2 样片门：首镜落地后停一次；批准后才继续到编排。
    await waitFor(() => service.readFull('project-1', 'run-driver-3').gates.some((gate) => gate.gateId === 'gate-sample-v1' && gate.status === 'waiting'))
    const atSample = service.readFull('project-1', 'run-driver-3')
    expect(atSample.status).toBe('running')
    expect(calls).not.toContain('production.arrange') // 样片门期间未进编排
    await service.command('project-1', 'run-driver-3', { commandId: 'sample-3', expectedRevision: atSample.revision, type: 'gate.decide', payload: { gateId: 'gate-sample-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
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

  it('W2 冻结门：有未冻结视觉锚 → 合同批准后停在冻结门（零 provider 调用）；冻结批准后才提交镜头', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
    fs.mkdirSync(path.join(root, 'exports'), { recursive: true })
    const calls: string[] = []
    // 冻结桥：合同批准前锚未冻结 → 回一个未冻结锚（driver 据此设冻结门）；冻结门放行后 hasApprovedFreezeGate
    // 短路，不再调本桥（下面断言 check-frozen 恰 1 次）。
    const requestRenderer = async (op: string) => {
      calls.push(op)
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'Nomi promo script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
      if (op === 'production.check-frozen') return { unfrozenAnchors: [{ nodeId: 'anchor-hero', title: '林夏 · 定妆' }] }
      if (op === 'production.generate-node') return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
      if (op === 'production.arrange') return { arranged: 1, total: 1 }
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
      runId: 'run-freeze', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'codex' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 60 },
    })
    await service.command('project-1', 'run-freeze', { commandId: 'direction-f', expectedRevision: 0, type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await approveLatestScript(service, 'project-1', 'run-freeze')
    await approveLatestStoryboard(service, 'project-1', 'run-freeze')
    const planned = service.readFull('project-1', 'run-freeze')
    const attached = await service.command('project-1', 'run-freeze', {
      commandId: 'attach-f', expectedRevision: planned.revision, type: 'plan.attach',
      payload: { artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId, bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }] }, issuedAt: new Date().toISOString(),
    })
    // 合同批准 → driveGeneration 触发；但有未冻结锚 → 停在冻结门，绝不提交（零 generate-node）。
    await service.command('project-1', 'run-freeze', { commandId: 'contract-f', expectedRevision: attached.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitFor(() => service.readFull('project-1', 'run-freeze').gates.some((gate) => gate.gateId === 'gate-freeze-v1' && gate.status === 'waiting'))
    const atFreeze = service.readFull('project-1', 'run-freeze')
    const freezeGate = atFreeze.gates.find((gate) => gate.gateId === 'gate-freeze-v1')
    expect(freezeGate?.scope).toBe('stage')
    expect(freezeGate?.status).toBe('waiting')
    expect(freezeGate?.jobIds).toEqual([]) // 不授权花钱、只呈现
    expect(calls).not.toContain('production.generate-node') // 冻结门期间零 provider 调用
    expect(atFreeze.budget.actual).toBe(0)
    // 冻结确认走创意门 seam（视觉确认），批准 → 重踢 driver → 首镜提交。
    await service.command('project-1', 'run-freeze', { commandId: 'freeze-f', expectedRevision: atFreeze.revision, type: 'gate.decide', payload: { gateId: 'gate-freeze-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitFor(() => service.readFull('project-1', 'run-freeze').jobs.some((job) => job.status === 'adopted' || job.status === 'submitting'))
    expect(calls).toContain('production.generate-node') // 冻结放行后才提交
    // 冻结桥只在放行前问一次（放行后 hasApprovedFreezeGate 短路）。
    expect(calls.filter((op) => op === 'production.check-frozen')).toHaveLength(1)
  })

  it('W2 冻结门：全部锚已冻结（桥回空）→ 不设冻结门，直接进首镜（回归：不平白拦住）', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
    const calls: string[] = []
    const requestRenderer = async (op: string) => {
      calls.push(op)
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'Nomi promo script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
      if (op === 'production.check-frozen') return { unfrozenAnchors: [] } // 全冻结
      if (op === 'production.generate-node') return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
      if (op === 'production.arrange') return { arranged: 1, total: 1 }
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
      runId: 'run-frozen-ok', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'codex' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 60 },
    })
    await service.command('project-1', 'run-frozen-ok', { commandId: 'direction-ok', expectedRevision: 0, type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await approveLatestScript(service, 'project-1', 'run-frozen-ok')
    await approveLatestStoryboard(service, 'project-1', 'run-frozen-ok')
    const planned = service.readFull('project-1', 'run-frozen-ok')
    const attached = await service.command('project-1', 'run-frozen-ok', {
      commandId: 'attach-ok', expectedRevision: planned.revision, type: 'plan.attach',
      payload: { artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId, bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }] }, issuedAt: new Date().toISOString(),
    })
    await service.command('project-1', 'run-frozen-ok', { commandId: 'contract-ok', expectedRevision: attached.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    // 全冻结 → 无冻结门、直接进首镜（会停在样片门，证明已越过冻结门）。
    await waitFor(() => service.readFull('project-1', 'run-frozen-ok').gates.some((gate) => gate.gateId === 'gate-sample-v1' && gate.status === 'waiting'))
    const state = service.readFull('project-1', 'run-frozen-ok')
    expect(state.gates.some((gate) => gate.gateId === 'gate-freeze-v1')).toBe(false)
    expect(calls).toContain('production.generate-node')
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
  it('blocks semantic assembly when adopted jobs have no landed artifacts', () => {
    const result = semanticGenerationReadiness({
      jobs: [{
        jobId: 'job-shot-a', stageId: 'generate', status: 'adopted', attempt: 1,
        provider: 'fixture-provider', model: 'fixture-video', idempotencyKey: 'idem-a',
        nodeId: 'node-shot-a', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
      }],
      artifacts: [],
    })

    expect(result).toMatchObject({ ready: false })
    expect((result as { reason: string }).reason).toContain('缺少已落地产物')
  })

  it('continues a semantic multi-shot batch from ready jobs through QA, timeline, and one export', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, '.nomi/out'), { recursive: true })
    fs.mkdirSync(path.join(root, 'exports'), { recursive: true })
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => '2026-08-31T00:00:00.000Z' })
    const candidates = [semanticCandidate('shot-a', 'a quiet sunrise'), semanticCandidate('shot-b', 'the camera follows the boat')]
    const contracts = candidates.map((item) => compileExecutionContract(item, semanticRegistry))
    const shots = candidates.map((item, index) => ({
      shotId: item.candidateId,
      role: 'shot' as const,
      candidate: { ...item, sealedContractHash: contracts[index].contractHash },
      contract: contracts[index],
      approvedReceiptId: 'receipt-semantic',
      updatedAt: '2026-08-31T00:00:00.000Z',
    }))
    repository.createGenerationDraft({
      operationId: 'semantic-driver-run',
      projectId: 'project-1',
      origin: { host: 'codex' },
      candidate: candidates[0],
      shots: shots.map(({ shotId, role, candidate }) => ({ shotId, role, candidate })),
      policy: { trustedHosts: ['codex'], allowedProviders: ['fixture-provider'], allowedModels: ['fixture-video'], maxSpend: 10, maxAttemptsPerJob: 1 },
    })
    const authorization = sealAndApproveProductionGeneration({
      repository,
      projectId: 'project-1',
      operationId: 'semantic-driver-run',
      immutableProjectUuid: 'project-uuid',
      projectGeneration: 1,
      projectRevision: 0,
      candidate: candidates[0],
      contract: contracts[0],
      providers: [{
        providerId: 'fixture-provider',
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
        buildRequest: (input) => input,
        submit: async () => ({ providerTaskId: 'unused' }),
      }],
      multiShot: { shots, planHash: 'semantic-plan-hash' },
      resolveShotPrice: () => ({ known: true, amount: 1 }),
      maximumSpend: 10,
      receiptId: 'receipt-semantic',
      now: '2026-08-31T00:00:00.000Z',
    })
    let run = authorization.run
    run = repository.execute('project-1', run.runId, {
      commandId: 'semantic-submit', expectedRevision: run.revision, type: 'generation.submit', payload: {}, issuedAt: run.updatedAt,
    }).run
    run = repository.execute('project-1', run.runId, {
      commandId: 'semantic-running', expectedRevision: run.revision, type: 'run.status', payload: { status: 'running' }, issuedAt: run.updatedAt,
    }).run

    // Model the scheduler's durable hand-off: each provider result is already
    // materialized as a ready artifact/job. The continuation driver, rather
    // than the adapter, owns ready -> adopted and the downstream stages.
    for (const [index, job] of run.jobs.entries()) {
      const shotId = shots[index].shotId
      run = repository.execute('project-1', run.runId, {
        commandId: `semantic-bind-${shotId}`, expectedRevision: run.revision, type: 'job.patch',
        payload: { jobId: job.jobId, patch: { nodeId: `node-${shotId}`, metadata: { shotId }, providerTaskId: `provider-${shotId}` } }, issuedAt: run.updatedAt,
      }).run
      for (const status of ['submit_intent_persisted', 'submitting', 'provider_accepted', 'ready'] as const) {
        run = repository.execute('project-1', run.runId, {
          commandId: `semantic-${shotId}-${status}`, expectedRevision: run.revision, type: 'job.status', payload: { jobId: job.jobId, status }, issuedAt: run.updatedAt,
        }).run
      }
      fs.writeFileSync(path.join(root, `.nomi/out/${shotId}.mp4`), `fixture-${shotId}`)
      run = repository.execute('project-1', run.runId, {
        commandId: `semantic-artifact-${shotId}`, expectedRevision: run.revision, type: 'artifact.add',
        payload: { artifact: { artifactId: `artifact-${shotId}`, stageId: 'generate', jobId: job.jobId, kind: 'video', status: 'ready', projectRelativePath: `.nomi/out/${shotId}.mp4`, contentHash: `hash-${shotId}`, createdAt: run.updatedAt } }, issuedAt: run.updatedAt,
      }).run
    }

    const rendererCalls: Array<{ op: string; payload: unknown }> = []
    let exportCalls = 0
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer: async (op, payload) => {
        rendererCalls.push({ op, payload })
        if (op === 'production.verify-shots') {
          const ids = (payload as { shotNodeIds: string[] }).shotNodeIds
          return { reviewedShotIds: ids, verdicts: ids.map((shotNodeId) => ({ shotNodeId, passed: true })) }
        }
        if (op === 'production.arrange') {
          return { arranged: 2, total: 2, timelineContract: { version: 1, clips: ['node-shot-a', 'node-shot-b'] } }
        }
        throw new Error(`unexpected renderer operation ${op}`)
      },
      executeProductionExport: async ({ outputName }) => {
        exportCalls += 1
        fs.writeFileSync(path.join(root, 'exports', outputName), 'fixture-export')
        return { relativePath: `exports/${outputName}`, size: 14 }
      },
    })

    await service.advanceSemanticProduction('project-1', 'semantic-driver-run')
    const roughCut = service.readFull('project-1', 'semantic-driver-run')
    expect(roughCut.status).toBe('awaiting_rough_cut_review')
    expect(roughCut.jobs.every((job) => job.status === 'adopted')).toBe(true)
    expect(roughCut.stages.find((stage) => stage.stageId === 'qa')?.status).toBe('completed')
    expect(roughCut.stages.find((stage) => stage.stageId === 'assemble')?.status).toBe('completed')
    expect(roughCut.artifacts.some((artifact) => artifact.kind === 'timeline')).toBe(true)
    expect(rendererCalls.map((call) => call.op)).toEqual(['production.verify-shots', 'production.arrange'])

    // Re-entering after the callback is safe: the status guard leaves the
    // durable revision and provider side effects unchanged.
    const roughCutRevision = roughCut.revision
    await service.advanceSemanticProduction('project-1', 'semantic-driver-run')
    expect(service.readFull('project-1', 'semantic-driver-run').revision).toBe(roughCutRevision)

    const exportGate = roughCut.gates.find((gate) => gate.scope === 'export')!
    const exportReady = await service.command('project-1', 'semantic-driver-run', {
      commandId: 'semantic-rough-cut-accept', expectedRevision: roughCut.revision, type: 'run.status',
      payload: { status: 'awaiting_export' }, issuedAt: new Date().toISOString(),
    })
    expect(exportReady.run.status).toBe('awaiting_export')
    await service.command('project-1', 'semantic-driver-run', {
      commandId: 'semantic-export-approve', expectedRevision: exportReady.run.revision, type: 'gate.decide',
      payload: { gateId: exportGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', 'semantic-driver-run').status === 'completed')
    expect(exportCalls).toBe(1)
    const completed = service.readFull('project-1', 'semantic-driver-run')
    expect(completed.stages.find((stage) => stage.stageId === 'export')?.status).toBe('completed')
    expect(completed.artifacts.some((artifact) => artifact.kind === 'export' && artifact.projectRelativePath === 'exports/nomi-semantic-driver-run.mp4')).toBe(true)

    // Same gate decision is service-idempotent and cannot launch a second export.
    const replay = await service.command('project-1', 'semantic-driver-run', {
      commandId: 'semantic-export-approve-replay', expectedRevision: completed.revision, type: 'gate.decide',
      payload: { gateId: exportGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(replay.run.revision).toBe(completed.revision)
    expect(exportCalls).toBe(1)
  })
})
