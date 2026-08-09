// 能力核 · 接入 MCP 客户端的配置读写（见 docs/plan/2026-06-22-multi-client-mcp-connect.md
// + docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// 「一键接入」就靠这一层：算出 nomi MCP server 启动条目 → 把 nomi 条目合并进各客户端的配置文件。
// 启动条目 = **app 自身二进制 + env NOMI_MCP_STDIO=1**（main.ts 据此跑进程内 stdio MCP server，
// 见 mcpStdioServer.ts）。打包版二进制永远存在、不依赖用户装 node——根治旧版指向 asar 里不存在的
// node 脚本导致的「Connection closed」握手失败。
// 支持 Claude Code / Codex / Cursor 三个一键，其余助手走 UI 的「复制配置」。
// 安全口径（三客户端一致）：**只写各自固定文件**（非任意路径写）；写前自动备份；**合并而非覆盖**
// （保留用户已有的其它 MCP server）；原子写（tmp→rename）。
// Codex 是 TOML，用块级文本合并（按 [表头] 边界只换我们自己的 [mcp_servers.nomi] 块），不引 TOML 依赖（P1）。
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renameSyncWithRetry } from '../jsonFile'
import {
  MCP_CLIENT_ENV,
  MCP_CLIENT_PROOF_ENV,
  readToken,
  signMcpClient,
  type AuthenticatedMcpClient,
} from './security'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'

const SERVER_NAME = 'nomi'

export type McpClientKey = AuthenticatedMcpClient

type ClientSpec = {
  label: string
  format: 'json' | 'toml'
  /** 配置文件绝对路径。 */
  configPath: () => string
}

const CLIENTS: Record<McpClientKey, ClientSpec> = {
  claude: { label: 'Claude Code', format: 'json', configPath: () => path.join(os.homedir(), '.claude.json') },
  cursor: { label: 'Cursor', format: 'json', configPath: () => path.join(os.homedir(), '.cursor', 'mcp.json') },
  codex: { label: 'Codex', format: 'toml', configPath: () => path.join(os.homedir(), '.codex', 'config.toml') },
}

function resolveClient(client?: string): McpClientKey {
  return client === 'codex' || client === 'cursor' ? client : 'claude'
}

/** MCP server 启动条目（command/args/env），三客户端共用。 */
export type McpServerEntry = { command: string; args: string[]; env?: Record<string, string> }

/**
 * nomi MCP server 条目：让 Nomi 用**自身可执行文件**以 NOMI_MCP_STDIO 模式启动 = 进程内 stdio MCP server。
 * 打包版 process.execPath = `/Applications/Nomi.app/Contents/MacOS/Nomi`（包内永远存在、无 node 依赖）。
 * dev 下 execPath = node_modules 的 electron，需 args 指明 app 路径（repo 根）让它找到 main。三客户端共用。
 */
