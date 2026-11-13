import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fsyncDirectoryIfDurable } from "../durability";
import { WORKSPACE_MANIFEST_BUSY_ERROR_NAME } from "../shared/contracts/workspaceBusy";
import { isSharingViolation, readJsonFile, renameSyncWithRetry, retryOnSharingViolation, writeJsonFileAtomic } from "../jsonFile";
import type { SyncSharingRetryOptions } from "../sharingRetry";
import { workspaceNomiDir } from "./workspacePaths";

export const WORKSPACE_MANIFEST_LOCK_SCHEMA_VERSION = 1;

const LOCK_DIR_NAME = "manifest-transaction.lock";
const OWNER_FILE_NAME = "owner.json";
const QUARANTINE_PREFIX = "manifest-transaction.quarantine-";
const RELEASE_PREFIX = "manifest-transaction.release-";
const CANDIDATE_PREFIX = "manifest-transaction.candidate-";
const DEFAULT_INITIALIZATION_GRACE_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 10;
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

type ProcessLiveness = "alive" | "dead" | "unknown";

export type WorkspaceManifestLockOwner = {
  schemaVersion: typeof WORKSPACE_MANIFEST_LOCK_SCHEMA_VERSION;
  ownerId: string;
  nonce: string;
  host: string;
  pid: number;
  processStartedAtMs: number;
  createdAtMs: number;
};

export type WorkspaceManifestLockLease = {
  canonicalRootPath: string;
  lockDir: string;
  owner: WorkspaceManifestLockOwner;
  /** 取锁时调用方显式要求了「不原地睡」（保存路径）：这把锁之后的读写 owner.json 也都不睡，见 {@link WorkspaceManifestLockOptions.noBlockingWait}。 */
  noBlockingWait?: boolean;
};

export type WorkspaceManifestLockOptions = {
  ownerId?: string;
  randomId?: () => string;
  nowMs?: () => number;
  host?: string;
  pid?: number;
  processStartedAtMs?: number;
  processLiveness?: (pid: number) => ProcessLiveness;
  initializationGraceMs?: number;
  retryDelayMs?: number;
  waitTimeoutMs?: number;
  /**
   * 保存路径显式传 true：读写 owner.json 撞上占用不原地睡，立即再试一次就抛；锁还在手里时读不到 owner.json
   * 报 {@link WorkspaceManifestLockOccupiedError}（可重排的被占用），不判成锁丢了。不传的调用方行为逐字不变。
   */
  noBlockingWait?: boolean;
};

export class WorkspaceManifestLockBusyError extends Error {
  readonly code = "workspace_manifest_busy";

  constructor(message = "Workspace manifest is being changed by another process", options?: { cause?: unknown }) {
    super(message);
    // 名字是跨进程身份：渲染层只拿得到「名字: 信息」，据此报「项目正被别处占用」（见 shared/contracts/workspaceBusy）。
    this.name = WORKSPACE_MANIFEST_BUSY_ERROR_NAME;
    if (options) Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
  }
}

export class WorkspaceManifestLockPublishError extends Error {
  readonly code = "workspace_manifest_publish_failed";

  constructor(cause: unknown) {
    super("Workspace manifest lock could not be published");
    this.name = "WorkspaceManifestLockPublishError";
    Object.defineProperty(this, "cause", { configurable: true, value: cause });
  }
}

/**
 * 取锁时项目根已经不在（被删 / 被挪走）。不可重试：等多久根也不会自己回来，而重试时建目录会凭空造出一个
 * 没清单、没登记的孤儿根（V-plibrary N1）。取锁只在「根已在」的前提下建 .nomi，结构上不再创建项目根。
 */
export class WorkspaceRootMissingError extends Error {
  readonly code = "workspace_root_missing";

  constructor(rootPath: string, options?: { cause?: unknown }) {
    super(`Workspace project folder no longer exists: ${rootPath}`);
    this.name = "WorkspaceRootMissingError";
    if (options) Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
  }
}

export class WorkspaceManifestLockLostError extends Error {
  readonly code = "workspace_manifest_lock_lost";

