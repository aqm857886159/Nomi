import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard } from './productionRunTestHelpers'

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-driver-'))
}

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('ProductionRunService driver round 1', () => {
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
      origin: { host: 'nomi' },
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
      origin: { host: 'nomi' },
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
    let exportPayload: Record<string, unknown> | undefined
    const requestRenderer = async (op: string, payload?: unknown) => {
      calls.push(op)
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'Nomi promo script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
      if (op === 'production.generate-node') return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
      if (op === 'production.arrange') return {
        arranged: 1,
        total: 1,
        timelineContract: {
          fps: 30,
          durationFrames: 90,
          clips: [{ shotId: 'shot-1', startFrame: 0, endFrame: 90 }],
          subtitles: [],
          transitions: [],
        },
      }
      if (op === 'production.export') {
        exportPayload = payload as Record<string, unknown>
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
      runId: 'run-driver-3', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'nomi' },
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
    const exportTimeline = exportPayload?.timeline as { tracks?: Array<{ type?: string; clips?: unknown[] }> } | undefined
    expect(exportTimeline?.tracks?.find((track) => track.type === 'video')?.clips).toHaveLength(1)
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
      runId: 'run-freeze', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'nomi' },
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
    await waitFor(() => service.readFull('project-1', 'run-freeze').jobs.some((job) => job.status === 'adopted' || job.status === 'submitting'), 1_000)
    expect(calls).toContain('production.generate-node') // 冻结放行后才提交
    // 冻结桥只在放行前问一次（放行后 hasApprovedFreezeGate 短路）。
    expect(calls.filter((op) => op === 'production.check-frozen')).toHaveLength(1)
  })

  it('W2 外部 Agent：冻结校验自动留痕，不再生成额外用户确认点', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
    const calls: string[] = []
    const requestRenderer = async (op: string) => {
      calls.push(op)
      if (op === 'production.check-frozen') return { unfrozenAnchors: [{ nodeId: 'anchor-hero', title: '林夏 · 定妆' }] }
      if (op === 'production.generate-node') return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
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
      runId: 'run-external-freeze', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'codex' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 30 },
    })
    service.proposeDirectionCandidates('project-1', 'run-external-freeze', [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }])
    const direction = service.readFull('project-1', 'run-external-freeze')
    await service.command('project-1', 'run-external-freeze', { commandId: 'direction-external', expectedRevision: direction.revision, type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'a' }, issuedAt: new Date().toISOString() })
    service.proposeScriptCandidate('project-1', 'run-external-freeze', 'A concise product story')
    const scriptRun = service.readFull('project-1', 'run-external-freeze')
    const script = scriptRun.artifacts.find((item) => item.kind === 'script' && item.status === 'candidate')
    await service.command('project-1', 'run-external-freeze', { commandId: 'approve-script-external', expectedRevision: scriptRun.revision, type: 'script.review', payload: { artifactId: script?.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString() })
    const shots = Array.from({ length: 6 }, (_, index) => ({
      shotId: `shot-${index + 1}`,
      narrativeGoal: `Advance the product story beat ${index + 1}`,
      actionChain: `The maker moves from beat ${index} to beat ${index + 1}`,
      dramaticBeat: `A clear visual turn lands at beat ${index + 1}`,
      ffDesc: `Start on the stable frame for shot ${index + 1}`,
      motionDesc: `The subject performs one visible action in shot ${index + 1}`,
      lfDesc: `End with a stable frame that hands off to the next shot`,
      durationSec: 5,
      anchorIds: ['anchor-hero'],
      prompt: `A coherent cinematic product story frame for Nomi shot ${index + 1}, rainy neon studio light`,
      ...(index > 0 ? { previousShotId: `shot-${index}`, firstFrameRef: `shot-${index}-last-frame` } : {}),
      ...(index > 0 ? { transition: { type: 'dissolve', durationFrames: 8 } } : {}),
    }))
    service.proposeStoryboardCandidate('project-1', 'run-external-freeze', { title: 'Nomi promo', anchors: [{ id: 'anchor-hero', type: 'character', title: 'Hero' }], shots })
    await approveLatestStoryboard(service, 'project-1', 'run-external-freeze')
    const planned = service.readFull('project-1', 'run-external-freeze')
    const attached = await service.command('project-1', 'run-external-freeze', {
      commandId: 'attach-external', expectedRevision: planned.revision, type: 'plan.attach',
      payload: { artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId, bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }] }, issuedAt: new Date().toISOString(),
    })
    await service.command('project-1', 'run-external-freeze', { commandId: 'contract-external', expectedRevision: attached.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitFor(() => service.readFull('project-1', 'run-external-freeze').jobs.some((job) => job.status === 'adopted'), 1_000)
    const after = service.readFull('project-1', 'run-external-freeze')
    expect(after.gates.find((gate) => gate.gateId === 'gate-freeze-v1')?.status).toBe('approved')
    expect(calls).toContain('production.check-frozen')
    expect(calls).toContain('production.generate-node')
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
      runId: 'run-frozen-ok', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'nomi' },
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
    await waitFor(() => service.readFull('project-1', 'run-frozen-ok').gates.some((gate) => gate.gateId === 'gate-sample-v1' && gate.status === 'waiting'), 1_000)
    const state = service.readFull('project-1', 'run-frozen-ok')
    expect(state.gates.some((gate) => gate.gateId === 'gate-freeze-v1')).toBe(false)
    expect(calls).toContain('production.generate-node')
  })

  it('live MCP reads do not turn an in-flight submission into restart recovery', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/live.mp4'), 'video', 'utf8')
    let markGenerationStarted = () => undefined
    const generationStarted = new Promise<void>((resolve) => { markGenerationStarted = resolve })
    let releaseGeneration = () => undefined
    let released = false
    const requestRenderer = async (op: string) => {
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'Nomi promo script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
      if (op === 'production.check-frozen') return { unfrozenAnchors: [] }
      if (op === 'production.generate-node') {
        markGenerationStarted()
        // Hold the provider call open long enough for the external MCP
        // observer to poll nomi_get_run several times.
        await new Promise<void>((resolve) => {
          releaseGeneration = () => { released = true; resolve() }
          if (released) resolve()
        })
        return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/live.mp4' }] }
      }
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
      runId: 'run-live-mcp-read', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'nomi' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 30 },
    })
    await service.command('project-1', 'run-live-mcp-read', { commandId: 'direction-live', expectedRevision: 0, type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await approveLatestScript(service, 'project-1', 'run-live-mcp-read')
    await approveLatestStoryboard(service, 'project-1', 'run-live-mcp-read')
    const planned = service.readFull('project-1', 'run-live-mcp-read')
    const attached = await service.command('project-1', 'run-live-mcp-read', {
      commandId: 'attach-live', expectedRevision: planned.revision, type: 'plan.attach',
      payload: { artifactId: planned.artifacts.find((item) => item.kind === 'storyboard')?.artifactId, bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }] }, issuedAt: new Date().toISOString(),
    })
    await service.command('project-1', 'run-live-mcp-read', { commandId: 'contract-live', expectedRevision: attached.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await Promise.race([generationStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('live generation did not start')), 1_000))])

    for (let attempt = 0; attempt < 5; attempt += 1) {
      service.readProjection('project-1', 'run-live-mcp-read')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const inFlight = service.readFull('project-1', 'run-live-mcp-read')
    expect(['submitting', 'provider_accepted', 'polling']).toContain(inFlight.jobs[0]?.status)
    expect(inFlight.jobs[0]?.errorCode).not.toBe('restart_recovery_required')

    releaseGeneration()
    await waitFor(() => service.readFull('project-1', 'run-live-mcp-read').jobs[0]?.status === 'adopted', 2_000)
  })

  it('submits independent jobs in the user-selected bounded waves without duplicating requests', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    for (const name of ['a.mp4', 'b.mp4', 'c.mp4']) fs.writeFileSync(path.join(root, `assets/generated/${name}`), 'video', 'utf8')
    const started: string[] = []
    const releaseByJob = new Map<string, () => void>()
    const requestRenderer = async (op: string, payload?: unknown) => {
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'A concise product script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'Nomi promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'show Nomi' }] } }
      if (op === 'production.check-frozen') return { unfrozenAnchors: [] }
      if (op === 'production.generate-node') {
        const jobId = String((payload as Record<string, unknown>)?.jobId || '')
        started.push(jobId)
        return await new Promise<{ assets: Array<{ type: string; url: string }> }>((resolve) => {
          releaseByJob.set(jobId, () => resolve({ assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/a.mp4' }] }))
        })
      }
      if (op === 'production.verify-shots') return { verdicts: [] }
      if (op === 'production.arrange') return { arranged: 3, total: 3, timelineContract: { fps: 30, durationFrames: 90, clips: [], subtitles: [], transitions: [] } }
      throw new Error(`unexpected renderer op: ${op}`)
    }
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer,
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1, maxConcurrentJobs: 2, trustLevel: 'budget_only' }),
    })
    service.createDraft({
      runId: 'run-concurrency', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'codex' },
      brief: { goal: 'Make a truthful Nomi product promo', durationSeconds: 15 },
    })
    await waitFor(() => service.readFull('project-1', 'run-concurrency').gates.some((gate) => (gate.directionCandidates?.length || 0) >= 2), 1_000)
    let current = service.readFull('project-1', 'run-concurrency')
    await service.command('project-1', 'run-concurrency', { commandId: 'concurrency-direction', expectedRevision: current.revision, type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'a' }, issuedAt: new Date().toISOString() })
    service.proposeScriptCandidate('project-1', 'run-concurrency', 'A concise product script')
    current = service.readFull('project-1', 'run-concurrency')
    const script = current.artifacts.find((item) => item.kind === 'script' && item.status === 'candidate')
    await service.command('project-1', 'run-concurrency', { commandId: 'concurrency-script', expectedRevision: current.revision, type: 'script.review', payload: { artifactId: script?.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString() })
    service.proposeStoryboardCandidate('project-1', 'run-concurrency', {
      title: 'Nomi promo',
      anchors: [{ id: 'anchor-hero', type: 'character', title: 'Hero' }],
      shots: Array.from({ length: 6 }, (_, index) => ({
        shotId: `shot-${index + 1}`, narrativeGoal: 'Advance', actionChain: 'Visible action', dramaticBeat: 'Turn', ffDesc: 'Start', motionDesc: 'Move', lfDesc: 'End', durationSec: 5,
        anchorIds: ['anchor-hero'], prompt: `A coherent cinematic shot ${index + 1} with visible action and continuity`,
        ...(index > 0 ? { previousShotId: `shot-${index}`, firstFrameRef: `shot-${index}-tail` } : {}),
      })),
    })
    current = service.readFull('project-1', 'run-concurrency')
    const storyboard = current.artifacts.find((item) => item.kind === 'storyboard' && item.status === 'candidate')
    await service.command('project-1', 'run-concurrency', { commandId: 'concurrency-storyboard', expectedRevision: current.revision, type: 'script.review', payload: { artifactId: storyboard?.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString() })
    current = service.readFull('project-1', 'run-concurrency')
    const attached = await service.command('project-1', 'run-concurrency', {
      commandId: 'concurrency-attach', expectedRevision: current.revision, type: 'plan.attach',
      payload: { artifactId: storyboard?.artifactId, bindings: [1, 2, 3].map((index) => ({ nodeId: `shot-${index}`, provider: 'local', model: 'demo-video', stageId: 'generate', metadata: { shotId: `shot-${index}` } })) }, issuedAt: new Date().toISOString(),
    })
    await service.command('project-1', 'run-concurrency', { commandId: 'concurrency-contract', expectedRevision: attached.run.revision, type: 'gate.decide', payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString() })
    await waitFor(() => started.length >= 2, 1_000)
    expect(started).toHaveLength(2)
    releaseByJob.get(started[0])?.()
    releaseByJob.get(started[1])?.()
    await waitFor(() => started.length >= 3, 1_000)
    expect(started).toHaveLength(3)
    releaseByJob.get(started[2])?.()
    await waitFor(() => service.readFull('project-1', 'run-concurrency').jobs.every((job) => job.status === 'adopted'), 2_000)
    const final = service.readFull('project-1', 'run-concurrency')
    expect(final.jobs).toHaveLength(3)
    expect(final.jobs.every((job) => job.status === 'adopted')).toBe(true)
    expect(new Set(started).size).toBe(3)
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
    // A fresh service instance has no active driver. The same path used by
    // `nomi_get_run` may therefore perform restart recovery on its first read.
    service.readProjection('project-1', 'run-driver-recovery')
    await waitFor(() => service.readFull('project-1', 'run-driver-recovery').jobs[0]?.status === 'submission_unknown', 1_000)
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

  it('keeps a provider receipt when renderer reports a recoverable poll timeout, then reconciles without resubmitting', async () => {
    const root = makeRoot()
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/reconciled.mp4'), 'video', 'utf8')
    let generateCalls = 0
    const requestRenderer = async (op: string) => {
      if (op === 'production.check-frozen') return { unfrozenAnchors: [] }
      if (op === 'production.materialize-storyboard') {
        return {
          createdNodeIds: ['shot-1'],
          connectedCount: 0,
          bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }],
        }
      }
      if (op === 'production.generate-node') {
        generateCalls += 1
        return {
          status: 'recoverable',
          providerTaskId: 'provider-task-poll-1',
          taskKind: 'text_to_video',
          modelKey: 'demo-video',
          errorCode: 'provider_poll_recoverable',
          errorMessage: '生成超时(可找回): provider-task-poll-1',
        }
      }
      throw new Error(`unexpected renderer op: ${op}`)
    }
    const repository = createProductionRunRepository({ projectDirResolver: () => root })
    let reconcileCalls = 0
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      requestRenderer,
      sleep: async () => undefined,
      policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1, trustLevel: 'confirm_all' }),
      reconcileProviderTask: async () => {
        reconcileCalls += 1
        if (reconcileCalls === 1) throw new TypeError('fetch failed')
        return { status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/reconciled.mp4' }] }
      },
    })
    service.createDraft({
      runId: 'run-recoverable-poll', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'codex' },
      brief: { goal: 'recover a provider poll', durationSeconds: 30 },
    })
    service.proposeDirectionCandidates('project-1', 'run-recoverable-poll', [
      { key: 'a', title: '方向一', oneLiner: 'x' },
      { key: 'b', title: '方向二', oneLiner: 'y' },
    ])
    await service.command('project-1', 'run-recoverable-poll', {
      commandId: 'direction-recoverable', expectedRevision: service.readFull('project-1', 'run-recoverable-poll').revision,
      type: 'gate.decide', payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'a' }, issuedAt: new Date().toISOString(),
    })
    service.proposeScriptCandidate('project-1', 'run-recoverable-poll', '雨夜捡到一张纸条，走进工作室。')
    let current = service.readFull('project-1', 'run-recoverable-poll')
    const script = current.artifacts.find((artifact) => artifact.kind === 'script' && artifact.status === 'candidate')
    if (!script) throw new Error('script candidate missing')
    await service.command('project-1', 'run-recoverable-poll', {
      commandId: 'script-recoverable', expectedRevision: current.revision, type: 'script.review',
      payload: { artifactId: script.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString(),
    })
    const storyboardShots = Array.from({ length: 6 }, (_, index) => ({
      index: index + 1,
      shotId: index === 0 ? 'shot-1' : `shot-${index + 1}`,
      shotKind: 'video',
      durationSec: 3,
      anchorIds: ['anchor-1'],
      prompt: '雨夜人物沿着画门的湿纸条线索走进同一间温暖创作工作室',
      narrativeGoal: `推进线索 ${index + 1}`,
      actionChain: '人物移动，纸条保持在画面中，镜头平稳跟随',
      dramaticBeat: `线索变化 ${index + 1}`,
      ffDesc: '中景，雨夜冷光与人物和纸条清晰可见',
      motionDesc: '人物缓慢移动，镜头轻微推进，环境雨声连续',
      lfDesc: '人物在画面右侧停下，纸条朝向下一镜入口',
      ...(index > 0 ? { previousShotId: `shot-${index}`, firstFrameRef: `shot-${index}` } : {}),
    }))
    service.proposeStoryboardCandidate('project-1', 'run-recoverable-poll', {
      title: 'recoverable poll', anchors: [{ anchorId: 'anchor-1', title: '人物与纸条' }], shots: storyboardShots,
    })
    current = service.readFull('project-1', 'run-recoverable-poll')
    const storyboard = current.artifacts.find((artifact) => artifact.kind === 'storyboard' && artifact.status === 'candidate')
    if (!storyboard) throw new Error('storyboard candidate missing')
    await service.command('project-1', 'run-recoverable-poll', {
      commandId: 'storyboard-recoverable', expectedRevision: current.revision, type: 'artifact.review',
      payload: { artifactId: storyboard.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await service.materializeStoryboard({ projectId: 'project-1', runId: 'run-recoverable-poll', artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1 })
    current = service.readFull('project-1', 'run-recoverable-poll')
    const contract = current.gates.find((gate) => gate.scope === 'budget_envelope')
    if (!contract) throw new Error('contract gate missing')
    await service.command('project-1', 'run-recoverable-poll', {
      commandId: 'contract-recoverable', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: contract.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', 'run-recoverable-poll').gates.some((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting'), 2_000)
    current = service.readFull('project-1', 'run-recoverable-poll')
    const shotGate = current.gates.find((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting')
    if (!shotGate) throw new Error('shot gate missing')
    await service.command('project-1', 'run-recoverable-poll', {
      commandId: 'shot-recoverable', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: shotGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', 'run-recoverable-poll').jobs[0]?.status === 'submission_unknown', 2_000)
    const unknown = service.readFull('project-1', 'run-recoverable-poll')
    expect(unknown.jobs[0]).toMatchObject({
      status: 'submission_unknown', providerTaskId: 'provider-task-poll-1', errorCode: 'provider_poll_recoverable',
    })
    expect(unknown.jobs[0]?.errorCode).not.toBe('provider_task_not_found')
    expect(generateCalls).toBe(1)

    await service.command('project-1', 'run-recoverable-poll', {
      commandId: 'reconcile-recoverable', expectedRevision: unknown.revision, type: 'job.reconcile',
      payload: { jobId: unknown.jobs[0].jobId, outcome: 'found' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', 'run-recoverable-poll').jobs[0]?.status === 'adopted', 2_000)
    expect(service.readFull('project-1', 'run-recoverable-poll').jobs[0]?.status).toBe('adopted')
    expect(reconcileCalls).toBe(2)
    expect(generateCalls).toBe(1)
  })
})
