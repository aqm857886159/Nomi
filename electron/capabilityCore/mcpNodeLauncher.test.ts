import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

import { afterEach, describe, expect, it } from 'vitest'

import { instanceAdvertFileName } from './instanceAdvert'

type RpcFrame = { id?: unknown; result?: Record<string, unknown>; error?: { message?: string } }

const require = createRequire(import.meta.url)
const launcherSource = path.join(process.cwd(), 'electron', 'capabilityCore', 'mcpNodeLauncher.ts')
const tsxCli = require.resolve('tsx/cli')
const roots: string[] = []
const children = new Set<ChildProcessWithoutNullStreams>()
const fakeServers: import('node:http').Server[] = []

function installedClientIdentity(capabilityDir: string) {
  fs.mkdirSync(capabilityDir, { recursive: true })
  const tokenPath = path.join(capabilityDir, 'token')
  const token = fs.existsSync(tokenPath)
    ? fs.readFileSync(tokenPath, 'utf8').trim()
    : crypto.randomBytes(32).toString('base64url')
  if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
  return {
    client: 'codex',
    proof: crypto.createHmac('sha256', token).update('nomi-mcp-client:v1:codex').digest('base64url'),
  }
}

function fakeNomiScript(root: string): string {
  const target = path.join(root, 'fake-nomi.mjs')
  fs.writeFileSync(target, `
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const capabilityDir = process.argv[2]
fs.mkdirSync(capabilityDir, { recursive: true })
const lockPath = path.join(capabilityDir, 'fake-app.lock')
let lock
try {
  lock = fs.openSync(lockPath, 'wx')
} catch {
  process.exit(0)
}

const token = 'launcher-race-token'
const server = http.createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    const frame = JSON.parse(body || '{}')
    const result = frame.method === 'project.list' ? { projects: [{ id: 'race-project' }] } : {}
    const payload = JSON.stringify({ ok: true, result })
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
    response.end(payload)
  })
})

const cleanup = () => {
  try { fs.closeSync(lock) } catch {}
  try { fs.rmSync(lockPath, { force: true }) } catch {}
  try { fs.rmSync(path.join(capabilityDir, 'instance.json'), { force: true }) } catch {}
}
process.on('SIGTERM', () => server.close(() => { cleanup(); process.exit(0) }))
process.on('exit', cleanup)

setTimeout(() => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    // v2 广告：带 projectsRoot（这个 fake 用 capabilityDir 当占位库根）+ 心跳。launcher 的期望库根在本用例是
    // null（未设 NOMI_PROJECTS_DIR → 默认库，读 instance.json），故 validateAdvert 跳过库全等 → match。
    fs.writeFileSync(path.join(capabilityDir, 'instance.json'), JSON.stringify({
      version: 2,
      pid: process.pid,
      port: address.port,
      token,
      startedAt: Date.now(),
      projectsRoot: capabilityDir,
      heartbeatAt: Date.now(),
      appVersion: 'test',
    }))
  })
}, 250)
`, 'utf8')
  return target
}

