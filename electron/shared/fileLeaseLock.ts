import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fsyncDirectoryIfDurable, fsyncIfDurable } from "../durability";
import {
  isSharingViolation, readJsonFile, readJsonFileAsync, renameOnce, renameSyncOnce,
  renameSyncWithRetry, renameWithRetry, retryOnSharingViolation, retryOnSharingViolationAsync,
  writeJsonFileAtomic, writeJsonFileAtomicAsync,
} from "../jsonFile";

export const DIRECTORY_LEASE_SCHEMA_VERSION = 1;
const ownerFileName = "owner.json";
const DEFAULT_INITIALIZATION_GRACE_MS = 5_000;
const ORPHANED_LOCK_REAP_DELAYS_MS = [250, 1_000, 4_000, 15_000, 60_000];

type ProcessLiveness = "alive" | "dead" | "unknown";

export type DirectoryLeaseOwner = {
  schemaVersion: typeof DIRECTORY_LEASE_SCHEMA_VERSION;
  ownerId: string;
  nonce: string;
  host: string;
  pid: number;
  processStartedAtMs: number;
  createdAtMs: number;
};

export type DirectoryLease = {
  lockDir: string;
  owner: DirectoryLeaseOwner;
};

export type DirectoryLeaseOptions = {
  ownerId?: string;
  randomId?: () => string;
  nowMs?: () => number;
  host?: string;
  pid?: number;
  processStartedAtMs?: number;
  processLiveness?: (pid: number) => ProcessLiveness;
  initializationGraceMs?: number;
};

type LeaseErrors = {
  busy(message?: string, options?: { cause?: unknown }): Error;
  lost(message?: string, options?: { cause?: unknown }): Error;
};

/**
 * 本进程此刻真正持有的锁（按 nonce）。取锁成功时登记，释放（无论成败）时注销。
 *
 * 为什么要它（2026-09-24 Windows 用户反馈）：释放锁要把锁目录改名挪走，而同步盘 / 杀毒软件
 * 恰好会在 owner.json 刚写出来时打开它——Windows 上这会让改名失败（EPERM），锁目录留在原地，
 * 记着的是**本进程自己**的 pid。旧逻辑只问「这个 pid 还活着吗」，于是本进程此后每一次取锁都被
 * 自己挡住：保存、导入、生成结果落盘全部先干等 5 秒再失败，直到退出 Nomi。
 * 有了这张表就能分清：pid 是自己、但 nonce 不在表里 ＝ 残留，立即收回；在表里 ＝ 真有一次操作在持有。
 * 前提：本模块在一个进程里只有一份（dist-electron 里只编出一份，主进程不开工作线程）。
 */
const liveLeaseNonces = new Set<string>();

