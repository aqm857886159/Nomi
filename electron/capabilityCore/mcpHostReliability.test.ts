// MCP 真宿主实测 10-16 的 C-1 / C-2：连接检查不许挤掉真实工作会话；转发口遇到失效会话要自己重握手。
// 全部走官方 SDK 客户端实连本机服务（capability 目录在临时目录，身份现铸，不碰任何真实宿主配置 / 真实资料）。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./mcpHostEntries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mcpHostEntries')>()),
  isStableLocalMcpUrl: () => true,
}))

import { bridgeStdioToHttp, NOMI_INTERRUPTED_MESSAGE, NOMI_SESSION_LOST_MESSAGE, NOMI_UNREACHABLE_MESSAGE } from './mcpHttpBridge'
import { MCP_VERIFY_PROBE_NAME, mcpHttpIdentityHeaders } from './mcpHttpEndpoint'
import { startMcpHttpServer, type McpHttpServerHandle } from './mcpHttpServer'
import { createNomiMcpServer } from './mcpProtocol'
import { createTestMcpHost } from './__tests__/mcpHostTestUtils'
import { ensureToken, signMcpClient } from './security'
import { verifyHttpEntry } from './mcpVerifyHttp'

const previousCapabilityDir = process.env.NOMI_CAPABILITY_DIR
let capabilityDir: string
const servers: McpHttpServerHandle[] = []

const identity = (client: string) => mcpHttpIdentityHeaders(client, signMcpClient(client) ?? '')

function startServer(port = 0, maxSessions = 32): Promise<McpHttpServerHandle> {
  return startMcpHttpServer({
    port,
    maxSessions,
    sessionFor: (id) => createNomiMcpServer(createTestMcpHost({
      invoke: async () => ({}),
      isAppOpen: () => true,
      getAuthenticatedClient: () => id.connection.authenticatedClient,
    })),
  }).then((server) => { servers.push(server); return server })
}

beforeEach(() => {
  capabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-reliability-'))
  vi.stubEnv('NOMI_CAPABILITY_DIR', capabilityDir)
  ensureToken()
})
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => {})))
  if (previousCapabilityDir === undefined) vi.stubEnv('NOMI_CAPABILITY_DIR', undefined)
  else vi.stubEnv('NOMI_CAPABILITY_DIR', previousCapabilityDir)
  fs.rmSync(capabilityDir, { recursive: true, force: true })
})

async function realHostClient(url: string): Promise<Client> {
  const client = new Client({ name: 'codex-host', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: identity('codex') } }))
  return client
}

describe('C-1 连接检查不许累积服务端会话、挤掉真实工作会话', () => {
  it('在会话上限（4）下连查 30 次，真实宿主的会话仍可用，服务端没有累积探针会话', async () => {
    const server = await startServer(0, 4)
    const host = await realHostClient(server.url)
    const before = await host.listTools()
    const entry = { url: server.url, headers: identity('codex') }
    for (let index = 0; index < 30; index += 1) {
      const outcome = await verifyHttpEntry('codex', entry)
      expect(outcome.ok).toBe(true)
    }
    expect(server.sessionCount()).toBe(1)
    const after = await host.listTools()
    expect(after.tools.length).toBe(before.tools.length)
    await host.close()
  })

  it('类防线：即使某个客户端忘了结束探针会话，服务端挤的也是探针，不是真实会话', async () => {
    const server = await startServer(0, 3)
    const host = await realHostClient(server.url)
    // 泄漏的探针：握手后既不 DELETE 也不再来。
    for (let index = 0; index < 10; index += 1) {
      const probe = new Client({ name: MCP_VERIFY_PROBE_NAME, version: '1.0' })
      await probe.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: identity('codex') } }))
      await probe.listTools()
      // 故意不 terminateSession、也不 close()
    }
    expect(server.sessionCount()).toBeLessThanOrEqual(3)
    await expect(host.listTools()).resolves.toBeTruthy()
    await host.close()
  })
})

/** 事件驱动的收件箱：帧一到就唤醒等它的人；不设墙钟上限（永不成立由 vitest 的 testTimeout 兜底）。 */
class Inbox<T> {
  readonly items: T[] = []
  private waiters: Array<() => void> = []
  push(item: T): void {
    this.items.push(item)
    const waiting = this.waiters
    this.waiters = []
    for (const wake of waiting) wake()
  }
  async until<R>(find: () => R | undefined): Promise<R> {
    for (;;) {
      const found = find()
      if (found !== undefined) return found
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }
}

function bridgeHarness(url: string) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  type Frame = { id?: number | string; result?: unknown; error?: { message?: string } }
  const inbox = new Inbox<Frame>()
  const frames = inbox.items
  let buffer = ''
  stdout.setEncoding('utf8')
  stdout.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) inbox.push(JSON.parse(line))
  })
  const upstream = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: identity('claude-desktop') } })
  const bridged = bridgeStdioToHttp(new StdioServerTransport(stdin, stdout), upstream)
  const send = (message: unknown) => stdin.write(`${JSON.stringify(message)}\n`)
  const reply = (id: number) => inbox.until(() => frames.find((item) => item.id === id))
  const handshake = async () => {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-desktop', version: '1' } } })
    await reply(1)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }
  return { send, reply, handshake, frames, finish: async () => { stdin.end(); await bridged } }
}

