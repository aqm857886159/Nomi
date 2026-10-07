import { describe, expect, it, vi } from 'vitest'

import { CANVAS_READ_MCP_ADAPTER, createMcpCapabilityResolver } from './mcpCapabilityProjection'
import { createMcpProtocol, validateToolArguments, type McpTransport } from './mcpProtocol'
import { MCP_TOOL_CATALOG } from './mcpToolCatalog'
import { mcpProfileTools, specsForCapability } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { mcpToolDescription } from '../shared/agentCapabilities/modelFacingTools'
import { EXPORT_READ_CAPABILITY } from '../shared/agentCapabilities/exportCapabilities'
import { CANVAS_WRITE_CAPABILITY } from '../shared/agentCapabilities/canvasWrite'
import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
import { registerProductionPlaybook } from '../productionRun/productionPlaybooks'

// SDK 处理每一帧都是异步的：发出一帧后让事件循环转一圈再读回帧。
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise<void>((resolve) => setImmediate(resolve)) }

describe('MCP L1 tools/list_changed notification', () => {
  it('publishes every shared MCP guideline through the real tools/list, including the collapsed read tool', async () => {
    const frames: Array<Record<string, unknown>> = []
    const protocol = createMcpProtocol({ send: frame => frames.push(frame as Record<string, unknown>),
      invoke: async () => { throw new Error('tools/list must not execute a domain operation') }, isAppOpen: () => false })
    try {
      protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      await settle()
      const listed = frames.find(frame => frame.id === 1)?.result as { tools: Array<{ name: string; description: string }> }
      expect(listed.tools.length).toBeGreaterThan(0)
      const sources = mcpProfileTools()
      // canvas.write 对外是手写传输（`nomi_canvas_edit`），不在派生 sources 里；描述仍从三个画布写动词派生。
      expect(sources.some(source => source.contractId === 'canvas.write')).toBe(false)
      expect(listed.tools.find(tool => tool.name === CANVAS_WRITE_CAPABILITY.aliases.mcp)?.description)
        .toBe(mcpToolDescription(CANVAS_WRITE_CAPABILITY, specsForCapability(CANVAS_WRITE_CAPABILITY.id)))
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
    await settle()
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
      protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
      await settle()
      frames.length = 0
      createMcpCapabilityResolver([CANVAS_READ_MCP_ADAPTER])
      await settle()
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
      protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
      await settle()
      frames.length = 0
      registerProductionPlaybook({
        name: 'mcp.l1-test',
        stages: [{ stageId: 'brief', title: 'Brief' }, { stageId: 'direction', title: 'Direction' }],
        briefStageId: 'brief', directionStageId: 'direction',
      })
      await settle()
      expect(frames).toContainEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    } finally {
      protocol.dispose()
    }
  })
})

describe('MCP passive discovery', () => {
  const flush = settle
  function makeTransport(overrides: Partial<McpTransport> = {}) {
    const frames: unknown[] = []
    const invoke = vi.fn(async () => ({ skills: [{ name: 'live-skill', description: 'live' }] }))
    const value: McpTransport = { send: (frame) => frames.push(frame), isAppOpen: () => false, invoke, ...overrides }
    return { frames, invoke, value }
  }

  it('does not cold-start through invoke when resources/list runs with no live instance', async () => {
    const { frames, invoke, value } = makeTransport()
    const protocol = createMcpProtocol(value)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 91, method: 'resources/list', params: {} })
    await flush()
    expect(invoke).not.toHaveBeenCalled()
    expect((frames[0] as { result?: { resources?: unknown[] } }).result?.resources).toEqual(expect.arrayContaining([expect.objectContaining({ uri: 'ui://nomi/live-draft.html' })]))
    protocol.dispose()
  })

  it('probes a live instance for dynamic skills without using cold-start invoke', async () => {
    const probe = vi.fn(async () => ({ skills: [{ name: 'live-skill', directoryName: 'live-skill', packageVersion: '1.0.0', contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', description: 'live', filePaths: ['SKILL.md'] }] }))
    const { frames, invoke, value } = makeTransport({ invokeIfOpen: probe })
    const protocol = createMcpProtocol(value)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 92, method: 'resources/list', params: {} })
    await flush()
    expect(probe).toHaveBeenCalledWith('skills.list', {})
    expect(invoke).not.toHaveBeenCalled()
    expect((frames[0] as { result?: { resources?: Array<{ name?: string }> } }).result?.resources).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'live-skill' })]))
    protocol.dispose()
  })

  it.each(['initialize', 'tools/list', 'resources/list', 'resources/templates/list', 'prompts/list', 'ping'])('keeps %s passive', async (method) => {
    const { frames, invoke, value } = makeTransport()
    const protocol = createMcpProtocol(value)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 93, method, params: method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } : {} })
    await flush()
    expect(invoke).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)
    protocol.dispose()
  })
})

// tools/call 的参数校验引擎是官方 SDK 的 JSON Schema 校验器（替掉了手写的 mcpArgValidation.ts）。
// 这里钉的是边界语义——缺 / 错类型 / 多余 / 越界都被拒、合法载荷原样放行、坏 schema 失败即关——不钉引擎的措辞。
describe('MCP tools/call 参数边界（SDK 校验器）', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 3 } },
    required: ['name', 'count'],
    additionalProperties: false,
  }

  it('rejects missing, wrong-typed, unknown and out-of-range values with the shared invalid-input code', () => {
    for (const args of [{ count: 1 }, { name: 3, count: 1 }, { name: 'ok', count: 1, extra: true }, { name: 'ok', count: 4 }, { name: 'ok', count: 1.5 }]) {
      const invalid = validateToolArguments('demo', schema, args)
      expect(invalid, JSON.stringify(args)).not.toBeNull()
      expect((invalid as Error & { code?: string }).code).toBe('capability_input_invalid')
      expect(invalid?.message).toContain('参数不符合 demo 的契约')
    }
  })

  it('names a missing required field', () => {
    expect(validateToolArguments('demo', schema, { count: 1 })?.message).toContain('name')
  })

  it('accepts a valid payload without rewriting it', () => {
    const payload = { name: 'ok', count: 2 }
    expect(validateToolArguments('demo', schema, payload)).toBeNull()
    expect(payload).toEqual({ name: 'ok', count: 2 })
  })

  it('validates recursive local references and typed dictionaries', () => {
    const recursive = { type: 'object', properties: { values: { type: 'object', additionalProperties: { $ref: '#/definitions/json' } } },
      definitions: { json: { anyOf: [{ type: ['string', 'number', 'boolean', 'null'] },
        { type: 'array', items: { $ref: '#/definitions/json' } },
        { type: 'object', additionalProperties: { $ref: '#/definitions/json' } }] } } }
    expect(validateToolArguments('recursive', recursive, { values: { tree: [null, true, 3, { child: ['ok'] }] } })).toBeNull()
    expect(validateToolArguments('dictionary', { type: 'object', additionalProperties: { type: 'integer' } }, { x: 1.5 })).not.toBeNull()
  })

  it('fails closed on schemas whose references cannot be resolved', () => {
    for (const broken of [{ $ref: '#/missing' }, { $ref: 'https://invalid.example/schema' }]) {
      expect(validateToolArguments('invalid-schema', broken, {})).not.toBeNull()
    }
  })

  it('compiles every published tool schema', () => {
    for (const tool of MCP_TOOL_CATALOG) {
      expect(validateToolArguments(tool.name, tool.inputSchema, {})?.message ?? '', tool.name).not.toContain('无效工具 schema')
    }
  })
})