/** The existing directory protocol publishes a complete owner record with one rename. */
export function createDirectoryLeaseLock({
  stem,
  ownerPrefix,
  label,
  errors,
}: {
  stem: string;
  ownerPrefix: string;
  label: string;
  errors: LeaseErrors & { publish(cause: unknown): Error };
}) {
  const lockDirName = `${stem}.lock`;
  const quarantinePrefix = `${stem}.quarantine-`;
  const releasePrefix = `${stem}.release-`;
  const candidatePrefix = `${stem}.candidate-`;

  /**
   * `unreadable`：owner.json 此刻被别的程序（同步盘 / 杀毒 / 索引器）开着读不到。
   * 这只说明「现在不知道」，不说明记录坏了——调用方一律按忙处理，绝不据此强拆别人的锁。
   */
  type ParsedOwner = { valid: true; owner: DirectoryLeaseOwner } | { valid: false; unreadable?: true };

  /** 记录的主人就是本进程（同主机同 pid），而本进程没有任何一次操作在持有它：残留，可立即收回。 */
  function isOwnAbandonedRecord(owner: DirectoryLeaseOwner, self: { host: string; pid: number }): boolean {
    return owner.host === self.host && owner.pid === self.pid && !liveLeaseNonces.has(owner.nonce);
  }

  /** 删一个已经不代表任何持有者的目录（隔离区 / 旧锁）。删不掉只是「清理还没完」，按忙处理、下次再来。 */
  function removeRecoveryDirectory(nomiDir: string, directoryPath: string): void {
    try {
      retryOnSharingViolation(() => fs.rmSync(directoryPath, { recursive: true, force: true }));
    } catch (error) {
      throw errors.busy(`${label} recovery cleanup is still in progress`, { cause: error });
    }
    fsyncDirectoryIfDurable(nomiDir);
  }

  async function removeRecoveryDirectoryAsync(nomiDir: string, directoryPath: string): Promise<void> {
    try {
      await retryOnSharingViolationAsync(() => fs.promises.rm(directoryPath, { recursive: true, force: true }));
    } catch (error) {
      throw errors.busy(`${label} recovery cleanup is still in progress`, { cause: error });
    }
    fsyncDirectoryIfDurable(nomiDir);
  }

  function defaultProcessLiveness(pid: number): ProcessLiveness {
    try {
      process.kill(pid, 0);
      return "alive";
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === "ESRCH" ? "dead" : "unknown";
    }
  }

  function ownerFile(directoryPath: string): string {
    return path.join(directoryPath, ownerFileName);
  }

  function pathToken(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  function validateOwnerValue(value: Partial<DirectoryLeaseOwner> | null | undefined): ParsedOwner {
    if (
      !value ||
      value.schemaVersion !== DIRECTORY_LEASE_SCHEMA_VERSION ||
      typeof value.ownerId !== "string" ||
      !value.ownerId ||
      typeof value.nonce !== "string" ||
      !value.nonce ||
      typeof value.host !== "string" ||
      !value.host ||
      !Number.isInteger(value.pid) ||
      (value.pid ?? 0) <= 0 ||
      !Number.isFinite(value.processStartedAtMs) ||
      (value.processStartedAtMs ?? -1) < 0 ||
      !Number.isFinite(value.createdAtMs) ||
      (value.createdAtMs ?? -1) < 0
    ) {
      return { valid: false };
    }
    return { valid: true, owner: value as DirectoryLeaseOwner };
  }

  function parseOwner(directoryPath: string): ParsedOwner {
    let value: Partial<DirectoryLeaseOwner>;
    try {
      value = retryOnSharingViolation(() => readJsonFile(ownerFile(directoryPath))) as Partial<DirectoryLeaseOwner>;
    } catch (error) {
      return isSharingViolation(error) ? { valid: false, unreadable: true } : { valid: false };
    }
    return validateOwnerValue(value);
  }

  async function parseOwnerAsync(directoryPath: string): Promise<ParsedOwner> {
    let value: Partial<DirectoryLeaseOwner>;
    try {
      value = (await readJsonFileAsync(ownerFile(directoryPath), {
        retrySharingViolation: true,
      })) as Partial<DirectoryLeaseOwner>;
    } catch (error) {
      return isSharingViolation(error) ? { valid: false, unreadable: true } : { valid: false };
    }
    return validateOwnerValue(value);
  }

  function sameOwner(left: DirectoryLeaseOwner, right: DirectoryLeaseOwner): boolean {
    return (
      left.schemaVersion === right.schemaVersion &&
      left.ownerId === right.ownerId &&
      left.nonce === right.nonce &&
      left.host === right.host &&
      left.pid === right.pid &&
      left.processStartedAtMs === right.processStartedAtMs &&
      left.createdAtMs === right.createdAtMs
    );
  }

  function directoryAgeMs(directoryPath: string, nowMs: number): number {
    try {
      return Math.max(0, nowMs - fs.statSync(directoryPath).mtimeMs);
    } catch {
      return 0;
    }
  }

  type RecoveryInput = {
    nomiDir: string;
    host: string;
    pid: number;
    nowMs: number;
    initializationGraceMs: number;
    processLiveness: (pid: number) => ProcessLiveness;
  };

  function prefixedNamesSync(nomiDir: string, prefix: string): string[] {
    try { return fs.readdirSync(nomiDir).filter((name) => name.startsWith(prefix)).sort(); } catch { return []; }
  }

  async function prefixedNamesAsync(nomiDir: string, prefix: string): Promise<string[]> {
    try { return (await fs.promises.readdir(nomiDir)).filter((name) => name.startsWith(prefix)).sort(); } catch { return []; }
  }

  async function pathExistsAsync(targetPath: string): Promise<boolean> {
    return fs.promises.access(targetPath).then(() => true, () => false);
  }

  async function directoryAgeMsAsync(directoryPath: string, nowMs: number): Promise<number> {
    try { return Math.max(0, nowMs - (await fs.promises.stat(directoryPath)).mtimeMs); } catch { return 0; }
  }

  function assertQuarantineRecoverable(parsed: ParsedOwner, ageMs: number, input: RecoveryInput): void {
    if (parsed.valid) {
      if (parsed.owner.host !== input.host) throw errors.busy(`${label} recovery belongs to another host`);
      if (!isOwnAbandonedRecord(parsed.owner, input) && input.processLiveness(parsed.owner.pid) !== "dead") {
        throw errors.busy(`${label} recovery owner is still alive or cannot be verified`);
      }
      return;
    }
    if (parsed.unreadable) throw errors.busy(`${label} recovery record is held open by another program`);
    if (ageMs < input.initializationGraceMs) throw errors.busy(`${label} recovery owner is still initializing`);
  }

  function assertMovedQuarantineValid(moved: ParsedOwner, ageMs: number, expected: DirectoryLeaseOwner | undefined, graceMs: number): void {
    if (expected) {
      if (!moved.valid || !sameOwner(moved.owner, expected)) throw errors.busy(`${label} owner changed during recovery`);
    } else if (moved.valid || moved.unreadable || ageMs < graceMs) {
      throw errors.busy(`${label} owner completed during recovery`);
    }
  }

  function decideLockRecovery(parsed: ParsedOwner, ageMs: number, input: RecoveryInput): DirectoryLeaseOwner | undefined {
    if (!parsed.valid) {
      if (parsed.unreadable) throw errors.busy(`${label} owner record is held open by another program`);
      if (ageMs < input.initializationGraceMs) throw errors.busy(`${label} owner record is still initializing`);
      return undefined;
    }
    if (parsed.owner.host !== input.host) throw errors.busy(`${label} is owned on another host`);
    if (!isOwnAbandonedRecord(parsed.owner, input) && input.processLiveness(parsed.owner.pid) !== "dead") {
      throw errors.busy(`${label} owner is still alive or cannot be verified`);
    }
    return parsed.owner;
  }

  function verifyCandidateOwner(candidateOwner: ParsedOwner, owner: DirectoryLeaseOwner): void {
    if (!candidateOwner.valid && candidateOwner.unreadable) {
      throw errors.publish(new Error(`${label} owner record is held open by another program`));
    }
    if (!candidateOwner.valid || !sameOwner(candidateOwner.owner, owner)) {
      throw errors.lost(`${label} owner record could not be verified before publish`);
    }
  }

  function classifyPublishFailure(error: unknown, lockExists: boolean): never {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
      if (code === "EPERM" && !lockExists) throw errors.publish(error);
      throw errors.busy(undefined, { cause: error });
    }
    throw error;
  }

  function verifyOwnedState(quarantines: string[], current: ParsedOwner, owner: DirectoryLeaseOwner): void {
    if (quarantines.length > 0) throw errors.lost(`${label} lock is under recovery`);
    if (!current.valid || !sameOwner(current.owner, owner)) throw errors.lost();
  }

  function prepareAcquire(nomiDir: string, options: DirectoryLeaseOptions) {
    const randomId = options.randomId ?? (() => crypto.randomUUID());
    const nowMs = options.nowMs ?? (() => Date.now());
    const host = options.host?.trim() || os.hostname();
    const pid = options.pid ?? process.pid;
    const processStartedAtMs = options.processStartedAtMs ?? Math.max(0, Math.floor(Date.now() - process.uptime() * 1_000));
    const processLiveness = options.processLiveness ?? defaultProcessLiveness;
    const initializationGraceMs = options.initializationGraceMs ?? DEFAULT_INITIALIZATION_GRACE_MS;
    const lockDir = path.join(nomiDir, lockDirName);
    const recovery = (): RecoveryInput => ({ nomiDir, host, pid, nowMs: nowMs(), initializationGraceMs, processLiveness });
    const createOwner = (): { owner: DirectoryLeaseOwner; candidateDir: string } => {
      const owner: DirectoryLeaseOwner = {
        schemaVersion: DIRECTORY_LEASE_SCHEMA_VERSION,
        ownerId: options.ownerId?.trim() || `${ownerPrefix}-${pid}-${randomId()}`,
        nonce: randomId(), host, pid, processStartedAtMs, createdAtMs: nowMs(),
      };
      return { owner, candidateDir: path.join(nomiDir, `${candidatePrefix}${pathToken(`${owner.ownerId}:${owner.nonce}`)}`) };
    };
    return { randomId, nowMs, initializationGraceMs, lockDir, recovery, createOwner };
  }

  /** 已交出所有权的旧锁目录（release-*）删不掉就留到下一次，绝不挡住取锁。 */
  function removeReleasedLocks(nomiDir: string): void {
    for (const name of prefixedNamesSync(nomiDir, releasePrefix)) {
      try { fs.rmSync(path.join(nomiDir, name), { recursive: true, force: true }); fsyncDirectoryIfDurable(nomiDir); } catch { /* 下次再收 */ }
    }
  }

  function removeAbandonedCandidates(nomiDir: string, nowMs: number, graceMs: number): void {
    for (const name of prefixedNamesSync(nomiDir, candidatePrefix)) {
      const candidatePath = path.join(nomiDir, name);
      if (directoryAgeMs(candidatePath, nowMs) < graceMs) continue;
      try { fs.rmSync(candidatePath, { recursive: true, force: true }); } catch { /* 下次再收 */ }
    }
  }

  function removeRecoverableQuarantines(input: RecoveryInput): void {
    for (const name of prefixedNamesSync(input.nomiDir, quarantinePrefix)) {
      const quarantinePath = path.join(input.nomiDir, name);
      const parsed = parseOwner(quarantinePath);
      assertQuarantineRecoverable(parsed, parsed.valid ? 0 : directoryAgeMs(quarantinePath, input.nowMs), input);
      removeRecoveryDirectory(input.nomiDir, quarantinePath);
    }
  }

  function quarantineExistingOwner(lockDir: string, input: RecoveryInput, randomId: () => string, expected?: DirectoryLeaseOwner): void {
    const quarantinePath = path.join(input.nomiDir, `${quarantinePrefix}${pathToken(randomId())}`);
    try { renameSyncOnce(lockDir, quarantinePath); } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw errors.busy(`${label} owner changed during recovery`);
    }
    fsyncDirectoryIfDurable(input.nomiDir);
    const moved = parseOwner(quarantinePath);
    assertMovedQuarantineValid(moved, expected ? 0 : directoryAgeMs(quarantinePath, input.nowMs), expected, input.initializationGraceMs);
    removeRecoveryDirectory(input.nomiDir, quarantinePath);
  }

  function acquire(nomiDir: string, options: DirectoryLeaseOptions): DirectoryLease {
    const ctx = prepareAcquire(nomiDir, options);
    removeReleasedLocks(nomiDir);
    removeAbandonedCandidates(nomiDir, ctx.nowMs(), ctx.initializationGraceMs);
    removeRecoverableQuarantines(ctx.recovery());
    if (fs.existsSync(ctx.lockDir)) {
      const rec = ctx.recovery();
      const parsed = parseOwner(ctx.lockDir);
      const expected = decideLockRecovery(parsed, parsed.valid ? 0 : directoryAgeMs(ctx.lockDir, rec.nowMs), rec);
      quarantineExistingOwner(ctx.lockDir, rec, ctx.randomId, expected);
    }
    removeRecoverableQuarantines(ctx.recovery());

    const { owner, candidateDir } = ctx.createOwner();
    fs.mkdirSync(candidateDir);
    try {
      writeJsonFileAtomic(ownerFile(candidateDir), owner);
      verifyCandidateOwner(parseOwner(candidateDir), owner);
      fsyncDirectoryIfDurable(candidateDir);
      try { renameSyncOnce(candidateDir, ctx.lockDir); } catch (error) { classifyPublishFailure(error, fs.existsSync(ctx.lockDir)); }
      fsyncDirectoryIfDurable(nomiDir);
    } finally {
      if (fs.existsSync(candidateDir)) {
        try { fs.rmSync(candidateDir, { recursive: true, force: true }); } catch { /* 留给下次按年龄回收 */ }
      }
    }
    const lease = { lockDir: ctx.lockDir, owner };
    assertOwned(lease);
    liveLeaseNonces.add(owner.nonce);
    return lease;
  }

  function assertOwned(lease: DirectoryLease): void {
    verifyOwnedState(prefixedNamesSync(path.dirname(lease.lockDir), quarantinePrefix), parseOwner(lease.lockDir), lease.owner);
  }

  function releaseDirFor(lease: DirectoryLease): string {
    return path.join(path.dirname(lease.lockDir), `${releasePrefix}${pathToken(`${lease.owner.ownerId}:${crypto.randomUUID()}`)}`);
  }

  /**
   * 释放已提交事务的锁目录：若因 Windows 同步盘/杀毒短暂占用改名失败，交出内存所有权并由后台补收目录。
   */
  function release(lease: DirectoryLease): void {
    try {
      assertOwned(lease);
      const nomiDir = path.dirname(lease.lockDir);
      const releaseDir = releaseDirFor(lease);
      try { renameSyncWithRetry(lease.lockDir, releaseDir); } catch (error) {
        if (isSharingViolation(error)) { scheduleOrphanedLockReap(lease); return; }
        throw errors.lost(`${label} lock changed before release`, { cause: error });
      }
      fsyncDirectoryIfDurable(nomiDir);
      try { fs.rmSync(releaseDir, { recursive: true, force: true }); fsyncDirectoryIfDurable(nomiDir); } catch { /* 下次取锁清理 */ }
    } finally {
      liveLeaseNonces.delete(lease.owner.nonce);
    }
  }

  function reapOrphanedLock(lease: DirectoryLease): boolean {
    if (!fs.existsSync(lease.lockDir)) return true;
    const current = parseOwner(lease.lockDir);
    if (!current.valid) return !current.unreadable;
    if (!sameOwner(current.owner, lease.owner) || liveLeaseNonces.has(current.owner.nonce)) return true;
    const releaseDir = releaseDirFor(lease);
    try { renameSyncOnce(lease.lockDir, releaseDir); } catch (error) { return !isSharingViolation(error); }
    try { fs.rmSync(releaseDir, { recursive: true, force: true }); } catch { /* 下次取锁清理 */ }
    return true;
  }

  function scheduleOrphanedLockReap(lease: DirectoryLease, attempt = 0): void {
    if (attempt >= ORPHANED_LOCK_REAP_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      if (!reapOrphanedLock(lease)) scheduleOrphanedLockReap(lease, attempt + 1);
    }, ORPHANED_LOCK_REAP_DELAYS_MS[attempt]);
    timer.unref?.();
  }

  async function removeRecoverableQuarantinesAsync(input: RecoveryInput): Promise<void> {
    for (const name of await prefixedNamesAsync(input.nomiDir, quarantinePrefix)) {
      const quarantinePath = path.join(input.nomiDir, name);
      const parsed = await parseOwnerAsync(quarantinePath);
      const ageMs = parsed.valid ? 0 : await directoryAgeMsAsync(quarantinePath, input.nowMs);
      assertQuarantineRecoverable(parsed, ageMs, input);
      await removeRecoveryDirectoryAsync(input.nomiDir, quarantinePath);
    }
  }

  async function quarantineExistingOwnerAsync(lockDir: string, input: RecoveryInput, randomId: () => string, expected?: DirectoryLeaseOwner): Promise<void> {
    const quarantinePath = path.join(input.nomiDir, `${quarantinePrefix}${pathToken(randomId())}`);
    try { await renameOnce(lockDir, quarantinePath); } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw errors.busy(`${label} owner changed during recovery`);
    }
    fsyncDirectoryIfDurable(input.nomiDir);
    const moved = await parseOwnerAsync(quarantinePath);
    const ageMs = expected ? 0 : await directoryAgeMsAsync(quarantinePath, input.nowMs);
    assertMovedQuarantineValid(moved, ageMs, expected, input.initializationGraceMs);
    await removeRecoveryDirectoryAsync(input.nomiDir, quarantinePath);
  }

  async function assertOwnedAsync(lease: DirectoryLease): Promise<void> {
    verifyOwnedState(await prefixedNamesAsync(path.dirname(lease.lockDir), quarantinePrefix), await parseOwnerAsync(lease.lockDir), lease.owner);
  }

  async function acquireAsync(nomiDir: string, options: DirectoryLeaseOptions): Promise<DirectoryLease> {
    const ctx = prepareAcquire(nomiDir, options);
    for (const name of await prefixedNamesAsync(nomiDir, releasePrefix)) {
      try { await fs.promises.rm(path.join(nomiDir, name), { recursive: true, force: true }); fsyncDirectoryIfDurable(nomiDir); } catch { /* 下次再收 */ }
    }
    const now = ctx.nowMs();
    for (const name of await prefixedNamesAsync(nomiDir, candidatePrefix)) {
      const candidatePath = path.join(nomiDir, name);
      if ((await directoryAgeMsAsync(candidatePath, now)) < ctx.initializationGraceMs) continue;
      try { await fs.promises.rm(candidatePath, { recursive: true, force: true }); } catch { /* 下次再收 */ }
    }
    await removeRecoverableQuarantinesAsync(ctx.recovery());
    if (await pathExistsAsync(ctx.lockDir)) {
      const rec = ctx.recovery();
      const parsed = await parseOwnerAsync(ctx.lockDir);
      const expected = decideLockRecovery(parsed, parsed.valid ? 0 : await directoryAgeMsAsync(ctx.lockDir, rec.nowMs), rec);
      await quarantineExistingOwnerAsync(ctx.lockDir, rec, ctx.randomId, expected);
    }
    await removeRecoverableQuarantinesAsync(ctx.recovery());

    const { owner, candidateDir } = ctx.createOwner();
    await fs.promises.mkdir(candidateDir);
    try {
      await writeJsonFileAtomicAsync(ownerFile(candidateDir), owner);
      verifyCandidateOwner(await parseOwnerAsync(candidateDir), owner);
      fsyncDirectoryIfDurable(candidateDir);
      try { await renameOnce(candidateDir, ctx.lockDir); } catch (error) { classifyPublishFailure(error, await pathExistsAsync(ctx.lockDir)); }
      fsyncDirectoryIfDurable(nomiDir);
    } finally {
      if (await pathExistsAsync(candidateDir)) {
        try { await fs.promises.rm(candidateDir, { recursive: true, force: true }); } catch { /* 留给下次按年龄回收 */ }
      }
    }
    const lease = { lockDir: ctx.lockDir, owner };
    await assertOwnedAsync(lease);
    liveLeaseNonces.add(owner.nonce);
    return lease;
  }

  async function releaseAsync(lease: DirectoryLease): Promise<void> {
    try {
      await assertOwnedAsync(lease);
      const nomiDir = path.dirname(lease.lockDir);
      const releaseDir = releaseDirFor(lease);
      try { await renameWithRetry(lease.lockDir, releaseDir); } catch (error) {
        if (isSharingViolation(error)) { scheduleOrphanedLockReap(lease); return; }
        throw errors.lost(`${label} lock changed before release`, { cause: error });
      }
      fsyncDirectoryIfDurable(nomiDir);
      try { await fs.promises.rm(releaseDir, { recursive: true, force: true }); fsyncDirectoryIfDurable(nomiDir); } catch { /* 下次取锁清理 */ }
    } finally {
      liveLeaseNonces.delete(lease.owner.nonce);
    }
  }

  return { acquire, acquireAsync, assertOwned, assertOwnedAsync, release, releaseAsync };
}

