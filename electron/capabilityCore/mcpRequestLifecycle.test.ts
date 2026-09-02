import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, MCP_REQUEST_SIGNAL, SUPPORTED_PROTOCOL_VERSIONS, type McpTransport } from './mcpProtocol'

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

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
    expect(protocol.cancelAllInFlight('stdio disconnected')).toBe(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    pendingResolvers.forEach((resolve) => resolve({ models: [] }))
    await flush()
    expect(frames.filter((frame) => [10, 11].includes((frame as { id?: number }).id ?? -1))).toHaveLength(0)
  })

  it('refuses to cancel initialize and negotiates only a supported version', async () => {
    const frames: unknown[] = []
    const protocol = createMcpProtocol({
      send: (frame) => frames.push(frame),
      isAppOpen: () => false,
      invoke: async () => ({}),
    })
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'banana' } })
    await flush()
    expect((frames[0] as { error?: { code?: number; data?: { supported?: string[] } } }).error?.code).toBe(-32602)
    expect((frames[0] as { error?: { data?: { supported?: string[] } } }).error?.data?.supported).toEqual([...SUPPORTED_PROTOCOL_VERSIONS])
    expect((frames[0] as { result?: { protocolVersion?: string } }).result?.protocolVersion).not.toBe('banana')
  })
})
