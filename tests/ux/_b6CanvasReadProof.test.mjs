import { describe, expect, test } from 'vitest'

import { parseJsonToolResult, proveCanonicalCanvasReadToolResult } from './_b6CanvasReadProof.mjs'

const canonical = Object.freeze({
  nodes: [],
  edges: [],
  groups: [],
  selectedNodeIds: [],
})

function callToolResult(value = canonical) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

describe('B6 packaged canvas.read proof', () => {
  test('parses ordinary JSON tool text for selection and session handles', () => {
    expect(
      parseJsonToolResult(
        {
          content: [{ type: 'text', text: JSON.stringify({ id: 'project-a', projectSelectionHandle: 'selection-a' }) }],
        },
        'create project',
      ),
    ).toEqual({ id: 'project-a', projectSelectionHandle: 'selection-a' })
  })

  test('accepts only a canonical structured canvas result mirrored by the text block', () => {
    expect(proveCanonicalCanvasReadToolResult(callToolResult())).toEqual(canonical)
  })

  test.each([
    [
      'text/structured drift',
      {
        ...callToolResult(),
        content: [{ type: 'text', text: JSON.stringify({ ...canonical, nodes: [{ id: 'not-structured' }] }) }],
      },
    ],
    ['extra top-level field', callToolResult({ ...canonical, raw: { providerTaskId: 'private' } })],
    ['missing canonical array', callToolResult({ nodes: [], edges: [], groups: [] })],
    ['incomplete canonical node', callToolResult({ ...canonical, nodes: [{ position: {} }] })],
  ])('rejects %s', (_label, payload) => {
    expect(() => proveCanonicalCanvasReadToolResult(payload)).toThrow(/canonical canvas\.read/i)
  })
})