export function mcpServerEntry(client?: McpClientKey): McpServerEntry {
  const env: Record<string, string> = { NOMI_MCP_STDIO: '1' }
  const proof = client ? signMcpClient(client) : null
  if (client && proof) {
    env[MCP_CLIENT_ENV] = client
    env[MCP_CLIENT_PROOF_ENV] = proof
  }
  return {
    command: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
    env,
  }
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function atomicWrite(target: string, content: string): string | null {
  ensureDir(target)
  let backupPath: string | null = null
  if (fs.existsSync(target)) {
    backupPath = `${target}.nomi-backup`
    fs.copyFileSync(target, backupPath)
  }
  const tmp = `${target}.nomi-tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  // Windows：目标（如 Claude/Cursor 配置）被杀毒/编辑器短暂持有会 EPERM，共享重试收口（P2）。
  renameSyncWithRetry(tmp, target)
  return backupPath
}

// ── JSON 客户端（Claude Code / Cursor）：root.mcpServers.nomi ─────────────

function readJsonConfig(target: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function jsonInstalled(target: string): boolean {
  const servers = readJsonConfig(target).mcpServers
  return Boolean(servers && typeof servers === 'object' && (servers as Record<string, unknown>)[SERVER_NAME])
}

function jsonSnippet(server: McpServerEntry): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }, null, 2)
}

function jsonInstall(target: string, client: McpClientKey): string | null {
  const backupPath = fs.existsSync(target) ? `${target}.nomi-backup` : null
  const config = readJsonConfig(target)
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
    ? (config.mcpServers as Record<string, unknown>)
    : {}) as Record<string, unknown>
  servers[SERVER_NAME] = mcpServerEntry(client)
  config.mcpServers = servers
  atomicWrite(target, JSON.stringify(config, null, 2))
  return backupPath
}

function jsonUninstall(target: string): void {
  if (!fs.existsSync(target)) return
  const config = readJsonConfig(target)
  const servers = config.mcpServers as Record<string, unknown> | undefined
  if (servers && typeof servers === 'object' && servers[SERVER_NAME]) {
    delete servers[SERVER_NAME]
    config.mcpServers = servers
    atomicWrite(target, JSON.stringify(config, null, 2))
  }
}

// ── TOML 客户端（Codex）：[mcp_servers.nomi]，块级合并不引依赖 ──────────────

const CODEX_HEADER_RE = /^\s*\[\s*mcp_servers\s*\.\s*(?:nomi|"nomi"|'nomi')\s*\]\s*(?:#.*)?$/
const CODEX_TABLE_HEADER_RE = /^\s*(?:\[[^\]]+\]|\[\[[^\]]+\]\])\s*(?:#.*)?$/
const CODEX_FAMILY_HEADER_RE = /^\s*\[\s*mcp_servers\s*\.\s*(?:nomi|"nomi"|'nomi')\s*(?:\.\s*[^\]]+)?\]\s*(?:#.*)?$/

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Codex 的三个默认值对 Nomi 全都不成立，不显式写就是三种「看着接上了其实用不了」（官方文档核实：
 * developers.openai.com/codex/mcp）：
 * ① startup_timeout_sec 默认 **10s**，而我们的 MCP server 是**整个 Electron app**（实测打包版 0.5s、
 *    dev 并发 6.5–7.6s，冷启更久）。超时 Codex 会**静默丢掉这个 server** → 工具直接不存在 = 用户看到的
 *    「Codex 说不能用」。对照：Codex 自家 node_repl（一个 node 二进制）写的是 120。
 * ② tool_timeout_sec 默认 **60s**，而 nomi_generate 是真出图/出视频，视频动辄几分钟 → 必然中途断
 *    = 用户看到的「发消息之后没反应」。
 * ③ default_tools_approval_mode 不写 = 每个工具调用都要人点一次同意，连「列一下项目」都要点。
 *    设 "writes" = 只对**没标 readOnlyHint** 的工具弹确认（标注在 mcpProtocol 的 READ_ONLY_TOOLS）：
 *    查询类静默通过，**花钱的 nomi_generate 仍然每次问**——不拿用户的钱换顺滑。
 */
const CODEX_STARTUP_TIMEOUT_SEC = 60
const CODEX_TOOL_TIMEOUT_SEC = 600

function codexBlock(server: McpServerEntry): string {
  const args = server.args.map((arg) => `"${tomlEscape(arg)}"`).join(', ')
  let block = `[mcp_servers.${SERVER_NAME}]\ncommand = "${tomlEscape(server.command)}"\nargs = [${args}]\n`
  block += `startup_timeout_sec = ${CODEX_STARTUP_TIMEOUT_SEC}\n`
  block += `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}\n`
  block += `default_tools_approval_mode = "writes"\n`
  const envKeys = server.env ? Object.keys(server.env) : []
  if (envKeys.length) {
    const env = envKeys.map((key) => `${key} = "${tomlEscape(server.env![key])}"`).join(', ')
    block += `env = { ${env} }\n`
  }
  return block
}

function readText(target: string): string {
  try {
    return fs.readFileSync(target, 'utf8')
  } catch {
    return ''
  }
}

function codexInstalled(target: string): boolean {
  return readText(target).split('\n').some((line) => CODEX_HEADER_RE.test(line))
}

/**
 * 删掉现有 [mcp_servers.nomi] 及其子表块，其他内容原样保留。
 *
 * Codex 也接受 `[mcp_servers.nomi.env]`。如果只删父表、留下 env 子表，再写
 * `env = { ... }`，整个 config.toml 会因重复 env 键而无法解析。
 */
function removeCodexBlock(text: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (CODEX_FAMILY_HEADER_RE.test(line)) {
      skipping = true
      continue
    }
    if (skipping && CODEX_TABLE_HEADER_RE.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

function codexInstall(target: string, client: McpClientKey): string | null {
  const backupPath = fs.existsSync(target) ? `${target}.nomi-backup` : null
  const base = removeCodexBlock(readText(target)).replace(/\s*$/, '')
  const next = (base ? `${base}\n\n` : '') + codexBlock(mcpServerEntry(client))
  atomicWrite(target, next)
  return backupPath
}

function codexUninstall(target: string): void {
  if (!fs.existsSync(target)) return
  if (!codexInstalled(target)) return
  const next = removeCodexBlock(readText(target)).replace(/\s*$/, '') + '\n'
  atomicWrite(target, next)
}

// ── 对外 API ───────────────────────────────────────────────────────────

export type McpClientInfo = { installed: boolean; configPath: string; snippet: string }

export type McpInfo = {
  tokenReady: boolean
  rpcRunning: boolean
  server: McpServerEntry
  trustedHosts: string[]
  /** 每个可一键接入的客户端的状态 + 可复制片段（卡片据此显示 + 默认选已接入的）。 */
  clients: Record<McpClientKey, McpClientInfo>
}

function clientInfo(client: McpClientKey): McpClientInfo {
  const spec = CLIENTS[client]
  const target = spec.configPath()
  const server = mcpServerEntry(client)
  const installed = spec.format === 'toml' ? codexInstalled(target) : jsonInstalled(target)
  const snippet = spec.format === 'toml' ? codexBlock(server) : jsonSnippet(server)
  return { installed, configPath: target, snippet }
}

/** 读接入状态 + 各客户端配置片段。rpcPort 由调用方（appIntegration）传入。 */
export function readMcpInfo(rpcPort: number | null): McpInfo {
  const server = mcpServerEntry()
  const trustedHosts = readAutomationPolicySettings().trustedHosts
  return {
    tokenReady: readToken() !== null,
    rpcRunning: typeof rpcPort === 'number' && rpcPort > 0,
    server,
    trustedHosts,
    clients: {
      claude: clientInfo('claude'),
      codex: clientInfo('codex'),
      cursor: clientInfo('cursor'),
    },
  }
}

function tomlUnescape(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/** 取 [mcp_servers.nomi] 块的正文（到下一个 [表头] 或 EOF）；没这块回 null。 */
function codexBlockBody(text: string): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => CODEX_HEADER_RE.test(line))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^\s*\[/.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

function codexConfiguredEntry(target: string): McpServerEntry | null {
  const body = codexBlockBody(readText(target))
  if (body === null) return null
  const command = body.match(/^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1]
  if (!command) return null
  const argsRaw = body.match(/^\s*args\s*=\s*\[(.*)\]\s*$/m)?.[1] ?? ''
  const args = [...argsRaw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => tomlUnescape(m[1]))
  const env: Record<string, string> = {}
  // 只认我们写的行内表；用户手改成 [mcp_servers.nomi.env] 子表时 env 留空（不影响 command 可执行性判断）。
  const envRaw = body.match(/^\s*env\s*=\s*\{(.*)\}\s*$/m)?.[1] ?? ''
  for (const m of envRaw.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) env[m[1]] = tomlUnescape(m[2])
  return { command: tomlUnescape(command), args, env }
}

/**
 * 读回该客户端**实际会启动的那条命令**——注意不是 mcpServerEntry()（那是「我们现在会写什么」）。
 * 两者可能天差地别：老版本 Nomi 写过 `node <repo>/scripts/nomi-mcp.mjs`（该脚本已随 5a40acbc 删除）、
 * 从 dev 构建点接入会把 args 钉在一条随时会消失的 git worktree 上。「已接入」若只看配置里有没有这行字，
 * 这些全都显示绿灯而实际早断了——验证必须拿这条读回来的命令去真跑（见 mcpVerify）。
 */
export function configuredMcpEntry(client?: string): McpServerEntry | null {
  const key = resolveClient(client)
  const spec = CLIENTS[key]
  const target = spec.configPath()
  if (spec.format === 'toml') return codexConfiguredEntry(target)
  const servers = readJsonConfig(target).mcpServers as Record<string, unknown> | undefined
  const entry = servers && typeof servers === 'object' ? servers[SERVER_NAME] : undefined
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const command = typeof record.command === 'string' ? record.command : ''
  if (!command) return null
  const args = Array.isArray(record.args) ? record.args.filter((a): a is string => typeof a === 'string') : []
  const env: Record<string, string> = {}
  if (record.env && typeof record.env === 'object') {
    for (const [k, v] of Object.entries(record.env as Record<string, unknown>)) if (typeof v === 'string') env[k] = v
  }
  return { command, args, env }
}

/** 一键写入指定客户端：备份 → 合并 nomi 条目（保留其它）→ 原子写回。默认 Claude Code。 */
export function installMcp(client?: string): { ok: boolean; client: McpClientKey; configPath: string; backupPath: string | null } {
  const key = resolveClient(client)
  const spec = CLIENTS[key]
  const target = spec.configPath()
  const backupPath = spec.format === 'toml' ? codexInstall(target, key) : jsonInstall(target, key)
  return { ok: true, client: key, configPath: target, backupPath }
}

/** 撤销接入指定客户端：删 nomi 条目（不碰其它）。文件不存在/没装就当成功。默认 Claude Code。 */
export function uninstallMcp(client?: string): { ok: boolean; client: McpClientKey } {
  const key = resolveClient(client)
  const spec = CLIENTS[key]
  const target = spec.configPath()
  if (spec.format === 'toml') codexUninstall(target)
  else jsonUninstall(target)
  return { ok: true, client: key }
}
