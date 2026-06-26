import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'

// MCP 协议层的 elicitation 付费确认握手（B 模式：Nomi 没开）。
// 验证手搓双向 JSON-RPC：服务端能发 elicitation/create 给客户端、按 id 路由响应、按确认结果放行/拦截。
// 直接驱动纯协议层 mcpProtocol.ts（注入假 transport）——不 spawn 任何进程、不触发真实生成，
// 只覆盖 decline / 不支持 两条不调 invoke 的路径（取代旧的 spawn `node scripts/nomi-mcp.mjs`）。

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

/** 充当 MCP 客户端：收集服务端发来的帧，把客户端的帧喂回协议层。 */
class ProtocolHarness {
  readonly invoke = vi.fn(async () => {
    throw new Error('invoke 不该在 decline / 不支持 路径被调用')
  })
  private protocol: ReturnType<typeof createMcpProtocol>
  private queue: RpcMessage[] = []
  private waiters: Array<(msg: RpcMessage) => void> = []

  constructor(appOpen = false) {
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

describe('nomi-mcp · 付费 elicitation 握手（B 模式）', () => {
  it('客户端支持 elicitation：generate → 弹确认 → decline → 拦截不生成', async () => {
    harness = new ProtocolHarness(false)
    await harness.initialize(true)
    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'nomi_generate', arguments: { projectId: 'p', vendor: 'apimart', modelKey: 'doubao-seedance-2.0', intent: 'video', prompt: '巷口回头' } },
    })
    // 服务端应先发 elicitation/create 请求给客户端。
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    expect(typeof elicit.id).toBe('string')
    const params = elicit.params as { message?: string }
    expect(params.message).toContain('Nomi 未打开')
    expect(params.message).toContain('doubao-seedance-2.0')
    // 真人点了取消 → decline。
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'decline' } })
    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    const result = toolRes.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('已取消')
    expect(harness.invoke).not.toHaveBeenCalled()
  })

  it('握手回显客户端请求的协议版本（兼容只讲老协议的客户端，如 Codex/Cursor 早期）', async () => {
    harness = new ProtocolHarness(false)
    // 老客户端只讲 2025-03-26（elicitation 之前的修订）。
    const res = await harness.initialize(false, '2025-03-26')
    const result = res.result as { protocolVersion?: string }
    expect(result.protocolVersion).toBe('2025-03-26')
  })

  it('客户端不支持 elicitation：generate → 不弹、回可操作错误', async () => {
    harness = new ProtocolHarness(false)
    await harness.initialize(false)
    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'nomi_generate', arguments: { projectId: 'p', vendor: 'apimart', modelKey: 'sora-2', intent: 'video', prompt: 'x' } },
    })
    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    const result = toolRes.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Nomi 未打开')
    expect(harness.invoke).not.toHaveBeenCalled()
  })
})
