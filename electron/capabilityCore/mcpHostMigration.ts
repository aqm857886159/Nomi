// 能力核 · 宿主配置迁移（MCP 第 3 段）：用户点「改过去」之后，把宿主里 Nomi 自己写的旧 stdio 条目
// 换成本机 HTTP 直连（Claude Code / Codex / Cursor）或 stdio→HTTP 转发口（Claude Desktop）。
// 设计卡 docs/plan/2026-10-09-mcp-host-migration.md。
//
// 铁律：
// - 只有 migrateMcpHostsToHttp 会把 stdio 改成 HTTP，它只在用户同意后被调用；启动修复（repairStaleMcpConfigs）
//   与「修复 / 重新连接」（installMcp）只会按条目当前的传输方式重写，永远不改变传输方式。
// - 条目形状住 mcpHostEntries（地址与身份头由第 2 段的 buildMcpHttpHostEntry 生成，不另写一份）。
// - 写盘只走 hostConfigWrite.atomicWrite：每个文件一把锁、备份、换名前比对原文件版本、原子换名。
//   迁移前原文单独备份为 .nomi-backup-premigrate，排他创建、只存第一次。
import fs from 'node:fs'

import { app } from 'electron'

import {
  HostConfigBusyError,
  HostConfigChangedError,
  HostConfigWriteRefused,
  atomicWrite,
  hostConfigBackupFailed,
  readJsonConfig,
  readText,
  sha256OfFile,
  withHostConfigLock,
} from './hostConfigWrite'
import {
  CODEX_TOOL_TIMEOUT_SEC,
  SERVER_NAME,
  classifyMcpEntry,
  configuredMcpEntry,
  mcpServerEntry,
  removeCodexBlock,
  type McpClientKey,
} from './mcpConfig'
import { builtinMcpClientConfigPath, isMcpClientAppInstalled } from './mcpDetectedClients'
import { codexHttpBlock, forwarderEntry, httpJsonEntry, stableMcpPort } from './mcpHostEntries'
import { isMcpHttpLiveAt } from './mcpHttpEndpoint'
import { MCP_CLIENT_REGISTRY, isBuiltinMcpClient, type BuiltinMcpClient } from '../shared/mcpClientRegistry'

/** 迁移前那份原文的备份后缀：只存第一次（排他创建），installMcp 的 .nomi-backup 永远不碰它。 */
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
  /** 读完之后宿主又改了这个文件：放弃，原文件不动，请重试。 */
  | 'host-changed'

export type McpMigrationResult =
  | { client: string; ok: true; kind: 'http' | 'forwarder'; backupPath: string | null }
  | { client: string; ok: false; reason: McpMigrationFailure }

export type McpRestoreResult =
  | { client: string; ok: true }
  | { client: string; ok: false; reason: 'no-backup' | 'write-failed' | 'isolated-instance' | 'host-changed' }

function migratable(client: string): client is BuiltinMcpClient {
  return isBuiltinMcpClient(client) && !STAYS_STDIO.has(client) && builtinMcpClientConfigPath(client) !== null
}

/** 宿主里是否真有 Nomi 自己写的 stdio 条目（custom = 别人写的；已迁移的转发口 / HTTP 条目也不算）。 */
function hasNomiStdioEntry(client: McpClientKey): boolean {
  const entry = configuredMcpEntry(client)
  if (!entry) return false
  const state = classifyMcpEntry(client, entry)
  return state !== 'custom' && state !== 'absent' && state !== 'migrated-forwarder'
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

function migrateOne(client: string, port: number | null): McpMigrationResult {
  const fail = (reason: McpMigrationFailure): McpMigrationResult => ({ client, ok: false, reason })
  if (!migratable(client)) return fail('not-migratable')
  if (!isMcpClientAppInstalled(client)) return fail('client-not-installed')
  const target = builtinMcpClientConfigPath(client)!
  const isToml = MCP_CLIENT_REGISTRY[client].format === 'toml'
  try {
    // 读—改—写整段在这个文件的锁里；换名前 atomicWrite 会再读一遍原文件，与这里读到的那版比对。
    return withHostConfigLock(target, () => {
      const before = sha256OfFile(target)
      const config = isToml ? {} : readJsonConfig(target)
      if (!config) return fail('config-unreadable')
      if (!hasNomiStdioEntry(client)) return fail('not-migratable')
      // 新连接方式此刻没在稳定地址上活着：宿主保持原样，原来的连接照常可用。
      if (port === null || !isMcpHttpLiveAt(port)) return fail('http-unavailable')
      let content: string
      if (isToml) {
        const block = codexHttpBlock(client, port, CODEX_TOOL_TIMEOUT_SEC)
        if (!block) return fail('not-migratable')
        const base = removeCodexBlock(readText(target)).replace(/\s*$/, '')
        content = (base ? `${base}\n\n` : '') + block
      } else {
        const entry = FORWARDER_HOSTS.has(client) ? forwarderEntry(client, port, mcpServerEntry(client)) : httpJsonEntry(client, port)
        if (!entry) return fail('not-migratable')
        const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
          ? config.mcpServers
          : {}) as Record<string, unknown>
        servers[SERVER_NAME] = entry
        config.mcpServers = servers
        content = JSON.stringify(config, null, 2)
      }
      const backupPath = atomicWrite(target, content, { backup: PRE_MIGRATION_BACKUP, lockHeld: true, expectedSha256: before })
      return { client, ok: true as const, kind: FORWARDER_HOSTS.has(client) ? 'forwarder' as const : 'http' as const, backupPath }
    })
  } catch (error) {
    if (error instanceof HostConfigWriteRefused) return fail(error.reason === 'isolated-instance' ? 'isolated-instance' : 'config-unreadable')
    if (error instanceof HostConfigChangedError) return fail('host-changed')
    if (error instanceof HostConfigBusyError) return fail('write-failed')
    return fail(hostConfigBackupFailed(error) ? 'backup-failed' : 'write-failed')
  }
}

/** 用户点了「改过去」才会走到这里。每个宿主独立：一个失败不影响别的，失败的原文件一个字节都不动。 */
export function migrateMcpHostsToHttp(clients: readonly string[]): McpMigrationResult[] {
  const port = stableMcpPort()
  return clients.map((client) => migrateOne(client, port))
}

/** 恢复迁移前的配置：逐字节写回那份原文，同样走锁 + 原子写。主进程能力；这一版界面上没有入口。 */
export function restorePreMigrationMcpConfig(client: string): McpRestoreResult {
  if (!isBuiltinMcpClient(client)) return { client, ok: false, reason: 'no-backup' }
  const target = builtinMcpClientConfigPath(client)
  const backup = target ? `${target}${PRE_MIGRATION_BACKUP_SUFFIX}` : null
  if (!target || !backup || !fs.existsSync(backup)) return { client, ok: false, reason: 'no-backup' }
  try {
    withHostConfigLock(target, () => atomicWrite(target, fs.readFileSync(backup), { lockHeld: true, expectedSha256: sha256OfFile(target) }))
    return { client, ok: true }
  } catch (error) {
    if (error instanceof HostConfigWriteRefused) return { client, ok: false, reason: 'isolated-instance' }
    if (error instanceof HostConfigChangedError) return { client, ok: false, reason: 'host-changed' }
    return { client, ok: false, reason: 'write-failed' }
  }
}