  constructor(message = "Workspace manifest lock is no longer owned", options?: { cause?: unknown }) {
    super(message);
    this.name = "WorkspaceManifestLockLostError";
    if (options && Object.prototype.hasOwnProperty.call(options, "cause")) {
      Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
    }
  }
}

/**
 * 锁还是我的，但 owner.json 此刻被别的程序（杀毒扫新写的文件 / 同步盘）开着读不到：这是「被占用」，不是「锁丢了」。
 * 只在取锁时显式要求了 `noBlockingWait` 的调用方（保存路径）身上出现；错误码照抄原错误（EBUSY / EPERM / EACCES），
 * `path` 指向 owner.json——上层按共享冲突用定时器重排，并据此目录是否可写分辨「真没权限」。
 */
export class WorkspaceManifestLockOccupiedError extends Error {
  readonly code: string | undefined;
  readonly errno: number | undefined;
  readonly syscall: string | undefined;
  readonly path: string;

  constructor(ownerPath: string, cause: unknown) {
    super("Workspace manifest owner record is held open by another program");
    this.name = "WorkspaceManifestLockOccupiedError";
    const c = (cause ?? {}) as { code?: string; errno?: number; syscall?: string };
    this.code = c.code;
    this.errno = c.errno;
    this.syscall = c.syscall;
    this.path = ownerPath;
    Object.defineProperty(this, "cause", { configurable: true, value: cause });
  }
}

/**
 * `unreadable`：owner.json 此刻被别的程序（同步盘 / 杀毒 / 索引器）开着读不到。
 * 这只说明「现在不知道」，不说明记录坏了——调用方一律按忙处理，绝不据此强拆别人的锁。
 */
type ParsedOwner = { valid: true; owner: WorkspaceManifestLockOwner } | { valid: false; unreadable?: true; error?: unknown };

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

/** 记录的主人就是本进程（同主机同 pid），而本进程没有任何一次操作在持有它：残留，可立即收回。 */
function isOwnAbandonedRecord(owner: WorkspaceManifestLockOwner, self: { host: string; pid: number }): boolean {
  return owner.host === self.host && owner.pid === self.pid && !liveLeaseNonces.has(owner.nonce);
}

/** 删一个已经不代表任何持有者的目录（隔离区 / 旧锁）。删不掉只是「清理还没完」，按忙处理、下次再来。 */
function removeRecoveryDirectory(nomiDir: string, directoryPath: string, wait: SyncSharingRetryOptions): void {
  try {
    retryOnSharingViolation(() => fs.rmSync(directoryPath, { recursive: true, force: true }), wait);
  } catch (error) {
    throw new WorkspaceManifestLockBusyError("Workspace manifest recovery cleanup is still in progress", { cause: error });
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

function canonicalWorkspaceRoot(actualRootPath: string): string {
  const canonical = fs.realpathSync(actualRootPath);
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error("Workspace root must be a directory");
  }
  return canonical;
}

function ownerFile(directoryPath: string): string {
  return path.join(directoryPath, OWNER_FILE_NAME);
}

function pathToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseOwner(directoryPath: string, wait: SyncSharingRetryOptions): ParsedOwner {
  let value: Partial<WorkspaceManifestLockOwner>;
  try {
    value = retryOnSharingViolation(() => readJsonFile(ownerFile(directoryPath)), wait) as Partial<WorkspaceManifestLockOwner>;
  } catch (error) {
    return isSharingViolation(error) ? { valid: false, unreadable: true, error } : { valid: false };
  }
  if (
    !value ||
    value.schemaVersion !== WORKSPACE_MANIFEST_LOCK_SCHEMA_VERSION ||
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
  return { valid: true, owner: value as WorkspaceManifestLockOwner };
}

function sameOwner(left: WorkspaceManifestLockOwner, right: WorkspaceManifestLockOwner): boolean {
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
      .filter((name) => name.startsWith(QUARANTINE_PREFIX))
      .sort();
  } catch {
    return [];
  }
}

function releaseNames(nomiDir: string): string[] {
  try {
    return fs
      .readdirSync(nomiDir)
      .filter((name) => name.startsWith(RELEASE_PREFIX))
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
    names = fs.readdirSync(nomiDir).filter((name) => name.startsWith(CANDIDATE_PREFIX));
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
  wait: SyncSharingRetryOptions;
}): void {
  for (const name of quarantineNames(input.nomiDir)) {
    const quarantinePath = path.join(input.nomiDir, name);
    const parsed = parseOwner(quarantinePath, input.wait);
    if (parsed.valid) {
      if (parsed.owner.host !== input.host) {
        throw new WorkspaceManifestLockBusyError("Workspace manifest recovery belongs to another host");
      }
      if (!isOwnAbandonedRecord(parsed.owner, input) && input.processLiveness(parsed.owner.pid) !== "dead") {
        throw new WorkspaceManifestLockBusyError(
          "Workspace manifest recovery owner is still alive or cannot be verified",
        );
      }
      removeRecoveryDirectory(input.nomiDir, quarantinePath, input.wait);
      continue;
    }
    if (parsed.unreadable) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest recovery record is held open by another program");
    }
    if (directoryAgeMs(quarantinePath, input.nowMs) < input.initializationGraceMs) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest recovery owner is still initializing");
    }
    removeRecoveryDirectory(input.nomiDir, quarantinePath, input.wait);
  }
}

