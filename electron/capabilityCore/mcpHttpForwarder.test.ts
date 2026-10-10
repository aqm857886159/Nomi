// #1142 复审阻断 3：Claude Desktop 转发口只把身份发给「本机此刻活着的那个 Nomi 的稳定地址」。
// 判据住在 mcpHttpEndpoint（liveForwarderUrl / forwarderFetch），转发口进程每个出站请求都过它。
// capability 目录指到临时目录、端口是测试自己开的计数服务器，不碰 ~/.nomi，也不碰任何宿主配置。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NOMI_UNREACHABLE_MESSAGE } from './mcpHttpBridge'
import { ForwarderTargetRefused, forwarderFetch, liveForwarderUrl, mcpHttpUrl, writeMcpHttpEndpoint } from './mcpHttpEndpoint'
import { ensureToken, signMcpClient } from './security'

const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')
const forwarderSource = path.join(process.cwd(), 'electron', 'capabilityCore', 'mcpHttpForwarder.ts')
const DEAD_PID = 2_147_483_000

type Seen = { method: string; url: string; client: string | undefined; proof: string | undefined }
let capabilityDir = ''
const servers: http.Server[] = []

/** 一个只记账的本机服务器：谁连过来、带没带身份头，一目了然。 */
async function countingServer(): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', client: req.headers['x-nomi-mcp-client'] as string | undefined, proof: req.headers['x-nomi-mcp-client-proof'] as string | undefined })
    req.resume()
    req.on('end', () => { res.writeHead(500); res.end() })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as { port: number }).port, seen }
}

function writeEndpoint(port: number, pid: number): void {
  fs.writeFileSync(path.join(capabilityDir, 'mcp-http.json'), JSON.stringify({ url: mcpHttpUrl(port), port, pid }))
}

beforeEach(() => {
  capabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-forwarder-'))
  vi.stubEnv('NOMI_CAPABILITY_DIR', capabilityDir)
  ensureToken()
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  fs.rmSync(capabilityDir, { recursive: true, force: true })
})

describe('liveForwarderUrl：三项全对才给地址', () => {
  it('端口 = 稳定端口、端点文件记的正是它、写它的进程活着 → 给；任一项不对 → null', () => {
    writeMcpHttpEndpoint(4242)
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '4242' })).toBe('http://127.0.0.1:4242/mcp')
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '4242', NOMI_MCP_HTTP_URL: 'http://127.0.0.1:4242/mcp' })).toBe('http://127.0.0.1:4242/mcp')
    // 宿主配置里的地址被改成别的端口 / 路径 / 主机
    for (const url of ['http://127.0.0.1:1/mcp', 'http://127.0.0.1:4242/other', 'http://evil.example:4242/mcp', 'http://localhost:4242/mcp']) {
      expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '4242', NOMI_MCP_HTTP_URL: url }), url).toBeNull()
    }
    // 没有稳定端口（显式随机 / 隔离目录又没给端口）
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '0' })).toBeNull()
    expect(liveForwarderUrl({ NOMI_CAPABILITY_DIR: capabilityDir })).toBeNull()
    // 端点文件记的是别的端口 / 写它的进程已经死了 / 没有端点文件（Nomi 没开）
    writeEndpoint(4243, process.pid)
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '4242' })).toBeNull()
    writeEndpoint(4242, DEAD_PID)
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '4242' })).toBeNull()
    fs.rmSync(path.join(capabilityDir, 'mcp-http.json'))
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '4242' })).toBeNull()
  })
})

describe('forwarderFetch：每个出站请求发出前重核，身份头只在核过之后加', () => {
  it('对上了：请求到达，带着这个宿主的身份头；对不上（别的端口 / 进程死了）：抛错，服务器一个请求都没收到', async () => {
    const live = await countingServer()
    const stray = await countingServer()
    const env = { NOMI_MCP_HTTP_PORT: String(live.port) }
    const proof = signMcpClient('claude-desktop')!
    const send = forwarderFetch('claude-desktop', proof, env)
    writeMcpHttpEndpoint(live.port)
    await (await send(mcpHttpUrl(live.port), { method: 'POST', body: '{}' })).text()
    expect(live.seen).toEqual([{ method: 'POST', url: '/mcp', client: 'claude-desktop', proof }])
    await expect(send(mcpHttpUrl(stray.port), { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ForwarderTargetRefused)
    await expect(send(`http://127.0.0.1:${live.port}/other`, { method: 'GET' })).rejects.toBeInstanceOf(ForwarderTargetRefused)
    writeEndpoint(live.port, DEAD_PID)
    await expect(send(mcpHttpUrl(live.port), { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ForwarderTargetRefused)
    expect(stray.seen).toEqual([])
    expect(live.seen).toHaveLength(1)
  })
})

/** 真转发口进程（tsx 跑 mcpHttpForwarder.ts）：喂一帧 initialize，拿回它给宿主的第一帧回复。 */
async function runForwarder(env: Record<string, string>): Promise<{ id?: number; error?: { message?: string } }> {
  const child = spawn(process.execPath, [tsxCli, forwarderSource], {
    env: { ...process.env, NOMI_CAPABILITY_DIR: capabilityDir, NOMI_MCP_CLIENT: 'claude-desktop', NOMI_MCP_CLIENT_PROOF: signMcpClient('claude-desktop')!, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  try {
    const reply = new Promise<{ id?: number; error?: { message?: string } }>((resolve, reject) => {
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        try { resolve(JSON.parse(line)) } catch { /* 非 JSON 行不是回复 */ }
      })
      child.on('exit', (code) => reject(new Error(`forwarder exited ${code} before replying`)))
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`)
    return await reply
  } finally {
    child.stdin.end()
    child.kill()
  }
}

describe('真转发口进程：宿主配置里的地址被改成本机别的端口，身份不出门', () => {
  it('地址指向本机另一个端口：宿主拿到「请先打开 Nomi」，那个端口和稳定端口都没收到任何请求', async () => {
    const stable = await countingServer()
    const stray = await countingServer()
    writeEndpoint(stable.port, process.pid)
    const reply = await runForwarder({ NOMI_MCP_HTTP_PORT: String(stable.port), NOMI_MCP_HTTP_URL: mcpHttpUrl(stray.port) })
    expect(reply).toMatchObject({ id: 7, error: { message: NOMI_UNREACHABLE_MESSAGE } })
    expect(stray.seen).toEqual([])
    expect(stable.seen).toEqual([])
  }, 30_000)

  it('稳定端口但写端点文件的 Nomi 已经不在了（端口可能已被别的程序占用）：同样不发', async () => {
    const stable = await countingServer()
    writeEndpoint(stable.port, DEAD_PID)
    const reply = await runForwarder({ NOMI_MCP_HTTP_PORT: String(stable.port), NOMI_MCP_HTTP_URL: mcpHttpUrl(stable.port) })
    expect(reply).toMatchObject({ id: 7, error: { message: NOMI_UNREACHABLE_MESSAGE } })
    expect(stable.seen).toEqual([])
  }, 30_000)

  it('阳性对照：稳定端口 + 端点文件对 + 进程活着 → 请求真的到达，带着身份头', async () => {
    const stable = await countingServer()
    writeEndpoint(stable.port, process.pid)
    await runForwarder({ NOMI_MCP_HTTP_PORT: String(stable.port), NOMI_MCP_HTTP_URL: mcpHttpUrl(stable.port) })
    expect(stable.seen.length).toBeGreaterThan(0)
    expect(stable.seen[0]).toMatchObject({ method: 'POST', url: '/mcp', client: 'claude-desktop' })
  }, 30_000)
})
