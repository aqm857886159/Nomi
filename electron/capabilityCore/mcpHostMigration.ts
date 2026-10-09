// 能力核 · 宿主配置迁移（MCP 第 3 段）：用户点「改过去」之后，把宿主里 Nomi 自己写的旧 stdio 条目
// 换成本机 HTTP 直连（Claude Code / Codex / Cursor）或 stdio→HTTP 转发口（Claude Desktop）。
// 设计卡 docs/plan/2026-10-09-mcp-host-migration.md。
//
// 铁律：
// - 只有 migrateMcpHostsToHttp 会写 HTTP 条目，它只在用户同意后被调用；启动修复（repairStaleMcpConfigs）
//   永远只做同传输的 stdio 修复，不 import 本文件。
// - 条目由 buildMcpHttpHostEntry 生成（第 2 段留好的唯一出口），这里不另写一份身份头。
// - 写盘只走 mcpConfig.atomicWrite（备份 → 临时文件 → 原子换名）。迁移前备份用独立后缀且只存第一次。
import fs from 'node:fs'

import { app } from 'electron'

import {
  CODEX_TOOL_TIMEOUT_SEC,
  HostConfigWriteRefused,
  SERVER_NAME,
  atomicWrite,
  classifyMcpEntry,
  configuredMcpEntry,
  hostConfigWriteStage,
  mcpServerEntry,
  readJsonConfig,
  readText,
  removeCodexBlock,
  tomlEscape,
  type McpClientKey,
  type McpServerEntry,
} from './mcpConfig'
import { builtinMcpClientConfigPath, isMcpClientAppInstalled } from './mcpDetectedClients'
import {
  MCP_HTTP_URL_ENV,
  buildMcpHttpHostEntry,
  isMcpHttpLiveAt,
  mcpHttpUrl,
  resolveMcpHttpPort,
} from './mcpHttpEndpoint'
import { MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV, signMcpClient } from './security'
import { MCP_CLIENT_REGISTRY, isBuiltinMcpClient, type BuiltinMcpClient } from '../shared/mcpClientRegistry'

/** 迁移前那份原文的备份后缀：只存第一次，installMcp 的 .nomi-backup 永远不碰它。 */
export const PRE_MIGRATION_BACKUP_SUFFIX = '.nomi-backup-premigrate'
const PRE_MIGRATION_BACKUP = { suffix: PRE_MIGRATION_BACKUP_SUFFIX, overwrite: false } as const

/** 官方没有 HTTP 写法、先保持 stdio 的宿主（依据见设计卡）。 */
const STAYS_STDIO: ReadonlySet<BuiltinMcpClient> = new Set(['workbuddy'])
/** 只会 stdio 的宿主：写转发口，不写 url。 */
const FORWARDER_HOSTS: ReadonlySet<BuiltinMcpClient> = new Set(['claude-desktop'])

export type McpMigrationFailure =
  | 'not-migratable'
  | 'client-not-installed'
  | 'isolated-instance'
  | 'config-unreadable'
  | 'http-unavailable'
  | 'backup-failed'
  | 'write-failed'

export type McpMigrationResult =
  | { client: string; ok: true; kind: 'http' | 'forwarder'; backupPath: string | null }
  | { client: string; ok: false; reason: McpMigrationFailure }

export type McpRestoreResult =
  | { client: string; ok: true }
  | { client: string; ok: false; reason: 'no-backup' | 'write-failed' | 'isolated-instance' }

/** 稳定地址的端口：服务端自己选端口的同一个函数。显式 0（随机）或隔离实例（null）都不是稳定地址。 */
function stablePort(): number | null {
  const port = resolveMcpHttpPort()
  return port !== null && port > 0 ? port : null
}

function migratable(client: string): client is BuiltinMcpClient {
  return isBuiltinMcpClient(client) && !STAYS_STDIO.has(client) && builtinMcpClientConfigPath(client) !== null
}

/** 宿主里是否真有 Nomi 自己写的 stdio 条目（custom = 别人写的，不碰）。 */
function hasNomiStdioEntry(client: McpClientKey): boolean {
  const entry = configuredMcpEntry(client)
  if (!entry) return false
  const state = classifyMcpEntry(client, entry)
  return state !== 'custom' && state !== 'absent'
}

/** 连接卡顶部「要不要改过去」问的就是这份名单：只含装了、且已写着 Nomi 旧 stdio 条目、能迁移的宿主。 */
export function listMigratableMcpHosts(): BuiltinMcpClient[] {
  return (Object.keys(MCP_CLIENT_REGISTRY) as BuiltinMcpClient[]).filter(
    (client) => migratable(client) && isMcpClientAppInstalled(client) && hasNomiStdioEntry(client),
  )
}

export type McpMigrationState = {
  hosts: { client: BuiltinMcpClient; label: string }[]
  /** 「以后再说」按它记：到下一版再问。 */
  appVersion: string
}

export function readMcpMigrationState(): McpMigrationState {
  return {
    hosts: listMigratableMcpHosts().map((client) => ({ client, label: MCP_CLIENT_REGISTRY[client].label })),
    appVersion: app.getVersion(),
  }
}