function quarantineExistingOwner(input: {
  lockDir: string;
  nomiDir: string;
  expected?: WorkspaceManifestLockOwner;
  randomId: () => string;
  initializationGraceMs: number;
  nowMs: number;
  wait: SyncSharingRetryOptions;
}): void {
  const quarantinePath = path.join(input.nomiDir, `${QUARANTINE_PREFIX}${pathToken(input.randomId())}`);
  try {
    fs.renameSync(input.lockDir, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw new WorkspaceManifestLockBusyError("Workspace manifest owner changed during recovery");
  }
  fsyncDirectoryIfDurable(input.nomiDir);

  const moved = parseOwner(quarantinePath, input.wait);
  if (input.expected) {
    if (!moved.valid || !sameOwner(moved.owner, input.expected)) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest owner changed during recovery");
    }
  } else if (moved.valid || moved.unreadable || directoryAgeMs(quarantinePath, input.nowMs) < input.initializationGraceMs) {
    throw new WorkspaceManifestLockBusyError("Workspace manifest owner completed during recovery");
  }

  removeRecoveryDirectory(input.nomiDir, quarantinePath, input.wait);
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
  wait: SyncSharingRetryOptions;
}): void {
  const parsed = parseOwner(input.lockDir, input.wait);
  if (!parsed.valid) {
    if (parsed.unreadable) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest owner record is held open by another program");
    }
    if (directoryAgeMs(input.lockDir, input.nowMs) < input.initializationGraceMs) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest owner record is still initializing");
    }
    quarantineExistingOwner({ ...input });
    return;
  }
  if (parsed.owner.host !== input.host) {
    throw new WorkspaceManifestLockBusyError("Workspace manifest is owned on another host");
  }
  if (isOwnAbandonedRecord(parsed.owner, input)) {
    quarantineExistingOwner({ ...input, expected: parsed.owner });
    return;
  }
  const liveness = input.processLiveness(parsed.owner.pid);
  if (liveness !== "dead") {
    throw new WorkspaceManifestLockBusyError("Workspace manifest owner is still alive or cannot be verified");
  }
  quarantineExistingOwner({ ...input, expected: parsed.owner });
}

