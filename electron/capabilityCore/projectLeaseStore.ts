import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fsyncIfDurable, isDurable } from "../durability";
import { renameSyncWithRetry } from "../jsonFile";

export const PROJECT_LEASE_STORE_SCHEMA_VERSION = 2;

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const CANDIDATE_PATTERN = /^\.candidate-(\d{13,})-([a-f0-9]{20})$/;
const DEFAULT_MAX_RECORDS = 1_024;
const DEFAULT_MAX_RECORDS_PER_PROJECT = 128;
const DEFAULT_CANDIDATE_GRACE_MS = 30_000;
const DEFAULT_MAX_CANDIDATES = 64;

export type StoredProjectLease = {
  tokenHash: string;
  projectId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  issuedAt: string;
  expiresAt: string;
};

export type StoredProjectLeaseRecord = {
  lease: StoredProjectLease;
  revokedAt?: string;
};

type IssuedPayload = StoredProjectLease;

type RevokedPayload = {
  tokenHash: string;
  revokedAt: string;
  expiresAt: string;
  issuedChecksum: string;
};

type SignedRecord<Kind extends "issued" | "revoked", Payload> = {
  schemaVersion: typeof PROJECT_LEASE_STORE_SCHEMA_VERSION;
  kind: Kind;
  keyId: string;
  payload: Payload;
  checksum: string;
  mac: string;
};

export type ProjectLeaseStoreDeps = {
  /** V2 root directory. A legacy central JSON, when present, must use legacyFilePath. */
  filePath: string;
  legacyFilePath?: string;
  macKey: string | NodeJS.TypedArray;
  keyId?: string;
  previousKeys?: Readonly<Record<string, string | NodeJS.TypedArray>>;
  now?: () => string;
  randomId?: () => string;
  maxRecords?: number;
  maxRecordsPerProject?: number;
  candidateGraceMs?: number;
  maxCandidates?: number;
};

export class ProjectLeaseStoreIntegrityError extends Error {
  readonly code = "migration_parse_error";

  constructor(message: string) {
    super(`migration_parse_error: ${message}`);
    this.name = "ProjectLeaseStoreIntegrityError";
  }
}

export class ProjectLeaseStoreCapacityError extends Error {
  readonly code = "project_session_unavailable";

  constructor() {
    super("Project session capacity is unavailable");
    this.name = "ProjectLeaseStoreCapacityError";
  }
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Lease store record must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Lease store record must be JSON serializable");
}

function keyBuffer(value: string | NodeJS.TypedArray): Buffer {
  return typeof value === "string"
    ? Buffer.from(value, "utf8")
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function mac(value: unknown, key: string | NodeJS.TypedArray): string {
  return crypto.createHmac("sha256", keyBuffer(key)).update(stableJson(value)).digest("base64url");
}

function equalMac(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

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
    // Windows cannot open a directory as a file descriptor.
  }
}

function realDirectory(directoryPath: string): boolean {
  try {
    const stat = fs.lstatSync(directoryPath);
    return !stat.isSymbolicLink() && stat.isDirectory();
  } catch {
    return false;
  }
}

function directoryState(directoryPath: string): "missing" | "directory" | "invalid" {
  try {
    const stat = fs.lstatSync(directoryPath);
    return !stat.isSymbolicLink() && stat.isDirectory() ? "directory" : "invalid";
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "missing";
    throw error;
  }
}

function assertRealDirectory(directoryPath: string, label: string): void {
  if (!realDirectory(directoryPath)) throw new ProjectLeaseStoreIntegrityError(`${label} must be a real directory`);
}

function assertRegularFile(filePath: string, label: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("not a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw error;
    throw new ProjectLeaseStoreIntegrityError(`${label} must be a regular file`);
  }
}

