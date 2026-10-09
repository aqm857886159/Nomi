// 能力核 · 宿主配置的唯一写盘门（从 mcpConfig 抽出，因为迁移与安装两条写路径都要走它）。
//
// 一次写 = 持有这个文件的互斥锁 → 备份（失败则原文件不动）→ 带拥有者的唯一临时名写入 → 换名前再读一遍原文件、
// 与调用方读到的版本比对（不一致就放弃，原文件不动）→ 原子换名。
//
// 锁用仓库已有的租约设施 productionRun/productionRunLock（排他创建 + 过期回收 + 围栏），不另写一套；
// 它是通用的「一个文件 = 一把租约」，这里只传 ephemeral（不留 epoch 文件在用户目录里）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

import { renameSyncWithRetry } from '../jsonFile'
import { ProductionRunLockBusyError, createProductionRunLock } from '../productionRun/productionRunLock'
import { SETTINGS_ROOT_ENV } from '../settings/settingsRoot'

/** 写盘被拒的原因（UI 按它走 i18n）。 */
export type McpWriteRefusal = 'unknown-client' | 'client-not-installed' | 'isolated-instance' | 'config-unreadable' | 'http-unavailable'

export class HostConfigWriteRefused extends Error {
  constructor(readonly reason: McpWriteRefusal, detail: string) {
    super(`host config write refused (${reason}): ${detail}`)
  }
}

/** 换名前发现原文件已不是调用方读到的那一版（宿主刚写过它）。 */
export class HostConfigChangedError extends Error {
  constructor(target: string) {
    super(`host config changed while Nomi was preparing the write: ${target}`)
  }
}

/** 同一个文件正被别的写入者持有（另一个 Nomi 实例正在迁移 / 修复它）。 */
export class HostConfigBusyError extends Error {
  constructor(target: string) {
    super(`host config is being written by another Nomi: ${target}`)
  }
}

/** 隔离实例的判据（唯一一份；协议登记等也问它）：走查/评测启动器钉死的 NOMI_E2E，或设置根不是本机 Electron 的 userData。 */
export function isolatedInstanceMarker(): string | null {
  if (process.env.NOMI_E2E === '1') return 'NOMI_E2E=1'
  const settingsRoot = String(process.env[SETTINGS_ROOT_ENV] || '').trim()
  if (settingsRoot && path.resolve(settingsRoot) !== path.resolve(app.getPath('userData'))) return `${SETTINGS_ROOT_ENV}=${settingsRoot}`
  return null
}

/** 真实用户主目录——取 passwd/profile 那份，不取 HOME 环境变量（走查会把 HOME 换成临时目录）。 */
function realUserHome(): string | null {
  try {
    const home = os.userInfo().homedir
    return home && path.isAbsolute(home) ? path.resolve(home) : null
  } catch {
    return null
  }
}

function isInside(target: string, root: string): boolean {
  const relative = path.relative(root, path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * 隔离实例（走查 / 评测 / 临时 profile）不得改写**真实用户主目录**下的宿主配置——那会把开发者本机的
 * Claude Code / Codex / Cursor 全指到一个跑完就删的临时 profile（2026-09-13 本机 5 个文件全指向死掉的
 * /tmp/nomi-real-agent-*，就是这么来的）。HOME 已换成临时目录的走查照常可写（目标不在真实主目录里）。
 * 守卫住在唯一的写盘门上，而不是某个包装层：包装层可以被绕（此前 readMcpInfo 就绕过了 repair 的守卫）。
 */
function assertHostConfigWritable(target: string): void {
  const marker = isolatedInstanceMarker()
  if (!marker) return
  const realHome = realUserHome()
  if (realHome && isInside(target, realHome)) throw new HostConfigWriteRefused('isolated-instance', `${marker} → ${target}`)
}

/** 抢不到锁时最多等多久（毫秒）；测试用环境变量压短。 */
const LOCK_WAIT_ENV = 'NOMI_HOST_LOCK_WAIT_MS'
const LOCK_LEASE_MS = 15_000

function lockWaitMs(): number {
  const raw = Number(process.env[LOCK_WAIT_ENV])
  return Number.isFinite(raw) && raw >= 0 ? raw : 3000
}

/** 每个目标文件一把互斥锁（租约文件挨着配置，崩溃残留过期后自动回收）。 */
export function withHostConfigLock<T>(target: string, run: () => T): T {
  const lock = createProductionRunLock({
    filePath: `${target}.nomi-lock`,
    durability: 'ephemeral',
    leaseMs: LOCK_LEASE_MS,
    ownerId: `nomi-host-config-${process.pid}-${crypto.randomUUID()}`,
  })
  const deadline = Date.now() + lockWaitMs()
  const spin = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    try {
      const lease = lock.acquire()
      try {
        return run()
      } finally {
        try { lock.release(lease) } catch { /* 租约已丢失不盖过原结果 */ }
      }
    } catch (error) {
      if (!(error instanceof ProductionRunLockBusyError)) throw error
      if (Date.now() >= deadline) throw new HostConfigBusyError(target)
      Atomics.wait(spin, 0, 0, 25)
    }
  }
}

export function sha256OfFile(target: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  } catch {
    return null
  }
}

