import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fsyncDirectoryIfDurable, fsyncIfDurable } from "../durability";
import { writeJsonFileAtomic } from "../jsonFile";

export const PRODUCTION_RUN_LOCK_SCHEMA_VERSION = 1;
export const PRODUCTION_RUN_LOCK_DEFAULT_LEASE_MS = 30_000;

export type ProductionRunLockLease = {
  schemaVersion: typeof PRODUCTION_RUN_LOCK_SCHEMA_VERSION;
  ownerId: string;
  pid: number;
  acquiredAt: string;
  expiresAt: string;
  fencingEpoch: number;
  nonce: string;
};

export type ProductionRunLockDeps = {
  filePath: string;
  epochPath?: string;
  ownerId?: string;
  pid?: number;
  leaseMs?: number;
  now?: () => string;
  randomId?: () => string;
  /** Repository mutation locks are short-lived mutexes; the Run lock remains the durable fence. */
  durability?: "durable" | "ephemeral";
};

export class ProductionRunLockBusyError extends Error {
  readonly code = "run_lock_busy";

  constructor(message = "Production run is owned by another worker") {
    super(message);
    this.name = "ProductionRunLockBusyError";
  }
}

export class ProductionRunLockLostError extends Error {
  readonly code = "run_lock_lost";

  constructor(message = "Production run fencing lock is no longer owned") {
    super(message);
    this.name = "ProductionRunLockLostError";
  }
}

/** 锁文件在，但记录读不出来（空文件、写了一半）。对外仍是「忙」，只有 acquire 按文件多久没动过决定能不能回收。 */
class ProductionRunLockCorruptRecordError extends ProductionRunLockBusyError {
  constructor() {
    super("Production run lock record is corrupt");
    this.name = "ProductionRunLockCorruptRecordError";
  }
}

// 注：`deps.durability` 决定「这把锁要不要durable 围栏语义」；下面两个 helper 里的
// `fsyncIfDurable`/`isDurable` 是另一回事——全局落盘屏障开关（测试里整体关掉，见
// `electron/durability.ts`）。两者独立，别合并。
function fsyncFile(fd: number): void {
  try {
    fsyncIfDurable(fd);
  } catch {
    // Some filesystems do not expose fsync for a just-created lock file.
  }
}

function fsyncDirectory(filePath: string): void {
  fsyncDirectoryIfDurable(path.dirname(filePath));
}

function parseEpoch(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as { fencingEpoch?: unknown };
    if (!Number.isSafeInteger(value.fencingEpoch) || (value.fencingEpoch as number) < 0) {
      throw new Error("invalid epoch");
    }
    return value.fencingEpoch as number;
  } catch {
    throw new ProductionRunLockBusyError("Production run fencing epoch is corrupt");
  }
}

function parseLease(filePath: string): ProductionRunLockLease | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as ProductionRunLockLease;
    if (value.schemaVersion !== PRODUCTION_RUN_LOCK_SCHEMA_VERSION
      || typeof value.ownerId !== "string" || !value.ownerId
      || !Number.isInteger(value.pid)
      || typeof value.acquiredAt !== "string" || typeof value.expiresAt !== "string"
      || !Number.isSafeInteger(value.fencingEpoch) || value.fencingEpoch < 1
      || typeof value.nonce !== "string" || !value.nonce) {
      throw new Error("invalid lock record");
    }
    if (!Number.isFinite(Date.parse(value.expiresAt))) throw new Error("invalid lock expiry");
    return value;
  } catch {
    throw new ProductionRunLockCorruptRecordError();
  }
}

function sameLease(left: ProductionRunLockLease | null, right: ProductionRunLockLease): boolean {
  return Boolean(left && left.ownerId === right.ownerId && left.nonce === right.nonce && left.fencingEpoch === right.fencingEpoch);
}

/**
 * What a lock file says, without taking it. `dead` means it cannot be parsed and nobody has touched
 * it for a whole lease, so no writer is mid-write and `acquire` would stay busy on it forever.
 * `acquire` itself stays closed on purpose: only a caller that knows what the lock guards may act on this.
 */
export function inspectProductionRunLockFile(
  filePath: string,
  kind: "lease" | "epoch",
  leaseMs = PRODUCTION_RUN_LOCK_DEFAULT_LEASE_MS,
  nowMs = Date.now(),
): "free" | "held" | "dead" {
  try {
    if (kind === "epoch") {
      parseEpoch(filePath);
      return "free";
    }
    const lease = parseLease(filePath);
    return lease && nowMs < Date.parse(lease.expiresAt) ? "held" : "free";
  } catch {
    try {
      return nowMs - fs.statSync(filePath).mtimeMs >= leaseMs ? "dead" : "held";
    } catch {
      return "free";
    }
  }
}

