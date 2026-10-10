// 能力核 · 宿主配置里「Nomi 那一条」的形状：怎么写（HTTP / 转发口）、怎么读回、以及**它是不是 Nomi 的**。
//
// 只有形状与判定：什么时候写（用户同意）归 mcpHostMigration，写盘归 hostConfigWrite。地址与身份头由
// 第 2 段的 buildMcpHttpHostEntry 生成，这里不另算。
// 不 import mcpConfig（它要 import 本文件做「只保持可确认的原传输」），旧启动器条目由调用方传入。
//
// 所有权判定（nomiEntryTransport）是写入门、分类、验证、迁移名单共用的唯一一份：
// 「这一条到底走哪种传输、是不是 Nomi 生成的」只看这里，绝不把「有 url」当成「已迁移」的凭据。
import {
  MCP_HTTP_CLIENT_HEADER,
  MCP_HTTP_CLIENT_PROOF_HEADER,
  MCP_HTTP_PATH,
  MCP_HTTP_PORT_ENV,
  MCP_HTTP_URL_ENV,
  buildMcpHttpHostEntry,
  mcpHttpUrl,
  resolveMcpHttpPort,
} from './mcpHttpEndpoint'
import { builtinMcpClientConfigPath } from './mcpDetectedClients'
import { parseJsonConfig, readText, tomlEscapeValue } from './hostConfigWrite'
import { CAPABILITY_DIR_ENV, MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV, signMcpClient, type AuthenticatedMcpClient } from './security'
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
  // 端口也写进去：转发口在宿主进程里用同一个 resolveMcpHttpPort 算稳定地址，两边必须算出同一个。
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', [MCP_HTTP_URL_ENV]: mcpHttpUrl(port), [MCP_HTTP_PORT_ENV]: String(port) }
  // 隔离 capability 目录（走查 / 测试）时，转发口要去同一个目录核端点文件。
  const capabilityDir = String(process.env[CAPABILITY_DIR_ENV] ?? '').trim()
  if (capabilityDir) env[CAPABILITY_DIR_ENV] = capabilityDir
  if (proof) Object.assign(env, { [MCP_CLIENT_ENV]: client, [MCP_CLIENT_PROOF_ENV]: proof })
  const script = launcher.args[0] ?? ''
  return { command: launcher.command, args: [script.replace(/mcpNodeLauncher\.js$/i, 'mcpHttpForwarder.js')], env }
}

const FORWARDER_SCRIPT = /(?:^|[\\/])mcpHttpForwarder\.js$/i

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

// ── 读回：宿主配置里叫 nomi 的那一条，原样（两种传输的字段都收，判定交给 nomiEntryTransport）──

export type RawNomiEntry = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  type?: string
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}

function jsonNomiEntry(text: Buffer | string | null): RawNomiEntry | null | 'unreadable' {
  const config = parseJsonConfig(text)
  if (!config) return 'unreadable'
  const servers = config.mcpServers
  const entry = servers && typeof servers === 'object' && !Array.isArray(servers) ? (servers as Record<string, unknown>)[SERVER_NAME] : undefined
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  const raw: RawNomiEntry = {}
  if (typeof record.command === 'string') raw.command = record.command
  if (Array.isArray(record.args)) raw.args = record.args.filter((a): a is string => typeof a === 'string')
  if (record.env !== undefined) raw.env = stringRecord(record.env) ?? {}
  if (typeof record.url === 'string') raw.url = record.url
  if (record.headers !== undefined) raw.headers = stringRecord(record.headers) ?? {}
  if (typeof record.type === 'string') raw.type = record.type
  return raw
}

const CODEX_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:nomi|"nomi"|'nomi')\s*\]\s*(?:#.*)?$/

function tomlUnescape(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function tomlInlineTable(body: string, key: string): Record<string, string> | undefined {
  const inner = body.match(new RegExp(`^\\s*${key}\\s*=\\s*\\{(.*)\\}\\s*$`, 'm'))?.[1]
  if (inner === undefined) return undefined
  const out: Record<string, string> = {}
  for (const m of inner.matchAll(/"?([A-Za-z0-9_-]+)"?\s*=\s*"((?:[^"\\]|\\.)*)"/g)) out[m[1]] = tomlUnescape(m[2])
  return out
}

/** Codex：只读我们写的那种块（[mcp_servers.nomi] 到下一个表头为止）；用户手改成子表的 env / headers 不收。 */
function codexNomiEntry(text: string): RawNomiEntry | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => CODEX_HEADER.test(line))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^\s*\[/.test(line))
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n')
  const raw: RawNomiEntry = {}
  const command = body.match(/^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1]
  if (command !== undefined) raw.command = tomlUnescape(command)
  const argsRaw = body.match(/^\s*args\s*=\s*\[(.*)\]\s*$/m)?.[1]
  if (argsRaw !== undefined) raw.args = [...argsRaw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => tomlUnescape(m[1]))
  const env = tomlInlineTable(body, 'env')
  if (env) raw.env = env
  const url = body.match(/^\s*url\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1]
  if (url !== undefined) raw.url = tomlUnescape(url)
  const headers = tomlInlineTable(body, 'http_headers')
  if (headers) raw.headers = headers
  return raw
}

/** 从一份配置字节里读 Nomi 那一条：没有 → null；JSON 坏了 → 'unreadable'（不许写）。写入门与读路径用同一个解析。 */
export function parseNomiEntry(format: 'json' | 'toml', text: Buffer | string | null): RawNomiEntry | null | 'unreadable' {
  if (format === 'toml') return codexNomiEntry(text === null ? '' : String(text))
  return jsonNomiEntry(text)
}

