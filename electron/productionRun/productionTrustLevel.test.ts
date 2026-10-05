import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, finishLegacyGenerationJobs, waitForProduction as waitFor } from './productionRunTestHelpers'
import { normalizeTrustLevel, trustLevelOf, DEFAULT_TRUST_LEVEL } from './productionRunTypes'
import { buildToolOutcome } from '../capabilityCore/mcpToolResults'

// B3 信任档位（plan 2026-08-11-mcp-conversation-native-phase-b）：
// key_confirm（默认）= 五门全开；budget_only（「别问了直接出」）= 自动批准创意/样片门、只留预算门（永不跳）；
// confirm_all = 每镜提交前在 Nomi 停门。降档留痕（事件 commandId 自证）。
// 2026-10-05 发动机收敛第一刀第 4 步：旧剧本那台生成写手（派发 production.generate-node、建样片门 / 逐镜门）已删；
// 「生成完成」由夹具落进账本（finishLegacyGenerationJobs），这里只验档位与门的关系——预算门任何档位都不跳、
// 自动批准永远碰不到付费门（旧 Run 里仍可能挂着逐镜门）。

function makeService(root: string, trackCalls: { count: number }, userTrustLevel?: 'key_confirm' | 'budget_only' | 'confirm_all') {
  fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
  fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
  const requestRenderer = async (op: string) => {
    if (op === 'production.plan-directions') {
      return { candidates: [
        { key: 'a', title: '方向一', oneLiner: 'x' },
        { key: 'b', title: '方向二', oneLiner: 'y' },
      ] }
    }
    if (op === 'production.plan-script') return { text: 'trust level script' }
    if (op === 'production.plan-storyboard') {
      return { plan: { title: 'promo', anchors: [], shots: [
        { index: 1, shotKind: 'video', prompt: 'shot one' },
        { index: 2, shotKind: 'video', prompt: 'shot two' },
      ] } }
    }
    if (op === 'production.generate-node') {
      trackCalls.count += 1
      return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
    }
    if (op === 'production.arrange') return { arranged: 2, total: 2 }
    throw new Error(`unexpected renderer op: ${op}`)
  }
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  return createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer,
    // 用户自己的档位设置（不是调用方在 payload 里自报的那一个）。
    policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1, ...(userTrustLevel ? { trustLevel: userTrustLevel } : {}) }),
  })
}

