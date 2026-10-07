// 能力核 · MCP 本机 HTTP 直连（Streamable HTTP，设计卡 docs/plan/2026-10-05-mcp-official-sdk.md 第 2 段）。
//
// 宿主（Claude Code / Codex / Cursor）直连 http://127.0.0.1:<端口>/mcp，不再每次拉起一个启动器进程。
// 这里只管 HTTP 这一层：只听 127.0.0.1、Host / Origin 只认本机（防 DNS 重绑定）、按身份头认人、按会话分配
// 协议实例。协议本身（握手、路由、取消、进度、请求关联）是 SDK 的 Streamable HTTP 传输 + 同一个
// createNomiMcpServer；工具、付费审批、取消、进度走的都是 stdio 那一份 Server，没有第二条派发路径。
//
// 认人：与回环 RPC 同一套签名身份（x-nomi-mcp-client + x-nomi-mcp-client-proof）。没通过的请求一律回
// 同一帧 -32001（mcpUnauthenticatedResponse），与 stdio 上的拒绝逐字相同；已建立的会话换了身份同样拒。
//
// 本文件必须保持 electron-free：单测与特征测试直接起它（不起 Electron）。
import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { NodeStreamableHTTPServerTransport, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node'
import { DEFAULT_MAX_REQUEST_BODY_SIZE, isInitializeRequest, type JSONRPCMessage } from '@modelcontextprotocol/server'

import { createMcpConnectionContext, McpConnectionAuthenticationError, type McpConnectionContext } from './mcpConnectionContext'
import { MCP_HTTP_CLIENT_HEADER, MCP_HTTP_CLIENT_PROOF_HEADER, MCP_HTTP_PATH } from './mcpHttpEndpoint'
import { createLoopbackGenerationConfirmation, callMcpLoopbackRpc } from './mcpLoopbackRpcCall'
import { createNomiMcpServer, MCP_REQUEST_SIGNAL, mcpUnauthenticatedResponse, SUPPORTED_PROTOCOL_VERSIONS, type McpInvokeOptions, type NomiMcpServer } from './mcpProtocol'
import { verifyMcpClient } from './security'
import type { ResultLocale } from './mcpToolResults'

/** 一条 HTTP 会话认出来的人：连接身份（租约绑它）+ 这次用的 proof（会话内每个请求都得一样）。 */
export type McpHttpIdentity = Readonly<{ connection: McpConnectionContext; proof: string }>

export type McpHttpServerOptions = Readonly<{
  /** 0 = 随机（走查 / 单测）。 */
  port: number
  /** 每条会话一个协议实例（createNomiMcpServer）。生产用 createLoopbackMcpHttpSession。 */
  sessionFor: (identity: McpHttpIdentity) => NomiMcpServer
  /** 有效请求到达（与回环 RPC 同一个「后台活动」信号，用来推迟空闲自退）。 */
  onActivity?: () => void
  /** 同时保留的会话上限；超出时关掉最久没动静的那条（宿主不总会发 DELETE）。 */
  maxSessions?: number
}>

export type McpHttpServerHandle = Readonly<{ port: number; url: string; sessionCount: () => number; close: () => Promise<void> }>

type Session = { transport: NodeStreamableHTTPServerTransport; nomi: NomiMcpServer; client: string; proof: string; lastSeen: number }

function firstHeader(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] ?? '' : value ?? '').trim()
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent || res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function readJsonBody(req: http.IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > DEFAULT_MAX_REQUEST_BODY_SIZE) return { ok: false, status: 413, message: 'Request body too large' }
    chunks.push(chunk as Buffer)
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }
  } catch {
    return { ok: false, status: 400, message: 'Parse error' }
  }
}

/** 一帧（或一批）客户端消息里每个请求都回 -32001；只有通知 / 响应的批次回 202（规范：无需回内容）。 */
function rejectUnauthenticated(res: http.ServerResponse, method: string | undefined, body: unknown): void {
  if (method !== 'POST') {
    sendJson(res, 403, { jsonrpc: '2.0', id: null, error: { code: -32001, message: new McpConnectionAuthenticationError().message } })
    return
  }
  const messages = (Array.isArray(body) ? body : [body]) as Array<Partial<JSONRPCMessage> | null>
  const replies = messages
    .filter((message): message is JSONRPCMessage & { id: string | number; method: string } =>
      Boolean(message && typeof message === 'object' && 'method' in message && 'id' in message && (typeof message.id === 'string' || typeof message.id === 'number')))
    .map((message) => mcpUnauthenticatedResponse(message.id))
  if (replies.length === 0) {
    res.writeHead(202).end()
    return
  }
  sendJson(res, 200, Array.isArray(body) ? replies : replies[0])
}

