import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isDurable } from "../durability";
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
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
};

export class WorkspaceManifestLockBusyError extends Error {
  readonly code = "workspace_manifest_busy";

  constructor(message = "Workspace manifest is being changed by another process") {
    super(message);
    this.name = "WorkspaceManifestLockBusyError";
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

type ParsedOwner = { valid: true; owner: WorkspaceManifestLockOwner } | { valid: false };

function fsyncDirectory(directoryPath: string): void {
  if (!isDurable()) return;
  try {
    const fd = fs.openSync(directoryPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Windows cannot open directories as file descriptors.
  }
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

function parseOwner(directoryPath: string): ParsedOwner {
  try {
    const value = readJsonFile(ownerFile(directoryPath)) as Partial<WorkspaceManifestLockOwner>;
    if (
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
  } catch {
    return { valid: false };
  }
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

function removeReleasedLocks(nomiDir: string): void {
  for (const name of releaseNames(nomiDir)) {
    try {
      fs.rmSync(path.join(nomiDir, name), { recursive: true, force: true });
      fsyncDirectory(nomiDir);
    } catch {
      throw new WorkspaceManifestLockBusyError("Workspace manifest release cleanup is still in progress");
    }
  }
}

function removeRecoverableQuarantines(input: {
  nomiDir: string;
  host: string;
  nowMs: number;
  initializationGraceMs: number;
  processLiveness: (pid: number) => ProcessLiveness;
}): void {
  for (const name of quarantineNames(input.nomiDir)) {
    const quarantinePath = path.join(input.nomiDir, name);
    const parsed = parseOwner(quarantinePath);
    if (parsed.valid) {
      if (parsed.owner.host !== input.host) {
        throw new WorkspaceManifestLockBusyError("Workspace manifest recovery belongs to another host");
      }
      if (input.processLiveness(parsed.owner.pid) !== "dead") {
        throw new WorkspaceManifestLockBusyError(
          "Workspace manifest recovery owner is still alive or cannot be verified",
        );
      }
      fs.rmSync(quarantinePath, { recursive: true, force: true });
      fsyncDirectory(input.nomiDir);
      continue;
    }
    if (directoryAgeMs(quarantinePath, input.nowMs) < input.initializationGraceMs) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest recovery owner is still initializing");
    }
    fs.rmSync(quarantinePath, { recursive: true, force: true });
    fsyncDirectory(input.nomiDir);
  }
}

function quarantineExistingOwner(input: {
  lockDir: string;
  nomiDir: string;
  expected?: WorkspaceManifestLockOwner;
  randomId: () => string;
  initializationGraceMs: number;
  nowMs: number;
}): void {
  const quarantinePath = path.join(input.nomiDir, `${QUARANTINE_PREFIX}${pathToken(input.randomId())}`);
  try {
    fs.renameSync(input.lockDir, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw new WorkspaceManifestLockBusyError("Workspace manifest owner changed during recovery");
  }
  fsyncDirectory(input.nomiDir);

  const moved = parseOwner(quarantinePath);
  if (input.expected) {
    if (!moved.valid || !sameOwner(moved.owner, input.expected)) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest owner changed during recovery");
    }
  } else if (moved.valid || directoryAgeMs(quarantinePath, input.nowMs) < input.initializationGraceMs) {
    throw new WorkspaceManifestLockBusyError("Workspace manifest owner completed during recovery");
  }

  fs.rmSync(quarantinePath, { recursive: true, force: true });
  fsyncDirectory(input.nomiDir);
}

function recoverExistingLock(input: {
  lockDir: string;
  nomiDir: string;
  host: string;
  nowMs: number;
  initializationGraceMs: number;
  processLiveness: (pid: number) => ProcessLiveness;
  randomId: () => string;
}): void {
  const parsed = parseOwner(input.lockDir);
  if (!parsed.valid) {
    if (directoryAgeMs(input.lockDir, input.nowMs) < input.initializationGraceMs) {
      throw new WorkspaceManifestLockBusyError("Workspace manifest owner record is still initializing");
    }
    quarantineExistingOwner({ ...input });
    return;
  }
  if (parsed.owner.host !== input.host) {
    throw new WorkspaceManifestLockBusyError("Workspace manifest is owned on another host");
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
  const nomiDir = workspaceNomiDir(canonicalRootPath);
  fs.mkdirSync(nomiDir, { recursive: true });
  const lockDir = path.join(nomiDir, LOCK_DIR_NAME);

  removeReleasedLocks(nomiDir);
  removeRecoverableQuarantines({
    nomiDir,
    host,
    nowMs: nowMs(),
    initializationGraceMs,
    processLiveness,
  });
  if (fs.existsSync(lockDir)) {
    recoverExistingLock({
      lockDir,
      nomiDir,
      host,
      nowMs: nowMs(),
      initializationGraceMs,
      processLiveness,
      randomId,
    });
  }
  removeRecoverableQuarantines({
    nomiDir,
    host,
    nowMs: nowMs(),
    initializationGraceMs,
    processLiveness,
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
    writeJsonFileAtomic(ownerFile(candidateDir), owner);
    const candidateOwner = parseOwner(candidateDir);
    if (!candidateOwner.valid || !sameOwner(candidateOwner.owner, owner)) {
      throw new WorkspaceManifestLockLostError("Workspace manifest owner record could not be verified before publish");
    }
    fsyncDirectory(candidateDir);
    try {
      fs.renameSync(candidateDir, lockDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
        throw new WorkspaceManifestLockBusyError();
      }
      throw error;
    }
    fsyncDirectory(nomiDir);
  } finally {
    if (fs.existsSync(candidateDir)) {
      fs.rmSync(candidateDir, { recursive: true, force: true });
    }
  }

  const lease = { canonicalRootPath, lockDir, owner };
  assertWorkspaceManifestLockOwned(lease);
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
      if (!(error instanceof WorkspaceManifestLockBusyError) || Date.now() >= deadline) {
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
  const current = parseOwner(lease.lockDir);
  if (!current.valid || !sameOwner(current.owner, lease.owner)) {
    throw new WorkspaceManifestLockLostError();
  }
}

export function releaseWorkspaceManifestLock(lease: WorkspaceManifestLockLease): void {
  assertWorkspaceManifestLockOwned(lease);
  const nomiDir = path.dirname(lease.lockDir);
  const releaseDir = path.join(
    nomiDir,
    `${RELEASE_PREFIX}${pathToken(`${lease.owner.ownerId}:${crypto.randomUUID()}`)}`,
  );
  try {
    fs.renameSync(lease.lockDir, releaseDir);
  } catch (error) {
    throw new WorkspaceManifestLockLostError("Workspace manifest lock changed before release", { cause: error });
  }
  fsyncDirectory(nomiDir);
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    fsyncDirectory(nomiDir);
  } catch {
    // The atomic rename above already relinquished ownership. A leftover release
    // directory is reserved metadata and the next acquirer safely reaps it.
  }
}
