import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction, PRODUCTION_DRIVER_TEST_TIMEOUT_MS } from './productionRunTestHelpers'

// B4 gate.decide 幂等 + 并发（plan 2026-08-11-mcp-conversation-native-phase-b）：
// 两个审批同时来（异 commandId、同决议）不再互相炸——同决议重复 = 幂等 no-op（返回当前态），
// 只有「翻决议」（approved→rejected 或反之）才拒。两个 run 的门各自独立可决，互不覆盖。

const WAIT_MS = 4000

function makeService(root: string) {
  fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
  fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
  const requestRenderer = async (op: string) => {
    if (op === 'production.plan-directions') {
      return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
    }
    if (op === 'production.plan-script') return { text: 'idempotency script' }
    if (op === 'production.plan-storyboard') {
      return { plan: { title: 'promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'shot one' }] } }
    }
    if (op === 'production.generate-node') return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
    if (op === 'production.arrange') return { arranged: 1, total: 1 }
    throw new Error(`unexpected renderer op: ${op}`)
  }
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer,
    policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1 }),
  })
  return service
}

/** 建一个 budget_only 草稿（自动过方向门），停在合同门（预算门 waiting）。 */
async function draftAtContractGate(service: ReturnType<typeof createProductionRunService>, runId: string) {
  service.createDraft({
    runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' }, brief: { goal: 'idempotency', durationSeconds: 30 },
    policy: { trustLevel: 'budget_only' },
  })
  await approveLatestScript(service, 'project-1', runId)
  await approveLatestStoryboard(service, 'project-1', runId)
  const planned = service.readFull('project-1', runId)!
  const storyboardId = planned.artifacts.find((a) => a.kind === 'storyboard')!.artifactId
  await service.command('project-1', runId, {
    commandId: 'attach', expectedRevision: planned.revision, type: 'plan.attach',
    payload: { artifactId: storyboardId, bindings: [{ nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' }] },
    issuedAt: new Date().toISOString(),
  })
  await waitForProduction(() => service.readFull('project-1', runId)!.gates.some((g) => g.gateId === 'gate-contract-v1' && g.status === 'waiting'), WAIT_MS)
}

describe('gate.decide idempotency (B4)', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('异 commandId、同决议重复 approve 已决门 = 幂等 no-op（不抛、返回当前态）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-gate-idem-'))
    const service = makeService(root)
    const runId = 'run-idem-1'
    await draftAtContractGate(service, runId)

    const atGate = service.readFull('project-1', runId)!
    const first = await service.command('project-1', runId, {
      commandId: 'decide-A', expectedRevision: atGate.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(first.run.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('approved')

    // 第二次（新 commandId、拿最新 revision）：门已 approved → 不再抛「already decided」，幂等返回。
    const afterFirst = service.readFull('project-1', runId)!
    const second = await service.command('project-1', runId, {
      commandId: 'decide-B', expectedRevision: afterFirst.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(second.run.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('approved')
    // 幂等 = 短路返回、不执行：第二次不产生任何事件（异 commandId 却不炸；不执行 = 不重复授权预算）。
    // （run 是 budget_only，合同批准后 driver 会异步续跑改变 revision——所以查「无新事件」而非 revision 稳定。）
    expect(second.events).toEqual([])
    // 决议事件全局只发过一次（幂等没重复留痕）。
    const events = await service.readEvents('project-1', runId, 0, 0)
    expect(events.events.filter((e) => e.type === 'gate.decided' && e.commandId === 'decide-A')).toHaveLength(1)
    expect(events.events.some((e) => e.type === 'gate.decided' && e.commandId === 'decide-B')).toBe(false)
  })

  it('翻决议（已 approved 再 reject）仍拒——不静默改写已批准的门', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-gate-flip-'))
    const service = makeService(root)
    const runId = 'run-idem-2'
    await draftAtContractGate(service, runId)

    const atGate = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'approve', expectedRevision: atGate.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    const afterApprove = service.readFull('project-1', runId)!
    await expect(service.command('project-1', runId, {
      commandId: 'flip-reject', expectedRevision: afterApprove.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'rejected' }, issuedAt: new Date().toISOString(),
    })).rejects.toThrow(/already decided/i)
    // 门仍是 approved（翻决议被拒，不改写）。
    expect(service.readFull('project-1', runId)!.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('approved')
  })

  it('同 commandId 重放仍幂等（既有保证不回归）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-gate-replay-'))
    const service = makeService(root)
    const runId = 'run-idem-3'
    await draftAtContractGate(service, runId)

    const atGate = service.readFull('project-1', runId)!
    const cmd = {
      commandId: 'same-id', expectedRevision: atGate.revision, type: 'gate.decide' as const,
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    }
    const first = await service.command('project-1', runId, cmd)
    const second = await service.command('project-1', runId, cmd)
    // 同 commandId → 第二次回放第一次的事件（同 eventId），不产生新决议事件。
    expect(second.events.map((e) => (e as { eventId: string }).eventId))
      .toEqual(first.events.map((e) => (e as { eventId: string }).eventId))
    expect(service.readFull('project-1', runId)!.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('approved')
  })
})

describe('two runs decide independently (B4 并发不互相覆盖)', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('两个 run 各自停在合同门 → 分别批准 → 互不影响', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-two-runs-'))
    const service = makeService(root)
    const runA = 'run-conc-a'
    const runB = 'run-conc-b'
    await draftAtContractGate(service, runA)
    await draftAtContractGate(service, runB)

    // 两个门同时 waiting。
    expect(service.readFull('project-1', runA)!.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('waiting')
    expect(service.readFull('project-1', runB)!.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('waiting')

    // 批准 A → B 不受影响（仍 waiting）。
    const atA = service.readFull('project-1', runA)!
    await service.command('project-1', runA, {
      commandId: 'approve-a', expectedRevision: atA.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(service.readFull('project-1', runA)!.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('approved')
    expect(service.readFull('project-1', runB)!.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('waiting')

    // 再批准 B → 各自独立完成。
    const atB = service.readFull('project-1', runB)!
    await service.command('project-1', runB, {
      commandId: 'approve-b', expectedRevision: atB.revision, type: 'gate.decide',
      payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(service.readFull('project-1', runB)!.gates.find((g) => g.gateId === 'gate-contract-v1')!.status).toBe('approved')
  })
})