/** 内置宿主当前配置文件里 Nomi 那一条（读路径用；写路径在锁里用同一个 parseNomiEntry 解析它读到的那份字节）。 */
export function readNomiEntry(client: string): RawNomiEntry | null | 'unreadable' {
  if (!isBuiltinMcpClient(client)) return null
  const target = builtinMcpClientConfigPath(client)
  if (!target) return null
  const format = MCP_CLIENT_REGISTRY[client].format
  return parseNomiEntry(format, format === 'toml' ? readText(target) : jsonTextOrNull(target))
}

function jsonTextOrNull(target: string): string | null {
  const text = readText(target)
  return text === '' ? null : text
}

// ── 所有权：这一条走哪种传输、是不是 Nomi 生成的 ─────────────────────────

/**
 * - absent：没有这一条（或这一条既没有 command 也没有 url，没有传输可言）；
 * - stdio：只有 command（是不是 Nomi 的启动器由 mcpConfig.classifyMcpEntry 再细分；别人的 stdio 条目也是 stdio）；
 * - http：Nomi 生成的直连条目——没有 command，地址是本实例的稳定本机地址，身份头是这个宿主自己的；
 * - forwarder：Nomi 生成的转发口——只跑 mcpHttpForwarder.js，环境里的地址是稳定地址、身份是这个宿主的；
 * - unowned：两种写法混在一起，或者长得像 HTTP / 转发口但地址或身份对不上——不知道宿主实际会走哪条，**不许改**。
 */
export type NomiEntryTransport = 'absent' | 'stdio' | 'http' | 'forwarder' | 'unowned'

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function ownedHttp(client: string, raw: RawNomiEntry): boolean {
  if (raw.args !== undefined || raw.env !== undefined) return false
  if (!raw.url || !isStableLocalMcpUrl(raw.url)) return false
  if (client === 'claude' ? raw.type !== 'http' : raw.type !== undefined && raw.type !== 'http') return false
  return raw.headers?.[MCP_HTTP_CLIENT_HEADER] === client && nonEmpty(raw.headers?.[MCP_HTTP_CLIENT_PROOF_HEADER])
}

function ownedForwarder(client: string, raw: RawNomiEntry): boolean {
  if (raw.headers !== undefined || raw.type !== undefined) return false
  if (raw.args?.length !== 1 || !FORWARDER_SCRIPT.test(raw.args[0])) return false
  const env = raw.env ?? {}
  const url = env[MCP_HTTP_URL_ENV]
  if (!url || !isStableLocalMcpUrl(url)) return false
  if (env[MCP_HTTP_PORT_ENV] !== undefined && env[MCP_HTTP_PORT_ENV] !== String(stableMcpPort())) return false
  return env[MCP_CLIENT_ENV] === client && nonEmpty(env[MCP_CLIENT_PROOF_ENV])
}

export function nomiEntryTransport(client: string, raw: RawNomiEntry | null): NomiEntryTransport {
  if (!raw) return 'absent'
  const hasCommand = nonEmpty(raw.command)
  const hasUrl = nonEmpty(raw.url)
  if (hasCommand && hasUrl) return 'unowned'
  if (hasUrl) return ownedHttp(client, raw) ? 'http' : 'unowned'
  if (!hasCommand) return raw.headers !== undefined || raw.type !== undefined ? 'unowned' : 'absent'
  if (raw.args?.some((arg) => FORWARDER_SCRIPT.test(arg))) return ownedForwarder(client, raw) ? 'forwarder' : 'unowned'
  return 'stdio'
}

/** 这一条在用 Nomi 的直连地址（直连条目的 url，或转发口环境里的地址）——核它要先知道本实例的稳定地址。 */
export function namesNomiHttpAddress(raw: RawNomiEntry | null): boolean {
  return Boolean(raw && (nonEmpty(raw.url) || nonEmpty(raw.env?.[MCP_HTTP_URL_ENV])))
}

export type ConfiguredHttpEntry = { url: string; headers: Record<string, string> }

/** 宿主配置里 Nomi 生成的 HTTP 直连条目（url + 身份头）；不是（含混合 / 未证明的）回 null。 */
export function configuredMcpHttpEntry(client: string): ConfiguredHttpEntry | null {
  const raw = readNomiEntry(client)
  if (!raw || raw === 'unreadable' || nomiEntryTransport(client, raw) !== 'http') return null
  return { url: raw.url!, headers: { ...raw.headers } }
}

/** stdio 形状的条目是不是 Nomi 生成的转发口（分类器用；与 nomiEntryTransport 同一条判据）。 */
export function isOwnedForwarderEntry(client: string, entry: StdioShape): boolean {
  return nomiEntryTransport(client, { command: entry.command, args: entry.args, env: entry.env ?? {} }) === 'forwarder'
}

/** 长得像转发口（跑的是 mcpHttpForwarder.js）——不管是不是我们的；不是我们的就归 custom。 */
export function looksLikeForwarderEntry(entry: StdioShape): boolean {
  return entry.args.some((arg) => FORWARDER_SCRIPT.test(arg))
}

/** 转发口条目里等价的「它会连哪里、带什么身份」，验证时直接握这一条（转发口本身只是 stdio→HTTP 的桥）。 */
export function forwarderTarget(entry: StdioShape): ConfiguredHttpEntry | null {
  const url = entry.env?.[MCP_HTTP_URL_ENV]
  const client = entry.env?.[MCP_CLIENT_ENV]
  const proof = entry.env?.[MCP_CLIENT_PROOF_ENV]
  if (!url || !client || !proof) return null
  return { url, headers: { [MCP_HTTP_CLIENT_HEADER]: client, [MCP_HTTP_CLIENT_PROOF_HEADER]: proof } }
}
