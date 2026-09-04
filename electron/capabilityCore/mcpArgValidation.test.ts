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

  it('exercises every runtime schema type and defensive input shape', () => {
    expect(validateToolArguments('no-schema', undefined, {})).toBeNull()
    expect(validateToolArguments('primitive-schema', 'not-a-schema', {})).toBeNull()
    expect(validateToolArguments('untyped-schema', { type: 123 }, {})).toBeNull()

    const objectSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        ignored: null,
        optional: { type: 'string' },
      },
      required: ['name', 42],
      additionalProperties: false,
    }
    expect(validateToolArguments('object', objectSchema, { name: 3, extra: true, ignored: 'kept' })?.message)
      .toContain('必须是字符串')
    expect(validateToolArguments('empty-object', { type: 'object', properties: {}, additionalProperties: false }, { extra: true })?.message)
      .toContain('不接受任何参数')
    expect(validateToolArguments('loose-object', { type: 'object', properties: 'invalid', required: 'invalid', additionalProperties: true }, {}))
      .toBeNull()
    expect(validateToolArguments('object-shape', { type: 'object' }, [])?.message).toContain('必须是对象')
    expect(validateToolArguments('object-shape', { type: 'object' }, null)?.message).toContain('null')
    expect(validateToolArguments('object-shape', { type: 'object' }, 'wrong')?.message).toContain('字符串')

    const arraySchema = { type: 'array', minItems: 2, maxItems: 1, items: { type: 'string' } }
    expect(validateToolArguments('array', arraySchema, [])?.message).toContain('至少')
    expect(validateToolArguments('array', arraySchema, ['one', 'two'])?.message).toContain('最多')
    expect(validateToolArguments('array', { type: 'array', items: { type: 'string' } }, [3])?.message).toContain('必须是字符串')
    expect(validateToolArguments('array-shape', { type: 'array' }, 'wrong')?.message).toContain('必须是数组')
    expect(validateToolArguments('array-items', { type: 'array', items: 'invalid' }, [])).toBeNull()

    expect(validateToolArguments('min-length', { type: 'string', minLength: 1 }, '')?.message).toContain('不能为空')
    expect(validateToolArguments('min-length', { type: 'string', minLength: 2, maxLength: 3 }, '')?.message).toContain('至少 2')
    expect(validateToolArguments('max-length', { type: 'string', minLength: 2, maxLength: 3 }, 'abcd')?.message).toContain('最多 3')
    expect(validateToolArguments('string-type', { type: 'string' }, null)?.message).toContain('null')
    expect(validateToolArguments('string-type', { type: 'string' }, [])?.message).toContain('数组')
    expect(validateToolArguments('string-type', { type: 'string' }, {})?.message).toContain('对象')
    expect(validateToolArguments('string-type', { type: 'string' }, true)?.message).toContain('布尔值')
    expect(validateToolArguments('string-type', { type: 'string' }, 1)?.message).toContain('数字')
    expect(validateToolArguments('string-type', { type: 'string' }, undefined)?.message).toContain('undefined')

    const numberSchema = { type: 'number', minimum: 1, maximum: 3 }
    expect(validateToolArguments('number', numberSchema, 'wrong')?.message).toContain('必须是数字')
    expect(validateToolArguments('number', numberSchema, Infinity)?.message).toContain('必须是数字')
    expect(validateToolArguments('number', numberSchema, 0)?.message).toContain('不能小于')
    expect(validateToolArguments('number', numberSchema, 4)?.message).toContain('不能大于')
    expect(validateToolArguments('number', numberSchema, 2)).toBeNull()
    expect(validateToolArguments('integer', { type: 'integer' }, 1.5)?.message).toContain('必须是整数')
    expect(validateToolArguments('integer', { type: 'integer' }, Infinity)?.message).toContain('必须是整数')
    expect(validateToolArguments('boolean', { type: 'boolean' }, 1)?.message).toContain('数字')
    expect(validateToolArguments('boolean', { type: 'boolean' }, true)).toBeNull()
  })

  it('exercises schema structure rejection branches without excluding them from coverage', () => {
    expect(findUnsupportedSchemaFeatures(null)).toEqual([])
    expect(findUnsupportedSchemaFeatures('invalid')).toEqual([])
    expect(findUnsupportedSchemaFeatures([])).toEqual([])
    expect(findUnsupportedSchemaFeatures({ unknown: true })).toEqual(['<root>: 不支持的关键字 "unknown"'])
    expect(findUnsupportedSchemaFeatures({ properties: { nested: { unknown: true } } })).toEqual(['nested: 不支持的关键字 "unknown"'])
    expect(findUnsupportedSchemaFeatures({ type: 'unsupported' })).toEqual(['<root>: 不支持的 type "unsupported"'])
    expect(findUnsupportedSchemaFeatures({ type: 123 })).toEqual([])
    expect(findUnsupportedSchemaFeatures({ type: 'object', properties: null, items: null })).toEqual([])
    expect(findUnsupportedSchemaFeatures({ properties: 'invalid' })).toEqual([])
    expect(findUnsupportedSchemaFeatures({ properties: { nested: { type: 'string' } }, items: { type: 'string' } })).toEqual([])
  })

  it('keeps the entire catalog inside the validator-supported schema subset', () => {
    const unsupported = MCP_TOOL_CATALOG.flatMap((tool) => findUnsupportedSchemaFeatures(tool.inputSchema).map((issue) => `${tool.name}: ${issue}`))
    expect(unsupported).toEqual([])
  })
})
