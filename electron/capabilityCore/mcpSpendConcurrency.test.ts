import { describe, expect, it } from 'vitest'

import { createMcpProtocol, MCP_REQUEST_SIGNAL, type McpTransport } from './mcpProtocol'

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('MCP paid confirmation binding', () => {
  it('elicits once for two concurrent first-time paid requests and mints two independent grants', async () => {
    const frames: Array<Record<string, unknown>> = []
    const invokes: Array<{ params: Record<PropertyKey, unknown>; options?: { spendConfirmed?: boolean }; resolve: (value: unknown) => void }> = []
    const transport: McpTransport = {
      send: (frame) => frames.push(frame as Record<string, unknown>),
      isAppOpen: () => true,
      invoke: async (_method, params, options) => new Promise((resolve) => {
        invokes.push({ params: params as Record<PropertyKey, unknown>, options, resolve })
      }),
    }
    const protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} } } })
    await flush()

    const args = { projectId: 'project-concurrency', vendor: 'apimart', modelKey: 'image-model', intent: 'image', prompt: 'a blue square' }
    protocol.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nomi_generate', arguments: args } })
    protocol.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nomi_generate', arguments: args } })
    await flush()
    const elicitationFrames = frames.filter((frame) => frame.method === 'elicitation/create')
    expect(elicitationFrames).toHaveLength(1)
    protocol.handleIncoming({ jsonrpc: '2.0', id: elicitationFrames[0].id, result: { action: 'accept', content: { confirm: true } } })
    await flush()
    expect(invokes).toHaveLength(2)
    expect(invokes.every(({ options }) => options?.spendConfirmed === true)).toBe(true)
    expect(invokes[0]?.params[MCP_REQUEST_SIGNAL]).not.toBe(invokes[1]?.params[MCP_REQUEST_SIGNAL])
    invokes[0]?.resolve({ assets: [] })
    invokes[1]?.resolve({ assets: [] })
    await flush()
    expect(frames.filter((frame) => frame.id === 2)).toHaveLength(1)
    expect(frames.filter((frame) => frame.id === 3)).toHaveLength(1)
  })

  it('shares a decline without opening a second confirmation', async () => {
    const frames: Array<Record<string, unknown>> = []
    const transport: McpTransport = {
      send: (frame) => frames.push(frame as Record<string, unknown>),
      isAppOpen: () => true,
      invoke: async () => ({ assets: [] }),
    }
    const protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} } } })
    await flush()
    const args = { projectId: 'project-decline', vendor: 'apimart', modelKey: 'image-model', intent: 'image', prompt: 'a blue square' }
    protocol.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nomi_generate', arguments: args } })
    protocol.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nomi_generate', arguments: args } })
    await flush()
    const elicitation = frames.find((frame) => frame.method === 'elicitation/create')
    expect(elicitation).toBeTruthy()
    protocol.handleIncoming({ jsonrpc: '2.0', id: elicitation?.id, result: { action: 'decline', content: { confirm: false } } })
    await flush()
    expect(frames.filter((frame) => frame.method === 'elicitation/create')).toHaveLength(1)
    expect(frames.filter((frame) => frame.id === 2)).toHaveLength(1)
    expect(frames.filter((frame) => frame.id === 3)).toHaveLength(1)
  })
})
