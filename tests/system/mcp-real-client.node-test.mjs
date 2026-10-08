import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { parseMcpServerNames, buildCodexOverrides, compareFingerprints } from './mcp-real-client.mjs'

const { mcpServerEntry } = tsxRequire('../../electron/capabilityCore/mcpConfig.ts', import.meta.url)

function isolatedEnv() {
  const root = path.join(os.tmpdir(), 'mcp-real-client-fixture')
  return { NOMI_MCP_STDIO: '1', NOMI_ELECTRON_USER_DATA_DIR: path.join(root, 'user-data'), NOMI_SETTINGS_DIR: root, NOMI_PROJECTS_DIR: path.join(root, 'projects'), NOMI_CAPABILITY_DIR: path.join(root, 'capability') }
}

test('parses unique MCP headers including dotted and quoted names', () => {
  const config = '[mcp_servers.node_repl]\ncommand="x"\n[mcp_servers.node_repl]\n[mcp_servers."team.tools"]\n[mcp_servers."quoted\\\"name"]\n'
  assert.deepEqual(parseMcpServerNames(config), ['node_repl', 'team.tools', 'quoted"name'])
})

test('missing config produces only the nomi overrides', () => {
  const env = isolatedEnv()
  const root = env.NOMI_SETTINGS_DIR
  assert.deepEqual(buildCodexOverrides('', { command: 'electron', args: ['.'], env }), [
    'mcp_servers.nomi.enabled=true', 'mcp_servers.nomi.command="electron"', 'mcp_servers.nomi.args=["."]', `mcp_servers.nomi.env={NOMI_MCP_STDIO="1",NOMI_ELECTRON_USER_DATA_DIR=${JSON.stringify(path.join(root, 'user-data'))},NOMI_SETTINGS_DIR=${JSON.stringify(root)},NOMI_PROJECTS_DIR=${JSON.stringify(path.join(root, 'projects'))},NOMI_CAPABILITY_DIR=${JSON.stringify(path.join(root, 'capability'))}}`,
  ])
})

test('Codex overrides fail closed when isolation env is incomplete or outside temp', () => {
  assert.throws(() => buildCodexOverrides('', { command: 'electron', args: [], env: { NOMI_MCP_STDIO: '1' } }), /missing NOMI_ELECTRON_USER_DATA_DIR/)
  const env = { NOMI_MCP_STDIO: '1', NOMI_ELECTRON_USER_DATA_DIR: 'C:/Users/user/AppData/Roaming/nomi', NOMI_SETTINGS_DIR: 'C:/Users/user/AppData/Roaming', NOMI_PROJECTS_DIR: 'C:/Users/user/AppData/Roaming/projects', NOMI_CAPABILITY_DIR: 'C:/Users/user/AppData/Roaming/capability' }
  assert.throws(() => buildCodexOverrides('', { command: 'electron', args: [], env }), /isolation root must be a child/)
})

test('Codex smoke uses the shared Node launcher entry and isolated runtime override', () => {
  const env = isolatedEnv()
  const entry = mcpServerEntry('codex', {
    appCommand: 'electron.exe',
    appArgs: ['D:/repo'],
    launcherCommand: process.execPath,
    launcherScript: 'D:/repo/dist-electron/capabilityCore/mcpNodeLauncher.js',
    kind: 'development',
    settingsDir: env.NOMI_SETTINGS_DIR,
  })
  assert.equal(entry.command, process.execPath)
  assert.deepEqual(entry.args, ['D:/repo/dist-electron/capabilityCore/mcpNodeLauncher.js'])
  assert.equal(entry.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(entry.env.NOMI_MCP_APP_COMMAND, 'electron.exe')
  assert.deepEqual(JSON.parse(entry.env.NOMI_MCP_APP_ARGS), ['D:/repo'])
})

test('overrides disable every configured server and preserve exact argv', () => {
  const env = isolatedEnv()
  const result = buildCodexOverrides('[mcp_servers."foo.bar"]\n[mcp_servers.pencil]\n', { command: 'electron.exe', args: ['D:/repo', '--flag'], env })
  assert.deepEqual(result.slice(0, 2), ['mcp_servers."foo.bar".enabled=false', 'mcp_servers.pencil.enabled=false'])
  assert.equal(result.at(-2), 'mcp_servers.nomi.args=["D:/repo","--flag"]')
})

test('fingerprints compare metadata structurally', () => {
  const before = { files: [{ path: 'x', mtimeMs: 1, size: 2 }], capability: [] }
  assert.equal(compareFingerprints(before, structuredClone(before)).equal, true)
  assert.equal(compareFingerprints(before, { ...before, files: [{ path: 'x', mtimeMs: 2, size: 2 }] }).equal, false)
})
