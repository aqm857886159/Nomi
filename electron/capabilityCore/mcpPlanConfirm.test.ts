import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProtocol, type McpInvokeOptions, type McpTransport } from './mcpProtocol'
import { dispatch } from './dispatcher'
import type { PlanConfirmInfo, ProjectGateway } from './gateway'

// T1 · 画布方案确认 elicitation-first + 会话级信任（plan 2026-08-18-t1-elicitation-first-plan-confirm）。
// 纯协议层单测（注入假 transport）——不 spawn 进程、不碰真实库/App。验证：
//  · 声明 elicitation + App 开着 → 批量加节点先在聊天里问一次、渲染层弹窗不被调、accept 带 planConfirmed 放行；
//  · 同会话同项目第二批直接放行（信任）；不同项目再问一次；
//  · decline / 超时 → cancelled 形状且不 invoke；
//  · 不声明 elicitation（App 开）/ headless（声明 elicitation）→ 老路径逐字节不变（无 planConfirmed、无 elicit）。

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

type InvokeCall = { method: string; params: Record<string, unknown>; options?: McpInvokeOptions }

/** 充当 MCP 客户端：收集服务端发来的帧 + 记录每次 invoke（含 options，用于断言 planConfirmed 透传）。 */
class PlanHarness {
  readonly invoke: ReturnType<typeof vi.fn>
  readonly invokeCalls: InvokeCall[] = []
  private protocol: ReturnType<typeof createMcpProtocol>
  private queue: RpcMessage[] = []
  private waiters: Array<(msg: RpcMessage) => void> = []

  constructor(appOpen: boolean) {
    // 加节点 invoke 返回稳定 ids；记录 method/params/options 供断言。
    this.invoke = vi.fn(async (method: string, params: Record<string, unknown>, options?: McpInvokeOptions) => {
      this.invokeCalls.push({ method, params, options })
      if (method === 'canvas.write') {
        const count = Array.isArray(params.nodes) ? params.nodes.length : 0
        const ids = Array.from({ length: count }, (_, i) => `n${i}`)
        return { applied: true, proposalId: 'proposal-test', operation: 'create_canvas_nodes', affectedNodeIds: ids, affectedEdgeIds: [], clientIdToNodeId: {}, connectedCount: 0, skippedEdges: [], reconciliation: { ok: true, deviationCount: 0 } }
      }
      throw new Error(`unexpected invoke: ${method}`)
    })
    const transport: McpTransport = {
      send: (message) => {
        const msg = message as RpcMessage
        const waiter = this.waiters.shift()
        if (waiter) waiter(msg)
        else this.queue.push(msg)
      },
      invoke: this.invoke as McpTransport['invoke'],
      isAppOpen: () => appOpen,
    }
    this.protocol = createMcpProtocol(transport)
  }

  send(msg: RpcMessage): void {
    this.protocol.handleIncoming(msg)
  }

  next(timeoutMs = 5000): Promise<RpcMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 MCP 消息超时')), timeoutMs)
      this.waiters.push((msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
    })
  }

  async initialize(elicitation: boolean): Promise<void> {
    this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'claude-code' } },
    })
    const res = await this.next()
    expect(res.id).toBe(1)
  }

  /** 发一批 add_nodes 调用（不等结果）。 */
  addNodes(id: number, projectId: string, count: number): void {
    this.send({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'nomi_canvas_edit',
        arguments: { leaseHandle: 'lease-a', projectId, operation: 'create_canvas_nodes', summary: '创建画布节点', nodes: Array.from({ length: count }, (_, i) => ({ clientId: `client-${i + 1}`, kind: 'image', title: `镜 ${i + 1}`, prompt: `镜头 ${i + 1}` })) },
      },
    })
  }

  addNodeCalls(): InvokeCall[] {
    return this.invokeCalls.filter((call) => call.method === 'canvas.write')
  }
}

let harness: PlanHarness | null = null
afterEach(() => {
  harness = null
})

