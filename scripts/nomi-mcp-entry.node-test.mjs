// 旧 MCP 入口墓碑的回归测试：**跑真实的旧路径**（宿主配置里逐字写着的那条命令），
// 断言它在 stderr 里说人话、并以可分诊的退出码结束。
//
// 会红的证据（修复前）：`scripts/nomi-mcp.mjs` 不存在 → node 打 `MODULE_NOT_FOUND`、退出码 1，
// stderr 里一个 Nomi 字都没有，宿主只看得到 CONNECTION_CLOSED。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const legacyEntry = path.join(repoRoot, 'scripts', 'nomi-mcp.mjs')

test('the retired MCP entry point tells the host how to re-connect instead of dying silently', () => {
  const run = spawnSync(process.execPath, [legacyEntry], { encoding: 'utf8' })
  assert.equal(run.error, undefined, 'the legacy path must still resolve to a runnable file')
  assert.equal(run.status, 2, 'exit code 2 marks a stale host config, distinct from node crash code 1')
  const stderr = run.stderr ?? ''
  assert.match(stderr, /Nomi MCP 入口已迁移/, 'the Chinese migration line must be present')
  assert.match(stderr, /接入 AI 编程助手/, 'the notice must name the exact place to re-connect')
  assert.match(stderr, /entry point has moved/, 'the English migration line must be present')
  assert.match(stderr, /Connect an AI coding assistant/, 'the English notice must name the same place')
  assert.equal(run.stdout, '', 'stdout is the JSON-RPC channel; the signpost must never write to it')
})

test('the signpost never pretends to be an MCP server', async () => {
  const module = await import(legacyEntry)
  assert.equal(module.STALE_ENTRY_EXIT_CODE, 2)
  assert.doesNotMatch(module.migrationNotice(), /jsonrpc/i, 'no protocol framing lives in the signpost')
})
