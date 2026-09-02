import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'

// MCP 协议层的 elicitation 付费确认握手。
// 验证手搓双向 JSON-RPC：服务端能发 elicitation/create 给客户端、按 id 路由响应、按确认结果放行/拦截。
// 直接驱动纯协议层 mcpProtocol.ts（注入假 transport）——不 spawn 任何进程、不触发真实生成。
//
// 路由判据 = 「谁能替我们问到真人」，**不是「Nomi 窗口开着没」**（2026-08-18 修：窗口开着 ≠ 用户注意力
// 在 Nomi，旧判据害得人从 Claude 跑回 App 点一下）。下面 4 条锁死 {支持 elicitation × App 开/关} 全矩阵。

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

/** 充当 MCP 客户端：收集服务端发来的帧，把客户端的帧喂回协议层。 */
class ProtocolHarness {
  readonly invoke: ReturnType<typeof vi.fn>
  private protocol: ReturnType<typeof createMcpProtocol>
  private queue: RpcMessage[] = []
  private waiters: Array<(msg: RpcMessage) => void> = []

  constructor(
    appOpen = false,
    invokeImpl: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () => {
      throw new Error('invoke 不该在 decline / 不支持 路径被调用')
    },
  ) {
    this.invoke = vi.fn(invokeImpl)
    const transport: McpTransport = {
      send: (message) => {
        const msg = message as RpcMessage
        const waiter = this.waiters.shift()
        if (waiter) waiter(msg)
        else this.queue.push(msg)
      },
      invoke: this.invoke,
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

  async initialize(elicitation: boolean, protocolVersion = '2025-11-25'): Promise<RpcMessage> {
    this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion, capabilities: elicitation ? { elicitation: {} } : {} },
    })
    const res = await this.next()
    expect(res.id).toBe(1)
    return res
  }
}

let harness: ProtocolHarness | null = null

afterEach(() => {
  harness = null
})

describe('nomi-mcp · retired direct generation route', () => {
  const GENERATE_ARGS = { projectId: 'p', vendor: 'apimart', modelKey: 'doubao-seedance-2.0', intent: 'video', prompt: '巷口回头' }
  const callGenerate = (h: ProtocolHarness) =>
    h.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nomi_generate', arguments: GENERATE_ARGS } })
  it('rejects nomi_generate before elicitation or provider invocation', async () => {
    harness = new ProtocolHarness(false)
    await harness.initialize(true)
    callGenerate(harness)
    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    expect(toolRes.error?.message).toContain('未知工具: nomi_generate')
    expect(harness.invoke).not.toHaveBeenCalled()
  })

  it('握手回显客户端请求的协议版本（兼容只讲老协议的客户端，如 Codex/Cursor 早期）', async () => {
    harness = new ProtocolHarness(false)
    // 老客户端只讲 2025-03-26（elicitation 之前的修订）。
    const res = await harness.initialize(false, '2025-03-26')
    const result = res.result as { protocolVersion?: string }
    expect(result.protocolVersion).toBe('2025-03-26')
  })
})

