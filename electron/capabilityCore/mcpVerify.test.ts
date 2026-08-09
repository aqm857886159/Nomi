// 实连验证：「配置里有 nomi 这行字」≠「还连得上」。
// 这一层是专门为「UI 显示已接入、用户在助手里发消息却石沉大海」建的——用户机器上真实存在的两种失效：
//   ① 老版本写的 `node <repo>/scripts/nomi-mcp.mjs`（该脚本已随 5a40acbc 从仓库删除）；
//   ② 从 dev 构建点接入，args 钉在一条随时会被删的 git worktree 上。
// 故用例必须覆盖「命令没了」「起得来但握不上手」「真能握手」三种，且验的是**读回来的那条命令**。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let homeDir = ''

vi.mock('electron', () => ({
  app: { getAppPath: () => '/fake/repo', getPath: () => homeDir, isPackaged: false },
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => homeDir }, homedir: () => homeDir }
})

import { verifyMcp } from './mcpVerify'
import {
  MCP_CLIENT_ENV,
  MCP_CLIENT_PROOF_ENV,
  ensureToken,
  signMcpClient,
  type AuthenticatedMcpClient,
} from './security'

const roots: string[] = []
function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcpverify-'))
  roots.push(dir)
  return dir
}

/** 往 ~/.claude.json 写一条 nomi 条目（模拟「已接入」写下的配置）。 */
function signedEnv(client: AuthenticatedMcpClient): Record<string, string> {
  return {
    NOMI_MCP_STDIO: '1',
    [MCP_CLIENT_ENV]: client,
    [MCP_CLIENT_PROOF_ENV]: signMcpClient(client)!,
  }
}

function writeClaudeEntry(command: string, args: string[] = [], env = signedEnv('claude')): void {
  fs.writeFileSync(path.join(homeDir, '.claude.json'), JSON.stringify({ mcpServers: { nomi: { command, args, env } } }))
}

/** 造一个最小 stdio MCP server 脚本：回 initialize + tools/list。用它验「真握上手」这一路。 */
function fakeServerScript(toolCount: number): string {
  const file = path.join(homeDir, 'fake-server.mjs')
  fs.writeFileSync(
    file,
    `import readline from 'node:readline'
const tools = Array.from({length: ${toolCount}}, (_, i) => ({ name: 'nomi_t' + i }))
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const m = JSON.parse(line)
  if (m.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: {}, serverInfo: { name: 'fake', version: '1' } } }) + '\\n')
  else if (m.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id: m.id, result: { tools } }) + '\\n')
})
`,
  )
  return file
}

beforeEach(() => {
  homeDir = tempHome()
  ensureToken()
})
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('capabilityCore/mcpVerify', () => {
  it('压根没接入 → not-installed（不 spawn 任何东西）', async () => {
    const res = await verifyMcp('claude')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('not-installed')
  })

  it('配置指向的程序已经不在 → command-missing（老版本 scripts/nomi-mcp.mjs 被删就是这一类）', async () => {
    writeClaudeEntry(path.join(homeDir, 'gone', 'nomi-mcp.mjs'))
    const res = await verifyMcp('claude')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('command-missing')
    // 这条命令跟「我们现在会写的」不是一回事 → 陈旧，「重新接入」能直接治好。
    expect(res.stale).toBe(true)
  })

  it('命令在但握不上手 → handshake-failed（不许因为文件存在就报「已接入」）', async () => {
    const dud = path.join(homeDir, 'dud.mjs')
    fs.writeFileSync(dud, 'process.exit(3)')
    writeClaudeEntry(process.execPath, [dud])
    const res = await verifyMcp('claude')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('handshake-failed')
  })

  it('当前 Nomi 启动器缺少签名客户端身份 → 要求重新接入，不能假报完整可用', async () => {
    writeClaudeEntry(process.execPath, ['/fake/repo'], { NOMI_MCP_STDIO: '1' })
    const res = await verifyMcp('claude')
    expect(res).toMatchObject({ ok: false, reason: 'client-auth-missing', stale: true })
  })

  it('仍能握手的旧启动方式缺少签名身份也必须重新接入', async () => {
    writeClaudeEntry('node', [fakeServerScript(4)], { NOMI_MCP_STDIO: '1' })
    const res = await verifyMcp('claude')
    expect(res).toMatchObject({ ok: false, reason: 'client-auth-missing', stale: true })
  })

  // 真机走查抓到的误报：用户的老配置是 command:"node"（裸命令名靠 PATH 解析），
  // 早先版本用 existsSync(command) 判存在 → 恒 false → 每份走 PATH 的配置都被误报「程序不在了」。
  // 单测此前全喂绝对路径，五门全绿也照样放过去。这条专门钉住裸命令名不许被误判。
  it('裸命令名（node/npx，靠 PATH 解析）不许被误报成 command-missing', async () => {
    writeClaudeEntry('node', [fakeServerScript(4)])
    const res = await verifyMcp('claude')
    expect(res.reason).not.toBe('command-missing')
    expect(res.ok).toBe(true)
    expect(res.toolCount).toBe(4)
  })

  it('真能握手 → ok，并带回工具数与耗时（UI 拿它当「已接入」的证据）', async () => {
    writeClaudeEntry(process.execPath, [fakeServerScript(9)])
    const res = await verifyMcp('claude')
    expect(res.ok).toBe(true)
    expect(res.reason).toBe('ok')
    expect(res.toolCount).toBe(9)
    expect(res.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('Codex 走 TOML：能从 [mcp_servers.nomi] 块读回命令并验证（含我们写的超时/审批行）', async () => {
    const script = fakeServerScript(9)
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true })
    fs.writeFileSync(
      path.join(homeDir, '.codex', 'config.toml'),
      `[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.nomi]\ncommand = "${process.execPath}"\nargs = ["${script}"]\nstartup_timeout_sec = 60\ntool_timeout_sec = 600\ndefault_tools_approval_mode = "writes"\nenv = { NOMI_MCP_STDIO = "1", ${MCP_CLIENT_ENV} = "codex", ${MCP_CLIENT_PROOF_ENV} = "${signMcpClient('codex')}" }\n`,
    )
    const res = await verifyMcp('codex')
    expect(res.ok).toBe(true)
    expect(res.toolCount).toBe(9)
  })
})
