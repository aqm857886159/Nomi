// 本机 HTTP 直连只属于 HTTP 的那几条边界（协议行为的 38 条在 mcpWireContract.test.ts 里四种连接器各跑一遍）：
// 只听 127.0.0.1、Host / Origin 只认本机（防 DNS 重绑定）、会话不许换人、端口怎么选、宿主配置那一条长什么样、
// 转发口在 Nomi 没开时给宿主回什么。capability 目录指到临时目录，token 现铸，不碰 ~/.nomi。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bridgeStdioToHttp, NOMI_UNREACHABLE_MESSAGE } from './mcpHttpBridge'
import {
  buildMcpHttpHostEntry, MCP_HTTP_DEFAULT_PORT, mcpHttpIdentityHeaders, readMcpHttpEndpoint,
  liveForwarderUrl, resolveMcpHttpPort, writeMcpHttpEndpoint, clearMcpHttpEndpoint,
} from './mcpHttpEndpoint'
import { startMcpHttpServer, type McpHttpServerHandle } from './mcpHttpServer'
import { createNomiMcpServer } from './mcpProtocol'
import { ensureToken, signMcpClient, verifyMcpClient } from './security'

const previousCapabilityDir = process.env.NOMI_CAPABILITY_DIR
let capabilityDir: string
let server: McpHttpServerHandle

beforeEach(async () => {
  capabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-http-'))
  vi.stubEnv("NOMI_CAPABILITY_DIR", capabilityDir)
  ensureToken()
  server = await startMcpHttpServer({
    port: 0,
    maxSessions: 2,
    sessionFor: (identity) => createNomiMcpServer({
      invoke: async () => ({}),
      isAppOpen: () => true,
      getAuthenticatedClient: () => identity.connection.authenticatedClient,
    }),
  })
})

afterEach(async () => {
  await server.close()
  if (previousCapabilityDir === undefined) vi.stubEnv("NOMI_CAPABILITY_DIR", undefined)
  else vi.stubEnv("NOMI_CAPABILITY_DIR", previousCapabilityDir)
})

const initializeBody = (id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http-test', version: '1' } } })
const identity = (client: string) => mcpHttpIdentityHeaders(client, signMcpClient(client) ?? '')
const post = (body: string, headers: Record<string, string> = {}) => fetch(server.url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body,
})

async function openSession(client: string): Promise<string> {
  const response = await post(initializeBody(), identity(client))
  expect(response.status).toBe(200)
  await response.text()
  const sessionId = response.headers.get('mcp-session-id')
  expect(sessionId).toBeTruthy()
  return sessionId as string
}

