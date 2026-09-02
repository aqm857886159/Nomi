import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import { createProductionRunRepository } from '../productionRun/productionRunRepository'
import { createProductionRunService } from '../productionRun/productionRunService'

// A7 真实任务旅程（R16 · plan 2026-08-11-mcp-conversation-native-p0）：
// 协议层 + 真 ProductionRunService（真持久化 run 仓库）走通「接住 → 进度 → 控制 → 状态 → 事件」，
// 断言用户在 CLI 里真正读到的 text 与模型依赖的 structuredContent.nomiOutcome。
// 只有传输是注入的（send 收帧、invoke 走真 service）——与获批样张壹/肆/陆幕逐项对应。

type RpcFrame = {
  jsonrpc?: string
  id?: unknown
  method?: string
  params?: Record<string, unknown>
  result?: {
    content?: Array<{ type: string; text: string }>
    structuredContent?: { nomiOutcome?: Record<string, unknown> }
    isError?: boolean
  }
}

function makeJourney() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-journey-'))
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    // 方向门先拟候选（B1 · production.plan-directions），批准后 driver 真提分镜案（production.plan-storyboard）。
    requestRenderer: async (op: string) => {
      if (op === 'production.plan-directions') {
        return { candidates: [
          { key: 'street', title: '城市烟火气', oneLiner: '小满穿行清晨街市，蒸汽与霓虹里的陪伴感' },
          { key: 'studio', title: '极简产品美学', oneLiner: '棚拍大光比，材质与线条特写' },
          { key: 'montage', title: '快节奏踩点混剪', oneLiner: '鼓点卡切，15 个场景闪回' },
        ] }
      }
      if (op === 'production.plan-script') return { text: '剧本：雨夜里，小满在街市找回走失的小猫。' }
      if (op === 'production.materialize-storyboard') return {
        createdNodeIds: ['canvas-shot-1'], connectedCount: 0,
        bindings: [{ nodeId: 'canvas-shot-1', stageId: 'generate', provider: 'local', model: 'demo-video' }],
      }
      return {
        text: '已完成分镜规划',
        plan: { title: '品牌宣传片', anchors: [], shots: [{ index: 1, shotKind: 'video', prompt: '清晨街市蒸汽中的小满' }] },
      }
    },
  })
  const frames: RpcFrame[] = []
  const protocolRef: { current: ReturnType<typeof createMcpProtocol> | null } = { current: null }
  const transport: McpTransport = {
    send: (message) => {
      const frame = message as RpcFrame
      frames.push(frame)
      if (frame.method === 'elicitation/create' && frame.id != null) {
        queueMicrotask(() => protocolRef.current?.handleIncoming({
          jsonrpc: '2.0', id: frame.id,
          result: { action: 'accept', content: { confirm: true } },
        }))
      }
    },
    isAppOpen: () => true,
    invoke: async (method, params) => {
      if (method === 'production.start') {
        return service.createDraft({
          projectId: String(params.projectId),
          playbook: { name: String(params.playbook), version: String(params.playbookVersion || '1.0.0') },
          origin: { host: 'claude', actorId: String(params.actorId || 'claude') },
          brief: params.brief as { goal: string },
        })
      }
      if (method === 'production.get') return service.readProjection(String(params.projectId), String(params.runId))
      if (method === 'production.events') {
        return service.readEvents(String(params.projectId), String(params.runId), Number(params.afterCursor) || 0, 0)
      }
      if (method === 'production.control') {
        const full = service.readFull(String(params.projectId), String(params.runId))
        if (!full) throw new Error('run missing')
        await service.command(String(params.projectId), String(params.runId), {
          commandId: `mcp-control-${String(params.action)}-${full.revision}`,
          expectedRevision: full.revision,
          type: 'run.control',
          payload: { action: params.action },
          issuedAt: new Date().toISOString(),
        })
        return service.readProjection(String(params.projectId), String(params.runId))
      }
      if (method === 'production.decide-gate') {
        const full = service.readFull(String(params.projectId), String(params.runId))
        if (!full) throw new Error('run missing')
        const choiceKey = typeof params.choiceKey === 'string' ? params.choiceKey : undefined
        await service.command(String(params.projectId), String(params.runId), {
          commandId: `mcp-decide-${String(params.gateId)}-${String(params.decision)}-${full.revision}`,
          expectedRevision: full.revision,
          type: 'gate.decide',
          payload: { gateId: params.gateId, status: params.decision, ...(choiceKey ? { choiceKey } : {}) },
          issuedAt: new Date().toISOString(),
        })
        return service.readProjection(String(params.projectId), String(params.runId))
      }
      if (method === 'production.artifact.review') {
        await service.reviewArtifact({
          projectId: String(params.projectId), runId: String(params.runId), artifactId: String(params.artifactId),
          expectedVersion: Number(params.expectedVersion), decision: params.decision as 'approved' | 'changes_requested' | 'rejected',
        })
        return service.readProjection(String(params.projectId), String(params.runId))
      }
      if (method === 'production.storyboard.materialize') {
        return service.materializeStoryboard({
          projectId: String(params.projectId), runId: String(params.runId), artifactId: String(params.artifactId),
          expectedVersion: Number(params.expectedVersion),
        })
      }
      throw new Error(`unexpected invoke: ${method}`)
    },
  }
  const protocol = createMcpProtocol(transport)
  protocolRef.current = protocol
  async function call(id: number, name: string, args: Record<string, unknown>, progressToken?: string): Promise<RpcFrame> {
    protocol.handleIncoming({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name, arguments: args, ...(progressToken ? { _meta: { progressToken } } : {}) },
    })
    await vi.waitFor(() => { expect(frames.some((frame) => frame.id === id)).toBe(true) }, { timeout: 3000 })
    return frames.find((frame) => frame.id === id)!
  }
  return { service, frames, protocol, call }
}

