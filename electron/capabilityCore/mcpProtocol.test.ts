import { describe, expect, it } from 'vitest'

import { CANVAS_READ_MCP_ADAPTER, createMcpCapabilityResolver } from './mcpCapabilityProjection'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import { mcpProfileTools, specsForCapability } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { mcpToolDescription } from '../shared/agentCapabilities/modelFacingTools'
import { EXPORT_READ_CAPABILITY } from '../shared/agentCapabilities/exportCapabilities'
import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
import { registerProductionPlaybook } from '../productionRun/productionPlaybooks'

describe('MCP L1 tools/list_changed notification', () => {
  it('publishes every shared MCP guideline through the real tools/list, including the collapsed read tool', () => {
    const frames: Array<Record<string, unknown>> = []
    const protocol = createMcpProtocol({ send: frame => frames.push(frame as Record<string, unknown>),
      invoke: async () => { throw new Error('tools/list must not execute a domain operation') }, isAppOpen: () => false })
    try {
      protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      const listed = frames.find(frame => frame.id === 1)?.result as { tools: Array<{ name: string; description: string }> }
      expect(listed.tools.length).toBeGreaterThan(0)
      const sources = mcpProfileTools()
      expect(sources.some(source => source.contractId === 'canvas.write')).toBe(true)
      expect(sources.some(source => source.contractId === 'document.write')).toBe(true)
      expect(sources.some(source => source.contractId === 'asset.read')).toBe(true)
      for (const source of sources) {
        const name = source.name === CANVAS_READ_CAPABILITY.aliases.mcp ? 'nomi_read' : source.name
        const actual = listed.tools.find(tool => tool.name === name)
        expect(actual, `${source.name} is retained directly or in its approved aggregate`).toBeDefined()
        for (const guideline of new Set(source.specs.flatMap(spec => spec.promptGuidelines ?? []))) {
          expect(actual?.description, `${name} retains its shared guideline`).toContain(guideline)
        }
      }
      const read = listed.tools.find(tool => tool.name === 'nomi_read')!
      expect(read.description).toContain('For target=canvas only')
      expect(listed.tools.find(tool => tool.name === EXPORT_READ_CAPABILITY.aliases.mcp)?.description)
        .toBe(mcpToolDescription(EXPORT_READ_CAPABILITY, specsForCapability(EXPORT_READ_CAPABILITY.id)))
    } finally { protocol.dispose() }
  })

  it('projects semantic tool titles in the transport locale', async () => {
    const frames: Array<Record<string, unknown>> = []
    const transport: McpTransport = { send: (frame) => frames.push(frame as Record<string, unknown>), invoke: async () => ({}), isAppOpen: () => false, getLocale: () => 'en' }
    const protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const listed = frames.find((frame) => frame.id === 1)?.result as { tools: Array<{ name: string; title?: string }> } | undefined
    expect(listed).toBeDefined()
    expect(listed?.tools.find((tool) => tool.name === 'nomi_timeline_edit')?.title).toBe('Preview, apply or undo timeline edits')
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
