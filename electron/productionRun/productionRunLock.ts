import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../jsonFile";

export const PRODUCTION_RUN_LOCK_SCHEMA_VERSION = 1;

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

function fsyncFile(fd: number): void {
  try {
    fs.fsyncSync(fd);
  } catch {
    // Some filesystems do not expose fsync for a just-created lock file.
  }
}

function fsyncDirectory(filePath: string): void {
  try {
    const fd = fs.openSync(path.dirname(filePath), "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Windows does not support opening a directory as a file descriptor.
  }
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
    throw new ProductionRunLockBusyError("Production run lock record is corrupt");
  }
}

function sameLease(left: ProductionRunLockLease | null, right: ProductionRunLockLease): boolean {
  return Boolean(left && left.ownerId === right.ownerId && left.nonce === right.nonce && left.fencingEpoch === right.fencingEpoch);
}

export function createProductionRunLock(deps: ProductionRunLockDeps) {
  const ownerId = deps.ownerId?.trim() || `worker-${process.pid}-${crypto.randomUUID()}`;
  const pid = deps.pid ?? process.pid;
  const leaseMs = deps.leaseMs ?? 30_000;
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const epochPath = deps.epochPath ?? `${deps.filePath}.epoch`;

  if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error("Production run lock leaseMs must be positive");

  function reclaimExpired(existing: ProductionRunLockLease): void {
    if (Date.parse(now()) < Date.parse(existing.expiresAt)) throw new ProductionRunLockBusyError();
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
    const existing = parseLease(deps.filePath);
    if (existing) reclaimExpired(existing);
    const fencingEpoch = parseEpoch(epochPath) + 1;
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
      fsyncFile(fd);
    } catch (error) {
      try { fs.rmSync(deps.filePath, { force: true }); } catch { /* preserve original error */ }
      throw error;
    } finally {
      fs.closeSync(fd);
    }
    try {
      writeJsonFileAtomic(epochPath, { schemaVersion: 1, fencingEpoch });
    } catch (error) {
      try { fs.rmSync(deps.filePath, { force: true }); } catch { /* preserve original error */ }
      throw error;
    }
    fsyncDirectory(deps.filePath);
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
    fsyncDirectory(deps.filePath);
    return renewed;
  }

  function release(lease: ProductionRunLockLease): void {
    assertOwned(lease);
    fs.rmSync(deps.filePath, { force: true });
    fsyncDirectory(deps.filePath);
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
