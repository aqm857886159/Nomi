import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanFile, scanSource } from './check-mcp-tool-references-lib.mjs'

const declared = new Set(['nomi_project_create', 'nomi_operation_plan'])

test('finds callTool positional and template-literal references', () => {
  const refs = scanSource(
    `
    await client.callTool('nomi_retired_x', {})
    await client.callTool(\`nomi_operation_plan\`, {})
  `,
    { declared },
  )
  assert.deepEqual(
    refs.map((ref) => ref.name),
    ['nomi_retired_x', 'nomi_operation_plan'],
  )
  assert.equal(refs[0].catalog.has(refs[0].name), false)
  assert.equal(refs[1].catalog.has(refs[1].name), true)
})

test('finds name payloads and does not skip NUL-containing sources', () => {
  const refs = scanSource("\0{ method: 'tools/call', params: { name: 'nomi_project_create' } }", { declared })
  assert.deepEqual(
    refs.map((ref) => ref.name),
    ['nomi_project_create'],
  )
  assert.equal(refs[0].catalog.has(refs[0].name), true)
})

test('keeps runtime compatibility aliases on the agent catalog', () => {
  const hostDeclared = new Set([
    'nomi_canvas_plan',
    'nomi_canvas_write',
    'nomi_canvas_read',
    'nomi_generation_plan',
    'nomi_storyboard_write',
  ])
  const refs = scanSource(
    "reply: { type: 'tool', id: '1', name: 'nomi_canvas_write' }; reply: { type: 'tool', id: '2', name: 'nomi_storyboard_write' }",
    { declared, hostDeclared },
  )
  assert.deepEqual(refs.map((ref) => ref.catalog), [hostDeclared, hostDeclared])
})

const hostDeclared = new Set(['nomi_canvas_plan'])
const catalogs = { declared, hostDeclared }
const valid = (source) => scanSource(source, catalogs).map((ref) => ref.catalog.has(ref.name))

test('native lane tool calls use their own catalog without changing MCP payload checks', () => {
  assert.deepEqual(valid(`
    { type: 'toolCall', id: 'call-1', name: 'nomi_canvas_plan', arguments: {} },
    { name: 'nomi_canvas_plan', arguments: {}, id: 'call-2', type: 'toolCall' },
    { type: 'toolCall', id: 'call-3', name: 'nomi_unknown_tool', arguments: {} },
    { method: 'tools/call', params: { name: 'nomi_canvas_plan', arguments: {} } },
    { type: 'toolCall', arguments: { name: 'nomi_canvas_plan' }, name: 'nomi_canvas_plan', id: 'call-4' }
  `), [true, true, false, false, false, true])
})

test('accepts agent manifest excerpts independently of field order and distance', () => {
  assert.deepEqual(
    valid(`
    { name: 'nomi_canvas_plan', intent: '${'long description '.repeat(40)}',
      capabilityRefs: ['canvas.write'], inputSchema: schema, outputSchema: result, ... },
    { outputSchema: result, inputSchema: schema, capabilityRefs: [], intent: 'edit',
      name: 'nomi_canvas_plan' },
  `),
    [true, true],
  )
})

test('rejects unknown manifest names and agent-only names in MCP calls', () => {
  assert.deepEqual(
    valid(`
    { name: 'nomi_unknown_tool', intent: 'test', capabilityRefs: [], inputSchema: schema, outputSchema: result },
    { name: 'nomi_canvas_plan', arguments: {} },
    client.callTool('nomi_canvas_plan', {});
    { type: 'tool', name: 'nomi_unknown_tool' }
  `),
    [false, false, false, false],
  )
})

test('host fixtures ignore field order, long values, comments and nested values', () => {
  assert.deepEqual(
    valid(`
    { type: 'tool', args: { description: '${'x'.repeat(500)}' }, name: 'nomi_canvas_plan' },
    { name: 'nomi_canvas_plan', id: 'late type', 'type': 'tool' },
    { type: /* comment } */ 'tool', id: '${'x'.repeat(500)}', name: 'nomi_canvas_plan' }
  `),
    [true, true, true],
  )
})

test('host markers do not leak into nested, adjacent or incomplete objects', () => {
  assert.deepEqual(
    valid(`
    { type: 'tool', args: { name: 'nomi_canvas_plan' }, name: 'nomi_canvas_plan' },
    { name: 'nomi_canvas_plan' },
    { metadata: { type: 'tool' }, name: 'nomi_canvas_plan' },
    { intent: 'x', capabilityRefs: [], name: 'nomi_canvas_plan' }
  `),
    [false, true, false, false, false],
  )
})

test('template interpolation before host objects preserves object boundaries', () => {
  assert.deepEqual(
    valid('const prefix = `value ${JSON.stringify({ id: 1 })} ${2}`;\n' + "{ type: 'tool', name: 'nomi_canvas_plan' }"),
    [true],
  )
})

test('Markdown fences retain line numbers and do not share host identity', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tool-refs-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'excerpt.md')
  fs.writeFileSync(
    file,
    [
      'Manifest excerpt:',
      '```ts',
      "{ name: 'nomi_canvas_plan', intent: 'plan', capabilityRefs: [], inputSchema: schema, outputSchema: result, ... },",
      '```',
      'MCP payload:',
      '```ts',
      "{ name: 'nomi_canvas_plan', arguments: {} }",
      '```',
      '```text',
      "{ name: 'nomi_unscanned_prose' }",
      '```',
    ].join('\n'),
  )
  const refs = scanFile(file, catalogs)
  assert.deepEqual(
    refs.map((ref) => ({ line: ref.line, valid: ref.catalog.has(ref.name) })),
    [
      { line: 3, valid: true },
      { line: 7, valid: false },
    ],
  )
})
