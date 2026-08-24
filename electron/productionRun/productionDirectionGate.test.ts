import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { normalizeDirectionCandidates } from './productionRunDriverOps'
import { approveLatestScript, waitForProduction, PRODUCTION_DRIVER_TEST_TIMEOUT_MS } from './productionRunTestHelpers'

// B1 创意方向门带方案（plan 2026-08-11-mcp-conversation-native-phase-b）：
// driver 拟 2-3 个候选挂上方向门 → 投影透出 directionCandidates → 批准带 choiceKey 留痕。
// GUI 关着（拟方向失败）→ 保持现状 gate 兜底，不硬塞空候选、不炸主流程。

const WAIT_MS = 3000

function makeService(requestRenderer: (op: string) => Promise<unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-direction-gate-'))
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer: async (op) => requestRenderer(op),
    policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1 }),
  })
  return { service, root }
}

describe('normalizeDirectionCandidates (B1 候选清洗)', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('保留 2-3 个合法候选、截断超长、补齐缺失 key', () => {
    const out = normalizeDirectionCandidates([
      { key: 'a', title: 'A 城市烟火气', oneLiner: '清晨街市的陪伴感' },
      { title: 'B 极简', oneLiner: '棚拍大光比' }, // 无 key → 补 dir-2
    ])
    expect(out).toHaveLength(2)
    expect(out[0].key).toBe('a')
    expect(out[1].key).toBe('dir-2')
  })

  it('少于两个可用候选 → 抛错（触发兜底 gate）', () => {
    expect(() => normalizeDirectionCandidates([{ key: 'a', title: 'only one', oneLiner: 'x' }])).toThrow()
    expect(() => normalizeDirectionCandidates([])).toThrow()
    expect(() => normalizeDirectionCandidates('nope')).toThrow()
  })
})

describe('direction gate with candidates (B1 全链)', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('草稿建好 → driver 拟候选挂门 → 投影透出 → 批准带 choiceKey 留痕', async () => {
    const { service } = makeService(async (op) => {
      if (op === 'production.plan-directions') {
        return { candidates: [
          { key: 'street', title: '城市烟火气', oneLiner: '小满穿行清晨街市，蒸汽与霓虹里的陪伴感' },
          { key: 'studio', title: '极简产品美学', oneLiner: '棚拍大光比，材质与线条特写' },
          { key: 'montage', title: '快节奏踩点混剪', oneLiner: '鼓点卡切，15 个场景闪回' },
        ] }
      }
      if (op === 'production.plan-script') return { text: 'direction script' }
      if (op === 'production.plan-storyboard') {
        return { plan: { title: 'promo', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'shot one' }] } }
      }
      throw new Error(`unexpected op: ${op}`)
    })
    const runId = 'run-dir-1'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'direction candidates', durationSeconds: 30 },
    })

    // driver 异步拟候选并挂到方向门上。
    await waitForProduction(() => {
      const gate = service.readFull('project-1', runId)?.gates.find((item) => item.gateId === 'gate-direction-v1')
      return (gate?.directionCandidates?.length ?? 0) === 3
    }, WAIT_MS)

    // 投影透出候选（经 sanitizer），供 MCP 转述。
    const projection = service.readProjection('project-1', runId)
    const projGate = projection.gates.find((item) => item.gateId === 'gate-direction-v1')!
    expect(projGate.directionCandidates?.map((candidate) => candidate.key)).toEqual(['street', 'studio', 'montage'])
    expect(projGate.directionCandidates?.[0].oneLiner).toContain('清晨街市')

    // gate.candidates 事件是重要事件（会经 subscribe 透出）。
    const events = await service.readEvents('project-1', runId, 0, 0)
    expect(events.events.some((event) => event.type === 'gate.candidates')).toBe(true)

    // 批准并带用户选中的 choiceKey → 留痕进 gate（decidedChoiceKey）。
    const current = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'approve-direction', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'studio' }, issuedAt: new Date().toISOString(),
    })
    const decided = service.readFull('project-1', runId)!.gates.find((item) => item.gateId === 'gate-direction-v1')!
    expect(decided.status).toBe('approved')
    expect(decided.decidedChoiceKey).toBe('studio')
    expect(service.readFull('project-1', runId)!.stages.find((stage) => stage.stageId === 'direction')).toMatchObject({
      status: 'completed',
      completedAt: expect.any(String),
    })

    // 方向批准后 driver 真提分镜案（run 走到分镜审阅）。
    await approveLatestScript(service, 'project-1', runId)
    await waitForProduction(() => service.readFull('project-1', runId)!.status === 'awaiting_storyboard_review')
  })

  it('不属于本门的 choiceKey 被丢弃（不留痕假选择）', async () => {
    const { service } = makeService(async (op) => {
      if (op === 'production.plan-directions') {
        return { candidates: [
          { key: 'street', title: '城市烟火气', oneLiner: 'a' },
          { key: 'studio', title: '极简产品美学', oneLiner: 'b' },
        ] }
      }
      if (op === 'production.plan-script') return { text: 'direction script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'p', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'x' }] } }
      throw new Error(`unexpected op: ${op}`)
    })
    const runId = 'run-dir-2'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'bad choice', durationSeconds: 30 },
    })
    await waitForProduction(() => (service.readFull('project-1', runId)?.gates[0]?.directionCandidates?.length ?? 0) === 2, WAIT_MS)
    const current = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'approve-bad-choice', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'not-a-real-key' }, issuedAt: new Date().toISOString(),
    })
    const decided = service.readFull('project-1', runId)!.gates.find((item) => item.gateId === 'gate-direction-v1')!
    expect(decided.status).toBe('approved')
    expect(decided.decidedChoiceKey).toBeUndefined() // 假 key 不留痕
  })

  it('GUI 关着拟方向失败 → 方向门保持兜底（无候选），仍可正常批准', async () => {
    const { service } = makeService(async (op) => {
      if (op === 'production.plan-directions') throw new Error('renderer unavailable (Nomi closed)')
      if (op === 'production.plan-script') return { text: 'fallback script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'p', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'x' }] } }
      throw new Error(`unexpected op: ${op}`)
    })
    const runId = 'run-dir-3'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'closed gui', durationSeconds: 30 },
    })
    // 给 driver 一点时间失败落地（不应改任何状态）。
    await new Promise((resolve) => setTimeout(resolve, 30))
    const gate = service.readFull('project-1', runId)!.gates.find((item) => item.gateId === 'gate-direction-v1')!
    expect(gate.status).toBe('waiting')
    expect(gate.directionCandidates).toBeUndefined() // 没硬塞空候选
    expect(service.readFull('project-1', runId)!.status).toBe('awaiting_direction') // 主流程未受影响

    // 无候选时仍能批准（不带 choiceKey），driver 照常提分镜。
    const current = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'approve-fallback', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await approveLatestScript(service, 'project-1', runId)
    await waitForProduction(() => service.readFull('project-1', runId)!.status === 'awaiting_storyboard_review')
  })
})