type ExpiringLeaseOptions<T extends { nonce: string }> = {
  filePath: string;
  leaseMs: number;
  parse: (value: unknown) => T | null;
  create: (expiresAtMs: number) => T;
  expiresAtMs: (record: T) => number;
  extend: (record: T, expiresAtMs: number) => T;
  sameOwner: (current: T, expected: T) => boolean;
  errors: LeaseErrors;
  /** Persist a caller-owned fence after the exclusive create, before returning the lease. */
  onAcquire?: (record: T) => void;
  nowMs?: () => number;
  durability?: "durable" | "ephemeral";
  /** Omit for callers that explicitly renew at their own checkpoints. */
  heartbeatMs?: number;
};

/**
 * JSON file leases for local, cooperating processes. Use the same mutation guard
 * for every writer: wx excludes competing creates, while the guard keeps an owner
 * read and its subsequent rename or unlink in the same critical section.
 */
export function createExpiringFileLeaseLock<T extends { nonce: string }>(options: ExpiringLeaseOptions<T>) {
  const { filePath, leaseMs, heartbeatMs, errors, nowMs = Date.now } = options;
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new RangeError("Lease duration must be a positive integer");
  if (heartbeatMs !== undefined && (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0 || heartbeatMs >= leaseMs)) {
    throw new RangeError("Heartbeat interval must be positive and shorter than the lease");
  }
  const parentDir = path.dirname(filePath);
  const durable = options.durability !== "ephemeral";
  const guard = createDirectoryLeaseLock({
    stem: `${path.basename(filePath)}.mutation`,
    ownerPrefix: "file-lease",
    label: "File lease mutation",
    errors: { ...errors, publish: (cause) => errors.busy(undefined, { cause }) },
  });

  function read(): T | null {
    try {
      return options.parse(retryOnSharingViolation(() => readJsonFile(filePath)));
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw error;
    }
  }

  function mutate<R>(operation: () => R): R {
    const lease = guard.acquire(parentDir, {});
    let result: R;
    try {
      result = operation();
    } catch (error) {
      try {
        guard.release(lease);
      } catch {
        // Cleanup must preserve the mutation's original failure.
      }
      throw error;
    }
    guard.release(lease);
    return result;
  }

  function reclaim(current: T | null): void {
    if (current) {
      if (nowMs() < options.expiresAtMs(current)) throw errors.busy();
    } else {
      // A crashed writer can leave an empty file after wx. Give it a full lease
      // window before treating a corrupt record as abandoned.
      try {
        const age = nowMs() - fs.statSync(filePath).mtimeMs;
        if (age < leaseMs) throw errors.busy("File lease record is still initializing");
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
        throw error;
      }
    }
    const stale = `${filePath}.stale.${crypto.randomUUID()}`;
    try {
      renameSyncOnce(filePath, stale);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw errors.busy("File lease changed during recovery", { cause });
    }
    fs.rmSync(stale, { force: true });
    if (durable) fsyncDirectoryIfDurable(parentDir);
  }

  function acquire(): T {
    fs.mkdirSync(parentDir, { recursive: true });
    return mutate(() => {
      reclaim(read());
      const record = options.create(nowMs() + leaseMs);
      let fd: number;
      try {
        fd = fs.openSync(filePath, "wx");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code === "EEXIST") throw errors.busy(undefined, { cause });
        throw cause;
      }
      try {
        try {
          fs.writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
          if (durable) fsyncIfDurable(fd);
        } finally {
          fs.closeSync(fd);
        }
        options.onAcquire?.(record);
        if (durable) fsyncDirectoryIfDurable(parentDir);
      } catch (error) {
        try {
          retryOnSharingViolation(() => fs.rmSync(filePath, { force: true }));
        } catch {
          // Preserve the publication error. The abandoned record can expire.
        }
        throw error;
      }
      return record;
    });
  }

  function readOwned(expected: T): T {
    const current = read();
    if (!current || current.nonce !== expected.nonce || !options.sameOwner(current, expected)) throw errors.lost();
    if (nowMs() >= options.expiresAtMs(current)) throw errors.lost("File lease expired");
    return current;
  }

  function assertOwned(expected: T): void {
    readOwned(expected);
  }

  function renew(expected: T): T {
    return mutate(() => {
      const current = readOwned(expected);
      const renewed = options.extend(current, nowMs() + leaseMs);
      writeJsonFileAtomic(filePath, renewed);
      if (durable) fsyncDirectoryIfDurable(parentDir);
      return renewed;
    });
  }

  function release(expected: T): void {
    mutate(() => {
      assertOwned(expected);
      try {
        retryOnSharingViolation(() => fs.rmSync(filePath, { force: true }));
      } catch (error) {
        if (!isSharingViolation(error)) throw error;
        // Leave the verified record in place until expiration if Windows keeps it open.
        return;
      }
      if (durable) fsyncDirectoryIfDurable(parentDir);
    });
  }

  async function withLock<R>(work: (record: T) => R | Promise<R>): Promise<R> {
    let record = acquire();
    let heartbeatFailure: { error: unknown } | undefined;
    const timer = heartbeatMs === undefined ? undefined : setInterval(() => {
      try {
        record = renew(record);
      } catch (error) {
        clearInterval(timer);
        heartbeatFailure = { error };
      }
    }, heartbeatMs);
    timer?.unref?.();
    try {
      const result = await work(record);
      if (heartbeatFailure) throw heartbeatFailure.error;
      if (heartbeatMs !== undefined) assertOwned(record);
      return result;
    } finally {
      clearInterval(timer);
      try {
        release(record);
      } catch {
        // Cleanup may lose ownership. Preserve the result of the fenced operation.
      }
    }
  }

  return { acquire, assertOwned, renew, release, withLock };
}
