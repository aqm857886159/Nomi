// 能力核 · 宿主配置的唯一写盘门（迁移、安装 / 修复、撤销、恢复四条写路径都走它）。
//
// 一次写 = 读—改—写整段在这个文件的锁里，且只读一次：
//   ① 拿锁（每个目标文件一把租约，写的每一步之间续租；锁丢了在换名之前失败）；
//   ② 把原文件**一次**读进内存，调用方从这份字节算出新内容（判断传输方式、合并条目都看同一份）；
//   ③ 备份从同一份内存写出（不 copyFile：复制途中宿主写入会留下一份混合的备份）；
//   ④ 提交：最后一刻再比一次 → 给原文件挂一个硬链接（留住被换下来的那一份）→ 原子换名 →
//      读那份被换下来的：不是我们读到的那版 = 宿主在比对之后、换名之前写过 → 把它放回去、报失败；
//      再读回一次：不是我们写的 = 宿主刚在换名之后写过 → 不动它、报失败。
// 普通文件系统没有对外部写者的 compare-and-swap；剩下唯一测不到的是「宿主用换名方式写入、恰好落在
// 我们挂链接与换名这两个相邻系统调用之间」，量级与处置见设计卡 docs/plan/2026-10-09-mcp-host-migration.md「中途表」。
//
// 锁用仓库已有的租约设施 productionRun/productionRunLock（排他创建 + 过期回收 + 带 nonce 的所有权核验 + 续租）。
// 为什么不接 proper-lockfile / 平台文件锁，见 docs/engineering/self-written.json 的 mcp-protocol 条目。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

import { renameSyncWithRetry, retryOnSharingViolation } from '../jsonFile'
import {
  ProductionRunLockBusyError,
  ProductionRunLockLostError,
  createProductionRunLock,
  type ProductionRunLockLease,
} from '../productionRun/productionRunLock'
import { SETTINGS_ROOT_ENV } from '../settings/settingsRoot'

/** 写盘被拒的原因（UI 按它走 i18n）。 */
export type McpWriteRefusal =
  | 'unknown-client'
  | 'client-not-installed'
  | 'isolated-instance'
  | 'config-unreadable'
  | 'http-unavailable'
  /** 宿主里叫 nomi 的那一条不能确认是 Nomi 写的（混合两种写法 / 地址或身份对不上）：不改它。 */
  | 'entry-not-owned'

export class HostConfigWriteRefused extends Error {
  constructor(readonly reason: McpWriteRefusal, detail: string) {
    super(`host config write refused (${reason}): ${detail}`)
  }
}

/** 提交前后发现原文件已不是调用方读到的那一版（宿主刚写过它）。committed = Nomi 的内容确实落过盘（之后又被宿主改了）。 */
export class HostConfigChangedError extends Error {
  constructor(target: string, readonly committed = false) {
    super(`host config changed while Nomi was writing it: ${target}`)
  }
}

/** 同一个文件正被别的写入者持有（另一个 Nomi 实例正在迁移 / 修复它）。 */
export class HostConfigBusyError extends Error {
  constructor(target: string) {
    super(`host config is being written by another Nomi: ${target}`)
  }
}

