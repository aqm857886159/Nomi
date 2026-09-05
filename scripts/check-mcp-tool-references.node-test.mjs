import test from 'node:test'
import assert from 'node:assert/strict'
import { scanSource } from './check-mcp-tool-references-lib.mjs'

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
