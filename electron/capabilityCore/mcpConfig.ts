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
import { readToken } from './security'

const SERVER_NAME = 'nomi'

export type McpClientKey = 'claude' | 'codex' | 'cursor'

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
type McpServerEntry = { command: string; args: string[]; env?: Record<string, string> }

/**
 * nomi MCP server 条目：让 Nomi 用**自身可执行文件**以 NOMI_MCP_STDIO 模式启动 = 进程内 stdio MCP server。
 * 打包版 process.execPath = `/Applications/Nomi.app/Contents/MacOS/Nomi`（包内永远存在、无 node 依赖）。
 * dev 下 execPath = node_modules 的 electron，需 args 指明 app 路径（repo 根）让它找到 main。三客户端共用。
 */
function mcpServerEntry(): McpServerEntry {
  return {
    command: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
    env: { NOMI_MCP_STDIO: '1' },
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
  fs.renameSync(tmp, target)
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

function jsonInstall(target: string): string | null {
  const backupPath = fs.existsSync(target) ? `${target}.nomi-backup` : null
  const config = readJsonConfig(target)
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
    ? (config.mcpServers as Record<string, unknown>)
    : {}) as Record<string, unknown>
  servers[SERVER_NAME] = mcpServerEntry()
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

const CODEX_HEADER_RE = /^\s*\[mcp_servers\.nomi\]\s*$/

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function codexBlock(server: McpServerEntry): string {
  const args = server.args.map((arg) => `"${tomlEscape(arg)}"`).join(', ')
  let block = `[mcp_servers.${SERVER_NAME}]\ncommand = "${tomlEscape(server.command)}"\nargs = [${args}]\n`
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

/** 删掉现有 [mcp_servers.nomi] 块（从该表头到下一个 [表头] 或 EOF），其它内容原样保留。 */
function removeCodexBlock(text: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (CODEX_HEADER_RE.test(line)) {
      skipping = true
      continue
    }
    if (skipping && /^\s*\[/.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

function codexInstall(target: string): string | null {
  const backupPath = fs.existsSync(target) ? `${target}.nomi-backup` : null
  const base = removeCodexBlock(readText(target)).replace(/\s*$/, '')
  const next = (base ? `${base}\n\n` : '') + codexBlock(mcpServerEntry())
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
  /** 每个可一键接入的客户端的状态 + 可复制片段（卡片据此显示 + 默认选已接入的）。 */
  clients: Record<McpClientKey, McpClientInfo>
}

function clientInfo(client: McpClientKey, server: McpServerEntry): McpClientInfo {
  const spec = CLIENTS[client]
  const target = spec.configPath()
  const installed = spec.format === 'toml' ? codexInstalled(target) : jsonInstalled(target)
  const snippet = spec.format === 'toml' ? codexBlock(server) : jsonSnippet(server)
  return { installed, configPath: target, snippet }
}

/** 读接入状态 + 各客户端配置片段。rpcPort 由调用方（appIntegration）传入。 */
export function readMcpInfo(rpcPort: number | null): McpInfo {
  const server = mcpServerEntry()
  return {
    tokenReady: readToken() !== null,
    rpcRunning: typeof rpcPort === 'number' && rpcPort > 0,
    server,
    clients: {
      claude: clientInfo('claude', server),
      codex: clientInfo('codex', server),
      cursor: clientInfo('cursor', server),
    },
  }
}

/** 一键写入指定客户端：备份 → 合并 nomi 条目（保留其它）→ 原子写回。默认 Claude Code。 */
export function installMcp(client?: string): { ok: boolean; client: McpClientKey; configPath: string; backupPath: string | null } {
  const key = resolveClient(client)
  const spec = CLIENTS[key]
  const target = spec.configPath()
  const backupPath = spec.format === 'toml' ? codexInstall(target) : jsonInstall(target)
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