describe('nomi-mcp · 画布方案确认 elicitation-first（App 开着）', () => {
  it('a. 声明 elicitation + App 开：批量加节点先弹聊天确认，渲染层不被调，accept 后带 planConfirmed 放行返 true', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(true)
    harness.addNodes(2, 'proj-a', 3)

    // 服务端先发 elicitation/create（把确认递进聊天），此时还没 invoke。
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    expect(typeof elicit.id).toBe('string')
    const params = elicit.params as { message?: string }
    expect(params.message).toContain('3') // 「往画布加 3 个节点」
    expect(params.message).toContain('画布')
    expect(harness.addNodeCalls()).toHaveLength(0) // 确认前绝不落节点

    // 真人 accept。
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'accept', content: { confirm: true } } })
    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    const result = toolRes.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBeFalsy()

    // 恰好一次 add，且带 planConfirmed=true（下游渲染层弹窗被预批准跳过 → 不双问）。
    const calls = harness.addNodeCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].params.projectId).toBe('proj-a')
    expect(calls[0].options?.planConfirmed).toBe(true)
  })

  it('b. 同会话同项目第二批：不再弹确认，直接带 planConfirmed 放行', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(true)

    // 第一批：走 elicitation + accept。
    harness.addNodes(2, 'proj-a', 2)
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'accept', content: { confirm: true } } })
    await harness.next()

    // 第二批（同项目）：不应再有 elicitation，直接回结果。
    harness.addNodes(3, 'proj-a', 5)
    const toolRes = await harness.next()
    expect(toolRes.method).not.toBe('elicitation/create')
    expect(toolRes.id).toBe(3)

    const calls = harness.addNodeCalls()
    expect(calls).toHaveLength(2)
    expect(calls[1].options?.planConfirmed).toBe(true)
    // 全程只发过一次 elicitation。
    expect(harness.invokeCalls.filter((c) => c.method === 'canvas.write')).toHaveLength(2)
  })

  it('c. 同会话不同项目：重新弹确认（信任按项目隔离）', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(true)

    harness.addNodes(2, 'proj-a', 2)
    const elicitA = await harness.next()
    expect(elicitA.method).toBe('elicitation/create')
    harness.send({ jsonrpc: '2.0', id: elicitA.id, result: { action: 'accept', content: { confirm: true } } })
    await harness.next()

    // 换项目 → 必须再问一次。
    harness.addNodes(3, 'proj-b', 2)
    const elicitB = await harness.next()
    expect(elicitB.method).toBe('elicitation/create')
    expect(typeof elicitB.id).toBe('string')
    harness.send({ jsonrpc: '2.0', id: elicitB.id, result: { action: 'accept', content: { confirm: true } } })
    const toolRes = await harness.next()
    expect(toolRes.id).toBe(3)

    const calls = harness.addNodeCalls()
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.params.projectId)).toEqual(['proj-a', 'proj-b'])
  })

  it('d. decline：回 cancelled 形状且不落节点', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(true)
    harness.addNodes(2, 'proj-a', 4)
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'decline' } })

    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    // caller（core→dispatcher→outcome）会把 cancelled 转述成文本；协议层这里断言不 invoke + 未落节点。
    expect(harness.addNodeCalls()).toHaveLength(0)
  })

  it('e. elicitation 超时/异常：回 cancelled 形状且不落节点', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(true)
    harness.addNodes(2, 'proj-a', 4)
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    // 客户端回 error（模拟超时/异常）。
    harness.send({ jsonrpc: '2.0', id: elicit.id, error: { code: -32000, message: 'timeout' } })

    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    expect(harness.addNodeCalls()).toHaveLength(0)
  })

  it('信任只在 accept 后建立：decline 后同项目再来仍要问', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(true)

    harness.addNodes(2, 'proj-a', 3)
    const first = await harness.next()
    expect(first.method).toBe('elicitation/create')
    harness.send({ jsonrpc: '2.0', id: first.id, result: { action: 'decline' } })
    await harness.next()

    // decline 不建立信任 → 再来一批同项目仍要弹。
    harness.addNodes(3, 'proj-a', 3)
    const second = await harness.next()
    expect(second.method).toBe('elicitation/create')
  })
})

