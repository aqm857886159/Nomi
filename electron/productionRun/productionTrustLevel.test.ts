import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction as waitFor } from './productionRunTestHelpers'
import { normalizeTrustLevel, trustLevelOf, DEFAULT_TRUST_LEVEL } from './productionRunTypes'
import { buildToolOutcome } from '../capabilityCore/mcpToolResults'

// B3 信任档位（plan 2026-08-11-mcp-conversation-native-phase-b）：
// key_confirm（默认）= 五门全开；budget_only（「别问了直接出」）= 自动批准创意/样片门、只留预算门（永不跳）；
// confirm_all = 每镜提交前在 Nomi 停门。降档留痕（事件 commandId 自证）。

function makeService(root: string, trackCalls: { count: number }) {
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
    policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1 }),
  })
}

/** 走到「合同已批准、driver 开始提镜」的公共前置（含方向门批准）。 */
async function driveToContract(service: ReturnType<typeof createProductionRunService>, runId: string) {
  await waitFor(() => Boolean(service.readFull('project-1', runId)?.gates.some((g) => g.gateId === 'gate-direction-v1' && g.status === 'approved')))
  await approveLatestScript(service, 'project-1', runId)
  await approveLatestStoryboard(service, 'project-1', runId)
  const planned = service.readFull('project-1', runId)!
  const storyboardId = planned.artifacts.find((a) => a.kind === 'storyboard')!.artifactId
  const attached = await service.command('project-1', runId, {
    commandId: 'attach', expectedRevision: planned.revision, type: 'plan.attach',
    payload: { artifactId: storyboardId, bindings: [
      { nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' },
      { nodeId: 'shot-2', provider: 'local', model: 'demo-video', stageId: 'generate' },
    ] },
    issuedAt: new Date().toISOString(),
  })
  await service.command('project-1', runId, {
    commandId: 'contract', expectedRevision: attached.run.revision, type: 'gate.decide',
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
  it('budget_only：草稿建好即自动批准方向门（留痕）+ 跳样片门，但预算门仍在等', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-budgetonly-'))
    const calls = { count: 0 }
    const service = makeService(root, calls)
    const runId = 'run-trust-1'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'budget only', durationSeconds: 30 },
      policy: { trustLevel: 'budget_only' },
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

    // 首镜提交后不设样片门（budget_only 跳）；直接批量到粗剪。
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    const done = service.readFull('project-1', runId)!
    expect(done.gates.some((g) => g.gateId === 'gate-sample-v1')).toBe(false) // 样片门被跳过
    expect(calls.count).toBe(2) // 两镜连提，无样片门中断
    expect(done.trustLevel ?? trustLevelOf(done.policy)).toBe('budget_only')
  })

  it('key_confirm（默认）：方向门有候选、样片门在首镜后停——五门全开', async () => {
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
      commandId: 'approve-direction', expectedRevision: beforeApprove.revision, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'a' }, issuedAt: new Date().toISOString(),
    })
    await driveToContract(service, runId)
    // 首镜后样片门停（key_confirm 要门）。
    await waitFor(() => service.readFull('project-1', runId)!.gates.some((g) => g.gateId === 'gate-sample-v1' && g.status === 'waiting'))
    expect(calls.count).toBe(1) // 窗口化：只提了镜 1
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

    // 用户：「别问了直接出」→ set_trust budget_only。
    await service.command('project-1', runId, {
      commandId: 'set-trust-1', expectedRevision: atDirection.revision, type: 'run.control',
      payload: { action: 'set_trust', trustLevel: 'budget_only' }, issuedAt: new Date().toISOString(),
    })

    // 档位落 policy + 方向门被顺手自动批准（留痕）。
    await waitFor(() => service.readFull('project-1', runId)!.gates.find((g) => g.gateId === 'gate-direction-v1')!.status === 'approved')
    const after = service.readFull('project-1', runId)!
    expect(trustLevelOf(after.policy)).toBe('budget_only')
    const events = await service.readEvents('project-1', runId, 0, 0)
    expect(events.events.some((event) => event.type === 'gate.decided' && (event.commandId || '').startsWith('auto-trust-budget-only:gate-direction-'))).toBe(true)

    // 降档后 run 一路自动跑到粗剪（无样片门中断）。
    await driveToContract(service, runId)
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    expect(service.readFull('project-1', runId)!.gates.some((g) => g.gateId === 'gate-sample-v1')).toBe(false)
  })

  it('set_trust 转述带新档位与后果（budget_only：创意/样片门自动过、预算门仍在）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-narrate-'))
    const service = makeService(root, { count: 0 })
    const runId = 'run-trust-4'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'narration', durationSeconds: 30 },
      policy: { trustLevel: 'budget_only' },
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