describe('本机 HTTP 直连 · HTTP 这一层的边界', () => {
  it('只听 127.0.0.1，地址是 /mcp', () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)
  })

  it('Host 不是本机（DNS 重绑定）→ 403，帧不进协议层', async () => {
    // fetch 不许改 Host 头（禁用头），用 node:http 原样发一个被重绑定过来的请求。
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1', port: server.port, path: '/mcp', method: 'POST',
        headers: { host: `evil.example:${server.port}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...identity('codex') },
      }, (response) => { response.resume(); resolve(response.statusCode ?? 0) })
      request.on('error', reject)
      request.end(initializeBody())
    })
    expect(status).toBe(403)
    expect(server.sessionCount()).toBe(0)
  })

  it('网页来源（Origin 不是本机）→ 403', async () => {
    const response = await post(initializeBody(), { origin: 'https://evil.example', ...identity('codex') })
    expect(response.status).toBe(403)
  })

  it('没带身份 / 签名不对 → 同一帧 -32001（与 stdio 逐字相同），不开会话', async () => {
    for (const headers of [{}, mcpHttpIdentityHeaders('codex', 'not-a-proof')]) {
      const response = await post(initializeBody(7), headers)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32001, message: 'A verified MCP client connection is required', data: { code: 'mcp_connection_unauthenticated' } } })
      expect(response.headers.get('mcp-session-id')).toBeNull()
    }
  })

  it('已开的会话不许换人：别的客户端拿着会话号来 → -32001', async () => {
    const sessionId = await openSession('codex')
    const response = await post(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }), { ...identity('claude'), 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' })
    expect((await response.json()).error.code).toBe(-32001)
  })

  it('不认识的会话号 → 404；没握手就发请求 → 400（Streamable HTTP 规范）', async () => {
    const unknown = await post(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }), { ...identity('codex'), 'mcp-session-id': 'no-such-session' })
    expect(unknown.status).toBe(404)
    const sessionless = await post(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }), identity('codex'))
    expect(sessionless.status).toBe(400)
  })

  it('会话数有上限：宿主不发 DELETE 也不会无限攒（挤掉最久没动静的那条）', async () => {
    await openSession('codex')
    await openSession('codex')
    await openSession('codex')
    expect(server.sessionCount()).toBeLessThanOrEqual(2)
  })
})

// 设计卡中途表「宿主断线但没发 DELETE」那一行的自动化证据：规范规定断线不等于取消，所以正在等确认的调用
// 不会因断线立刻收尾；它要靠确认请求的 5 分钟超时结束，而超时必须按「未确认」处理——不派发、不铸收据、不扣钱。
describe('宿主断线不发 DELETE：等确认的调用 5 分钟超时按未确认收尾', () => {
  const challenge = {
    challengeId: 'challenge-dropped', model: 'fixture-model', costScope: 'single-shot', maximumCost: 1, currency: 'CNY',
    expiresAt: '2099-01-01T00:00:00.000Z', handoff: { challengeToken: 'challenge-token', contractHash: 'contract-hash' },
  }
  const cases = [
    { label: '付费门', name: 'nomi_operation_gate', args: { leaseHandle: 'lease-1', operationId: 'operation-1', phase: 'request' }, before: ['nomi_request_generation_gate'] },
    { label: '删除节点', name: 'nomi_canvas_maintenance', args: { leaseHandle: 'lease-1', operation: 'delete_canvas_nodes', nodeIds: ['a'], reason: 'tidy' }, before: [] },
    { label: '文稿改写', name: 'nomi_document_edit', args: { leaseHandle: 'lease-1', content: '新的一段。', where: 'end' }, before: [] },
  ] as const

  it.each(cases)('$label：断线后推进到超时，领域派发 0 次、没有收据、调用以「未确认」结束', async ({ name, args, before }) => {
    // 只假 setTimeout：确认请求的 5 分钟计时器在这之后才挂上；shouldAdvanceTime 让 HTTP 本身照常随真实时间走。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const invoked: string[] = []
    const verifyReceipt = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-should-never-exist' }))
    const confirmInNomi = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-should-never-exist' }))
    let inFlightAtClose = -1
    const dropped = await startMcpHttpServer({
      port: 0,
      sessionFor: (identity) => {
        const nomi = createNomiMcpServer({
          invoke: async (method) => {
            invoked.push(method)
            if (method === 'nomi_request_generation_gate') return challenge
            return { applied: true }
          },
          isAppOpen: () => true,
          getAuthenticatedClient: () => identity.connection.authenticatedClient,
          verifyClientGenerationConfirmation: verifyReceipt,
          confirmGenerationInNomi: confirmInNomi,
        })
        nomi.onClose((count) => { inFlightAtClose = count })
        return nomi
      },
    })
    try {
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...identity('codex') }
      const opened = await fetch(dropped.url, {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'dropper', version: '1' } } }),
      })
      await opened.text()
      const session = { ...headers, 'mcp-session-id': opened.headers.get('mcp-session-id') ?? '', 'mcp-protocol-version': '2025-11-25' }
      await (await fetch(dropped.url, { method: 'POST', headers: session, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).text()

      // 发起调用，读那次 POST 的 SSE 流，直到确认弹框（elicitation/create）出现——然后宿主「直接断线」：掐断流，不发 DELETE、不回答。
      const hangUp = new AbortController()
      const call = await fetch(dropped.url, {
        method: 'POST', headers: session, signal: hangUp.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
      })
      const reader = call.body!.getReader()
      let seen = ''
      while (!seen.includes('elicitation/create')) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error(`确认弹框没出现：${seen}`)
        seen += new TextDecoder().decode(chunk.value)
      }
      hangUp.abort()
      expect(invoked).toEqual(before)

      await vi.advanceTimersByTimeAsync(300_001)
      for (let round = 0; round < 20; round += 1) await new Promise<void>((resolve) => setImmediate(resolve))

      expect(invoked, '超时之后不许派发任何领域写 / 付费调用').toEqual(before)
      expect(verifyReceipt, '没有人确认过，就不许去铸收据').not.toHaveBeenCalled()
      expect(confirmInNomi, '客户端那一面没确认，不许偷偷换成 Nomi 卡放行').not.toHaveBeenCalled()
    } finally {
      await dropped.close()
      vi.useRealTimers()
    }
    // 关服务时这条会话里已经没有在途调用：调用确实在超时时收尾了（以未确认的工具错误结束），不是还挂着。
    expect(inFlightAtClose).toBe(0)
  })
})

describe('端口与地址', () => {
  it('正常实例占默认端口；走查 / 隔离实例不抢，除非显式给端口', () => {
    expect(resolveMcpHttpPort({})).toBe(MCP_HTTP_DEFAULT_PORT)
    expect(resolveMcpHttpPort({ NOMI_E2E: '1' })).toBeNull()
    expect(resolveMcpHttpPort({ NOMI_CAPABILITY_DIR: '/tmp/x' })).toBeNull()
    expect(resolveMcpHttpPort({ NOMI_E2E: '1', NOMI_MCP_HTTP_PORT: '0' })).toBe(0)
    expect(resolveMcpHttpPort({ NOMI_MCP_HTTP_PORT: '99999' })).toBeNull()
  })

  it('端点文件：写进 capability 目录，转发口据此找地址；只清自己写的', () => {
    writeMcpHttpEndpoint(12345)
    expect(readMcpHttpEndpoint()).toEqual({ url: 'http://127.0.0.1:12345/mcp', port: 12345, pid: process.pid })
    // 转发口只认「端口 = 稳定端口、端点文件记的正是它、写它的进程还活着」；配置里的地址改成别的端口就不认。
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '12345' })).toBe('http://127.0.0.1:12345/mcp')
    expect(liveForwarderUrl({ NOMI_MCP_HTTP_PORT: '12345', NOMI_MCP_HTTP_URL: 'http://127.0.0.1:1/mcp' })).toBeNull()
    clearMcpHttpEndpoint()
    expect(readMcpHttpEndpoint()).toBeNull()
  })

  it('第 3 段要写进宿主配置的那一条：直连地址 + 能验过的身份头', () => {
    const entry = buildMcpHttpHostEntry('codex')
    expect(entry?.url).toBe(`http://127.0.0.1:${MCP_HTTP_DEFAULT_PORT}/mcp`)
    expect(verifyMcpClient(entry?.headers['x-nomi-mcp-client'], entry?.headers['x-nomi-mcp-client-proof'])).toBe('codex')
  })
})

describe('Desktop 转发口', () => {
  it('Nomi 没开（地址连不上）：宿主那个请求立刻拿到一句「请先打开 Nomi」，不干等', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const lines: string[] = []
    stdout.setEncoding('utf8')
    stdout.on('data', (chunk: string) => lines.push(...chunk.split('\n').filter(Boolean)))
    const upstream = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:9/mcp'), { requestInit: { headers: identity('claude-desktop') } })
    const bridged = bridgeStdioToHttp(new StdioServerTransport(stdin, stdout), upstream)
    stdin.write(`${initializeBody(11)}\n`)
    const reply = await vi.waitFor(() => {
      const frame = lines.map((line) => JSON.parse(line) as { id?: number; error?: { message?: string } }).find((item) => item.id === 11)
      if (!frame) throw new Error('no reply yet')
      return frame
    }, { timeout: 5000 })
    expect(reply.error?.message).toBe(NOMI_UNREACHABLE_MESSAGE)
    stdin.end()
    await bridged
  })
})
