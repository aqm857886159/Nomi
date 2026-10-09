// 能力核 · 迁移后（HTTP 直连）条目的读回与实连验证。
// 和 mcpVerify 对 stdio 条目做的是同一件事：只认宿主配置里**读回来的那一条**，真握手一次（initialize + tools/list）。
import { SERVER_NAME, readJsonConfig, readText, type McpClientKey } from './mcpConfig'
import { builtinMcpClientConfigPath } from './mcpDetectedClients'
import { MCP_HTTP_CLIENT_HEADER, MCP_HTTP_CLIENT_PROOF_HEADER } from './mcpHttpEndpoint'
import { verifyMcpClient } from './security'
import { isBuiltinMcpClient, MCP_CLIENT_REGISTRY } from '../shared/mcpClientRegistry'
import type { McpVerifyReason } from '../shared/mcpConnectionContract'

export type ConfiguredHttpEntry = { url: string; headers: Record<string, string> }

const CODEX_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:nomi|"nomi"|'nomi')\s*\]\s*(?:#.*)?$/

function codexHttpEntry(text: string): ConfiguredHttpEntry | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => CODEX_HEADER.test(line))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^\s*\[/.test(line))
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n')
  const url = body.match(/^\s*url\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1]
  if (!url) return null
  const headers: Record<string, string> = {}
  const raw = body.match(/^\s*http_headers\s*=\s*\{(.*)\}\s*$/m)?.[1] ?? ''
  for (const m of raw.matchAll(/"?([A-Za-z0-9_-]+)"?\s*=\s*"((?:[^"\\]|\\.)*)"/g)) headers[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  return { url, headers }
}

/** 宿主配置里 Nomi 的 HTTP 条目（url + 身份头）；不是 HTTP 条目回 null。 */
export function configuredMcpHttpEntry(client: string): ConfiguredHttpEntry | null {
  if (!isBuiltinMcpClient(client)) return null
  const target = builtinMcpClientConfigPath(client)
  if (!target) return null
  if (MCP_CLIENT_REGISTRY[client].format === 'toml') return codexHttpEntry(readText(target))
  const servers = readJsonConfig(target)?.mcpServers as Record<string, unknown> | undefined
  const entry = servers && typeof servers === 'object' ? servers[SERVER_NAME] : undefined
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  if (typeof record.url !== 'string' || !record.url) return null
  const headers: Record<string, string> = {}
  if (record.headers && typeof record.headers === 'object') {
    for (const [k, v] of Object.entries(record.headers as Record<string, unknown>)) if (typeof v === 'string') headers[k] = v
  }
  return { url: record.url, headers }
}

export type HttpVerifyOutcome =
  | { ok: true; latencyMs: number; toolCount: number | null }
  | { ok: false; reason: McpVerifyReason; detail: string }

const HANDSHAKE_TIMEOUT_MS = 15_000

/** 真握手：带着配置里的身份头连 url。SDK 按需加载，不进冷启动路径。 */
export async function verifyHttpEntry(client: McpClientKey, entry: ConfiguredHttpEntry): Promise<HttpVerifyOutcome> {
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