function startLauncher(capabilityDir: string, fakeApp: string) {
  const identity = installedClientIdentity(capabilityDir)
  const child = spawn(process.execPath, [tsxCli, launcherSource], {
    env: {
      ...process.env,
      NOMI_CAPABILITY_DIR: capabilityDir,
      NOMI_MCP_APP_COMMAND: process.execPath,
      NOMI_MCP_APP_ARGS: JSON.stringify([fakeApp, capabilityDir]),
      NOMI_MCP_EXIT_BOOTSTRAPPED_APP: '1',
      NOMI_MCP_CLIENT: identity.client,
      NOMI_MCP_CLIENT_PROOF: identity.proof,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.add(child)
  const pending = new Map<number, { resolve: (frame: RpcFrame) => void; reject: (error: Error) => void }>()
  let sequence = 0
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let frame: RpcFrame
    try { frame = JSON.parse(line) as RpcFrame } catch { return }
    const id = Number(frame.id)
    const waiter = pending.get(id)
    if (!waiter) return
    pending.delete(id)
    waiter.resolve(frame)
  })
  child.on('exit', (code, signal) => {
    children.delete(child)
    for (const waiter of pending.values()) waiter.reject(new Error(`launcher exited code=${code} signal=${signal}: ${stderr}`))
    pending.clear()
  })
  const rpc = (method: string, params: Record<string, unknown> = {}) => new Promise<RpcFrame>((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  return { child, rpc }
}

afterEach(async () => {
  for (const child of children) {
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  children.clear()
  for (const server of fakeServers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 50))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// ── 库指纹握手（§P3-F）的真进程用例 ─────────────────────────────────────────────────
// 这些用例驱动**真实 launcher 进程**（tsx 跑 mcpNodeLauncher.ts）读一个合成广告 + 一个我们自己拥有的活 PID
// （长睡子进程），命中的是真实 reader 代码路径，无需拉起整个 app（DANGER ZONE：只用临时 NOMI_CAPABILITY_DIR /
// NOMI_PROJECTS_DIR，绝不碰真实 ~/.nomi 或真实库）。
const FAST_FAIL_BUDGET_MS = 10_000

/** 起一个长睡子进程当「活 pid」来源（advert 的 pid 指它）。测试拥有它，afterEach 统一收。 */
function spawnSleeper(): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: ['pipe', 'pipe', 'pipe'] })
  children.add(child)
  return child
}

/**
 * 起一个假 RPC HTTP server：project.list 返回带 marker 的项目列表；写一个 v2 广告到指定文件名指向它。
 * 用来证明「若 launcher 连了它，就会拿到 marker 项目」——从而反证隔离/快速失败时**从未**连它。
 */
async function startFakeRpc(marker: string): Promise<{ port: number; requests: Array<Record<string, string | string[] | undefined>> }> {
  const http = await import('node:http')
  const requests: Array<Record<string, string | string[] | undefined>> = []
  const server = http.createServer((request, response) => {
    requests.push({ ...request.headers })
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const frame = JSON.parse(body || '{}')
      const result = frame.method === 'project.list' ? { projects: [{ id: marker }] } : {}
      const payload = JSON.stringify({ ok: true, result })
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
      response.end(payload)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  fakeServers.push(server)
  return { port, requests }
}

async function startFakeRpcFailure(error: Record<string, unknown>): Promise<{ port: number }> {
  const http = await import('node:http')
  const server = http.createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const payload = JSON.stringify({ ok: false, error })
      response.writeHead(403, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
      response.end(payload)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  fakeServers.push(server)
  return { port }
}

async function startRedirectingRpc(): Promise<{
  port: number
  sourceRequests: Array<Record<string, string | string[] | undefined>>
  targetRequests: Array<Record<string, string | string[] | undefined>>
}> {
  const http = await import('node:http')
  const targetRequests: Array<Record<string, string | string[] | undefined>> = []
  const target = http.createServer((request, response) => {
    targetRequests.push({ ...request.headers })
    request.resume()
    request.on('end', () => {
      const payload = JSON.stringify({ ok: true, result: { projects: [{ id: 'redirect-leak' }] } })
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
      response.end(payload)
    })
  })
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', () => resolve()))
  fakeServers.push(target)
  const targetPort = (target.address() as { port: number }).port
  const sourceRequests: Array<Record<string, string | string[] | undefined>> = []
  const source = http.createServer((request, response) => {
    sourceRequests.push({ ...request.headers })
    request.resume()
    request.on('end', () => {
      response.writeHead(307, { location: `http://127.0.0.1:${targetPort}/stolen` })
      response.end()
    })
  })
  await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', () => resolve()))
  fakeServers.push(source)
  return { port: (source.address() as { port: number }).port, sourceRequests, targetRequests }
}

/** 写一份 v2 广告 JSON 到 capabilityDir 下指定文件名。 */
function writeAdvert(capabilityDir: string, fileName: string, advert: Record<string, unknown>): void {
  fs.mkdirSync(capabilityDir, { recursive: true })
  fs.writeFileSync(path.join(capabilityDir, fileName), JSON.stringify(advert), 'utf8')
}

/** 参数化 launcher 启动器：可注入 NOMI_PROJECTS_DIR、可选 app 命令（默认给一个从不广告的 no-op，避免误冷启）。 */
function startLauncherWith(opts: {
  capabilityDir: string
  projectsDir?: string
  appCommand?: string
  appArgs?: string[]
}) {
  const identity = installedClientIdentity(opts.capabilityDir)
  const env: Record<string, string> = {
    ...process.env,
    NOMI_CAPABILITY_DIR: opts.capabilityDir,
    // 默认 app 命令 = 立即退出的 no-op：冷启路走到它会「兄弟进程正常退出」，不会误产生一个真广告。
    NOMI_MCP_APP_COMMAND: opts.appCommand ?? process.execPath,
    NOMI_MCP_APP_ARGS: JSON.stringify(opts.appArgs ?? ['-e', 'process.exit(0)']),
    NOMI_MCP_CLIENT: identity.client,
    NOMI_MCP_CLIENT_PROOF: identity.proof,
  }
  if (opts.projectsDir) env.NOMI_PROJECTS_DIR = opts.projectsDir
  const child = spawn(process.execPath, [tsxCli, launcherSource], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  children.add(child)
  const pending = new Map<number, { resolve: (frame: RpcFrame) => void; reject: (error: Error) => void }>()
  let sequence = 0
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let frame: RpcFrame
    try { frame = JSON.parse(line) as RpcFrame } catch { return }
    const id = Number(frame.id)
    const waiter = pending.get(id)
    if (!waiter) return
    pending.delete(id)
    waiter.resolve(frame)
  })
  child.on('exit', (code, signal) => {
    children.delete(child)
    for (const waiter of pending.values()) waiter.reject(new Error(`launcher exited code=${code} signal=${signal}: ${stderr}`))
    pending.clear()
  })
  const rpc = (method: string, params: Record<string, unknown> = {}) => new Promise<RpcFrame>((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  return { child, rpc }
}

describe('mcpNodeLauncher library fingerprint handshake', () => {
  it('never forwards client proof or connection attestation across a loopback redirect', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-redirect-'))
    roots.push(root)
    const capabilityDir = path.join(root, 'capability')
    const projectsDir = path.join(root, 'projects')
    const redirect = await startRedirectingRpc()
    writeAdvert(capabilityDir, instanceAdvertFileName(projectsDir, false), {
      version: 2,
      pid: process.pid,
      port: redirect.port,
      token: 'redirect-source-token',
      startedAt: Date.now(),
      projectsRoot: projectsDir,
      heartbeatAt: Date.now(),
      appVersion: 'test',
    })
    const launcher = startLauncherWith({ capabilityDir, projectsDir })
    await launcher.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'redirect-test', version: '1' },
    })

    const response = await launcher.rpc('tools/call', { name: 'nomi_read', arguments: { target: 'projects' } })

    expect(redirect.sourceRequests).toHaveLength(1)
    expect(redirect.targetRequests).toEqual([])
    expect(redirect.targetRequests.flatMap((headers) => [
      headers['x-nomi-mcp-client-proof'],
      headers['x-nomi-mcp-connection-attestation'],
    ].filter(Boolean))).toEqual([])
    expect(response.result?.isError).toBe(true)
  })

  it.each([
    ['lease_expired', 'Project session lease has expired'],
    ['lease_revoked', 'Project session lease has been revoked'],
  ])('preserves typed %s RPC failures through the whole MCP frame', async (code, message) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-mcp-${code}-`))
    roots.push(root)
    const capabilityDir = path.join(root, 'capability')
    const projectsDir = path.join(root, 'projects')
    const fake = await startFakeRpcFailure({
      code,
      message,
      nextAction: 'Open a new project session and retry',
      capability: 'canvas.read',
    })
    writeAdvert(capabilityDir, instanceAdvertFileName(projectsDir, false), {
      version: 2,
      pid: process.pid,
      port: fake.port,
      token: 'typed-error-token',
      startedAt: Date.now(),
      projectsRoot: projectsDir,
      heartbeatAt: Date.now(),
      appVersion: 'test',
    })
    const launcher = startLauncherWith({ capabilityDir, projectsDir })
    await launcher.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'typed-error-test', version: '1' },
    })

    const response = await launcher.rpc('tools/call', {
      name: 'nomi_read',
      arguments: { target: 'canvas', projectId: 'project-1', leaseHandle: 'opaque-project-lease' },
    })
    const serialized = JSON.stringify(response)
    const outcome = response.result?.structuredContent as { nomiOutcome?: Record<string, unknown> } | undefined

    expect(response.result?.isError).toBe(true)
    expect(outcome?.nomiOutcome).toMatchObject({
      errorCode: code,
      message,
      nextAction: 'Open a new project session and retry',
      capability: 'canvas.read',
    })
    expect(serialized).not.toContain('[object Object]')
  })

  it('keeps one private transport attestation stable within a launcher and distinct across launcher connections', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-connection-headers-'))
    roots.push(root)
    const capabilityDir = path.join(root, 'capability')
    const projectsDir = path.join(root, 'projects')
    const fake = await startFakeRpc('CONNECTION-HEADERS')
    writeAdvert(capabilityDir, instanceAdvertFileName(projectsDir, false), {
      version: 2,
      pid: process.pid,
      port: fake.port,
      token: 'connection-header-token',
      startedAt: Date.now(),
      projectsRoot: projectsDir,
      heartbeatAt: Date.now(),
      appVersion: 'test',
    })
    const first = startLauncherWith({ capabilityDir, projectsDir })
    const second = startLauncherWith({ capabilityDir, projectsDir })
    for (const launcher of [first, second]) {
      await launcher.rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'connection-header-test', version: '1' },
      })
    }

    await first.rpc('tools/call', { name: 'nomi_read', arguments: { target: 'projects' } })
    await first.rpc('tools/call', { name: 'nomi_read', arguments: { target: 'projects' } })
    await second.rpc('tools/call', { name: 'nomi_read', arguments: { target: 'projects' } })

    const [firstCall, firstAgain, secondCall] = fake.requests
    expect(firstCall?.['x-nomi-mcp-connection-attestation']).toBe(firstAgain?.['x-nomi-mcp-connection-attestation'])
    expect(firstCall?.['x-nomi-mcp-connection-attestation']).not.toBe(secondCall?.['x-nomi-mcp-connection-attestation'])
    expect(firstCall?.['x-nomi-mcp-session-id']).toBeUndefined()
    expect(firstCall?.['x-nomi-mcp-connection-nonce']).toBeUndefined()
    expect(firstCall).toMatchObject({ 'x-nomi-mcp-client': 'codex' })
  })

  it('fast-fails (≤10s) with BOTH library roots when a hijacker advertises a different library, and never returns its projects', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-hijack-'))
    roots.push(root)
    const capabilityDir = path.join(root, 'capability')
    const myLibrary = path.join(root, 'my-projects') // 我这个客户端要用的库
    const hijackLibrary = path.join(root, 'walkthrough-fixtures') // 抢注者服务的走查库

    // 抢注者：一个活 pid（我们拥有的长睡进程）+ 一个真会返回 fixture 项目的 RPC server，广告落**我期望库的
    // 命名空间文件**里、但 projectsRoot 指向走查库 → 制造 mismatch。若 launcher 连了它就会拿到 'HIJACKED-fixture'。
    const sleeper = spawnSleeper()
    const fake = await startFakeRpc('HIJACKED-fixture')
    const fileName = instanceAdvertFileName(myLibrary, false) // launcher 设了 NOMI_PROJECTS_DIR=myLibrary → 读这个文件
    writeAdvert(capabilityDir, fileName, {
      version: 2, pid: sleeper.pid, port: fake.port, token: 't',
      startedAt: Date.now(), projectsRoot: hijackLibrary, heartbeatAt: Date.now(), appVersion: 'fixture',
    })

    const launcher = startLauncherWith({ capabilityDir, projectsDir: myLibrary })
    await launcher.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hijack-test', version: '1' } })

    const startedAt = Date.now()
    const response = await launcher.rpc('tools/call', { name: 'nomi_read', arguments: { target: 'projects' } })
    const elapsed = Date.now() - startedAt

    expect(elapsed).toBeLessThan(FAST_FAIL_BUDGET_MS)
    const serialized = JSON.stringify(response)
    // 永不串库：绝不返回走查库的项目 marker。
    expect(serialized).not.toContain('HIJACKED-fixture')
    // 人话报错含两个库根 + 两条出路。
    const resultContent = Array.isArray(response.result?.content) ? response.result.content : []
    const visibleText = resultContent.find((item) => item && typeof item === 'object' && 'text' in item) as { text?: unknown } | undefined
    const message = response.error?.message || (typeof visibleText?.text === 'string' ? visibleText.text : serialized)
    expect(message).toContain(myLibrary)
    expect(message).toContain(hijackLibrary)
    expect(message).toMatch(/重启 Nomi/)
    expect(message).toMatch(/关掉/)
  }, 20_000)

  it('namespace isolation: a default-root reader ignores a custom-root advert entirely', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-namespace-'))
    roots.push(root)
    const capabilityDir = path.join(root, 'capability')
    const customLibrary = path.join(root, 'custom-projects')

    // 自定义库写者：把 v2 广告写到 instance-<hash(custom)>.json，指向一个会返回 'CUSTOM-only' 的 RPC server。
    const sleeper = spawnSleeper()
    const custom = await startFakeRpc('CUSTOM-only')
    writeAdvert(capabilityDir, instanceAdvertFileName(customLibrary, false), {
      version: 2, pid: sleeper.pid, port: custom.port, token: 't',
      startedAt: Date.now(), projectsRoot: customLibrary, heartbeatAt: Date.now(), appVersion: 'custom',
    })
    // 明确断言：命名空间文件名不是默认 instance.json（结构隔离前提）。
    expect(instanceAdvertFileName(customLibrary, false)).not.toBe('instance.json')

    // 默认库读者（不设 NOMI_PROJECTS_DIR → 读 instance.json，此刻不存在）。给它一个 app 命令：稍后写**默认**广告
    // 指向一个只返回 'DEFAULT-lib' 的 server → 证明 launcher 只认默认文件、彻底无视旁边的自定义广告。
    const fallbackApp = path.join(root, 'fallback-app.mjs')
    const defaultRpc = await startFakeRpc('DEFAULT-lib')
    fs.writeFileSync(fallbackApp, `
import fs from 'node:fs'
import path from 'node:path'
const capabilityDir = process.argv[2]
const port = Number(process.argv[3])
const lockPath = path.join(capabilityDir, 'fallback.lock')
try { fs.openSync(lockPath, 'wx') } catch { process.exit(0) }
setTimeout(() => {
  fs.writeFileSync(path.join(capabilityDir, 'instance.json'), JSON.stringify({
    version: 2, pid: process.pid, port, token: 't',
    startedAt: Date.now(), projectsRoot: ${JSON.stringify(path.join(root, 'default-lib'))}, heartbeatAt: Date.now(), appVersion: 'default',
  }))
}, 150)
setTimeout(() => process.exit(0), 5_000)
`, 'utf8')

    const launcher = startLauncherWith({
      capabilityDir,
      appCommand: process.execPath,
      appArgs: [fallbackApp, capabilityDir, String(defaultRpc.port)],
    })
    await launcher.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'namespace-test', version: '1' } })
    const response = await launcher.rpc('tools/call', { name: 'nomi_read', arguments: { target: 'projects' } })

    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('CUSTOM-only') // 自定义库广告被无视
    expect(serialized).toContain('DEFAULT-lib') // 只连了默认库广告
  }, 20_000)
})

describe('mcpNodeLauncher cold start', () => {
  it('lets concurrent helpers share the single Nomi instance that wins the launch race', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-launcher-race-'))
    roots.push(root)
    const capabilityDir = path.join(root, 'capability')
    const fakeApp = fakeNomiScript(root)
    const first = startLauncher(capabilityDir, fakeApp)
    const second = startLauncher(capabilityDir, fakeApp)

    await Promise.all([first, second].map(({ rpc }) => rpc('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'launcher-race-test', version: '1' },
    })))
    const responses = await Promise.all([first, second].map(({ rpc }) => rpc('tools/call', {
      name: 'nomi_read', arguments: { target: 'projects' },
    })))

    for (const response of responses) {
      expect(response.error).toBeUndefined()
      expect(JSON.stringify(response.result)).toContain('race-project')
    }
  }, 15_000)
})