/** Claude Desktop 的转发口条目：同一个 Node 启动器，换成转发口脚本；不带冷启 Nomi 的参数。 */
function forwarderEntry(client: McpClientKey, port: number): McpServerEntry {
  const launcher = mcpServerEntry(client)
  const proof = signMcpClient(client)
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', [MCP_HTTP_URL_ENV]: mcpHttpUrl(port) }
  if (proof) Object.assign(env, { [MCP_CLIENT_ENV]: client, [MCP_CLIENT_PROOF_ENV]: proof })
  const script = launcher.args[0] ?? ''
  return { command: launcher.command, args: [script.replace(/mcpNodeLauncher\.js$/i, 'mcpHttpForwarder.js')], env }
}

function jsonMigratedEntry(client: BuiltinMcpClient, port: number): Record<string, unknown> | null {
  if (FORWARDER_HOSTS.has(client)) return { ...forwarderEntry(client, port) }
  const http = buildMcpHttpHostEntry(client, port)
  if (!http) return null
  // Claude Code 的远程条目必须写 type；Cursor 只认 url + headers。
  return client === 'claude' ? { type: 'http', ...http } : { ...http }
}

function codexHttpBlock(client: BuiltinMcpClient, port: number): string | null {
  const http = buildMcpHttpHostEntry(client, port)
  if (!http) return null
  const headers = Object.entries(http.headers).map(([k, v]) => `${k} = "${tomlEscape(v)}"`).join(', ')
  return `[mcp_servers.${SERVER_NAME}]\nurl = "${tomlEscape(http.url)}"\nhttp_headers = { ${headers} }\n`
    + `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}\ndefault_tools_approval_mode = "writes"\n`
}

function migrateOne(client: string, port: number | null): McpMigrationResult {
  const fail = (reason: McpMigrationFailure): McpMigrationResult => ({ client, ok: false, reason })
  if (!migratable(client)) return fail('not-migratable')
  if (!isMcpClientAppInstalled(client)) return fail('client-not-installed')
  const target = builtinMcpClientConfigPath(client)!
  // 重新读一遍、校验：配置坏了就别碰；不是 Nomi 自己写的 stdio 条目也别碰。
  const isToml = MCP_CLIENT_REGISTRY[client].format === 'toml'
  const config = isToml ? {} : readJsonConfig(target)
  if (!config) return fail('config-unreadable')
  if (!hasNomiStdioEntry(client)) return fail('not-migratable')
  // 新连接方式此刻没在稳定地址上活着：宿主保持原样，原来的连接照常可用。
  if (port === null || !isMcpHttpLiveAt(port)) return fail('http-unavailable')
  try {
    let content: string
    if (isToml) {
      const block = codexHttpBlock(client, port)
      if (!block) return fail('not-migratable')
      const base = removeCodexBlock(readText(target)).replace(/\s*$/, '')
      content = (base ? `${base}\n\n` : '') + block
    } else {
      const entry = jsonMigratedEntry(client, port)
      if (!entry) return fail('not-migratable')
      const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
        ? config.mcpServers
        : {}) as Record<string, unknown>
      servers[SERVER_NAME] = entry
      config.mcpServers = servers
      content = JSON.stringify(config, null, 2)
    }
    const backupPath = atomicWrite(target, content, PRE_MIGRATION_BACKUP)
    return { client, ok: true, kind: FORWARDER_HOSTS.has(client) ? 'forwarder' : 'http', backupPath }
  } catch (error) {
    if (error instanceof HostConfigWriteRefused) return fail(error.reason === 'isolated-instance' ? 'isolated-instance' : 'config-unreadable')
    return fail(hostConfigWriteStage(error) === 'backup' ? 'backup-failed' : 'write-failed')
  }
}

/** 用户点了「改过去」才会走到这里。每个宿主独立：一个失败不影响别的，失败的原文件一个字节都不动。 */
export function migrateMcpHostsToHttp(clients: readonly string[]): McpMigrationResult[] {
  const port = stablePort()
  return clients.map((client) => migrateOne(client, port))
}

/** 恢复迁移前的配置：逐字节写回那份原文，同样走原子写。主进程能力；这一版界面上没有入口。 */
export function restorePreMigrationMcpConfig(client: string): McpRestoreResult {
  if (!isBuiltinMcpClient(client)) return { client, ok: false, reason: 'no-backup' }
  const target = builtinMcpClientConfigPath(client)
  const backup = target ? `${target}${PRE_MIGRATION_BACKUP_SUFFIX}` : null
  if (!target || !backup || !fs.existsSync(backup)) return { client, ok: false, reason: 'no-backup' }
  try {
    atomicWrite(target, fs.readFileSync(backup))
    return { client, ok: true }
  } catch (error) {
    if (error instanceof HostConfigWriteRefused) return { client, ok: false, reason: 'isolated-instance' }
    return { client, ok: false, reason: 'write-failed' }
  }
}
