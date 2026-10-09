// 能力核 · 迁移后（HTTP 直连 / 转发口）条目的实连验证。
// 和 mcpVerify 对 stdio 条目做的是同一件事：只认宿主配置里**读回来的那一条**，真握手一次（initialize + tools/list）。
// 安全：身份头只发往 `http://127.0.0.1:<稳定端口>/mcp`。配置里的地址被改成外部地址 / 别的端口 / 别的路径，
// 一律不发请求（fail-closed）——否则有效 proof 会被送到任意地址。
import { isStableLocalMcpUrl, type ConfiguredHttpEntry } from './mcpHostEntries'
import { MCP_HTTP_CLIENT_HEADER, MCP_HTTP_CLIENT_PROOF_HEADER } from './mcpHttpEndpoint'
import { verifyMcpClient, type AuthenticatedMcpClient } from './security'
import type { McpVerifyReason } from '../shared/mcpConnectionContract'

export type HttpVerifyOutcome =
  | { ok: true; latencyMs: number; toolCount: number | null }
  | { ok: false; reason: McpVerifyReason; detail: string }

const HANDSHAKE_TIMEOUT_MS = 15_000

/** 真握手：带着配置里的身份头连 url。SDK 按需加载，不进冷启动路径。 */
export async function verifyHttpEntry(client: AuthenticatedMcpClient, entry: ConfiguredHttpEntry): Promise<HttpVerifyOutcome> {
  if (!isStableLocalMcpUrl(entry.url)) {
    return { ok: false, reason: 'not-installed', detail: 'configured address is not this Nomi\'s stable local address; no request was sent' }
  }
  if (verifyMcpClient(entry.headers[MCP_HTTP_CLIENT_HEADER], entry.headers[MCP_HTTP_CLIENT_PROOF_HEADER]) !== client) {
    return { ok: false, reason: 'client-auth-missing', detail: 'identity headers missing or invalid' }
  }
  const started = Date.now()
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const transport = new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers, redirect: 'error' } })
  const probe = new Client({ name: 'nomi-verify', version: '1.0' })
  try {
    await probe.connect(transport, { timeout: HANDSHAKE_TIMEOUT_MS })
    const tools = await probe.listTools(undefined, { timeout: HANDSHAKE_TIMEOUT_MS })
    return { ok: true, latencyMs: Date.now() - started, toolCount: Array.isArray(tools.tools) ? tools.tools.length : null }
  } catch (error) {
    return { ok: false, reason: 'handshake-failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) }
  } finally {
    try { await probe.close() } catch { /* 关不掉不影响结论 */ }
  }
}
