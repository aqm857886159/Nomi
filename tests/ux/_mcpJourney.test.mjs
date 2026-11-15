// 握手助手的超时预算：进程开口之前等的是「起进程」，开口之后才是调用方写的应答时限。
// 来由：走查重新分片后，握手走查成了那一片里第一个冷启动 Electron 的，冷启动 9.5 秒贴着调用方的 10 秒线，偶发红。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { MCP_COLD_START_BUDGET_MS, makeIsolatedDirs, spawnMcpStdioClient } from './_mcpJourney.mjs'

// 假服务：每个问都晚 SLOW_MS 才答；FIXTURE_EXIT=1 时一句不说就退出。
const SLOW_MS = 400
const FAKE_SERVER = `
const readline = require('node:readline')
if (process.env.FIXTURE_EXIT === '1') process.exit(3)
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line)
  setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { echoed: frame.method } }) + '\\n'), ${SLOW_MS})
})
`

const clients = []
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.terminate(200))) })

function spawnFake(env = {}) {
  const dirs = makeIsolatedDirs('nomi-mcp-helper-test-')
  const script = path.join(dirs.tempRoot, 'fake-server.cjs')
  fs.writeFileSync(script, FAKE_SERVER, 'utf8')
  const client = spawnMcpStdioClient({
    ...dirs,
    captureStderr: true,
    // ELECTRON_RUN_AS_NODE 让助手走「直接起 Node 传输」那条路，不去碰钥匙串后端。
    runtime: { command: process.execPath, args: [script], cwd: dirs.tempRoot, env: { ELECTRON_RUN_AS_NODE: '1', NOMI_MCP_APP_COMMAND: process.execPath, NOMI_MCP_APP_ARGS: '[]', ...env } },
  })
  clients.push(client)
  return client
}

describe('spawnMcpStdioClient 的超时预算', () => {
  test('进程开口之前的问，按冷启动预算等，不按调用方写的短时限', async () => {
    const client = spawnFake()
    const response = await client.rpc('initialize', {}, 50)
    expect(response.result).toEqual({ echoed: 'initialize' })
    expect(MCP_COLD_START_BUDGET_MS).toBeGreaterThan(SLOW_MS)
  })

  test('进程开口之后，调用方写的时限照旧生效', async () => {
    const client = spawnFake()
    await client.rpc('initialize', {}, 50)
    await expect(client.rpc('tools/list', {}, 50)).rejects.toThrow('RPC timeout: tools/list')
  })

  test('进程一句不说就退出：在等的问按「进程退出」失败，不是等到超时', async () => {
    const client = spawnFake({ FIXTURE_EXIT: '1' })
    await expect(client.rpc('initialize', {}, 50)).rejects.toThrow('MCP stdio server exited')
  })
})
