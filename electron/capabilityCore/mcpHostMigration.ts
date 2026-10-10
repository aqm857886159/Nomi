// 能力核 · 宿主配置迁移（MCP 第 3 段）：用户点「改过去」之后，把宿主里 Nomi 自己写的旧 stdio 条目
// 换成本机 HTTP 直连（Claude Code / Codex / Cursor）或 stdio→HTTP 转发口（Claude Desktop）。
// 设计卡 docs/plan/2026-10-09-mcp-host-migration.md。
//
// 铁律：
// - 只有 migrateMcpHostsToHttp 会把 stdio 改成 HTTP，它只在用户同意后被调用；启动修复（repairStaleMcpConfigs）
//   与「修复 / 重新连接」（installMcp）只会按条目当前的传输方式重写，永远不改变传输方式。
// - 条目形状与所有权判定住 mcpHostEntries（地址与身份头由第 2 段的 buildMcpHttpHostEntry 生成，不另写一份）。
// - 写盘只走 hostConfigWrite.atomicWrite：每个文件一把锁、锁里只读一次、备份从同一份字节写出、提交前后核对宿主有没有插写。
//   迁移前原文单独备份为 .nomi-backup-premigrate，排他创建、只存第一次；这次没写成就撤掉这次建的那份。
import crypto from 'node:crypto'
import fs from 'node:fs'

import { app } from 'electron'

import {
  HostConfigBusyError,
  HostConfigChangedError,
  HostConfigLockLostError,
  HostConfigWriteRefused,
  atomicWrite,
  hostConfigBackupFailed,
  parseJsonConfig,
} from './hostConfigWrite'
import {
  CODEX_TOOL_TIMEOUT_SEC,
  SERVER_NAME,
  classifyMcpEntry,
  mcpServerEntry,
  removeCodexBlock,
  type McpClientKey,
} from './mcpConfig'
import { builtinMcpClientConfigPath, isMcpClientAppInstalled } from './mcpDetectedClients'
import {
  codexHttpBlock,
  forwarderEntry,
  httpJsonEntry,
  nomiEntryTransport,
  parseNomiEntry,
  readNomiEntry,
  stableMcpPort,
  type RawNomiEntry,
} from './mcpHostEntries'
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

/** 这一条是不是 Nomi 自己写的 stdio 条目（所有权与写入门同一个判定；混合 / 别人写的 / 已迁移的都不算）。 */
function isNomiStdioEntry(client: McpClientKey, raw: RawNomiEntry | null | 'unreadable'): boolean {
  if (!raw || raw === 'unreadable' || nomiEntryTransport(client, raw) !== 'stdio') return false
  const state = classifyMcpEntry(client, { command: raw.command ?? '', args: raw.args ?? [], env: { ...(raw.env ?? {}) } })
  return state !== 'custom' && state !== 'absent' && state !== 'migrated-forwarder'
}

/** 连接卡顶部「要不要改过去」问的就是这份名单：只含装了、且已写着 Nomi 旧 stdio 条目、能迁移的宿主。 */
export function listMigratableMcpHosts(): BuiltinMcpClient[] {
  return (Object.keys(MCP_CLIENT_REGISTRY) as BuiltinMcpClient[]).filter(
    (client) => migratable(client) && isMcpClientAppInstalled(client) && isNomiStdioEntry(client, readNomiEntry(client)),
  )
}

export type McpMigrationState = {
  hosts: { client: BuiltinMcpClient; label: string }[]
  /** 「以后再说」按它记：到下一版再问。 */
  appVersion: string
  /** 这一次询问的确认凭据：只覆盖上面列出的宿主、只能用一次、有效期内。没有可迁移的宿主时为 null。 */
  consent: string | null
}

/**
 * 用户同意绑定到主进程发出的那一次询问：凭据只认当时列出的宿主、只能用一次、过期作废。
 * 渲染层传来的名单多一个、凭据对不上、重放，都在写任何文件之前拒绝。主进程只记最近一次发出的那张。
 */
type ConsentGrant = { token: string; clients: ReadonlySet<string>; expiresAt: number }
const CONSENT_TTL_MS = 30 * 60_000
let consentGrant: ConsentGrant | null = null

function issueConsent(clients: readonly string[]): string | null {
  if (clients.length === 0) {
    consentGrant = null
    return null
  }
  const token = crypto.randomUUID()
  consentGrant = { token, clients: new Set(clients), expiresAt: Date.now() + CONSENT_TTL_MS }
  return token
}

export class McpMigrationConsentError extends Error {
  constructor() {
    super('migration consent is missing, expired, already used, or does not cover these hosts')
  }
}

function redeemConsent(consent: unknown, clients: unknown): string[] {
  const grant = consentGrant
  const requested = Array.isArray(clients) ? clients.filter((c): c is string => typeof c === 'string') : []
  const valid = grant !== null && typeof consent === 'string' && consent === grant.token && Date.now() < grant.expiresAt
    && requested.length > 0 && requested.length === (clients as unknown[]).length
    && new Set(requested).size === requested.length && requested.every((client) => grant.clients.has(client))
  if (!valid) throw new McpMigrationConsentError()
  consentGrant = null
  return requested
}

export function readMcpMigrationState(): McpMigrationState {
  const hosts = listMigratableMcpHosts()
  return {
    hosts: hosts.map((client) => ({ client, label: MCP_CLIENT_REGISTRY[client].label })),
    appVersion: app.getVersion(),
    consent: issueConsent(hosts),
  }
}

/** 迁移在锁里判定「不改」时抛它：原文件不动，结果里带原因。 */
class MigrationDeclined extends Error {
  constructor(readonly reason: McpMigrationFailure) {
    super(`migration declined: ${reason}`)
  }
}