function text(frame: RpcFrame): string {
  return frame.result?.content?.[0]?.text ?? ''
}
function outcome(frame: RpcFrame): Record<string, unknown> {
  return frame.result?.structuredContent?.nomiOutcome ?? {}
}

describe('MCP conversation journey (A7 · 真 service 全链路)', () => {
  it('接住→进度→控制→状态→事件：文本可转述、字段稳定、进度帧真实', async () => {
    const { service, frames, protocol, call } = makeJourney()
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'claude-code' } } })

    // ── 壹 · 接住：进度起始帧 + 结构化回执 + 参数回显 ────────────────────────────
    const started = await call(2, 'nomi_run_start', {
      projectId: 'project-1',
      playbook: 'brand.promo',
      brief: { goal: '一条 60 秒品牌宣传片', durationSeconds: 60 },
    }, 'tok-journey')
    const progressFrames = frames.filter((frame) => frame.method === 'notifications/progress')
    expect(progressFrames.length).toBeGreaterThan(0)
    expect(progressFrames[0].params?.progressToken).toBe('tok-journey')
    expect(String(progressFrames[0].params?.message)).toContain('正在创建制作草稿 · brand.promo')
    expect(text(started)).toContain('✓ 制作草稿已创建')
    expect(text(started)).toContain('未花费')
    expect(text(started)).toContain('brand.promo')
    const runId = String(outcome(started).runId)
    expect(runId).toBeTruthy()
    expect(outcome(started).kind).toBe('run_draft')
    expect(outcome(started).nextActions).toEqual(['pick_direction'])

    // ── 贰 · 定方向（B1 三选一）：driver 拟候选 → nomi_get_run 转述候选 → 走 nomi_decide_gate ────
    // driver 异步拟好 2-3 个候选并挂到方向门（createDraft 后触发的 proposeDirections）。
    await vi.waitFor(() => {
      const gate = service.readFull('project-1', runId)!.gates.find((item) => item.gateId === 'gate-direction-v1')
      expect(gate?.directionCandidates?.length).toBe(3)
    }, { timeout: 3000 })

    // 候选进转述：模型据此把「三选一 + 都不要」列给真人（elicitation 的原材料）。
    const withOptions = await call(3, 'nomi_read', { target: 'run', projectId: 'project-1', runId })
    expect(text(withOptions)).toContain('城市烟火气')
    expect(text(withOptions)).toContain('都不要，我来描述')
    expect(outcome(withOptions).nextActions).toEqual(['decide_direction'])
    const optionKeys = (outcome(withOptions).directionCandidates as Array<{ key: string }>).map((candidate) => candidate.key)
    expect(optionKeys).toEqual(['street', 'studio', 'montage'])

    // nomi_decide_gate 自己发服务端 elicitation；测试客户端明确 accept 后，协议层才调用 dispatcher。
    const decided = await call(4, 'nomi_run_gate', { action: 'decide', projectId: 'project-1', runId, gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'studio' })
    expect(frames.some((frame) => frame.method === 'elicitation/create')).toBe(true)
    expect(text(decided)).toContain('✓ 方向已定')
    expect(text(decided)).toContain('极简产品美学')
    expect(outcome(decided).kind).toBe('gate_decision')
    expect(outcome(decided).choiceKey).toBe('studio')

    await vi.waitFor(() => { expect(service.readFull('project-1', runId)!.status).toBe('awaiting_script_review') }, { timeout: 3000 })
    // choiceKey 留痕进 gate（可审计「用户当时选了哪个方向」）。
    expect(service.readFull('project-1', runId)!.gates.find((item) => item.gateId === 'gate-direction-v1')!.decidedChoiceKey).toBe('studio')

    // ── 剧本审阅点：先看剧本并批准，批准后才会拟分镜 ─────────────────────────
    const scriptCandidate = service.readFull('project-1', runId)!.artifacts.find((item) => item.kind === 'script')!
    const scriptStatus = await call(5, 'nomi_read', { target: 'run', projectId: 'project-1', runId })
    expect(text(scriptStatus)).toContain('剧本')
    expect(outcome(scriptStatus).nextActions).toEqual(['review_script'])
    const scriptReview = await call(6, 'nomi_artifact_review', {
      action: 'approve', projectId: 'project-1', runId, artifactId: scriptCandidate.artifactId, expectedVersion: scriptCandidate.version || 1,
    })
    expect(text(scriptReview)).toContain('产物版本已批准')
    await vi.waitFor(() => { expect(service.readFull('project-1', runId)!.status).toBe('awaiting_storyboard_review') }, { timeout: 3000 })

    // ── 状态可转述：分镜等审阅 → 人话 + 下一步 ──────────────────────────────
    const status = await call(7, 'nomi_read', { target: 'run', projectId: 'project-1', runId })
    expect(text(status)).toContain('分镜等你审阅')
    expect(outcome(status).nextActions).toEqual(['review_storyboard'])

    // ── 陆 · 掌控与错误契约：非法暂停给人话拒绝，取消合法且不计费 ─────────────
    const illegalPause = await call(8, 'nomi_run_control', { projectId: 'project-1', runId, action: 'pause' })
    expect(illegalPause.result?.isError).toBe(true)
    expect(text(illegalPause)).toContain('✗')
    expect(text(illegalPause)).toContain('无法暂停')

    const cancelled = await call(9, 'nomi_run_control', { projectId: 'project-1', runId, action: 'cancel' })
    expect(text(cancelled)).toContain('✓ 已取消')
    expect(text(cancelled)).toContain('已完成的产物保留在项目里')
    expect(outcome(cancelled).kind).toBe('run_control')
    expect(service.readFull('project-1', runId)!.status).toBe('cancelled')

    // ── 事件流：durable cursor 把整段旅程逐行透出（含方向候选事件）────────────
    const events = await call(10, 'nomi_read', { target: 'run_events', projectId: 'project-1', runId, afterCursor: 0 })
    expect(text(events)).toContain('[Nomi] run.created')
    expect(text(events)).toContain('gate.candidates')
    expect(text(events)).toContain('gate.decided')
    expect(text(events)).toMatch(/next cursor \d+/)

    // ── 错误契约：不存在的 run 返回人话 isError ─────────────────────────────
    const missing = await call(11, 'nomi_run_control', { projectId: 'project-1', runId: 'run-missing', action: 'pause' })
    expect(missing.result?.isError).toBe(true)
    expect(text(missing)).toContain('✗')
  })

  it('剧本和分镜都批准后，外部 Agent 可通过 MCP 把同一份分镜物化到 Nomi 项目', async () => {
    const { service, protocol, call } = makeJourney()
    protocol.handleIncoming({ jsonrpc: '2.0', id: 20, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'codex' } } })
    const started = await call(21, 'nomi_run_start', { projectId: 'project-1', playbook: 'brand.promo', brief: { goal: '雨夜找猫', durationSeconds: 30 } })
    const runId = String(outcome(started).runId)
    await vi.waitFor(() => {
      expect(service.readFull('project-1', runId)!.gates.find((gate) => gate.gateId === 'gate-direction-v1')?.directionCandidates?.length).toBe(3)
    }, { timeout: 3000 })
    await call(22, 'nomi_run_gate', { action: 'decide', projectId: 'project-1', runId, gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'street' })
    await vi.waitFor(() => { expect(service.readFull('project-1', runId)!.status).toBe('awaiting_script_review') }, { timeout: 3000 })
    const runWithScript = service.readFull('project-1', runId)!
    const script = runWithScript.artifacts.find((item) => item.kind === 'script')!
    await call(23, 'nomi_artifact_review', { action: 'approve', projectId: 'project-1', runId, artifactId: script.artifactId, expectedVersion: script.version || 1 })
    await vi.waitFor(() => { expect(service.readFull('project-1', runId)!.status).toBe('awaiting_storyboard_review') }, { timeout: 3000 })
    const runWithStoryboard = service.readFull('project-1', runId)!
    const storyboard = runWithStoryboard.artifacts.find((item) => item.kind === 'storyboard')!
    await call(24, 'nomi_artifact_review', { action: 'approve', projectId: 'project-1', runId, artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1 })
    const materialized = await call(25, 'nomi_run_gate', { action: 'materialize', projectId: 'project-1', runId, artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1 })
    expect(text(materialized)).toContain('分镜已落到 Nomi 画布')
    expect(text(materialized)).toContain('canvas-shot-1')
    expect(outcome(materialized)).toMatchObject({ kind: 'storyboard_materialized', bindingCount: 1 })
    expect(service.readFull('project-1', runId)!.artifacts.some((item) => item.kind === 'storyboard' && item.status === 'adopted')).toBe(true)
  })
})