describe('nomi-mcp · 画布方案确认：不声明 elicitation / headless → 老路径不变', () => {
  it('f. 不声明 elicitation + App 开：不弹、直接 invoke（无 planConfirmed）→ 渲染层弹窗照旧', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(false)
    harness.addNodes(2, 'proj-a', 3)

    const toolRes = await harness.next()
    expect(toolRes.method).not.toBe('elicitation/create')
    expect(toolRes.id).toBe(2)

    const calls = harness.addNodeCalls()
    expect(calls).toHaveLength(1)
    // 关键：不带 planConfirmed → 下游走 gateway.confirmPlan 弹窗（现状逐字节不变）。
    expect(calls[0].options?.planConfirmed).toBeUndefined()
  })

  it('g. 声明 elicitation + headless（App 没开）：不弹、直接 invoke（无 planConfirmed）→ headless 自动放行不变', async () => {
    harness = new PlanHarness(false)
    await harness.initialize(true)
    harness.addNodes(2, 'proj-a', 3)

    const toolRes = await harness.next()
    expect(toolRes.method).not.toBe('elicitation/create')
    expect(toolRes.id).toBe(2)

    const calls = harness.addNodeCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].options?.planConfirmed).toBeUndefined()
  })

  it('单节点：不属于「方案」→ 不弹确认（无论是否声明 elicitation）', async () => {
    harness = new PlanHarness(true)
    await harness.initialize(true)
    harness.addNodes(2, 'proj-a', 1)

    const toolRes = await harness.next()
    expect(toolRes.method).not.toBe('elicitation/create')
    expect(toolRes.id).toBe(2)
    const calls = harness.addNodeCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].options?.planConfirmed).toBeUndefined()
  })
})

// dispatch 层：planConfirmed 透传 → canvas.addNodes 预批准方案门（渲染层弹窗不再触发，免双问）。
// 这补上协议层假 transport 覆盖不到的下游一段：真人在聊天 accept 后，App 侧网关 confirmPlan 不该再被调。
describe('nomi-mcp · dispatch 层 planConfirmed 预批准方案门', () => {
  function spyGateway() {
    const planCalls: PlanConfirmInfo[] = []
    let applied = 0
    const gateway: ProjectGateway = {
      readDoc: async () => ({ nodes: [], edges: [] }),
      apply: async () => { applied += 1 },
      confirmSpend: async () => null,
      confirmPlan: async (info) => { planCalls.push(info); return true },
    }
    return { gateway, planCalls, getApplied: () => applied }
  }
  function ctxWith(gateway: ProjectGateway, planConfirmed: boolean) {
    return {
      runTask: vi.fn(async () => ({ status: 'succeeded' })),
      makeGateway: () => gateway,
      productionRuns: {
        createDraft: vi.fn(), readProjection: vi.fn(), readEvents: vi.fn(),
        readArtifactProjection: vi.fn(), readFull: vi.fn(), command: vi.fn(),
      },
      origin: { host: 'external' as const },
      ...(planConfirmed ? { planConfirmed: true } : {}),
    }
  }

  it('planConfirmed=true：≥2 节点批量 add 不再调 gateway.confirmPlan（App 弹窗被跳过），仍落节点', async () => {
    const spy = spyGateway()
    const result = await dispatch(
      'canvas.addNodes',
      { projectId: 'proj-a', nodes: [{ kind: 'image' }, { kind: 'image' }] },
      ctxWith(spy.gateway, true) as never,
    )
    expect(spy.planCalls).toHaveLength(0) // 关键：confirmPlan 未被调 → 渲染层不弹卡
    expect(spy.getApplied()).toBe(1)
    expect((result as { ids: string[] }).ids).toHaveLength(2)
  })

  it('planConfirmed 未设：≥2 节点批量 add 照常调 gateway.confirmPlan（老路径不变）', async () => {
    const spy = spyGateway()
    await dispatch(
      'canvas.addNodes',
      { projectId: 'proj-a', nodes: [{ kind: 'image' }, { kind: 'image' }] },
      ctxWith(spy.gateway, false) as never,
    )
    expect(spy.planCalls).toHaveLength(1) // 未预批准 → 走原网关确认（App 弹窗 / headless 放行）
    expect(spy.planCalls[0]).toMatchObject({ nodeCount: 2, projectId: 'proj-a' })
  })
})