function ensurePrivateDirectory(directoryPath: string): void {
  if (fs.existsSync(directoryPath)) {
    assertRealDirectory(directoryPath, "lease store directory");
  } else {
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  }
  try { fs.chmodSync(directoryPath, 0o700); } catch { /* Windows permissions are advisory. */ }
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateTokenHash(value: string): void {
  if (!TOKEN_HASH_PATTERN.test(value)) throw new Error("Invalid project lease token hash");
}

function validateLease(value: StoredProjectLease): StoredProjectLease {
  validateTokenHash(value.tokenHash);
  if (!value.projectId || !value.immutableProjectUuid
    || !Number.isInteger(value.projectGeneration) || value.projectGeneration < 1
    || !validDate(value.issuedAt) || !validDate(value.expiresAt)
    || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    throw new Error("Invalid project lease record");
  }
  return { ...value };
}

function sameLease(left: StoredProjectLease, right: StoredProjectLease): boolean {
  return stableJson(left) === stableJson(right);
}

function cloneRecord(value: StoredProjectLeaseRecord): StoredProjectLeaseRecord {
  return { lease: { ...value.lease }, revokedAt: value.revokedAt };
}

export function createProjectLeaseStore(deps: ProjectLeaseStoreDeps) {
  const keyId = deps.keyId ?? "lease-store-v2";
  const keys: Readonly<Record<string, string | NodeJS.TypedArray>> = {
    ...deps.previousKeys,
    [keyId]: deps.macKey,
  };
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const maxRecords = deps.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxRecordsPerProject = deps.maxRecordsPerProject ?? DEFAULT_MAX_RECORDS_PER_PROJECT;
  const candidateGraceMs = deps.candidateGraceMs ?? DEFAULT_CANDIDATE_GRACE_MS;
  const maxCandidates = deps.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const issuedRoot = path.join(deps.filePath, "issued");
  let initialized = false;

  if (!Number.isInteger(maxRecords) || maxRecords < 1
    || !Number.isInteger(maxRecordsPerProject) || maxRecordsPerProject < 1
    || maxRecordsPerProject > maxRecords
    || !Number.isInteger(candidateGraceMs) || candidateGraceMs < 0
    || !Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error("Project lease store capacity must be positive and per-project capacity cannot exceed global capacity");
  }
  if (deps.legacyFilePath && path.resolve(deps.legacyFilePath) === path.resolve(deps.filePath)) {
    throw new Error("Legacy project lease file must be separate from the V2 store directory");
  }

  function retireLegacyStore(): void {
    const legacyPath = deps.legacyFilePath;
    if (!legacyPath) return;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(legacyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new ProjectLeaseStoreIntegrityError("legacy lease store must be a regular file");
    }
    const retiredPath = `${legacyPath}.retired-${digest(randomId()).slice(0, 20)}`;
    try {
      renameSyncWithRetry(legacyPath, retiredPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw error;
    }
    try { fs.rmSync(retiredPath, { force: true }); } catch { /* Never read a retired V1 session ledger again. */ }
    fsyncDirectory(path.dirname(legacyPath));
  }

  function initialize(): void {
    if (initialized) return;
    retireLegacyStore();
    ensurePrivateDirectory(deps.filePath);
    ensurePrivateDirectory(issuedRoot);
    const activeCandidates = cleanupCandidates(currentTimeMs());
    if (activeCandidates > maxCandidates) throw new ProjectLeaseStoreCapacityError();
    initialized = true;
  }

  function buildRecord<Kind extends "issued" | "revoked", Payload>(
    kind: Kind,
    payload: Payload,
  ): SignedRecord<Kind, Payload> {
    const base: Omit<SignedRecord<Kind, Payload>, "checksum" | "mac"> = {
      schemaVersion: PROJECT_LEASE_STORE_SCHEMA_VERSION,
      kind,
      keyId,
      payload,
    };
    const checksum = digest(base);
    const withChecksum = { ...base, checksum };
    return { ...withChecksum, mac: mac(withChecksum, deps.macKey) };
  }

  function parseRecord<Kind extends "issued" | "revoked", Payload>(
    filePath: string,
    expectedKind: Kind,
  ): SignedRecord<Kind, Payload> {
    assertRegularFile(filePath, `${expectedKind} lease record`);
    let parsed: unknown;
    let serialized: string;
    try {
      serialized = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw error;
      throw new ProjectLeaseStoreIntegrityError(`${expectedKind} lease record cannot be read`);
    }
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new ProjectLeaseStoreIntegrityError(`${expectedKind} lease record is invalid JSON`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ProjectLeaseStoreIntegrityError(`${expectedKind} lease record must be an object`);
    }
    const record = parsed as SignedRecord<Kind, Payload>;
    if (record.schemaVersion !== PROJECT_LEASE_STORE_SCHEMA_VERSION
      || record.kind !== expectedKind
      || typeof record.keyId !== "string" || !record.keyId
      || !record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)
      || typeof record.checksum !== "string" || typeof record.mac !== "string") {
      throw new ProjectLeaseStoreIntegrityError(`${expectedKind} lease record envelope is invalid`);
    }
    const base = {
      schemaVersion: record.schemaVersion,
      kind: record.kind,
      keyId: record.keyId,
      payload: record.payload,
    };
    if (record.checksum !== digest(base)) {
      throw new ProjectLeaseStoreIntegrityError(`${expectedKind} lease record checksum mismatch`);
    }
    const recordKey = keys[record.keyId];
    if (!recordKey || !equalMac(record.mac, mac({ ...base, checksum: record.checksum }, recordKey))) {
      throw new ProjectLeaseStoreIntegrityError(`${expectedKind} lease record MAC mismatch`);
    }
    return record;
  }

  function writeCandidateRecord(filePath: string, record: unknown): void {
    const fd = fs.openSync(filePath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      fsyncIfDurable(fd);
    } finally {
      fs.closeSync(fd);
    }
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows permissions are advisory. */ }
  }

  function publishDirectory(
    parentPath: string,
    targetPath: string,
    recordName: string,
    record: unknown,
  ): boolean {
    const timeMs = currentTimeMs();
    if (cleanupCandidates(timeMs) >= maxCandidates) throw new ProjectLeaseStoreCapacityError();
    const candidatePath = path.join(
      parentPath,
      `.candidate-${Math.trunc(timeMs)}-${digest(randomId()).slice(0, 20)}`,
    );
    fs.mkdirSync(candidatePath, { mode: 0o700 });
    try {
      writeCandidateRecord(path.join(candidatePath, recordName), record);
      fsyncDirectory(candidatePath);
      try {
        renameSyncWithRetry(candidatePath, targetPath);
        fsyncDirectory(parentPath);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        const conflict = code === "EEXIST" || code === "ENOTEMPTY"
          || code === "EPERM" || code === "EACCES" || code === "EBUSY";
        if (conflict && realDirectory(targetPath)) return false;
        throw error;
      }
    } finally {
      if (fs.existsSync(candidatePath)) {
        try { fs.rmSync(candidatePath, { recursive: true, force: true }); } catch { /* Candidate is never authority. */ }
      }
    }
  }

  function tokenPath(tokenHash: string): string {
    return path.join(issuedRoot, tokenHash);
  }

  function cleanupCandidateEntries(parentPath: string, timeMs: number): number {
    let active = 0;
    for (const name of fs.readdirSync(parentPath)) {
      if (!name.startsWith(".candidate-")) continue;
      const match = CANDIDATE_PATTERN.exec(name);
      if (!match) throw new ProjectLeaseStoreIntegrityError("lease store candidate entry name is invalid");
      const candidatePath = path.join(parentPath, name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(candidatePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        throw error;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new ProjectLeaseStoreIntegrityError("lease store candidate entry must be a real directory");
      }
      const createdAtMs = Number(match[1]);
      if (!Number.isSafeInteger(createdAtMs)) {
        throw new ProjectLeaseStoreIntegrityError("lease store candidate timestamp is invalid");
      }
      if (createdAtMs + candidateGraceMs <= timeMs) {
        try {
          fs.rmSync(candidatePath, { recursive: true, force: true });
          fsyncDirectory(parentPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        }
        continue;
      }
      active += 1;
    }
    return active;
  }

  function cleanupCandidates(timeMs: number): number {
    let active = cleanupCandidateEntries(issuedRoot, timeMs);
    for (const name of fs.readdirSync(issuedRoot)) {
      if (!TOKEN_HASH_PATTERN.test(name)) continue;
      const directoryPath = tokenPath(name);
      if (!realDirectory(directoryPath)) continue;
      try {
        active += cleanupCandidateEntries(directoryPath, timeMs);
      } catch (error) {
        // Expiry pruning publishes by atomically moving the whole token directory.
        // A peer may do that after the lstat above but before this readdir.
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      }
    }
    return active;
  }

  function formalTokenNames(): string[] {
    initialize();
    const names = fs.readdirSync(issuedRoot).sort();
    const formal: string[] = [];
    for (const name of names) {
      if (name.startsWith(".candidate-")) {
        if (!CANDIDATE_PATTERN.test(name)) {
          throw new ProjectLeaseStoreIntegrityError("lease store candidate entry name is invalid");
        }
        const state = directoryState(path.join(issuedRoot, name));
        if (state === "missing") continue;
        if (state === "invalid") {
          throw new ProjectLeaseStoreIntegrityError("lease store candidate entry must be a real directory");
        }
        continue;
      }
      if (name.startsWith(".expired-")) continue;
      if (!TOKEN_HASH_PATTERN.test(name)) {
        throw new ProjectLeaseStoreIntegrityError("lease store contains an unknown formal entry");
      }
      const state = directoryState(tokenPath(name));
      if (state === "missing") continue;
      if (state === "invalid") {
        throw new ProjectLeaseStoreIntegrityError("issued token entry must be a real directory");
      }
      formal.push(name);
    }
    return formal;
  }

  function readInternal(tokenHash: string): (StoredProjectLeaseRecord & { issuedChecksum: string }) | undefined {
    validateTokenHash(tokenHash);
    const directoryPath = tokenPath(tokenHash);
    try {
      const state = directoryState(directoryPath);
      if (state === "missing") return undefined;
      if (state === "invalid") {
        throw new ProjectLeaseStoreIntegrityError("issued token entry must be a real directory");
      }
      const issued = parseRecord<"issued", IssuedPayload>(path.join(directoryPath, "issued.json"), "issued");
      let lease: StoredProjectLease;
      try {
        lease = validateLease(issued.payload);
      } catch {
        throw new ProjectLeaseStoreIntegrityError("issued lease payload is invalid");
      }
      if (lease.tokenHash !== tokenHash) {
        throw new ProjectLeaseStoreIntegrityError("issued lease token hash does not match its directory");
      }

      const revokedPath = path.join(directoryPath, "revoked");
      const revokedState = directoryState(revokedPath);
      if (revokedState === "missing") {
        const finalState = directoryState(directoryPath);
        if (finalState === "missing") return undefined;
        if (finalState === "invalid") {
          throw new ProjectLeaseStoreIntegrityError("issued token entry must be a real directory");
        }
        return { lease, revokedAt: undefined, issuedChecksum: issued.checksum };
      }
      if (revokedState === "invalid") {
        throw new ProjectLeaseStoreIntegrityError("revoked token entry must be a real directory");
      }
      const revoked = parseRecord<"revoked", RevokedPayload>(path.join(revokedPath, "record.json"), "revoked");
      const payload = revoked.payload;
      if (typeof payload.tokenHash !== "string" || payload.tokenHash !== tokenHash
        || !validDate(payload.revokedAt) || payload.expiresAt !== lease.expiresAt
        || payload.issuedChecksum !== issued.checksum) {
        throw new ProjectLeaseStoreIntegrityError("revoked lease marker does not match its issued record");
      }
      return { lease, revokedAt: payload.revokedAt, issuedChecksum: issued.checksum };
    } catch (error) {
      // Expiry pruning atomically moves the entire immutable token directory.
      // Losing that path at any read step is a legitimate concurrent removal;
      // every other filesystem or integrity failure remains fail-closed.
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        const finalState = directoryState(directoryPath);
        if (finalState === "missing") return undefined;
        if (finalState === "invalid") {
          throw new ProjectLeaseStoreIntegrityError("issued token entry must be a real directory");
        }
        throw new ProjectLeaseStoreIntegrityError("issued token entry is incomplete");
      }
      throw error;
    }
  }

  function currentTimeMs(): number {
    const value = Date.parse(now());
    if (!Number.isFinite(value)) throw new Error("Project lease store clock is invalid");
    return value;
  }

  function pruneExpired(timeMs: number): void {
    for (const name of fs.readdirSync(issuedRoot)) {
      if (!name.startsWith(".expired-")) continue;
      try { fs.rmSync(path.join(issuedRoot, name), { recursive: true, force: true }); } catch { /* Retry later. */ }
    }
    for (const hash of formalTokenNames()) {
      const record = readInternal(hash);
      if (!record || Date.parse(record.lease.expiresAt) > timeMs) continue;
      const quarantinePath = path.join(issuedRoot, `.expired-${hash}-${digest(randomId()).slice(0, 12)}`);
      try {
        renameSyncWithRetry(tokenPath(hash), quarantinePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        throw error;
      }
      fsyncDirectory(issuedRoot);
      try { fs.rmSync(quarantinePath, { recursive: true, force: true }); } catch { /* It is already outside authority. */ }
    }
  }

  function retainedRecords(timeMs: number): StoredProjectLeaseRecord[] {
    return formalTokenNames()
      .map((hash) => readInternal(hash))
      .filter((record): record is StoredProjectLeaseRecord & { issuedChecksum: string } => (
        Boolean(record) && Date.parse(record!.lease.expiresAt) > timeMs
      ))
      .map(cloneRecord);
  }

  function assertCapacity(lease: StoredProjectLease, timeMs: number): void {
    const records = retainedRecords(timeMs);
    if (records.length >= maxRecords
      || records.filter((record) => record.lease.projectId === lease.projectId).length >= maxRecordsPerProject) {
      throw new ProjectLeaseStoreCapacityError();
    }
    // Separate processes can pass this pre-publish count concurrently, so the
    // bound may overshoot briefly by the number of concurrent local writers.
    // Per-token immutable publication still prevents lost records; the next
    // mutation observes the excess and rejects until expiry pruning lowers it.
  }

  function recordIssued(input: StoredProjectLease): StoredProjectLease {
    initialize();
    const lease = validateLease(input);
    const timeMs = currentTimeMs();
    if (Date.parse(lease.expiresAt) <= timeMs) throw new Error("Cannot register an expired project lease");
    if (cleanupCandidates(timeMs) > maxCandidates) throw new ProjectLeaseStoreCapacityError();
    pruneExpired(timeMs);

    const existing = readInternal(lease.tokenHash);
    if (existing) {
      if (!sameLease(existing.lease, lease)) throw new Error(`lease record conflict: ${lease.tokenHash}`);
      if (existing.revokedAt) throw new Error(`lease already revoked: ${lease.tokenHash}`);
      return { ...existing.lease };
    }
    assertCapacity(lease, timeMs);
    const published = publishDirectory(
      issuedRoot,
      tokenPath(lease.tokenHash),
      "issued.json",
      buildRecord("issued", lease),
    );
    if (!published) {
      const raced = readInternal(lease.tokenHash);
      if (!raced || !sameLease(raced.lease, lease)) throw new Error(`lease record conflict: ${lease.tokenHash}`);
      if (raced.revokedAt) throw new Error(`lease already revoked: ${lease.tokenHash}`);
      return { ...raced.lease };
    }
    return { ...lease };
  }

  function revoke(tokenHash: string, revokedAt: string): StoredProjectLeaseRecord {
    initialize();
    validateTokenHash(tokenHash);
    if (!validDate(revokedAt)) throw new Error("Invalid project lease revocation time");
    const timeMs = currentTimeMs();
    if (cleanupCandidates(timeMs) > maxCandidates) throw new ProjectLeaseStoreCapacityError();
    pruneExpired(timeMs);
    const existing = readInternal(tokenHash);
    if (!existing) throw new Error(`lease not found: ${tokenHash}`);
    if (existing.revokedAt) return cloneRecord(existing);
    const revokedPath = path.join(tokenPath(tokenHash), "revoked");
    const published = publishDirectory(
      tokenPath(tokenHash),
      revokedPath,
      "record.json",
      buildRecord("revoked", {
        tokenHash,
        revokedAt,
        expiresAt: existing.lease.expiresAt,
        issuedChecksum: existing.issuedChecksum,
      }),
    );
    const current = readInternal(tokenHash);
    if (!current?.revokedAt) {
      if (!published) throw new ProjectLeaseStoreIntegrityError("revoked lease marker could not be verified");
      throw new ProjectLeaseStoreIntegrityError("published revoked lease marker is unavailable");
    }
    return cloneRecord(current);
  }

  function read(tokenHash: string): StoredProjectLeaseRecord | undefined {
    initialize();
    const value = readInternal(tokenHash);
    if (!value || Date.parse(value.lease.expiresAt) <= currentTimeMs()) return undefined;
    return cloneRecord(value);
  }

  function list(): StoredProjectLeaseRecord[] {
    initialize();
    return retainedRecords(currentTimeMs());
  }

  initialize();
  return {
    recordIssued,
    revoke,
    read,
    list,
    isRevoked: (tokenHash: string) => Boolean(read(tokenHash)?.revokedAt),
  };
}

export type ProjectLeaseStore = ReturnType<typeof createProjectLeaseStore>;