/** 走到「镜头已经生成、合同已批准」的公共前置（含方向门批准）。 */
async function driveToContract(service: ReturnType<typeof createProductionRunService>, runId: string) {
  await waitFor(() => Boolean(service.readFull('project-1', runId)?.gates.some((g) => g.gateId === 'gate-direction-v1' && g.status === 'approved')))
  await approveLatestScript(service, 'project-1', runId)
  await approveLatestStoryboard(service, 'project-1', runId)
  const planned = service.readFull('project-1', runId)!
  const storyboardId = planned.artifacts.find((a) => a.kind === 'storyboard')!.artifactId
  await service.command('project-1', runId, {
    commandId: 'attach', expectedRevision: planned.revision, type: 'plan.attach',
    payload: { artifactId: storyboardId, bindings: [
      { nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' },
      { nodeId: 'shot-2', provider: 'local', model: 'demo-video', stageId: 'generate' },
    ] },
    issuedAt: new Date().toISOString(),
  })
  finishLegacyGenerationJobs(service, 'project-1', runId)
  await service.command('project-1', runId, {
    commandId: 'contract', expectedRevision: service.readFull('project-1', runId)!.revision, type: 'gate.decide', humanGesture: true,
    payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
  })
}

describe('normalizeTrustLevel / trustLevelOf (B3 收口)', () => {
  it('合法档位原样保留；非法/缺省收敛到默认 key_confirm', () => {
    expect(normalizeTrustLevel('budget_only')).toBe('budget_only')
    expect(normalizeTrustLevel('confirm_all')).toBe('confirm_all')
    expect(normalizeTrustLevel('key_confirm')).toBe('key_confirm')
    expect(normalizeTrustLevel('garbage')).toBe(DEFAULT_TRUST_LEVEL)
    expect(normalizeTrustLevel(undefined)).toBe('key_confirm')
    expect(normalizeTrustLevel(null)).toBe('key_confirm')
    // 老 run 文件无字段 → 读作默认（向后兼容）。
    expect(trustLevelOf({ trustLevel: undefined })).toBe('key_confirm')
    expect(trustLevelOf({ trustLevel: 'budget_only' })).toBe('budget_only')
  })

})

describe('trust level gate-skip matrix (B3 · 预算门永不跳)', () => {
  it('budget_only：草稿建好即自动批准方向门（留痕），但预算门仍在等', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-budgetonly-'))
    const calls = { count: 0 }
    // 2026-09-21：档位来自**用户的设置**，不再是调用方在 createDraft payload 里自报的那一个。
    const service = makeService(root, calls, 'budget_only')
    const runId = 'run-trust-1'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'budget only', durationSeconds: 30 },
    })

    // 方向门被自动批准（不拟候选、不打扰），driver 直接推进到分镜。
    await waitFor(() => service.readFull('project-1', runId)!.gates.some((g) => g.gateId === 'gate-direction-v1' && g.status === 'approved'))
    const directionGate = service.readFull('project-1', runId)!.gates.find((g) => g.gateId === 'gate-direction-v1')!
    expect(directionGate.directionCandidates).toBeUndefined() // budget_only 不拟候选

    // 留痕：自动批准走专用 commandId，事件流可查证「按档位自动批准」。
    const events = await service.readEvents('project-1', runId, 0, 0)
    expect(events.events.some((event) => event.type === 'gate.decided' && (event.commandId || '').startsWith('auto-trust-budget-only:'))).toBe(true)

    // 走到合同门（预算门）：driver 不会自动批它——预算门任何档位都不跳。
    await driveToContract(service, runId)

    // 合同（预算门）是人批的；之后到粗剪。没有任何一笔经渲染层派发。
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    const done = service.readFull('project-1', runId)!
    expect(done.gates.find((g) => g.gateId === 'gate-contract-v1')?.status).toBe('approved')
    expect(calls.count).toBe(0)
    expect(done.trustLevel ?? trustLevelOf(done.policy)).toBe('budget_only')
  })

  it('key_confirm（默认）：方向门有候选、不自动批；粗剪后导出门照样等人', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-keyconfirm-'))
    const calls = { count: 0 }
    const service = makeService(root, calls)
    const runId = 'run-trust-2'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'default gates', durationSeconds: 30 },
      // 不传 trustLevel → 默认 key_confirm。
    })
    // 方向门拟出候选（不自动批）。
    await waitFor(() => (service.readFull('project-1', runId)?.gates.find((g) => g.gateId === 'gate-direction-v1')?.directionCandidates?.length ?? 0) === 2)
    const beforeApprove = service.readFull('project-1', runId)!
    expect(beforeApprove.gates.find((g) => g.gateId === 'gate-direction-v1')!.status).toBe('waiting') // 没被自动批
    // 手动批准方向门。
    await service.command('project-1', runId, {
      commandId: 'approve-direction', expectedRevision: beforeApprove.revision, type: 'gate.decide', humanGesture: true,
      payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'a' }, issuedAt: new Date().toISOString(),
    })
    await driveToContract(service, runId)
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    expect(service.readFull('project-1', runId)!.gates.find((g) => g.scope === 'export')?.status).toBe('waiting')
    expect(calls.count).toBe(0)
  })
})