type AlreadyMigrated = { kind: 'http' | 'forwarder' | null }

/** 锁里、拿着唯一一次读到的原文算新内容；已经是 Nomi 的直连 / 转发口就不写（重试幂等）。 */
function migratedContent(client: BuiltinMcpClient, port: number | null, original: Buffer | null, already: AlreadyMigrated): string | null {
  const isToml = MCP_CLIENT_REGISTRY[client].format === 'toml'
  const raw = parseNomiEntry(isToml ? 'toml' : 'json', original)
  if (raw === 'unreadable') throw new MigrationDeclined('config-unreadable')
  const transport = nomiEntryTransport(client, raw)
  if (transport === 'http' || transport === 'forwarder') {
    already.kind = transport
    return null
  }
  if (!isNomiStdioEntry(client, raw)) throw new MigrationDeclined('not-migratable')
  // 新连接方式此刻没在稳定地址上活着：宿主保持原样，原来的连接照常可用。
  if (port === null || !isMcpHttpLiveAt(port)) throw new MigrationDeclined('http-unavailable')
  if (isToml) {
    const block = codexHttpBlock(client, port, CODEX_TOOL_TIMEOUT_SEC)
    if (!block) throw new MigrationDeclined('not-migratable')
    const base = removeCodexBlock(original === null ? '' : String(original)).replace(/\s*$/, '')
    return (base ? `${base}\n\n` : '') + block
  }
  const entry = FORWARDER_HOSTS.has(client) ? forwarderEntry(client, port, mcpServerEntry(client)) : httpJsonEntry(client, port)
  if (!entry) throw new MigrationDeclined('not-migratable')
  const config = parseJsonConfig(original)!
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
    ? config.mcpServers
    : {}) as Record<string, unknown>
  servers[SERVER_NAME] = entry
  config.mcpServers = servers
  return JSON.stringify(config, null, 2)
}

function migrateOne(client: string, port: number | null): McpMigrationResult {
  const fail = (reason: McpMigrationFailure): McpMigrationResult => ({ client, ok: false, reason })
  if (!migratable(client)) return fail('not-migratable')
  if (!isMcpClientAppInstalled(client)) return fail('client-not-installed')
  const target = builtinMcpClientConfigPath(client)!
  const already: AlreadyMigrated = { kind: null }
  try {
    const { backupPath } = atomicWrite(target, (original) => migratedContent(client, port, original, already), { backup: PRE_MIGRATION_BACKUP })
    if (already.kind) {
      // 之前那次其实已经改好（例如提交后宿主紧接着又写了一次、被报成 host-changed）：重试如实报成功。
      const premigrate = `${target}${PRE_MIGRATION_BACKUP_SUFFIX}`
      return { client, ok: true, kind: already.kind, backupPath: fs.existsSync(premigrate) ? premigrate : null }
    }
    return { client, ok: true, kind: FORWARDER_HOSTS.has(client) ? 'forwarder' : 'http', backupPath }
  } catch (error) {
    if (error instanceof MigrationDeclined) return fail(error.reason)
    if (error instanceof HostConfigWriteRefused) return fail(error.reason === 'isolated-instance' ? 'isolated-instance' : 'config-unreadable')
    if (error instanceof HostConfigChangedError) return fail('host-changed')
    if (error instanceof HostConfigBusyError || error instanceof HostConfigLockLostError) return fail('write-failed')
    return fail(hostConfigBackupFailed(error) ? 'backup-failed' : 'write-failed')
  }
}

/** 每个宿主独立：一个失败不影响别的，失败的原文件一个字节都不动。只经 migrateMcpHostsWithConsent 从界面到达。 */
export function migrateMcpHostsToHttp(clients: readonly string[]): McpMigrationResult[] {
  const port = stableMcpPort()
  return clients.map((client) => migrateOne(client, port))
}

export type McpMigrationOutcome = {
  results: McpMigrationResult[]
  /** 「再试一次」的凭据：只覆盖这次没改成的宿主。全成功时为 null。 */
  retryConsent: string | null
}

/** 用户点了「改过去」/「再试一次」：先兑现那一次询问的凭据，再迁移。 */
export function migrateMcpHostsWithConsent(consent: unknown, clients: unknown): McpMigrationOutcome {
  const results = migrateMcpHostsToHttp(redeemConsent(consent, clients))
  return { results, retryConsent: issueConsent(results.filter((r) => !r.ok).map((r) => r.client)) }
}

/** 恢复迁移前的配置：逐字节写回那份原文，同样走写盘门（锁 + 同一套提交）。主进程能力；这一版界面上没有入口。 */
export function restorePreMigrationMcpConfig(client: string): McpRestoreResult {
  if (!isBuiltinMcpClient(client)) return { client, ok: false, reason: 'no-backup' }
  const target = builtinMcpClientConfigPath(client)
  const backup = target ? `${target}${PRE_MIGRATION_BACKUP_SUFFIX}` : null
  if (!target || !backup || !fs.existsSync(backup)) return { client, ok: false, reason: 'no-backup' }
  try {
    atomicWrite(target, (original) => {
      const restored = fs.readFileSync(backup)
      return original && original.equals(restored) ? null : restored
    })
    return { client, ok: true }
  } catch (error) {
    if (error instanceof HostConfigWriteRefused) return { client, ok: false, reason: 'isolated-instance' }
    if (error instanceof HostConfigChangedError) return { client, ok: false, reason: 'host-changed' }
    return { client, ok: false, reason: 'write-failed' }
  }
}