describe('nomi-mcp · 创意门由服务端强制 elicitation', () => {
  const directionProjection = {
    runId: 'run-1', projectId: 'project-1', status: 'awaiting_direction',
    gates: [{
      gateId: 'gate-direction-v1', scope: 'stage', status: 'waiting',
      title: 'Choose a direction', summary: 'Pick one before storyboard planning.',
      directionCandidates: [{ key: 'studio', title: 'Studio', oneLiner: 'Minimal product film' }],
    }],
  }

  it('客户端不支持 elicitation：不读取也不应用决定', async () => {
    harness = new ProtocolHarness(true)
    await harness.initialize(false)
    harness.send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nomi_run_gate', arguments: { action: 'decide', projectId: 'project-1', runId: 'run-1', gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'studio' } },
    })
    const response = await harness.next()
    expect(response.id).toBe(2)
    expect(response.result).toMatchObject({ isError: true })
    expect(harness.invoke).not.toHaveBeenCalled()
  })

  it('真人拒绝：只读当前门，不应用决定', async () => {
    harness = new ProtocolHarness(true, async (method) => {
      if (method === 'production.get') return directionProjection
      throw new Error(`unexpected invoke: ${method}`)
    })
    await harness.initialize(true)
    harness.send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nomi_run_gate', arguments: { action: 'decide', projectId: 'project-1', runId: 'run-1', gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'studio' } },
    })
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    expect((elicit.params as { message?: string }).message).toContain('Studio')
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'decline' } })
    const response = await harness.next()
    expect(response.result).toMatchObject({ isError: true })
    expect(harness.invoke).toHaveBeenCalledTimes(1)
    expect(harness.invoke).not.toHaveBeenCalledWith('production.decide-gate', expect.anything())
  })

  it('真人明确接受：确认后才应用同一个创意决定', async () => {
    harness = new ProtocolHarness(true, async (method) => {
      if (method === 'production.get') return directionProjection
      if (method === 'production.decide-gate') return {
        ...directionProjection,
        gates: [{ ...directionProjection.gates[0], status: 'approved', decidedChoiceKey: 'studio' }],
      }
      throw new Error(`unexpected invoke: ${method}`)
    })
    await harness.initialize(true)
    harness.send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nomi_run_gate', arguments: { action: 'decide', projectId: 'project-1', runId: 'run-1', gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'studio' } },
    })
    const elicit = await harness.next()
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'accept', content: { confirm: true } } })
    const response = await harness.next()
    expect(response.id).toBe(2)
    expect(response.result).not.toMatchObject({ isError: true })
    expect(harness.invoke).toHaveBeenNthCalledWith(1, 'production.get', { projectId: 'project-1', runId: 'run-1' })
    expect(harness.invoke).toHaveBeenNthCalledWith(2, 'production.decide-gate', {
      projectId: 'project-1', runId: 'run-1', gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'studio',
    })
  })

  // P4 §3.2：锚定妆照检查点与创意门同权——elicitation 用「视觉确认」文案问过真人后才应用决定。
  it('定妆照检查点：真人确认后应用决定（视觉确认文案）', async () => {
    const checkpointProjection = {
      runId: 'run-1', projectId: 'project-1', status: 'running',
      gates: [{
        gateId: 'gate-anchor-checkpoint-run-1', scope: 'anchor_checkpoint', status: 'waiting',
        title: 'Review the character look before shooting', summary: 'Approve the look, then it generates each shot.',
        jobIds: ['job-anchor-1'],
      }],
    }
    harness = new ProtocolHarness(true, async (method) => {
      if (method === 'production.get') return checkpointProjection
      if (method === 'production.decide-gate') return {
        ...checkpointProjection,
        gates: [{ ...checkpointProjection.gates[0], status: 'approved' }],
      }
      throw new Error(`unexpected invoke: ${method}`)
    })
    await harness.initialize(true)
    harness.send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nomi_run_gate', arguments: { action: 'decide', projectId: 'project-1', runId: 'run-1', gateId: 'gate-anchor-checkpoint-run-1', decision: 'approved' } },
    })
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    // 视觉确认语义：标题让真人「先过目定妆照」，不是泛化创意门文案。
    expect(JSON.stringify(elicit.params)).toContain('定妆照')
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'accept', content: { confirm: true } } })
    const response = await harness.next()
    expect(response.id).toBe(2)
    expect(response.result).not.toMatchObject({ isError: true })
    expect(harness.invoke).toHaveBeenNthCalledWith(2, 'production.decide-gate', {
      projectId: 'project-1', runId: 'run-1', gateId: 'gate-anchor-checkpoint-run-1', decision: 'approved',
    })
  })

  it('预算门在协议层直接拒绝，不向客户端伪装成可批准创意门', async () => {
    harness = new ProtocolHarness(true, async (method) => {
      if (method === 'production.get') return {
        ...directionProjection,
        gates: [{ gateId: 'gate-contract-v1', scope: 'budget_envelope', status: 'waiting', title: 'Budget', summary: 'Spend' }],
      }
      throw new Error(`unexpected invoke: ${method}`)
    })
    await harness.initialize(true)
    harness.send({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nomi_run_gate', arguments: { action: 'decide', projectId: 'project-1', runId: 'run-1', gateId: 'gate-contract-v1', decision: 'approved' } },
    })
    const response = await harness.next()
    expect(response.id).toBe(2)
    expect(response.result).toMatchObject({ isError: true })
    expect(JSON.stringify(response.result)).toContain('Nomi')
    expect(harness.invoke).toHaveBeenCalledTimes(1)
  })
})
