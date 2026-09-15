import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanCallArgumentKeys, scanFile, scanSource } from './check-mcp-tool-references-lib.mjs'

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

test('keeps intentional host fixture names on the agent catalog', () => {
  const hostDeclared = new Set(['nomi_canvas_plan'])
  const refs = scanSource("reply: { type: 'tool', id: '1', name: 'nomi_canvas_plan' }", { declared, hostDeclared })
  assert.equal(refs.length, 1)
  assert.equal(refs[0].catalog, hostDeclared)
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

// 入参形状（2026-09-15）：名字对得上不等于入参对得上。#797 把三个工具的入参从 `operation`
// 改成派生形状，单测都改了、五个调用点漏了（四个在本 PR、一个在 main 上躺着），而名字门岗全绿。
test('reads the top-level argument keys of a literal call, shorthand included', () => {
  const calls = scanCallArgumentKeys(`
    await mcp.callTool('nomi_timeline_read', { leaseHandle, projectId, operation: 'read_timeline' })
    await call(mcp, 'nomi_read', { target: 'artifact', nested: { deep: 1 }, 'quoted': 2 })
  `)
  assert.deepEqual(
    calls.map((call) => [call.name, call.keys.map((entry) => entry.key)]),
    [
      ['nomi_timeline_read', ['leaseHandle', 'projectId', 'operation']],
      ['nomi_read', ['target', 'nested', 'quoted']],
    ],
  )
})

// 这条是阳性对照：不处理模板字面量的 `${}`，整个文件从第一个模板起就被错误分词。
// 实测代价——同一份 e2e 文件，不处理时扫出 0 处调用，处理后扫出 49 处。
test('keeps lexing after a template literal instead of silently scanning nothing', () => {
  const calls = scanCallArgumentKeys(`
    const label = \`run \${runId} done\`
    await mcp.callTool('nomi_read', { target: 'run', runId })
  `)
  assert.deepEqual(calls.map((call) => call.name), ['nomi_read'])
})

// 判不出来的就别装判得出：展开运算符把顶层键变成运行期才知道的东西，这种调用整条跳过，
// 而不是拿看得见的那几个键当全部（那会把「传了多余字段」判成通过）。
test('skips calls whose argument object is spread, rather than half-checking them', () => {
  assert.deepEqual(scanCallArgumentKeys("await mcp.callTool('nomi_read', { target: 'run', ...rest })"), [])
})
