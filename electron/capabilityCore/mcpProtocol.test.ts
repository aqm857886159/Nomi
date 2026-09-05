import { describe, expect, it } from 'vitest'

import { CANVAS_READ_MCP_ADAPTER, createMcpCapabilityResolver } from './mcpCapabilityProjection'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import { registerProductionPlaybook } from '../productionRun/productionPlaybooks'

describe('MCP L1 tools/list_changed notification', () => {
  it('projects semantic tool titles in the transport locale', async () => {
    const frames: Array<Record<string, unknown>> = []
    const transport: McpTransport = { send: (frame) => frames.push(frame as Record<string, unknown>), invoke: async () => ({}), isAppOpen: () => false, getLocale: () => 'en' }
    const protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const listed = frames.find((frame) => frame.id === 1)?.result as { tools: Array<{ name: string; title?: string }> } | undefined
    expect(listed).toBeDefined()
    expect(listed?.tools.find((tool) => tool.name === 'nomi_timeline_edit')?.title).toBe('Preview, apply, or undo a revision-guarded timeline edit.')
    protocol.dispose()
  })

  it('notifies an initialized session when a capability adapter registration changes the catalog', async () => {
    const frames: Array<Record<string, unknown>> = []
    const transport: McpTransport = { send: (frame) => frames.push(frame as Record<string, unknown>), invoke: async () => ({}), isAppOpen: () => false }
    const protocol = createMcpProtocol(transport)
    try {
      protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } })
      await new Promise<void>((resolve) => setImmediate(resolve))
      frames.length = 0
      createMcpCapabilityResolver([CANVAS_READ_MCP_ADAPTER])
      expect(frames).toContainEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    } finally {
      protocol.dispose()
    }
  })

  it('notifies an initialized session when the playbook registry changes', async () => {
    const frames: Array<Record<string, unknown>> = []
    const transport: McpTransport = { send: (frame) => frames.push(frame as Record<string, unknown>), invoke: async () => ({}), isAppOpen: () => false }
    const protocol = createMcpProtocol(transport)
    try {
      protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } })
      await new Promise<void>((resolve) => setImmediate(resolve))
      frames.length = 0
      registerProductionPlaybook({
        name: 'mcp.l1-test',
        stages: [{ stageId: 'brief', title: 'Brief' }, { stageId: 'direction', title: 'Direction' }],
        briefStageId: 'brief', directionStageId: 'direction',
      })
      expect(frames).toContainEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    } finally {
      protocol.dispose()
    }
  })
})
