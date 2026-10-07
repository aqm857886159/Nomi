import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMcpServerNames, buildCodexOverrides, compareFingerprints } from './mcp-real-client.mjs'

test('parses unique MCP headers including dotted and quoted names', () => {
  const config = '[mcp_servers.node_repl]\ncommand="x"\n[mcp_servers.node_repl]\n[mcp_servers."team.tools"]\n[mcp_servers."quoted\\\"name"]\n'
  assert.deepEqual(parseMcpServerNames(config), ['node_repl', 'team.tools', 'quoted"name'])
})

test('missing config produces only the nomi overrides', () => {
  assert.deepEqual(buildCodexOverrides('', { command: 'electron', args: ['.'] }), [
    'mcp_servers.nomi.enabled=true', 'mcp_servers.nomi.command="electron"', 'mcp_servers.nomi.args=["."]', 'mcp_servers.nomi.env={NOMI_MCP_STDIO="1"}',
  ])
})

test('overrides disable every configured server and preserve exact argv', () => {
  const result = buildCodexOverrides('[mcp_servers."foo.bar"]\n[mcp_servers.pencil]\n', { command: 'electron.exe', args: ['D:/repo', '--flag'], env: { NOMI_MCP_STDIO: '1', TEST: 'yes' } })
  assert.deepEqual(result.slice(0, 2), ['mcp_servers."foo.bar".enabled=false', 'mcp_servers.pencil.enabled=false'])
  assert.equal(result.at(-2), 'mcp_servers.nomi.args=["D:/repo","--flag"]')
})

test('fingerprints compare metadata structurally', () => {
  const before = { files: [{ path: 'x', mtimeMs: 1, size: 2 }], capability: [] }
  assert.equal(compareFingerprints(before, structuredClone(before)).equal, true)
  assert.equal(compareFingerprints(before, { ...before, files: [{ path: 'x', mtimeMs: 2, size: 2 }] }).equal, false)
})
