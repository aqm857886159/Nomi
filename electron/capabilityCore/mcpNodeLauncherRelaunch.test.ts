// 真进程用例：launcher 在「我拉起的 Nomi」崩溃 / 被杀 / 闲置自退（先清广告、进程拖几秒才结束）之后，
// 下一次调用必须重新拉起 Nomi 并成功，而不是白等 60 秒再报「冷启动未就绪」。
// 假 Nomi 无界面；广告与日志都在临时 NOMI_CAPABILITY_DIR，不碰真实 ~/.nomi。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import net from 'node:net'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

import { afterEach, describe, expect, it } from 'vitest'

type RpcFrame = { id?: unknown; result?: unknown; error?: { message?: string } }

const require = createRequire(import.meta.url)
const launcherSource = path.join(process.cwd(), 'electron', 'capabilityCore', 'mcpNodeLauncher.ts')
const tsxCli = require.resolve('tsx/cli')
const roots: string[] = []
const children = new Set<ChildProcessWithoutNullStreams>()

const FAKE_NOMI = `
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const cap = process.argv[2]
const lingerMs = Number(process.argv[3] || 0)
const advertFile = path.join(cap, 'instance.json')
fs.appendFileSync(path.join(cap, 'starts.log'), 'start ' + process.pid + '\\n')
const token = 'relaunch-token'
const server = http.createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    const frame = JSON.parse(body || '{}')
    if (frame.method === '__quit') {
      // Same order as the real app quitting: clear the advert first, the process lingers lingerMs before it ends.
      clearInterval(globalThis.hb)
      fs.rmSync(advertFile, { force: true })
      response.end(JSON.stringify({ ok: true, result: {} }))
      setTimeout(() => process.exit(0), lingerMs)
      return
    }
    const result = frame.method === 'project.list' ? { projects: [{ id: 'relaunched-' + process.pid }] } : {}
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, result }))
  })
})
server.listen(0, '127.0.0.1', () => {
  const write = () => fs.writeFileSync(advertFile, JSON.stringify({
    version: 2, pid: process.pid, port: server.address().port, token,
    startedAt: Date.now(), projectsRoot: cap, heartbeatAt: Date.now(), appVersion: 'test',
  }))
  write()
  globalThis.hb = setInterval(write, 1000)
})
`

function startLauncher(root: string, lingerMs: number) {
  const capabilityDir = path.join(root, 'capability')
  fs.mkdirSync(capabilityDir, { recursive: true })
  const fake = path.join(root, 'fake-nomi.mjs')
  fs.writeFileSync(fake, FAKE_NOMI, 'utf8')
  const token = crypto.randomBytes(32).toString('base64url')
  fs.writeFileSync(path.join(capabilityDir, 'token'), token, { encoding: 'utf8', mode: 0o600 })
  const proof = crypto.createHmac('sha256', token).update('nomi-mcp-client:v1:codex').digest('base64url')
  const child = spawn(process.execPath, [tsxCli, launcherSource], {
    env: {
      ...process.env,
      NOMI_CAPABILITY_DIR: capabilityDir,
      NOMI_MCP_APP_COMMAND: process.execPath,
      NOMI_MCP_APP_ARGS: JSON.stringify([fake, capabilityDir, String(lingerMs)]),
      NOMI_MCP_EXIT_BOOTSTRAPPED_APP: '1',
      NOMI_MCP_CLIENT: 'codex',
      NOMI_MCP_CLIENT_PROOF: proof,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.add(child)
  const pending = new Map<number, (frame: RpcFrame) => void>()
  let sequence = 0
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let frame: RpcFrame
    try { frame = JSON.parse(line) as RpcFrame } catch { return }
    pending.get(Number(frame.id))?.(frame)
  })
  const rpc = (method: string, params: Record<string, unknown> = {}) => new Promise<RpcFrame>((resolve) => {
    const id = ++sequence
    pending.set(id, resolve)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  return {
    rpc,
    init: () => rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
    readProjects: () => rpc('tools/call', { name: 'nomi_read', arguments: { target: 'projects' } }),
    advert: () => JSON.parse(fs.readFileSync(path.join(capabilityDir, 'instance.json'), 'utf8')) as { pid: number; port: number; token: string },
    starts: () => fs.readFileSync(path.join(capabilityDir, 'starts.log'), 'utf8').trim().split('\n').length,
    text: (frame: RpcFrame) => JSON.stringify(frame),
  }
}

afterEach(() => {
  for (const child of children) {
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  children.clear()
  // The fake Nomi is the launcher's child; NOMI_MCP_EXIT_BOOTSTRAPPED_APP ends it with the launcher.
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-relaunch-'))
  roots.push(root)
  return root
}

describe('mcpNodeLauncher relaunches a Nomi that went away', () => {
  it('killed Nomi + immediate next call -> relaunched and answered (no 60s dead wait)', async () => {
    const launcher = startLauncher(tempRoot(), 0)
    await launcher.init()
    expect(launcher.text(await launcher.readProjects())).toContain('relaunched-')
    expect(launcher.starts()).toBe(1)

    process.kill(launcher.advert().pid, 'SIGKILL')
    const second = await launcher.readProjects()

    expect(launcher.text(second)).toContain('relaunched-')
    expect(launcher.starts()).toBe(2)
  }, 30_000)

  it('advert already cleared but the process lingers while quitting -> next call waits for exit, relaunches, answers', async () => {
    const launcher = startLauncher(tempRoot(), 3_000)
    await launcher.init()
    await launcher.readProjects()
    const { port, token } = launcher.advert()
    const quit = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ method: '__quit', params: {} }),
    })
    expect(quit.ok).toBe(true) // advert is gone now, the process lingers for 3s

    const next = await launcher.readProjects()

    expect(launcher.text(next)).toContain('relaunched-')
    expect(launcher.starts()).toBe(2)
  }, 30_000)

  it('concurrent calls on a dead Nomi spawn exactly one replacement (single flight)', async () => {
    const launcher = startLauncher(tempRoot(), 0)
    await launcher.init()
    await launcher.readProjects()
    process.kill(launcher.advert().pid, 'SIGKILL')

    const frames = await Promise.all([launcher.readProjects(), launcher.readProjects(), launcher.readProjects()])

    for (const frame of frames) expect(launcher.text(frame)).toContain('relaunched-')
    expect(launcher.starts()).toBe(2)
  }, 30_000)

  it('advert looks alive (pid still exists, e.g. an unreaped zombie on Linux/macOS) but the port refuses -> treated as dead, relaunched, request not lost', async () => {
    const root = tempRoot()
    const capabilityDir = path.join(root, 'capability')
    fs.mkdirSync(capabilityDir, { recursive: true })
    const closedPort = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as net.AddressInfo
        probe.close(() => resolve(port))
      })
    })
    // pid = this test process: guaranteed "alive" to the launcher's liveness probe, nobody listens on the port.
    fs.writeFileSync(path.join(capabilityDir, 'instance.json'), JSON.stringify({
      version: 2, pid: process.pid, port: closedPort, token: 'dead', startedAt: Date.now(),
      projectsRoot: capabilityDir, heartbeatAt: Date.now(), appVersion: 'test',
    }))
    const launcher = startLauncher(root, 0)
    await launcher.init()

    const frame = await launcher.readProjects()

    expect(launcher.text(frame)).toContain('relaunched-')
    expect(launcher.starts()).toBe(1)
  }, 30_000)
})
