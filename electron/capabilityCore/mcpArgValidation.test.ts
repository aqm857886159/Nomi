import { describe, expect, it } from 'vitest'

import { MCP_TOOL_CATALOG } from './mcpToolCatalog'
import { findUnsupportedSchemaFeatures, validateToolArguments } from './mcpArgValidation'

describe('MCP tools/call schema boundary', () => {
  it('rejects missing, wrong-typed, unknown, and out-of-range values', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 3 } },
      required: ['name', 'count'],
      additionalProperties: false,
    }
    expect(validateToolArguments('demo', schema, { count: 1 })?.message).toContain('name')
    expect(validateToolArguments('demo', schema, { name: 3, count: 1 })?.message).toContain('必须是字符串')
    expect(validateToolArguments('demo', schema, { name: 'ok', count: 1, extra: true })?.message).toContain('未知参数')
    expect(validateToolArguments('demo', schema, { name: 'ok', count: 4 })?.message).toContain('不能大于')
  })

  it('accepts a valid payload without rewriting it', () => {
    const payload = { projectId: 'p', nodes: [{ type: 'text', text: 'hello' }] }
    const schema = { type: 'object', properties: { projectId: { type: 'string' }, nodes: { type: 'array' } }, additionalProperties: false }
    expect(validateToolArguments('demo', schema, payload)).toBeNull()
    expect(payload).toEqual({ projectId: 'p', nodes: [{ type: 'text', text: 'hello' }] })
  })

  it('enforces array minimums at the shared MCP boundary', () => {
    const schema = { type: 'array', minItems: 1, items: { type: 'string' } }
    expect(validateToolArguments('demo', schema, [])?.message).toContain('至少')
    expect(validateToolArguments('demo', schema, ['model-a'])).toBeNull()
  })

  it('keeps the entire catalog inside the validator-supported schema subset', () => {
    const unsupported = MCP_TOOL_CATALOG.flatMap((tool) => findUnsupportedSchemaFeatures(tool.inputSchema).map((issue) => `${tool.name}: ${issue}`))
    expect(unsupported).toEqual([])
  })
})