describe('set_trust 对话改档 (B3 · 降档留痕 + 立即生效)', () => {
  it('卡在方向门时降 budget_only → 该门自动批准（留痕）并推进', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-settrust-'))
    const calls = { count: 0 }
    const service = makeService(root, calls)
    const runId = 'run-trust-3'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'downgrade mid-run', durationSeconds: 30 },
    })
    // 停在方向门（有候选，等确认）。
    await waitFor(() => (service.readFull('project-1', runId)?.gates.find((g) => g.gateId === 'gate-direction-v1')?.directionCandidates?.length ?? 0) === 2)
    const atDirection = service.readFull('project-1', runId)!
    expect(atDirection.gates.find((g) => g.gateId === 'gate-direction-v1')!.status).toBe('waiting')

    // 用户：「别问了直接出」→ set_trust budget_only。2026-09-21 起**任何**往 budget_only 的降档
    // 都要一次真人答过的确认（Nomi 窗口里的手势章，或一张收据）——「全自动档要不要开」是用户的决定。
    await service.command('project-1', runId, {
      commandId: 'set-trust-1', expectedRevision: atDirection.revision, type: 'run.control', humanGesture: true,
      payload: { action: 'set_trust', trustLevel: 'budget_only' }, issuedAt: new Date().toISOString(),
    })

    // 档位落 policy + 方向门被顺手自动批准（留痕）。
    await waitFor(() => service.readFull('project-1', runId)!.gates.find((g) => g.gateId === 'gate-direction-v1')!.status === 'approved')
    const after = service.readFull('project-1', runId)!
    expect(trustLevelOf(after.policy)).toBe('budget_only')
    const events = await service.readEvents('project-1', runId, 0, 0)
    expect(events.events.some((event) => event.type === 'gate.decided' && (event.commandId || '').startsWith('auto-trust-budget-only:gate-direction-'))).toBe(true)

    // 降档后 run 一路跑到粗剪。
    await driveToContract(service, runId)
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    expect(calls.count).toBe(0)
  })

  // 2026-09-10 根因回归闸：set_trust 只能由**客户端工具调用**发起（渲染层 IPC 把 run.control 收窄成
  // pause/resume/cancel，递不进 trustLevel）。原实现在降到 budget_only 时会顺手自动批准正在等待的
  // 逐镜门——那是付费门，批准即放行 provider 调用。等于一次工具调用替真人授权了一次扣费。
  //
  // 21:00 拍板后加严：confirm_all → budget_only 本身就是「以后这些镜头不再问你」= 一次付费放行，
  // 因此**没有人证时连降档都不许发生**；带了人证降档生效，但正在等待的那道逐镜付费门仍原样等着
  // （自动批准永远碰不到付费门——两条不变量各管各的，不许互相顶替）。
  it('budget_only 无收据无手势 → 拒；带手势降档生效但逐镜付费门仍原样等着', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-shot-'))
    const calls = { count: 0 }
    const service = makeService(root, calls)
    const runId = 'run-trust-shot'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'shot gate', durationSeconds: 30 },
      // confirm_all 是**收紧**（问得更多），调用方照样可以声明。
      policy: { trustLevel: 'confirm_all' },
    })
    await waitFor(() => Boolean(service.readFull('project-1', runId)?.gates.some((g) => g.gateId === 'gate-direction-v1' && g.status === 'waiting')))
    const atDirection = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'direction-shot', expectedRevision: atDirection.revision, type: 'gate.decide', humanGesture: true,
      payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'a' }, issuedAt: new Date().toISOString(),
    })
    await driveToContract(service, runId)
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    // 旧版本留下的一道还在等的逐镜付费门（旧剧本写手当年在每镜提交前建它；那段派发已删，旧 Run 里还可能挂着）。
    const beforeShot = service.readFull('project-1', runId)!
    const shotJob = beforeShot.jobs.find((job) => job.stageId === 'generate')!
    service.repository.execute('project-1', runId, { commandId: 'legacy-shot-gate', expectedRevision: beforeShot.revision, type: 'gate.add', issuedAt: new Date().toISOString(),
      payload: { gate: { gateId: `gate-shot-v${beforeShot.planVersion}-legacy-1`, scope: 'job_set', status: 'waiting', planHash: 'legacy-shot', jobIds: [shotJob.jobId], title: 'Approve shot before provider submission', summary: 'legacy', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() } } })
    const atShot = service.readFull('project-1', runId)!
    const shotGate = atShot.gates.find((g) => g.gateId.startsWith('gate-shot-') && g.status === 'waiting')!
    const submissionsBefore = calls.count

    // ① 无收据、无手势 → 拒（fail-closed）。档位一动不动。
    await expect(service.command('project-1', runId, {
      commandId: 'set-trust-shot-bare', expectedRevision: atShot.revision, type: 'run.control',
      payload: { action: 'set_trust', trustLevel: 'budget_only' }, issuedAt: new Date().toISOString(),
    })).rejects.toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
    expect(trustLevelOf(service.readFull('project-1', runId)!.policy)).toBe('confirm_all')

    // ② Nomi 窗口里的真人手势章 → 降档生效。
    await service.command('project-1', runId, {
      commandId: 'set-trust-shot', expectedRevision: atShot.revision, type: 'run.control', humanGesture: true,
      payload: { action: 'set_trust', trustLevel: 'budget_only' }, issuedAt: new Date().toISOString(),
    })

    await waitFor(() => trustLevelOf(service.readFull('project-1', runId)!.policy) === 'budget_only')
    const after = service.readFull('project-1', runId)!
    expect(after.gates.find((g) => g.gateId === shotGate.gateId)!.status).toBe('waiting')
    expect(calls.count).toBe(submissionsBefore)
    const events = await service.readEvents('project-1', runId, 0, 0)
    expect(events.events.some((event) => event.type === 'gate.decided'
      && (event.commandId || '').startsWith('auto-trust-budget-only:gate-shot-'))).toBe(false)
  })

  it('set_trust 转述带新档位与后果（budget_only：创意/样片门自动过、预算门仍在）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-narrate-'))
    const service = makeService(root, { count: 0 }, 'budget_only')
    const runId = 'run-trust-4'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'narration', durationSeconds: 30 },
    })
    const projection = service.readProjection('project-1', runId)
    const outcome = buildToolOutcome('nomi_run_control', { projectId: 'project-1', runId, action: 'set_trust', trustLevel: 'budget_only' }, projection, 'zh-CN')
    expect(outcome.text).toContain('信任档位已改为')
    expect(outcome.text).toContain('预算门仍会请示')
    expect(outcome.outcome).toMatchObject({ action: 'set_trust', trustLevel: 'budget_only' })
    // 英文侧同样双语可用。
    const outcomeEn = buildToolOutcome('nomi_run_control', { projectId: 'project-1', runId, action: 'set_trust', trustLevel: 'budget_only' }, projection, 'en')
    expect(outcomeEn.text).toContain('Trust level set to')
    expect(outcomeEn.text).toContain('budget gate still asks')
  })
})

