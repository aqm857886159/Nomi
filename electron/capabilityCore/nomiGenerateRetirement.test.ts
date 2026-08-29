import { describe, expect, it, vi } from 'vitest'

import { dispatch, type DispatchContext } from './dispatcher'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createMcpProtocol, MCP_TOOL_NAMES, type McpTransport } from './mcpProtocol'
import { MCP_TOOL_RESOLVER } from './mcpToolCatalog'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('retired nomi_generate route', () => {
  it('is absent from the catalog while retaining a fail-closed policy tombstone', () => {
    expect(MCP_TOOL_RESOLVER.resolve('nomi_generate')).toBeUndefined()
    expect(MCP_TOOL_RESOLVER.list().map((tool) => tool.name)).not.toContain('nomi_generate')
    expect(MCP_TOOL_NAMES).not.toContain('nomi_generate')
    expect(createMcpGenerationPolicy().classifyRoute('nomi_generate'))
      .toEqual({ kind: 'legacy', route: 'nomi_generate' })
  })

  it('is neither advertised nor callable through the MCP protocol', async () => {
    const frames: Array<Record<string, unknown>> = []
    const invoke = vi.fn()
    const transport: McpTransport = {
      send: (frame) => frames.push(frame as Record<string, unknown>),
      invoke,
      isAppOpen: () => true,
    }
    const protocol = createMcpProtocol(transport)

    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nomi_generate', arguments: { projectId: 'p1' } },
    })
    await flush()

    const listed = frames.find((frame) => frame.id === 1)?.result as {
      tools?: Array<{ name: string }>
    } | undefined
    expect(listed?.tools?.map((tool) => tool.name)).not.toContain('nomi_generate')
    expect(frames.find((frame) => frame.id === 2)?.error)
      .toMatchObject({ code: -32602, message: '未知工具: nomi_generate' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('cannot fall through the generic dispatcher to a gateway or provider', async () => {
    const runTask = vi.fn()
    const makeGateway = vi.fn()
    const productionRuns = new Proxy({}, {
      get: () => vi.fn(),
    })
    const context = { runTask, makeGateway, productionRuns } as unknown as DispatchContext

    await expect(dispatch('generate', { projectId: 'p1' }, context))
      .rejects.toMatchObject({ httpStatus: 404, message: '未知方法: generate' })
    expect(runTask).not.toHaveBeenCalled()
    expect(makeGateway).not.toHaveBeenCalled()
  })
})