describe('C-2 转发口：会话失效后自己重握手；错误文案如实区分', () => {
  it('Nomi 重启（同端口、旧会话号作废）后，宿主的下一次 tools/list 照常拿到结果，不说「请先打开 Nomi」', async () => {
    const first = await startServer()
    const port = first.port
    const bridge = bridgeHarness(first.url)
    await bridge.handshake()
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect((await bridge.reply(2)).result).toBeTruthy()

    await first.close()
    await startServer(port)

    bridge.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    const recovered = await bridge.reply(3)
    expect(recovered.error).toBeUndefined()
    expect((recovered.result as { tools?: unknown[] }).tools?.length).toBeGreaterThan(0)
    await bridge.finish()
  })

  it('会话被挤掉（服务还活着）也一样恢复；宿主看不到那个 404', async () => {
    const server = await startServer(0, 1)
    const bridge = bridgeHarness(server.url)
    await bridge.handshake()
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await bridge.reply(2)
    // 另一个客户端开会话，上限 1 ⇒ 转发口那条被挤掉。
    const other = await realHostClient(server.url)
    bridge.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    const recovered = await bridge.reply(3)
    expect(recovered.error).toBeUndefined()
    await other.close()
    await bridge.finish()
  })

  it('Nomi 真的没开：仍然说「请先打开 Nomi」（只有这一种情况才这么说）', async () => {
    const first = await startServer()
    const bridge = bridgeHarness(first.url)
    await bridge.handshake()
    await first.close()
    bridge.send({ jsonrpc: '2.0', id: 4, method: 'tools/list' })
    expect((await bridge.reply(4)).error?.message).toBe(NOMI_UNREACHABLE_MESSAGE)
    await bridge.finish()
  })

  it('重握手也不成（服务一律回 404）：说「会话已失效」，不冒充「Nomi 没开」，且不无限重试', async () => {
    let posts = 0
    const dead = http.createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        posts += 1
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } }))
      })
    })
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve))
    const port = (dead.address() as { port: number }).port
    const bridge = bridgeHarness(`http://127.0.0.1:${port}/mcp`)
    bridge.send({ jsonrpc: '2.0', id: 5, method: 'tools/list' })
    const failed = await bridge.reply(5)
    expect(failed.error?.message).toBe(NOMI_SESSION_LOST_MESSAGE)
    expect(posts).toBeLessThanOrEqual(4)
    await new Promise<void>((resolve) => dead.close(() => resolve()))
    await bridge.finish()
  })
})

// 连接状态不明（没拿到状态码）时的底线：写入 / 生成类请求绝不重发；只重发天然可重复的读请求。
describe('C-2 转发口：连接状态不明时不重放可能已生效的调用', () => {
  function fakeBridge(sendUpstream: (message: Record<string, unknown>) => Promise<void>) {
    const sentInbox = new Inbox<Record<string, unknown>>()
    const hostInbox = new Inbox<Record<string, unknown>>()
    const sentUpstream = sentInbox.items
    const toHost = hostInbox.items
    const upstream = {
      onmessage: undefined as ((m: unknown) => void) | undefined,
      onclose: undefined, onerror: undefined,
      start: async () => {},
      close: async () => {},
      terminateSession: async () => {},
      setProtocolVersion: () => {},
      send: async (message: Record<string, unknown>) => {
        sentInbox.push(message)
        await sendUpstream(message)
        if (message.method === 'initialize' || message.method === 'ping') upstream.onmessage?.({ jsonrpc: '2.0', id: message.id, result: {} })
      },
    }
    const downstream = {
      onmessage: undefined as ((m: unknown) => void) | undefined,
      onclose: undefined, onerror: undefined,
      start: async () => {},
      close: async () => {},
      send: async (message: Record<string, unknown>) => { hostInbox.push(message) },
    }
    void bridgeStdioToHttp(downstream as never, upstream as never)
    return { sentUpstream, toHost, sentInbox, hostInbox, host: (message: unknown) => downstream.onmessage?.(message) }
  }
  const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })

  it('tools/call 撞上被重置的连接、会话也丢了：重握手但不重发这次调用，如实说「可能已执行」', async () => {
    let alive = false
    const fake = fakeBridge(async (message) => {
      if (message.method === 'initialize') { alive = true; return }
      if (message.method === 'tools/call' && !alive) throw new Error('fetch failed')
      if (message.method === 'ping' && !alive) throw httpError(404)
    })
    fake.host({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
    await fake.sentInbox.until(() => fake.sentUpstream.find((m) => m.method === 'initialize'))
    alive = false
    fake.host({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nomi_generation_plan' } })
    await fake.hostInbox.until(() => fake.toHost.find((m) => m.id === 2))
    expect((fake.toHost.find((m) => m.id === 2) as { error: { message: string } }).error.message).toBe(NOMI_INTERRUPTED_MESSAGE)
    expect(fake.sentUpstream.filter((m) => m.method === 'tools/call')).toHaveLength(1)
  })

  it('同样的处境下 tools/list 是读请求：重握手后重发，宿主拿到结果', async () => {
    let alive = false
    const fake = fakeBridge(async (message) => {
      if (message.method === 'initialize') { alive = true; return }
      if (message.method === 'tools/list' && !alive) throw new Error('fetch failed')
      if (message.method === 'ping' && !alive) throw httpError(404)
    })
    fake.host({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
    await fake.sentInbox.until(() => fake.sentUpstream.find((m) => m.method === 'initialize'))
    alive = false
    fake.host({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await fake.sentInbox.until(() => (fake.sentUpstream.filter((m) => m.method === 'tools/list').length >= 2 ? true : undefined))
    expect(fake.toHost.find((m) => m.id === 2 && m.error)).toBeUndefined()
  })
})