// 2026-09-21 真机复现的两扇门：调用方自报的信任档不得自证。
// ① `production.start` 带 trustLevel: 'budget_only' → 200，方向门在 run 创建的同一刻被批掉，没人看见过。
// ② 同一个进程也能直接 `production.control set_trust budget_only`——从 key_confirm 降档当时一份证据都不要。
// 规则（用户 09-21）：只有「花钱 / 撤不回 / 全自动档」由用户的设置或授权决定要不要问，
// 外部入口不能靠一个参数把门批掉。
describe('调用方自报的信任档不得自证（09-21 真机复现的审批旁路）', () => {
  it('① 建 Run 时声明比用户默认更松的档位 → 拒，并指向真的会问人的那条路', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-selfdeclared-'))
    const service = makeService(root, { count: 0 }) // 用户没开全自动 → 默认 key_confirm
    expect(() => service.createDraft({
      runId: 'run-trust-bypass', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'bypass', durationSeconds: 30 },
      policy: { trustLevel: 'budget_only' },
    })).toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
    // Run 根本没建起来：没有半个「门已批准」的草稿留在盘上。
    expect(() => service.readFull('project-1', 'run-trust-bypass')).toThrowError(/Production run not found/)
  })

  it('① 收紧（confirm_all）照收——多问永远不需要授权', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-tighten-'))
    const service = makeService(root, { count: 0 })
    const projection = service.createDraft({
      runId: 'run-trust-tighten', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'tighten', durationSeconds: 30 },
      policy: { trustLevel: 'confirm_all' },
    })
    expect(projection.runId).toBe('run-trust-tighten')
    expect(trustLevelOf(service.readFull('project-1', 'run-trust-tighten')!.policy)).toBe('confirm_all')
  })

  it('② 从 key_confirm 直接 set_trust budget_only 且无手势无收据 → 拒（这一格以前一份证据都不要）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-bare-downgrade-'))
    const service = makeService(root, { count: 0 })
    const runId = 'run-trust-bare'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'bare downgrade', durationSeconds: 30 },
    })
    await waitFor(() => Boolean(service.readFull('project-1', runId)?.gates.some((g) => g.gateId === 'gate-direction-v1' && g.status === 'waiting')))
    const current = service.readFull('project-1', runId)!
    await expect(service.command('project-1', runId, {
      commandId: 'bare-downgrade', expectedRevision: current.revision, type: 'run.control',
      payload: { action: 'set_trust', trustLevel: 'budget_only' }, issuedAt: new Date().toISOString(),
    })).rejects.toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
    // 档位没动，方向门也没被顺手批掉。
    const after = service.readFull('project-1', runId)!
    expect(trustLevelOf(after.policy)).toBe('key_confirm')
    expect(after.gates.find((g) => g.gateId === 'gate-direction-v1')!.status).toBe('waiting')
  })
})