/** 写到一半锁已经不是自己的了（租约过期被回收）：在换名之前放弃，原文件不动。 */
export class HostConfigLockLostError extends Error {
  constructor(target: string) {
    super(`host config lock was lost before the write could be committed: ${target}`)
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

// ── 锁 ───────────────────────────────────────────────────────────────

/** 抢不到锁时最多等多久（毫秒）；测试用环境变量压短。 */
const LOCK_WAIT_ENV = 'NOMI_HOST_LOCK_WAIT_MS'
/** 租约时长；测试用环境变量压短到能在几秒内跨过它。 */
const LOCK_LEASE_ENV = 'NOMI_HOST_LOCK_LEASE_MS'
const DEFAULT_LEASE_MS = 30_000

function lockWaitMs(): number {
  const raw = Number(process.env[LOCK_WAIT_ENV])
  return Number.isFinite(raw) && raw >= 0 ? raw : 3000
}

function lockLeaseMs(): number {
  const raw = Number(process.env[LOCK_LEASE_ENV])
  return Number.isInteger(raw) && raw >= 300 ? raw : DEFAULT_LEASE_MS
}

/** 续租前至少还得剩这么多：剩得更少就当锁已经不可靠，直接放弃（回收方要等到过期才动手，这段余量就是安全边）。 */
function renewMarginMs(leaseMs: number): number {
  return Math.min(5_000, Math.floor(leaseMs / 3))
}

/** 写的每一步之间调一次：确认锁还是自己的（nonce 对得上、没过期、余量够），并把租约续满。 */
type LockFence = { check(): void }

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function withHostConfigLock<T>(target: string, run: (fence: LockFence) => T): T {
  const leaseMs = lockLeaseMs()
  const lock = createProductionRunLock({
    filePath: `${target}.nomi-lock`,
    durability: 'ephemeral',
    leaseMs,
    ownerId: `nomi-host-config-${process.pid}-${crypto.randomUUID()}`,
  })
  const deadline = Date.now() + lockWaitMs()
  let held: ProductionRunLockLease
  for (;;) {
    try {
      held = lock.acquire()
      break
    } catch (error) {
      if (!(error instanceof ProductionRunLockBusyError)) throw error
      if (Date.now() >= deadline) throw new HostConfigBusyError(target)
      sleepSync(25)
    }
  }
  const fence: LockFence = {
    check() {
      if (Date.parse(held.expiresAt) - Date.now() < renewMarginMs(leaseMs)) throw new HostConfigLockLostError(target)
      try {
        held = lock.renew(held)
      } catch (error) {
        if (error instanceof ProductionRunLockLostError || error instanceof ProductionRunLockBusyError) throw new HostConfigLockLostError(target)
        throw error
      }
    },
  }
  try {
    return run(fence)
  } finally {
    try { lock.release(held) } catch { /* 租约已丢失不盖过原结果 */ }
  }
}

// ── 写 ───────────────────────────────────────────────────────────────

/** suffix = 备份文件名后缀；overwrite=false = 已有就保留（迁移前那份原文只存第一次，排他创建）。 */
export type AtomicWriteBackup = Readonly<{ suffix: string; overwrite: boolean }>
const DEFAULT_BACKUP: AtomicWriteBackup = { suffix: '.nomi-backup', overwrite: true }

/** 从读到的原文（不存在 = null）算出新内容；返回 null = 不用写。抛 HostConfigWriteRefused = 拒绝（原文件不动）。 */
export type HostConfigEdit = (original: Buffer | null) => string | Buffer | null

export type AtomicWriteOptions = Readonly<{
  backup?: AtomicWriteBackup
  /** 测试缝：每次提交尝试的最开头（续租核验与最后一次比对之前）调用。生产调用方不传。 */
  beforeCommit?: () => void
  /**
   * 测量缝（只给 scripts/measure-host-config-commit-window.mjs 用）：本次提交「挂链接」调用开始到「换名」调用返回的
   * 纳秒数——宿主整份替换落在这段里就测不到（设计卡中途表的剩余窗口）。生产调用方不传。
   */
  onCommitWindow?: (nanoseconds: bigint) => void
}>

export type AtomicWriteResult = Readonly<{ written: boolean; backupPath: string | null }>

function markBackupFailure(error: unknown, backupStep: boolean): unknown {
  if (error && typeof error === 'object' && (error as { nomiBackupFailed?: boolean }).nomiBackupFailed === undefined) {
    (error as { nomiBackupFailed?: boolean }).nomiBackupFailed = backupStep
  }
  return error
}
/** 写盘失败时，是不是卡在「备份」这一步（迁移据此如实报「备份没成」还是「写没成」）。 */
export function hostConfigBackupFailed(error: unknown): boolean {
  return (error as { nomiBackupFailed?: unknown } | null)?.nomiBackupFailed === true
}

/** 带拥有者的唯一名：`<prefix>.<pid>.<8 位随机>`。崩溃留下的残渣据 pid 判死后清掉。 */
function ownedName(prefix: string): string {
  return `${prefix}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
}

function rmQuiet(file: string): void {
  try { fs.rmSync(file, { force: true }) } catch { /* 清不掉不盖过原结果 */ }
}

function readBytes(target: string): Buffer | null {
  try {
    return fs.readFileSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw error
  }
}

function sameBytes(left: Buffer | null, right: Buffer | null): boolean {
  return left === null || right === null ? left === right : left.equals(right)
}

function processAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** 崩溃残渣（临时文件、被换下来的链接、备份半成品）：写它的进程已经死了才清；`.nomi-conflict.*` 是数据，永远不清。 */
function sweepDeadLeftovers(target: string): void {
  const dir = path.dirname(target)
  const base = path.basename(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const leftover = new RegExp(`^${base}\\.nomi-(?:tmp|prev|backup\\.part|backup-premigrate\\.part)\\.(\\d+)\\.[0-9a-f]{8}$`)
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return }
  for (const name of names) {
    const pid = Number(leftover.exec(name)?.[1])
    if (Number.isInteger(pid) && pid > 0 && !processAlive(pid)) rmQuiet(path.join(dir, name))
  }
}

type PlacedBackup = { path: string; createdFirst: boolean }

/** 备份从内存里那份原文写出：内容一定是调用方据以修改的那一版，不会混进复制途中宿主的写入。 */
function placeBackup(target: string, original: Buffer, backup: AtomicWriteBackup): PlacedBackup {
  const backupPath = `${target}${backup.suffix}`
  const part = ownedName(`${backupPath}.part`)
  try {
    fs.writeFileSync(part, original, { flag: 'wx' })
    if (backup.overwrite) {
      renameSyncWithRetry(part, backupPath)
      return { path: backupPath, createdFirst: false }
    }
    // 只存第一次：排他链接，「已存在」的判断是原子的。
    let createdFirst = true
    try { fs.linkSync(part, backupPath) } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
      createdFirst = false
    }
    rmQuiet(part)
    return { path: backupPath, createdFirst }
  } catch (error) {
    rmQuiet(part)
    throw markBackupFailure(error, true)
  }
}

/** 这次创建的「只存第一次」备份，写没成功就撤掉：失败不得留下（并永久锁定）一份不是迁移前原文的首份备份。 */
function withdrawFirstBackup(backup: PlacedBackup | null, original: Buffer | null): void {
  if (!backup?.createdFirst) return
  if (sameBytes(readBytes(backup.path), original)) rmQuiet(backup.path)
}

/** 把宿主的内容放回原处（我们换名时把它换下来了）。先把它存到旁边，放回成功再删：任何一步失败，宿主的字节都还在盘上。 */
function putBack(target: string, displaced: Buffer, ours: Buffer): void {
  const keep = ownedName(`${target}.nomi-conflict`)
  fs.writeFileSync(keep, displaced, { flag: 'wx' })
  const tmp = ownedName(`${target}.nomi-tmp`)
  const aside = ownedName(`${target}.nomi-prev`)
  try {
    fs.writeFileSync(tmp, displaced, { flag: 'wx' })
    fs.linkSync(target, aside)
    renameSyncWithRetry(tmp, target)
    const second = fs.readFileSync(aside)
    // 放回的这一瞬宿主又写了一次：那一版留在 .nomi-conflict 里，不丢。
    if (sameBytes(second, ours)) rmQuiet(keep)
    else fs.writeFileSync(keep, second)
  } finally {
    rmQuiet(aside)
    rmQuiet(tmp)
  }
}

function linkOrChanged(from: string, to: string, target: string): void {
  try {
    fs.linkSync(from, to)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // EEXIST：原来没有的文件被宿主建了；ENOENT：原来有的文件被宿主删了。都是「不是我们读到的那一版」。
    if (code === 'EEXIST' || code === 'ENOENT') throw new HostConfigChangedError(target)
    throw error
  }
}

/**
 * 提交：最后一次比对 → 挂链接 → 换名（这两个系统调用紧挨着）→ 事后核对被换下来的那份与读回的这份。
 * Windows 上撞共享冲突就整段重来（包括重新比对），重试不会把窗口拉长。
 */
function commit(target: string, tmp: string, original: Buffer | null, content: Buffer, fence: LockFence, hooks: AtomicWriteOptions): void {
  let aside: string | null
  try {
    aside = retryOnSharingViolation(() => {
      hooks.beforeCommit?.()
      fence.check()
      if (!sameBytes(readBytes(target), original)) throw new HostConfigChangedError(target)
      if (original === null) {
        linkOrChanged(tmp, target, target) // 排他创建：宿主同时建了它就失败
        return null
      }
      const prev = ownedName(`${target}.nomi-prev`)
      const windowStart = process.hrtime.bigint()
      linkOrChanged(target, prev, target)
      try {
        fs.renameSync(tmp, target)
      } catch (error) {
        rmQuiet(prev)
        throw error
      }
      hooks.onCommitWindow?.(process.hrtime.bigint() - windowStart)
      return prev
    })
  } finally {
    rmQuiet(tmp)
  }
  // 已经换上去了：下面任何失败都不能再走「整段重来」，也一律当作「Nomi 的内容落过盘」（备份留着）。
  try {
    let displaced: Buffer | null = null
    if (aside) {
      try {
        displaced = retryOnSharingViolation(() => fs.readFileSync(aside!))
      } finally {
        rmQuiet(aside)
      }
    }
    if (displaced !== null && !sameBytes(displaced, original)) {
      // 比对之后、换名之前宿主写过（原地写）：换下来的就是它，放回去，这次算没写成。
      putBack(target, displaced, content)
      throw new HostConfigChangedError(target, false)
    }
    // 换名之后宿主立刻又写了：它的内容更新，不动它，如实报。
    if (!sameBytes(readBytes(target), content)) throw new HostConfigChangedError(target, true)
  } catch (error) {
    if (!(error instanceof HostConfigChangedError) && error && typeof error === 'object') (error as { nomiLanded?: boolean }).nomiLanded = true
    throw error
  }
}

/**
 * 宿主配置唯一写盘门。失败一律抛；没提交成功时原文件一个字节都不动（宿主同时写入的内容也不丢）。
 * edit 在锁里、拿着唯一一次读到的原文执行——「写什么」的判断和「写」用的是同一份字节。
 */
export function atomicWrite(target: string, edit: HostConfigEdit, options: AtomicWriteOptions = {}): AtomicWriteResult {
  assertHostConfigWritable(target)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  return withHostConfigLock(target, (fence) => {
    sweepDeadLeftovers(target)
    const original = readBytes(target)
    const next = edit(original)
    if (next === null) return { written: false, backupPath: null }
    const content = Buffer.isBuffer(next) ? next : Buffer.from(next, 'utf8')
    fence.check()
    const backup = original ? placeBackup(target, original, options.backup ?? DEFAULT_BACKUP) : null
    const tmp = ownedName(`${target}.nomi-tmp`)
    try {
      fs.writeFileSync(tmp, content, { flag: 'wx' })
      commit(target, tmp, original, content, fence, options)
    } catch (error) {
      rmQuiet(tmp)
      const landed = error instanceof HostConfigChangedError ? error.committed : (error as { nomiLanded?: boolean } | null)?.nomiLanded === true
      if (!landed) withdrawFirstBackup(backup, original)
      throw markBackupFailure(error, false)
    }
    return { written: true, backupPath: backup?.path ?? null }
  })
}

/**
 * 文件不存在 → `{}`（可以新建）；文件存在但不是一个 JSON 对象 → `null`（**不许写**）。
 * 此前解析失败也回 `{}`，随后整份 `{mcpServers:{nomi}}` 被当作整个文件写回——`~/.claude.json` 里
 * Claude Code 的登录会话和逐项目信任全没了（有 .nomi-backup，但用户不会知道）。
 */
export function parseJsonConfig(original: Buffer | string | null): Record<string, unknown> | null {
  if (original === null) return {}
  try {
    const parsed = JSON.parse(String(original))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readJsonConfig(target: string): Record<string, unknown> | null {
  if (!fs.existsSync(target)) return {}
  try {
    return parseJsonConfig(fs.readFileSync(target))
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
