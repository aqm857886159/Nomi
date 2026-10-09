// 迁移后的条目「真连得上」：本机起真的 HTTP 服务（同 mcpHttpServer.test 的做法），迁移写出宿主配置，
// 再用 Nomi 自己的验证和（有装才跑的）真宿主命令行读它。
// - 第一组永远跑：verifyMcp 读回迁移后的条目，带身份头真握手。
// - 第二组只在 NOMI_REAL_HOST_HANDSHAKE=1 且本机有 claude / codex 时跑：临时 HOME + 临时 CLAUDE_CONFIG_DIR /
//   CODEX_HOME，绝不读写真实用户配置。Cursor / Claude Desktop / WorkBuddy 没法无界面握手，记 unverified。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let homeDir = ''
vi.mock('electron', () => ({
  app: { getAppPath: () => path.join(homeDir, 'repo'), getPath: () => homeDir, getVersion: () => '9.9.9', get isPackaged() { return true } },
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => homeDir }, homedir: () => homeDir }
})

import { installMcp } from './mcpConfig'
import { migrateMcpHostsToHttp } from './mcpHostMigration'
import { writeMcpHttpEndpoint } from './mcpHttpEndpoint'
import { startMcpHttpServer, type McpHttpServerHandle } from './mcpHttpServer'
import { createNomiMcpServer } from './mcpProtocol'
import { CAPABILITY_DIR_ENV, ensureToken } from './security'
import { verifyMcp } from './mcpVerify'

const roots: string[] = []
let server: McpHttpServerHandle

beforeEach(async () => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcpreal-'))
  roots.push(homeDir)
  const appCommand = path.join(homeDir, process.platform === 'win32' ? 'Nomi.exe' : 'Nomi')
  const script = path.join(homeDir, 'resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
  for (const file of [appCommand, script]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '', { mode: 0o755 })
  }
  vi.spyOn(process, 'execPath', 'get').mockReturnValue(appCommand)
  vi.stubEnv(CAPABILITY_DIR_ENV, path.join(homeDir, '.nomi-cap'))
  vi.stubEnv('USERPROFILE', homeDir)
  vi.stubEnv('HOME', homeDir)
  ensureToken()
  server = await startMcpHttpServer({
    port: 0,
    sessionFor: (identity) => createNomiMcpServer({
      invoke: async () => ({}),
      isAppOpen: () => true,
      getAuthenticatedClient: () => identity.connection.authenticatedClient,
    }),
  })
  // 稳定地址取显式覆盖：测试里服务在随机端口上，宿主配置写的就是这个端口。
  vi.stubEnv('NOMI_MCP_HTTP_PORT', String(server.port))
  writeMcpHttpEndpoint(server.port)
})
afterEach(async () => {
  await server.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function seed(client: 'claude' | 'codex'): void {
  if (client === 'claude') {
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(homeDir, '.claude', 'installed-marker'), '1')
  } else {
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), '[profiles.p]\nmodel = "m"\n')
  }
  expect(installMcp(client).ok).toBe(true)
}

describe('迁移后的条目：Nomi 自己的验证带身份头真握手', () => {
  it.each(['claude', 'codex'] as const)('%s：改过去之后读回 HTTP 条目，握手成功并拿到工具清单', async (client) => {
    seed(client)
    expect(migrateMcpHostsToHttp([client])[0]).toMatchObject({ ok: true })
    const result = await verifyMcp(client)
    expect(result).toMatchObject({ ok: true, reason: 'ok' })
    expect(result.toolCount).toBeGreaterThan(0)
  })

  it('身份头被改坏：验证报 client-auth-missing，不去连', async () => {
    seed('claude')
    migrateMcpHostsToHttp(['claude'])
    const file = path.join(homeDir, '.claude.json')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/("x-nomi-mcp-client-proof": ")[^"]+/, '$1bad'))
    expect(await verifyMcp('claude')).toMatchObject({ ok: false, reason: 'client-auth-missing' })
  })
})

/** 只杀自己起的那个进程树（Windows 上 shell 包装会让 child.kill 杀不到真进程）。 */
function stopTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'])
  else child.kill()
}

const REAL = process.env.NOMI_REAL_HOST_HANDSHAKE === '1'
// PATH 里找不到时（Windows 上 npm 的 shim）用环境变量给完整路径。
const CLAUDE = process.env.NOMI_REAL_HOST_CLAUDE || 'claude'
const CODEX = process.env.NOMI_REAL_HOST_CODEX || 'codex'
const has = (cmd: string): boolean => spawnSync(cmd, ['--version'], { shell: process.platform === 'win32', encoding: 'utf8' }).status === 0

describe.skipIf(!REAL)('真宿主握手（临时 HOME，不碰真实配置）', () => {
  it.skipIf(!has(CLAUDE))('Claude Code：claude mcp list 显示 nomi 已连接', async () => {
    seed('claude')
    expect(migrateMcpHostsToHttp(['claude'])[0]).toMatchObject({ ok: true })
    // 必须异步 spawn：spawnSync 会堵死本进程的事件循环，里面那个 HTTP 服务就没法应答。
    const child = spawn(CLAUDE, ['mcp', 'list'], {
      cwd: homeDir,
      shell: process.platform === 'win32',
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, CLAUDE_CONFIG_DIR: homeDir },
    })
    let text = ''
    child.stdout.on('data', (chunk) => { text += String(chunk) })
    child.stderr.on('data', (chunk) => { text += String(chunk) })
    await new Promise<void>((resolve) => { child.on('close', () => resolve()); setTimeout(() => { stopTree(child); resolve() }, 90_000) })
    console.log(`[real-host] claude mcp list ->\n${text}`)
    expect(text).toMatch(/nomi[^\n]*Connected/i)
  }, 120_000)

  it.skipIf(!has(CODEX))('Codex：app-server 的 mcpServerStatus/list 给出 nomi 的工具清单', async () => {
    seed('codex')
    expect(migrateMcpHostsToHttp(['codex'])[0]).toMatchObject({ ok: true })
    const child = spawn(CODEX, ['app-server'], {
      shell: process.platform === 'win32',
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, CODEX_HOME: path.join(homeDir, '.codex') },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('codex app-server timeout')), 100_000)
      let buffer = ''
      child.stdout.on('data', (chunk) => {
        buffer += String(chunk)
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          try {
            const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown> }
            if (message.id === 1) {
              child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
              child.stdin.write(`${JSON.stringify({ id: 2, method: 'mcpServerStatus/list', params: {} })}\n`)
            }
            if (message.id === 2) { clearTimeout(timer); resolve(message.result ?? {}) }
          } catch { /* 非 JSON 行忽略 */ }
        }
      })
      child.on('error', reject)
      child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'nomi-real-host-test', version: '1' } } })}\n`)
    }).finally(() => stopTree(child))
    console.log(`[real-host] codex mcpServerStatus/list -> ${JSON.stringify(reply).slice(0, 600)}`)
    const nomi = (reply.data as { name?: string; tools?: Record<string, unknown> }[] | undefined)?.find((s) => s.name === 'nomi')
    expect(Object.keys(nomi?.tools ?? {}).length).toBeGreaterThan(0)
  }, 150_000)
})
