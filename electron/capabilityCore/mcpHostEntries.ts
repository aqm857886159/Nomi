// 能力核 · 宿主配置里「Nomi 那一条」的 HTTP / 转发口写法与读回（迁移与「同传输修复」共用的唯一一份）。
//
// 只有形状：条目长什么样、怎么读回、地址是不是稳定的本机地址。什么时候写（用户同意）归 mcpHostMigration，
// 写盘归 hostConfigWrite。地址与身份头由第 2 段的 buildMcpHttpHostEntry 生成，这里不另算。
// 不 import mcpConfig（它要 import 本文件做「已迁移的条目只能按同一种传输重写」），启动器条目由调用方传入。
import {
  MCP_HTTP_CLIENT_HEADER,
  MCP_HTTP_CLIENT_PROOF_HEADER,
  MCP_HTTP_PATH,
  MCP_HTTP_URL_ENV,
  buildMcpHttpHostEntry,
  mcpHttpUrl,
  resolveMcpHttpPort,
} from './mcpHttpEndpoint'
import { builtinMcpClientConfigPath } from './mcpDetectedClients'
import { readJsonConfig, readText, tomlEscapeValue } from './hostConfigWrite'
import { MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV, signMcpClient, type AuthenticatedMcpClient } from './security'
import { MCP_CLIENT_REGISTRY, isBuiltinMcpClient } from '../shared/mcpClientRegistry'

const SERVER_NAME = 'nomi'
type StdioShape = { command: string; args: string[]; env?: Record<string, string> }

/** 稳定地址的端口：服务端自己选端口的同一个函数。显式 0（随机）或隔离实例（null）都不是稳定地址。 */
export function stableMcpPort(): number | null {
  const port = resolveMcpHttpPort()
  return port !== null && port > 0 ? port : null
}

/** 唯一允许带着身份去连的地址：`http://127.0.0.1:<稳定端口>/mcp`，协议 / 主机 / 端口 / 路径 / 凭据 / 查询一项不符就不是。 */
export function isStableLocalMcpUrl(raw: string): boolean {
  const port = stableMcpPort()
  if (port === null) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === String(port)
      && url.pathname === MCP_HTTP_PATH && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

/** Claude Desktop 的转发口条目：同一个 Node 启动器换成转发口脚本；不带冷启 Nomi 的参数。 */
export function forwarderEntry(client: AuthenticatedMcpClient, port: number, launcher: StdioShape): StdioShape {
  const proof = signMcpClient(client)
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', [MCP_HTTP_URL_ENV]: mcpHttpUrl(port) }
  if (proof) Object.assign(env, { [MCP_CLIENT_ENV]: client, [MCP_CLIENT_PROOF_ENV]: proof })
  const script = launcher.args[0] ?? ''
  return { command: launcher.command, args: [script.replace(/mcpNodeLauncher\.js$/i, 'mcpHttpForwarder.js')], env }
}

export function isForwarderEntry(entry: StdioShape): boolean {
  return entry.args.some((arg) => /(?:^|[\\/])mcpHttpForwarder\.js$/i.test(arg)) && Boolean(entry.env?.[MCP_CLIENT_ENV])
}

/** JSON 宿主的 HTTP 条目：Claude Code 的远程条目必须写 type；Cursor 只认 url + headers。 */
export function httpJsonEntry(client: AuthenticatedMcpClient, port: number): Record<string, unknown> | null {
  const http = buildMcpHttpHostEntry(client, port)
  if (!http) return null
  return client === 'claude' ? { type: 'http', ...http } : { ...http }
}

/** Codex 的 HTTP 块（TOML）。 */
export function codexHttpBlock(client: AuthenticatedMcpClient, port: number, toolTimeoutSec: number): string | null {
  const http = buildMcpHttpHostEntry(client, port)
  if (!http) return null
  const headers = Object.entries(http.headers).map(([k, v]) => `${k} = "${tomlEscapeValue(v)}"`).join(', ')
  return `[mcp_servers.${SERVER_NAME}]\nurl = "${tomlEscapeValue(http.url)}"\nhttp_headers = { ${headers} }\n`
    + `tool_timeout_sec = ${toolTimeoutSec}\ndefault_tools_approval_mode = "writes"\n`
}

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

/** 宿主配置里 Nomi 的 HTTP 条目（url + 身份头）；不是 HTTP 条目回 null。地址稳不稳由调用方用 isStableLocalMcpUrl 判。 */
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

/** 转发口条目里等价的「它会连哪里、带什么身份」，验证时直接握这一条（转发口本身只是 stdio→HTTP 的桥）。 */
export function forwarderTarget(entry: StdioShape): ConfiguredHttpEntry | null {
  const url = entry.env?.[MCP_HTTP_URL_ENV]
  const client = entry.env?.[MCP_CLIENT_ENV]
  const proof = entry.env?.[MCP_CLIENT_PROOF_ENV]
  if (!url || !client || !proof) return null
  return { url, headers: { [MCP_HTTP_CLIENT_HEADER]: client, [MCP_HTTP_CLIENT_PROOF_HEADER]: proof } }
}
