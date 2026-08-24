import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction, PRODUCTION_DRIVER_TEST_TIMEOUT_MS } from './productionRunTestHelpers'

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-driver-'))
}

const WAIT_MS = 500

describe('ProductionRunService driver round 1', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
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
    const requestRenderer = async (op: string) => {
      calls.push(op)
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'Nomi promo script' }
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
    await waitForProduction(() => service.readFull('project-1', 'run-driver-3').gates.some((gate) => gate.gateId === 'gate-sample-v1' && gate.status === 'waiting'), WAIT_MS)
    const atSample = service.readFull('project-1', 'run-driver-3')
    expect(atSample.status).toBe('running')
    expect(calls).not.toContain('production.arrange') // 样片门期间未进编排
    await service.command('project-1', 'run-driver-3', { commandId: 'sample-3', expectedRevision: atSample.revision, type: 'gate.decide', payload: { gateId: 'gate-sample-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitForProduction(() => calls.includes('production.arrange'), WAIT_MS)
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
    await waitForProduction(() => calls.includes('production.export'), WAIT_MS)
    await waitForProduction(() => service.readFull('project-1', 'run-driver-3').status === 'completed', WAIT_MS)
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
    await waitForProduction(() => service.readFull('project-1', 'run-freeze').gates.some((gate) => gate.gateId === 'gate-freeze-v1' && gate.status === 'waiting'), WAIT_MS)
    const atFreeze = service.readFull('project-1', 'run-freeze')
    const freezeGate = atFreeze.gates.find((gate) => gate.gateId === 'gate-freeze-v1')
    expect(freezeGate?.scope).toBe('stage')
    expect(freezeGate?.status).toBe('waiting')
    expect(freezeGate?.jobIds).toEqual([]) // 不授权花钱、只呈现
    expect(calls).not.toContain('production.generate-node') // 冻结门期间零 provider 调用
    expect(atFreeze.budget.actual).toBe(0)
    // 冻结确认走创意门 seam（视觉确认），批准 → 重踢 driver → 首镜提交。
    await service.command('project-1', 'run-freeze', { commandId: 'freeze-f', expectedRevision: atFreeze.revision, type: 'gate.decide', payload: { gateId: 'gate-freeze-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitForProduction(() => service.readFull('project-1', 'run-freeze').jobs.some((job) => job.status === 'adopted' || job.status === 'submitting'), 1_000)
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
    await waitForProduction(() => service.readFull('project-1', 'run-frozen-ok').gates.some((gate) => gate.gateId === 'gate-sample-v1' && gate.status === 'waiting'), 1_000)
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
    await waitForProduction(() => service.readFull('project-1', 'run-driver-recovery').jobs[0].status === 'adopted', WAIT_MS)
    expect(service.readFull('project-1', 'run-driver-recovery').artifacts.some((artifact) => artifact.kind === 'video')).toBe(true)
    expect(rendererCalls).not.toContain('production.generate-node')
  })
})