export function createProductionRunLock(deps: ProductionRunLockDeps) {
  const ownerId = deps.ownerId?.trim() || `worker-${process.pid}-${crypto.randomUUID()}`;
  const pid = deps.pid ?? process.pid;
  const leaseMs = deps.leaseMs ?? PRODUCTION_RUN_LOCK_DEFAULT_LEASE_MS;
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const durable = deps.durability !== "ephemeral";
  const epochPath = deps.epochPath ?? `${deps.filePath}.epoch`;

  if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error("Production run lock leaseMs must be positive");

  function reclaimExpired(existing: ProductionRunLockLease): void {
    if (Date.parse(now()) < Date.parse(existing.expiresAt)) throw new ProductionRunLockBusyError();
    quarantine();
  }

  /**
   * 坏记录没有到期时间（崩在 open(wx) 和 write 之间、断电都会留下它），只能看文件多久没动过。活着的持有者每次续约都整份重写，
   * 所以超过一个租期没动过 = 没有活人，回收；没超过的仍算占用：那可能正是别的进程刚开了文件、还没写完。
   */
  function reclaimCorruptRecord(busy: ProductionRunLockCorruptRecordError): void {
    let modifiedAt: number;
    try {
      modifiedAt = fs.statSync(deps.filePath).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw busy;
    }
    if (Math.abs(Date.parse(now()) - modifiedAt) < leaseMs) throw busy;
    quarantine();
  }

  function quarantine(): void {
    const quarantinePath = `${deps.filePath}.stale.${randomId()}`;
    try {
      // rename is atomic: only one racing worker can quarantine this expired owner.
      fs.renameSync(deps.filePath, quarantinePath);
      fs.rmSync(quarantinePath, { force: true });
      fsyncDirectory(deps.filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return;
      throw new ProductionRunLockBusyError("Production run lock changed while reclaiming it");
    }
  }

  function acquire(): ProductionRunLockLease {
    fs.mkdirSync(path.dirname(deps.filePath), { recursive: true });
    let existing: ProductionRunLockLease | null = null;
    try {
      existing = parseLease(deps.filePath);
    } catch (error) {
      if (!(error instanceof ProductionRunLockCorruptRecordError)) throw error;
      reclaimCorruptRecord(error);
    }
    if (existing) reclaimExpired(existing);
    const fencingEpoch = durable ? parseEpoch(epochPath) + 1 : 1;
    const lease: ProductionRunLockLease = {
      schemaVersion: PRODUCTION_RUN_LOCK_SCHEMA_VERSION,
      ownerId,
      pid,
      acquiredAt: now(),
      expiresAt: new Date(Date.parse(now()) + leaseMs).toISOString(),
      fencingEpoch,
      nonce: randomId(),
    };
    let fd: number;
    try {
      fd = fs.openSync(deps.filePath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new ProductionRunLockBusyError();
      throw error;
    }
    try {
      fs.writeSync(fd, `${JSON.stringify(lease)}\n`, undefined, "utf8");
      if (durable) fsyncFile(fd);
    } catch (error) {
      try { fs.rmSync(deps.filePath, { force: true }); } catch { /* preserve original error */ }
      throw error;
    } finally {
      fs.closeSync(fd);
    }
    if (durable) {
      try {
        writeJsonFileAtomic(epochPath, { schemaVersion: 1, fencingEpoch });
      } catch (error) {
        try { fs.rmSync(deps.filePath, { force: true }); } catch { /* preserve original error */ }
        throw error;
      }
    }
    if (durable) fsyncDirectory(deps.filePath);
    return lease;
  }

  function assertOwned(lease: ProductionRunLockLease): void {
    const current = parseLease(deps.filePath);
    if (!sameLease(current, lease)) throw new ProductionRunLockLostError();
    if (Date.parse(now()) >= Date.parse(current!.expiresAt)) throw new ProductionRunLockLostError("Production run fencing lock expired");
  }

  function renew(lease: ProductionRunLockLease): ProductionRunLockLease {
    assertOwned(lease);
    const renewed: ProductionRunLockLease = {
      ...lease,
      expiresAt: new Date(Date.parse(now()) + leaseMs).toISOString(),
    };
    // Heartbeats must not expose a partially written lock to a reclaiming
    // process; use the same temp+rename primitive as other durable metadata.
    writeJsonFileAtomic(deps.filePath, renewed);
    if (durable) fsyncDirectory(deps.filePath);
    return renewed;
  }

  function release(lease: ProductionRunLockLease): void {
    assertOwned(lease);
    fs.rmSync(deps.filePath, { force: true });
    if (durable) fsyncDirectory(deps.filePath);
  }

  async function withLock<T>(callback: (lease: ProductionRunLockLease) => Promise<T> | T): Promise<T> {
    const lease = acquire();
    try {
      return await callback(lease);
    } finally {
      try {
        release(lease);
      } catch {
        // A crashed/lost owner must not mask the operation's original result.
      }
    }
  }

  return { acquire, assertOwned, renew, release, withLock };
}

export type ProductionRunLock = ReturnType<typeof createProductionRunLock>;
