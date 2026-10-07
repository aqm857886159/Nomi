import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, MCP_REQUEST_SIGNAL, SUPPORTED_PROTOCOL_VERSIONS, type McpTransport } from './mcpProtocol'

// 取消、断连中止、取消后不回响应都由官方 SDK 承担（在飞账本 mcpRequestLifecycle 的前身 mcpRequestRegistry 已删）；
// 这里钉的是 Nomi 依赖的那几条语义。SDK 处理每一帧都是异步的：让事件循环转几圈再读回帧。
const flush = async () => { for (let index = 0; index < 5; index += 1) await new Promise<void>((resolve) => setImmediate(resolve)) }

describe('MCP request lifecycle hardening', () => {
  it('cancels an in-flight tool call and sends no response', async () => {
    const frames: unknown[] = []
    let resolveInvoke!: (value: unknown) => void
    let signal: AbortSignal | undefined
    const transport: McpTransport = {
      send: (frame) => frames.push(frame),
      isAppOpen: () => false,
      invoke: vi.fn(async (_method, params) => {
        signal = (params as Record<PropertyKey, unknown>)[MCP_REQUEST_SIGNAL] as AbortSignal
        return new Promise((resolve) => { resolveInvoke = resolve })
      }),
    }
    const protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } })
    await flush()
    expect(signal).toBeInstanceOf(AbortSignal)
    protocol.handleIncoming({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 42, reason: 'user stopped' } })
    await flush()
    expect(signal?.aborted).toBe(true)
    resolveInvoke({ models: [] })
    await flush()
    expect(frames.some((frame) => (frame as { id?: number }).id === 42)).toBe(false)
  })

  it('ignores a forged, malformed, or already-completed cancellation id', async () => {
    const frames: unknown[] = []
    const transport: McpTransport = {
      send: (frame) => frames.push(frame),
      isAppOpen: () => false,
      invoke: async () => ({ models: [] }),
    }
    const protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } })
    await flush()
    protocol.handleIncoming({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: { forged: true } } })
    protocol.handleIncoming({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })
    await flush()
    expect(frames.filter((frame) => (frame as { id?: number }).id === 1)).toHaveLength(1)
  })

  it('cancels every in-flight request before stdio disconnect exits', async () => {
    const frames: unknown[] = []
    const signals: AbortSignal[] = []
    const pendingResolvers: Array<(value: unknown) => void> = []
    const protocol = createMcpProtocol({
      send: (frame) => frames.push(frame),
      isAppOpen: () => false,
      invoke: async (_method, params) => new Promise((resolve) => {
        signals.push((params as Record<PropertyKey, unknown>)[MCP_REQUEST_SIGNAL] as AbortSignal)
        pendingResolvers.push(resolve)
      }),
    })
    protocol.handleIncoming({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } })
    protocol.handleIncoming({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } })
    await flush()
    expect(await protocol.cancelAllInFlight('stdio disconnected')).toBe(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    pendingResolvers.forEach((resolve) => resolve({ models: [] }))
    await flush()
    expect(frames.filter((frame) => [10, 11].includes((frame as { id?: number }).id ?? -1))).toHaveLength(0)
  })

  it('never negotiates an unsupported version: it counter-offers the newest supported one', async () => {
    const frames: unknown[] = []
    const protocol = createMcpProtocol({
      send: (frame) => frames.push(frame),
      isAppOpen: () => false,
      invoke: async () => ({}),
    })
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'banana', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
    await flush()
    expect((frames[0] as { result?: { protocolVersion?: string } }).result?.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0])
  })
})