function tryAcquireCanonicalWorkspaceManifestLock(
  canonicalRootPath: string,
  options: WorkspaceManifestLockOptions,
): WorkspaceManifestLockLease {
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const nowMs = options.nowMs ?? (() => Date.now());
  const host = options.host?.trim() || os.hostname();
  const pid = options.pid ?? process.pid;
  const processStartedAtMs =
    options.processStartedAtMs ?? Math.max(0, Math.floor(Date.now() - process.uptime() * 1_000));
  const processLiveness = options.processLiveness ?? defaultProcessLiveness;
  const initializationGraceMs = options.initializationGraceMs ?? DEFAULT_INITIALIZATION_GRACE_MS;
  const wait: SyncSharingRetryOptions = { noWait: options.noBlockingWait === true };
  const nomiDir = workspaceNomiDir(canonicalRootPath);
  // 只建 .nomi、不递归：根没了就是没了（ENOENT），绝不在这里把项目根重新建出来。
  try {
    fs.mkdirSync(nomiDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new WorkspaceRootMissingError(canonicalRootPath, { cause: error });
    if (code !== "EEXIST") throw error;
  }
  const lockDir = path.join(nomiDir, LOCK_DIR_NAME);

  removeReleasedLocks(nomiDir);
  removeAbandonedCandidates(nomiDir, nowMs(), initializationGraceMs);
  removeRecoverableQuarantines({
    nomiDir,
    host,
    pid,
    nowMs: nowMs(),
    initializationGraceMs,
    processLiveness,
    wait,
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
      wait,
    });
  }
  removeRecoverableQuarantines({
    nomiDir,
    host,
    pid,
    nowMs: nowMs(),
    initializationGraceMs,
    processLiveness,
    wait,
  });

  const owner: WorkspaceManifestLockOwner = {
    schemaVersion: WORKSPACE_MANIFEST_LOCK_SCHEMA_VERSION,
    ownerId: options.ownerId?.trim() || `workspace-${pid}-${randomId()}`,
    nonce: randomId(),
    host,
    pid,
    processStartedAtMs,
    createdAtMs: nowMs(),
  };
  const candidateDir = path.join(nomiDir, `${CANDIDATE_PREFIX}${pathToken(`${owner.ownerId}:${owner.nonce}`)}`);
  fs.mkdirSync(candidateDir);
  try {
    writeJsonFileAtomic(ownerFile(candidateDir), owner, wait);
    const candidateOwner = parseOwner(candidateDir, wait);
    if (!candidateOwner.valid && candidateOwner.unreadable) {
      // 刚写出的 owner.json 被别的程序开着读不回来：还没发布，重试即可。
      throw new WorkspaceManifestLockPublishError(new Error("Workspace manifest owner record is held open by another program"));
    }
    if (!candidateOwner.valid || !sameOwner(candidateOwner.owner, owner)) {
      throw new WorkspaceManifestLockLostError("Workspace manifest owner record could not be verified before publish");
    }
    fsyncDirectoryIfDurable(candidateDir);
    try {
      fs.renameSync(candidateDir, lockDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
        if (code === "EPERM" && !fs.existsSync(lockDir)) throw new WorkspaceManifestLockPublishError(error);
        throw new WorkspaceManifestLockBusyError(undefined, { cause: error });
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

  const lease: WorkspaceManifestLockLease = { canonicalRootPath, lockDir, owner, ...(wait.noWait ? { noBlockingWait: true } : {}) };
  try {
    assertWorkspaceManifestLockOwned(lease);
  } catch (error) {
    // 保存路径：刚发布的锁目录是自己建的，核验失败就自己收掉，不留孤儿锁目录（别的进程会把它当成「本机有人在用」）。
    // 收不掉（owner.json 还被占着）交给后台补收。不传 noBlockingWait 的调用方行为逐字不变。
    if (lease.noBlockingWait && error instanceof WorkspaceManifestLockOccupiedError) relinquishPublishedLock(lease);
    throw error;
  }
  liveLeaseNonces.add(owner.nonce);
  return lease;
}

export function tryAcquireWorkspaceManifestLock(
  actualRootPath: string,
  options: WorkspaceManifestLockOptions = {},
): WorkspaceManifestLockLease {
  return tryAcquireCanonicalWorkspaceManifestLock(canonicalWorkspaceRoot(actualRootPath), options);
}

export async function acquireWorkspaceManifestLock(
  actualRootPath: string,
  options: WorkspaceManifestLockOptions = {},
): Promise<WorkspaceManifestLockLease> {
  const canonicalRootPath = canonicalWorkspaceRoot(actualRootPath);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + waitTimeoutMs;
  for (;;) {
    try {
      return tryAcquireCanonicalWorkspaceManifestLock(canonicalRootPath, options);
    } catch (error) {
      if (!(error instanceof WorkspaceManifestLockBusyError || error instanceof WorkspaceManifestLockPublishError) || Date.now() >= deadline) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

export function assertWorkspaceManifestLockOwned(lease: WorkspaceManifestLockLease): void {
  if (quarantineNames(path.dirname(lease.lockDir)).length > 0) {
    throw new WorkspaceManifestLockLostError("Workspace manifest lock is under recovery");
  }
  const current = parseOwner(lease.lockDir, { noWait: lease.noBlockingWait === true });
  if (!current.valid && current.unreadable && lease.noBlockingWait) {
    throw new WorkspaceManifestLockOccupiedError(ownerFile(lease.lockDir), current.error);
  }
  if (!current.valid || !sameOwner(current.owner, lease.owner)) {
    throw new WorkspaceManifestLockLostError();
  }
}

function releaseDirFor(lease: WorkspaceManifestLockLease): string {
  return path.join(
    path.dirname(lease.lockDir),
    `${RELEASE_PREFIX}${pathToken(`${lease.owner.ownerId}:${crypto.randomUUID()}`)}`,
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
export function releaseWorkspaceManifestLock(lease: WorkspaceManifestLockLease): void {
  try {
    try {
      assertWorkspaceManifestLockOwned(lease);
    } catch (error) {
      // 保存路径：owner.json 被占着读不到 ≠ 锁丢了。在这里交出所有权，盘上的目录交给后台补收；不抛——
      // 事务自己的结果（成功或原来的错）照常交给调用方，不能因为放锁时读不到 owner.json 把它盖掉。
      if (error instanceof WorkspaceManifestLockOccupiedError) {
        scheduleOrphanedLockReap(lease);
        return;
      }
      throw error;
    }
    const nomiDir = path.dirname(lease.lockDir);
    const releaseDir = releaseDirFor(lease);
    try {
      renameSyncWithRetry(lease.lockDir, releaseDir, { noWait: lease.noBlockingWait === true });
    } catch (error) {
      if (isSharingViolation(error)) {
        scheduleOrphanedLockReap(lease);
        return;
      }
      throw new WorkspaceManifestLockLostError("Workspace manifest lock changed before release", { cause: error });
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

const ORPHANED_LOCK_REAP_DELAYS_MS = [250, 1_000, 4_000, 15_000, 60_000];

/** 收一个已交出所有权、但目录还留在盘上的锁。返回 true = 不必再试（已收走，或它已经不是这把锁）。 */
function reapOrphanedLock(lease: WorkspaceManifestLockLease): boolean {
  if (!fs.existsSync(lease.lockDir)) return true;
  const current = parseOwner(lease.lockDir, { noWait: lease.noBlockingWait === true });
  if (!current.valid) return !current.unreadable;
  if (!sameOwner(current.owner, lease.owner) || liveLeaseNonces.has(current.owner.nonce)) return true;
  const releaseDir = releaseDirFor(lease);
  try {
    fs.renameSync(lease.lockDir, releaseDir);
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

/**
 * 保存路径取锁时，发布之后的核验因为 owner.json 被占着没过：自己建的锁目录现在就收（先核 owner 还是自己才挪），
 * 收不掉交给后台补收（本进程从没登记持有它）。
 */
function relinquishPublishedLock(lease: WorkspaceManifestLockLease): void {
  if (!reapOrphanedLock(lease)) scheduleOrphanedLockReap(lease);
}

function scheduleOrphanedLockReap(lease: WorkspaceManifestLockLease, attempt = 0): void {
  if (attempt >= ORPHANED_LOCK_REAP_DELAYS_MS.length) return;
  const timer = setTimeout(() => {
    if (!reapOrphanedLock(lease)) scheduleOrphanedLockReap(lease, attempt + 1);
  }, ORPHANED_LOCK_REAP_DELAYS_MS[attempt]);
  timer.unref?.();
}