/** suffix = 备份文件名后缀；overwrite=false = 已有就保留（迁移前那份原文只存第一次，排他创建）。 */
export type AtomicWriteBackup = Readonly<{ suffix: string; overwrite: boolean }>
const DEFAULT_BACKUP: AtomicWriteBackup = { suffix: '.nomi-backup', overwrite: true }

export type AtomicWriteOptions = Readonly<{
  backup?: AtomicWriteBackup
  /** 调用方已经持有这个文件的锁（读—改—写整段在锁里）。 */
  lockHeld?: boolean
  /** 调用方读到的那一版的 sha256（文件当时不存在 = null）。换名前再读一遍比对，不一致就放弃。undefined = 不比对。 */
  expectedSha256?: string | null
}>

function markBackupFailure(error: unknown, backupStep: boolean): unknown {
  if (error && typeof error === 'object') (error as { nomiBackupFailed?: boolean }).nomiBackupFailed = backupStep
  return error
}
/** 写盘失败时，是不是卡在「备份」这一步（迁移据此如实报「备份没成」还是「写没成」）。 */
export function hostConfigBackupFailed(error: unknown): boolean {
  return (error as { nomiBackupFailed?: unknown } | null)?.nomiBackupFailed === true
}

function uniqueSuffix(): string {
  return `${process.pid}.${crypto.randomBytes(4).toString('hex')}`
}

function backUp(target: string, backup: AtomicWriteBackup): string | null {
  if (!fs.existsSync(target)) return null
  const backupPath = `${target}${backup.suffix}`
  // 先写带拥有者的 .part，再换名（可覆盖的备份）或排他链接（只存第一次：已存在就不写，且「已存在」的判断是原子的）。
  const part = `${backupPath}.part.${uniqueSuffix()}`
  try {
    fs.copyFileSync(target, part)
    if (backup.overwrite) renameSyncWithRetry(part, backupPath)
    else {
      try { fs.linkSync(part, backupPath) } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error }
      fs.rmSync(part, { force: true })
    }
  } catch (error) {
    try { fs.rmSync(part, { force: true }) } catch { /* 清不掉不盖过原错误 */ }
    throw markBackupFailure(error, true)
  }
  return backupPath
}

/** 宿主配置唯一写盘门。失败一律抛，且失败时原文件一个字节都不动。 */
export function atomicWrite(target: string, content: string | Buffer, options: AtomicWriteOptions = {}): string | null {
  assertHostConfigWritable(target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const write = (): string | null => {
    const backupPath = backUp(target, options.backup ?? DEFAULT_BACKUP)
    // 换名前再读一遍：备份那一步也在读写窗口里，宿主此刻改过文件就放弃（剩余窗口只有这一次读到换名之间）。
    if (options.expectedSha256 !== undefined && sha256OfFile(target) !== options.expectedSha256) throw new HostConfigChangedError(target)
    const tmp = `${target}.nomi-tmp.${uniqueSuffix()}`
    try {
      fs.writeFileSync(tmp, content, 'utf8')
      // Windows：目标被杀毒/编辑器短暂持有会 EPERM，共享重试收口（P2）。
      renameSyncWithRetry(tmp, target)
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }) } catch { /* 清不掉不盖过原错误 */ }
      throw markBackupFailure(error, false)
    }
    return backupPath
  }
  return options.lockHeld ? write() : withHostConfigLock(target, write)
}

/**
 * 文件不存在 → `{}`（可以新建）；文件存在但不是一个 JSON 对象 → `null`（**不许写**）。
 * 此前解析失败也回 `{}`，随后整份 `{mcpServers:{nomi}}` 被当作整个文件写回——`~/.claude.json` 里
 * Claude Code 的登录会话和逐项目信任全没了（有 .nomi-backup，但用户不会知道）。
 */
export function readJsonConfig(target: string): Record<string, unknown> | null {
  if (!fs.existsSync(target)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readText(target: string): string {
  try {
    return fs.readFileSync(target, 'utf8')
  } catch {
    return ''
  }
}

/** TOML 双引号字符串里的转义。 */
export function tomlEscapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