export function startMcpHttpServer(options: McpHttpServerOptions): Promise<McpHttpServerHandle> {
  const sessions = new Map<string, Session>()
  const maxSessions = options.maxSessions ?? 32
  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()

  async function evictIfFull(): Promise<void> {
    while (sessions.size >= maxSessions) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0]
      if (!oldest) return
      sessions.delete(oldest[0])
      await oldest[1].nomi.close().catch(() => {})
    }
  }

  async function openSession(client: string, proof: string, req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> {
    await evictIfFull()
    const connection = createMcpConnectionContext({ client, proof })
    const nomi = options.sessionFor({ connection, proof })
    let sessionId: string | undefined
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      onsessioninitialized: (id) => {
        sessionId = id
        sessions.set(id, { transport, nomi, client, proof, lastSeen: Date.now() })
      },
    })
    // 会话关了（宿主发 DELETE、被挤掉、整个服务停）：SDK 中止这条会话上全部在途调用，这里只把账本里那条摘掉。
    nomi.onClose(() => { if (sessionId) sessions.delete(sessionId) })
    await nomi.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname !== MCP_HTTP_PATH) {
      sendJson(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Not found: ${pathname}` } })
      return
    }
    let body: unknown
    if (req.method === 'POST') {
      const read = await readJsonBody(req)
      if (!read.ok) {
        sendJson(res, read.status, { jsonrpc: '2.0', id: null, error: { code: read.status === 400 ? -32700 : -32000, message: read.message } })
        return
      }
      body = read.value
    }
    const client = firstHeader(req.headers[MCP_HTTP_CLIENT_HEADER])
    const proof = firstHeader(req.headers[MCP_HTTP_CLIENT_PROOF_HEADER])
    const verified = verifyMcpClient(client, proof)
    const sessionId = firstHeader(req.headers['mcp-session-id'])
    const session = sessionId ? sessions.get(sessionId) : undefined
    // 认人在找会话之前：没过的请求连「这个会话存不存在」都不告诉它。会话内每个请求都得是开会话的那个人。
    if (!verified || (session && (session.client !== verified || session.proof !== proof))) {
      rejectUnauthenticated(res, req.method, body)
      return
    }
    options.onActivity?.()
    if (session) {
      session.lastSeen = Date.now()
      await session.transport.handleRequest(req, res, body)
      return
    }
    if (sessionId) {
      sendJson(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } })
      return
    }
    if (req.method === 'POST' && isInitializeRequest(body)) {
      await openSession(verified, proof, req, res, body)
      return
    }
    sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bad Request: No valid session ID provided' } })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // 只 127.0.0.1：外网 / 局域网够不着（与回环 RPC 同一条底线）。
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject)
      const port = (server.address() as AddressInfo).port
      resolve({
        port,
        url: `http://127.0.0.1:${port}${MCP_HTTP_PATH}`,
        sessionCount: () => sessions.size,
        close: async () => {
          const open = [...sessions.values()]
          sessions.clear()
          await Promise.all(open.map((session) => session.nomi.close().catch(() => {})))
          await new Promise<void>((done) => {
            server.close(() => done())
            server.closeAllConnections()
          })
        },
      })
    })
  })
}

/**
 * 生产用的会话：HTTP 会话里的每次领域调用都走回环 RPC 进本进程的 rpcServer——与两条 stdio 启动器
 * 完全同一扇门（同样的认人、租约、渲染层 / 磁盘网关选路、收据），HTTP 这一层不另写派发。
 * 这是 McpHost 的第三个生产装配点（check:transport-assembly 比对三处是否接齐可选成员）。
 */
export function createLoopbackMcpHttpSession(deps: Readonly<{
  identity: McpHttpIdentity
  rpc: () => { port: number; token: string } | null
  /** 回环这一跳用哪个 fetch（主进程注入 appFetch，与 Electron stdio 那条同一个）。 */
  fetchImpl: typeof fetch
  getLocale: () => ResultLocale
  onClientDetected?: (name: string) => void
}>): NomiMcpServer {
  const call = (method: string, params: Record<string, unknown>, options?: McpInvokeOptions) => {
    const instance = deps.rpc()
    if (!instance) return Promise.reject(new Error('Nomi 的本机服务还没就绪，请稍后再试。 / Nomi is still starting; try again in a moment.'))
    const requestSignal = (params as Record<PropertyKey, unknown>)[MCP_REQUEST_SIGNAL] as AbortSignal | undefined
    return callMcpLoopbackRpc({
      instance,
      fetchImpl: deps.fetchImpl,
      clientProof: deps.identity.proof,
      connection: deps.identity.connection,
      method,
      params,
      ...(options || requestSignal ? { options: { ...options, ...(requestSignal ? { signal: requestSignal } : {}) } } : {}),
    })
  }
  const generationConfirmation = createLoopbackGenerationConfirmation({
    rpcIfOpen: (method, params) => (deps.rpc() ? call(method, params) : undefined),
    authenticatedClient: () => deps.identity.connection.authenticatedClient,
  })
  return createNomiMcpServer({
    invoke: call,
    // 本进程就是活着的 Nomi：被动发现也可以直接问它。
    invokeIfOpen: call,
    isAppOpen: () => true,
    getAuthenticatedClient: () => deps.identity.connection.authenticatedClient,
    confirmGenerationInNomi: generationConfirmation.confirmGenerationInNomi,
    verifyClientGenerationConfirmation: generationConfirmation.verifyClientGenerationConfirmation,
    getLocale: deps.getLocale,
    onClientDetected: (name) => deps.onClientDetected?.(name),
  })
}
