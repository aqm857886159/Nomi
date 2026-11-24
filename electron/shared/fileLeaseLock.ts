import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fsyncDirectoryIfDurable, fsyncIfDurable } from "../durability";
import { isSharingViolation, readJsonFile, renameSyncOnce, renameSyncWithRetry, retryOnSharingViolation, writeJsonFileAtomic } from "../jsonFile";

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

  function parseOwner(directoryPath: string): ParsedOwner {
    let value: Partial<DirectoryLeaseOwner>;
    try {
      value = retryOnSharingViolation(() => readJsonFile(ownerFile(directoryPath))) as Partial<DirectoryLeaseOwner>;
    } catch (error) {
      return isSharingViolation(error) ? { valid: false, unreadable: true } : { valid: false };
    }
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

  function quarantineNames(nomiDir: string): string[] {
    try {
      return fs
        .readdirSync(nomiDir)
        .filter((name) => name.startsWith(quarantinePrefix))
        .sort();
    } catch {
      return [];
    }
  }

  function releaseNames(nomiDir: string): string[] {
    try {
      return fs
        .readdirSync(nomiDir)
        .filter((name) => name.startsWith(releasePrefix))
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * 已交出所有权的旧锁目录（release-*）不代表任何持有者：删不掉只是占地方，不影响谁拿得到锁，
   * 所以删不掉就留到下一次，绝不因此挡住取锁（此前会让同步调用方直接失败）。
   */
  function removeReleasedLocks(nomiDir: string): void {
    for (const name of releaseNames(nomiDir)) {
      try {
        fs.rmSync(path.join(nomiDir, name), { recursive: true, force: true });
        fsyncDirectoryIfDurable(nomiDir);
      } catch {
        // 下一次取锁再收。
      }
    }
  }

  /** 发布失败留下、超过初始化宽限期仍在的候选目录：没有任何一次取锁还会用到它，按年龄回收。 */
  function removeAbandonedCandidates(nomiDir: string, nowMs: number, initializationGraceMs: number): void {
    let names: string[];
    try {
      names = fs.readdirSync(nomiDir).filter((name) => name.startsWith(candidatePrefix));
    } catch {
      return;
    }
    for (const name of names) {
      const candidatePath = path.join(nomiDir, name);
      if (directoryAgeMs(candidatePath, nowMs) < initializationGraceMs) continue;
      try {
        fs.rmSync(candidatePath, { recursive: true, force: true });
      } catch {
        // 下一次取锁再收。
      }
    }
  }

  function removeRecoverableQuarantines(input: {
    nomiDir: string;
    host: string;
    pid: number;
    nowMs: number;
    initializationGraceMs: number;
    processLiveness: (pid: number) => ProcessLiveness;
  }): void {
    for (const name of quarantineNames(input.nomiDir)) {
      const quarantinePath = path.join(input.nomiDir, name);
      const parsed = parseOwner(quarantinePath);
      if (parsed.valid) {
        if (parsed.owner.host !== input.host) {
          throw errors.busy(`${label} recovery belongs to another host`);
        }
        if (!isOwnAbandonedRecord(parsed.owner, input) && input.processLiveness(parsed.owner.pid) !== "dead") {
          throw errors.busy(
            `${label} recovery owner is still alive or cannot be verified`,
          );
        }
        removeRecoveryDirectory(input.nomiDir, quarantinePath);
        continue;
      }
      if (parsed.unreadable) {
        throw errors.busy(`${label} recovery record is held open by another program`);
      }
      if (directoryAgeMs(quarantinePath, input.nowMs) < input.initializationGraceMs) {
        throw errors.busy(`${label} recovery owner is still initializing`);
      }
      removeRecoveryDirectory(input.nomiDir, quarantinePath);
    }
  }

  function quarantineExistingOwner(input: {
    lockDir: string;
    nomiDir: string;
    expected?: DirectoryLeaseOwner;
    randomId: () => string;
    initializationGraceMs: number;
    nowMs: number;
  }): void {
    const quarantinePath = path.join(input.nomiDir, `${quarantinePrefix}${pathToken(input.randomId())}`);
    try {
      renameSyncOnce(input.lockDir, quarantinePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw errors.busy(`${label} owner changed during recovery`);
    }
    fsyncDirectoryIfDurable(input.nomiDir);

    const moved = parseOwner(quarantinePath);
    if (input.expected) {
      if (!moved.valid || !sameOwner(moved.owner, input.expected)) {
        throw errors.busy(`${label} owner changed during recovery`);
      }
    } else if (moved.valid || moved.unreadable || directoryAgeMs(quarantinePath, input.nowMs) < input.initializationGraceMs) {
      throw errors.busy(`${label} owner completed during recovery`);
    }

    removeRecoveryDirectory(input.nomiDir, quarantinePath);
  }

  function recoverExistingLock(input: {
    lockDir: string;
    nomiDir: string;
    host: string;
    pid: number;
    nowMs: number;
    initializationGraceMs: number;
    processLiveness: (pid: number) => ProcessLiveness;
    randomId: () => string;
  }): void {
    const parsed = parseOwner(input.lockDir);
    if (!parsed.valid) {
      if (parsed.unreadable) {
        throw errors.busy(`${label} owner record is held open by another program`);
      }
      if (directoryAgeMs(input.lockDir, input.nowMs) < input.initializationGraceMs) {
        throw errors.busy(`${label} owner record is still initializing`);
      }
      quarantineExistingOwner({ ...input });
      return;
    }
    if (parsed.owner.host !== input.host) {
      throw errors.busy(`${label} is owned on another host`);
    }
    if (isOwnAbandonedRecord(parsed.owner, input)) {
      quarantineExistingOwner({ ...input, expected: parsed.owner });
      return;
    }
    const liveness = input.processLiveness(parsed.owner.pid);
    if (liveness !== "dead") {
      throw errors.busy(`${label} owner is still alive or cannot be verified`);
    }
    quarantineExistingOwner({ ...input, expected: parsed.owner });
  }

  function acquire(
    nomiDir: string,
    options: DirectoryLeaseOptions,
  ): DirectoryLease {
    const randomId = options.randomId ?? (() => crypto.randomUUID());
    const nowMs = options.nowMs ?? (() => Date.now());
    const host = options.host?.trim() || os.hostname();
    const pid = options.pid ?? process.pid;
    const processStartedAtMs =
      options.processStartedAtMs ?? Math.max(0, Math.floor(Date.now() - process.uptime() * 1_000));
    const processLiveness = options.processLiveness ?? defaultProcessLiveness;
    const initializationGraceMs = options.initializationGraceMs ?? DEFAULT_INITIALIZATION_GRACE_MS;
    const lockDir = path.join(nomiDir, lockDirName);

    removeReleasedLocks(nomiDir);
    removeAbandonedCandidates(nomiDir, nowMs(), initializationGraceMs);
    removeRecoverableQuarantines({
      nomiDir,
      host,
      pid,
      nowMs: nowMs(),
      initializationGraceMs,
      processLiveness,
    });
    if (fs.existsSync(lockDir)) {
      recoverExistingLock({
        lockDir,
        nomiDir,
        host,
        pid,
        nowMs: nowMs(),
        initializationGraceMs,
        processLiveness,
        randomId,
      });
    }
    removeRecoverableQuarantines({
      nomiDir,
      host,
      pid,
      nowMs: nowMs(),
      initializationGraceMs,
      processLiveness,
    });

    const owner: DirectoryLeaseOwner = {
      schemaVersion: DIRECTORY_LEASE_SCHEMA_VERSION,
      ownerId: options.ownerId?.trim() || `${ownerPrefix}-${pid}-${randomId()}`,
      nonce: randomId(),
      host,
      pid,
      processStartedAtMs,
      createdAtMs: nowMs(),
    };
    const candidateDir = path.join(nomiDir, `${candidatePrefix}${pathToken(`${owner.ownerId}:${owner.nonce}`)}`);
    fs.mkdirSync(candidateDir);
    try {
      writeJsonFileAtomic(ownerFile(candidateDir), owner);
      const candidateOwner = parseOwner(candidateDir);
      if (!candidateOwner.valid && candidateOwner.unreadable) {
        // 刚写出的 owner.json 被别的程序开着读不回来：还没发布，重试即可。
        throw errors.publish(new Error(`${label} owner record is held open by another program`));
      }
      if (!candidateOwner.valid || !sameOwner(candidateOwner.owner, owner)) {
        throw errors.lost(`${label} owner record could not be verified before publish`);
      }
      fsyncDirectoryIfDurable(candidateDir);
      try {
        // EPERM can mean a competing owner. The caller handles it before any new attempt.
        renameSyncOnce(candidateDir, lockDir);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
          if (code === "EPERM" && !fs.existsSync(lockDir)) throw errors.publish(error);
          throw errors.busy(undefined, { cause: error });
        }
        throw error;
      }
      fsyncDirectoryIfDurable(nomiDir);
    } finally {
      if (fs.existsSync(candidateDir)) {
        try {
          fs.rmSync(candidateDir, { recursive: true, force: true });
        } catch {
          // 候选目录里的文件被别的程序开着删不掉：留给下一次取锁按年龄回收，
          // 不能让清理错误盖掉上面真正的失败原因（那会把可重试的发布失败变成立即失败）。
        }
      }
    }

    const lease = { lockDir, owner };
    assertOwned(lease);
    liveLeaseNonces.add(owner.nonce);
    return lease;
  }

  function assertOwned(lease: DirectoryLease): void {
    if (quarantineNames(path.dirname(lease.lockDir)).length > 0) {
      throw errors.lost(`${label} lock is under recovery`);
    }
    const current = parseOwner(lease.lockDir);
    if (!current.valid || !sameOwner(current.owner, lease.owner)) {
      throw errors.lost();
    }
  }

  function releaseDirFor(lease: DirectoryLease): string {
    return path.join(
      path.dirname(lease.lockDir),
      `${releasePrefix}${pathToken(`${lease.owner.ownerId}:${crypto.randomUUID()}`)}`,
    );
  }

  /**
   * 释放。事务在这之前已经提交；这里只负责把锁目录挪走。
   *
   * 挪不走分两种：锁已经不是我的（被回收 / 被改）→ 如实抛 Lost；owner.json 此刻被同步盘 /
   * 杀毒开着（Windows 上改名直接 EPERM）→ 这不是「丢了锁」，不能把一次已提交的保存报成失败。
   * 先按共享冲突短退避重试；仍挪不走就在这里交出所有权（nonce 离开在持表，本进程下一次取锁会
   * 直接收回），盘上的目录交给后台补收（0.25 / 1 / 4 / 15 / 60 秒）——它躺在同步目录里，另一台电脑会
   * 把它同步过去当成「别的主机正持有」，所以不能等到下次取锁才收。
   */
  function release(lease: DirectoryLease): void {
    try {
      assertOwned(lease);
      const nomiDir = path.dirname(lease.lockDir);
      const releaseDir = releaseDirFor(lease);
      try {
        renameSyncWithRetry(lease.lockDir, releaseDir);
      } catch (error) {
        if (isSharingViolation(error)) {
          scheduleOrphanedLockReap(lease);
          return;
        }
        throw errors.lost(`${label} lock changed before release`, { cause: error });
      }
      fsyncDirectoryIfDurable(nomiDir);
      try {
        fs.rmSync(releaseDir, { recursive: true, force: true });
        fsyncDirectoryIfDurable(nomiDir);
      } catch {
        // The atomic rename above already relinquished ownership. A leftover release
        // directory is reserved metadata and the next acquirer safely reaps it.
      }
    } finally {
      liveLeaseNonces.delete(lease.owner.nonce);
    }
  }

  /** 收一个已交出所有权、但目录还留在盘上的锁。返回 true = 不必再试（已收走，或它已经不是这把锁）。 */
  function reapOrphanedLock(lease: DirectoryLease): boolean {
    if (!fs.existsSync(lease.lockDir)) return true;
    const current = parseOwner(lease.lockDir);
    if (!current.valid) return !current.unreadable;
    if (!sameOwner(current.owner, lease.owner) || liveLeaseNonces.has(current.owner.nonce)) return true;
    const releaseDir = releaseDirFor(lease);
    try {
      renameSyncOnce(lease.lockDir, releaseDir);
    } catch (error) {
      return !isSharingViolation(error);
    }
    try {
      fs.rmSync(releaseDir, { recursive: true, force: true });
    } catch {
      // 已改名交出；旧目录留给下一次取锁收。
    }
    return true;
  }

  function scheduleOrphanedLockReap(lease: DirectoryLease, attempt = 0): void {
    if (attempt >= ORPHANED_LOCK_REAP_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      if (!reapOrphanedLock(lease)) scheduleOrphanedLockReap(lease, attempt + 1);
    }, ORPHANED_LOCK_REAP_DELAYS_MS[attempt]);
    timer.unref?.();
  }

  return { acquire, assertOwned, release };
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
