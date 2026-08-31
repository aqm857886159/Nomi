import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { normalizeDirectionCandidates } from './productionRunDriverOps'
import { approveLatestScript, waitForProduction } from './productionRunTestHelpers'

// B1 创意方向门带方案（plan 2026-08-11-mcp-conversation-native-phase-b）：
// driver 拟 2-3 个候选挂上方向门 → 投影透出 directionCandidates → 批准带 choiceKey 留痕。
// GUI/模型不可用（拟方向失败）→ 持久化 needs_attention + 可恢复原因，不静默卡在 waiting。

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  if (!check()) throw new Error('waitFor timed out')
}

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

describe('normalizeDirectionCandidates (B1 候选清洗)', () => {
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

describe('direction gate with candidates (B1 全链)', () => {
  it('外部 MCP 草稿不重复调用 Nomi 文本模型，由外部 Agent 提交候选并落同一方向门', async () => {
    let rendererCalls = 0
    const { service } = makeService(async () => { rendererCalls += 1; throw new Error('external path must not call renderer planner') })
    const runId = 'run-external-direction-1'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: '雨夜进创作室', durationSeconds: 30 },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(rendererCalls).toBe(0)
    expect(service.readFull('project-1', runId)!.status).toBe('awaiting_direction')
    const projected = service.proposeDirectionCandidates('project-1', runId, [
      { key: 'mystery', title: '湿纸条之谜', oneLiner: '沿着纸条上的门进入同一间工作室，线索逐步揭开' },
      { key: 'warmth', title: '冷雨转暖光', oneLiner: '从霓虹冷色一路过渡到窗边清晨，把创作变成情绪出口' },
    ], 'codex')
    const gate = projected.gates.find((item) => item.gateId === 'gate-direction-v1')!
    expect(gate.directionCandidates).toHaveLength(2)
    expect(projected.status).toBe('awaiting_direction')
    expect(service.readEvents('project-1', runId, 0, 0).then((value) => value.events.some((event) => event.type === 'gate.candidates'))).resolves.toBe(true)
  })

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
      origin: { host: 'nomi' }, brief: { goal: 'direction candidates', durationSeconds: 30 },
    })

    // driver 异步拟候选并挂到方向门上。
    await waitFor(() => {
      const gate = service.readFull('project-1', runId)?.gates.find((item) => item.gateId === 'gate-direction-v1')
      return (gate?.directionCandidates?.length ?? 0) === 3
    })

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
      origin: { host: 'nomi' }, brief: { goal: 'bad choice', durationSeconds: 30 },
    })
    await waitFor(() => (service.readFull('project-1', runId)?.gates[0]?.directionCandidates?.length ?? 0) === 2)
    const current = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'approve-bad-choice', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'not-a-real-key' }, issuedAt: new Date().toISOString(),
    })
    const decided = service.readFull('project-1', runId)!.gates.find((item) => item.gateId === 'gate-direction-v1')!
    expect(decided.status).toBe('approved')
    expect(decided.decidedChoiceKey).toBeUndefined() // 假 key 不留痕
  })

  it('拟方向失败 → 持久化原因并可由 resume 重试，不伪造候选', async () => {
    let attempts = 0
    const { service } = makeService(async (op) => {
      if (op === 'production.plan-directions') {
        attempts += 1
        if (attempts === 1) throw new Error('503 model_not_found')
        return { candidates: [
          { key: 'street', title: '城市烟火气', oneLiner: 'a' },
          { key: 'studio', title: '极简产品美学', oneLiner: 'b' },
        ] }
      }
      if (op === 'production.plan-script') return { text: 'fallback script' }
      if (op === 'production.plan-storyboard') return { plan: { title: 'p', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: 'x' }] } }
      throw new Error(`unexpected op: ${op}`)
    })
    const runId = 'run-dir-3'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'nomi' }, brief: { goal: 'closed gui', durationSeconds: 30 },
    })
    // 给 driver 一点时间失败落地；失败必须可见且可恢复。
    await new Promise((resolve) => setTimeout(resolve, 30))
    const failed = service.readFull('project-1', runId)!
    const gate = failed.gates.find((item) => item.gateId === 'gate-direction-v1')!
    expect(gate.status).toBe('waiting')
    expect(gate.directionCandidates).toBeUndefined() // 没硬塞空候选
    expect(failed.status).toBe('needs_attention')
    expect(failed.attention).toMatchObject({ code: 'direction_model_unavailable', retryable: true })
    expect((await service.readEvents('project-1', runId, 0, 0)).events.some((event) => event.type === 'run.needs_attention')).toBe(true)

    // 子 agent 看到原因后选择继续；resume 重新请求 planner，仍由 planner 返回候选。
    const current = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'resume-after-direction-error', expectedRevision: current.revision, type: 'run.control',
      payload: { action: 'resume' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => (service.readFull('project-1', runId)?.gates[0]?.directionCandidates?.length ?? 0) === 2)
    const recovered = service.readFull('project-1', runId)!
    expect(recovered.status).toBe('running')
    expect(recovered.attention).toBeUndefined()
    const directionGate = recovered.gates.find((item) => item.gateId === 'gate-direction-v1')!
    await service.command('project-1', runId, {
      commandId: 'approve-after-retry', expectedRevision: recovered.revision, type: 'gate.decide',
      payload: { gateId: directionGate.gateId, status: 'approved', choiceKey: 'street' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_script_review')
    const script = service.readFull('project-1', runId)!.artifacts.find((artifact) => artifact.kind === 'script')!
    await service.command('project-1', runId, {
      commandId: 'approve-script-after-direction-retry', expectedRevision: service.readFull('project-1', runId)!.revision,
      type: 'script.review', payload: { artifactId: script.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_storyboard_review')
  })
})
