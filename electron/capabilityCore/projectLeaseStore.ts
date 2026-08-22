import crypto from "node:crypto";
import fs from "node:fs";

import { writeJsonFileAtomic } from "../jsonFile";
import type { ProductionRunLock } from "../productionRun/productionRunLock";

export const PROJECT_LEASE_STORE_SCHEMA_VERSION = 1;

export type StoredProjectLease = {
  tokenHash: string;
  projectId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
};

export type StoredProjectLeaseRecord = {
  lease: StoredProjectLease;
  revokedAt?: string;
};

type ProjectLeaseStoreState = {
  schemaVersion: typeof PROJECT_LEASE_STORE_SCHEMA_VERSION;
  revision: number;
  keyId: string;
  records: Record<string, StoredProjectLeaseRecord>;
  checksum: string;
  mac: string;
};

export type ProjectLeaseStoreDeps = {
  filePath: string;
  macKey: string | NodeJS.TypedArray;
  keyId?: string;
  previousKeys?: Readonly<Record<string, string | NodeJS.TypedArray>>;
  lock?: ProductionRunLock;
};

export class ProjectLeaseStoreIntegrityError extends Error {
  readonly code = "migration_parse_error";

  constructor(message: string) {
    super(`migration_parse_error: ${message}`);
    this.name = "ProjectLeaseStoreIntegrityError";
  }
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Lease store state must contain finite numbers");
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
  throw new Error("Lease store state must be JSON serializable");
}

function keyBuffer(value: string | NodeJS.TypedArray): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function checksum(value: Omit<ProjectLeaseStoreState, "checksum" | "mac">): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function mac(value: Omit<ProjectLeaseStoreState, "mac">, key: string | NodeJS.TypedArray): string {
  return crypto.createHmac("sha256", keyBuffer(key)).update(stableJson(value)).digest("base64url");
}

function equalMac(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function emptyState(keyId: string): ProjectLeaseStoreState {
  const value: Omit<ProjectLeaseStoreState, "checksum" | "mac"> = { schemaVersion: PROJECT_LEASE_STORE_SCHEMA_VERSION, revision: 0, keyId, records: {} };
  return { ...value, checksum: checksum(value), mac: "" };
}

function sameLease(left: StoredProjectLease, right: StoredProjectLease): boolean {
  return stableJson(left) === stableJson(right);
}

function cloneRecord(value: StoredProjectLeaseRecord): StoredProjectLeaseRecord {
  return { lease: { ...value.lease }, revokedAt: value.revokedAt };
}

export function createProjectLeaseStore(deps: ProjectLeaseStoreDeps) {
  const keyId = deps.keyId ?? "lease-store-v1";
  const keys: Readonly<Record<string, string | NodeJS.TypedArray>> = {
    ...deps.previousKeys,
    [keyId]: deps.macKey,
  };

  function readState(): ProjectLeaseStoreState {
    if (!fs.existsSync(deps.filePath)) return emptyState(keyId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(deps.filePath, "utf8"));
    } catch {
      throw new ProjectLeaseStoreIntegrityError("invalid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProjectLeaseStoreIntegrityError("state must be an object");
    const state = parsed as ProjectLeaseStoreState;
    if (state.schemaVersion !== PROJECT_LEASE_STORE_SCHEMA_VERSION || !Number.isInteger(state.revision) || state.revision < 0
      || typeof state.keyId !== "string" || !state.keyId || !state.records || typeof state.records !== "object"
      || typeof state.checksum !== "string" || typeof state.mac !== "string") {
      throw new ProjectLeaseStoreIntegrityError("invalid state envelope");
    }
    const value = { schemaVersion: state.schemaVersion, revision: state.revision, keyId: state.keyId, records: state.records };
    if (state.checksum !== checksum(value)) throw new ProjectLeaseStoreIntegrityError("checksum mismatch");
    const stateKey = keys[state.keyId];
    if (!stateKey || !equalMac(state.mac, mac({ ...value, checksum: state.checksum }, stateKey))) {
      throw new ProjectLeaseStoreIntegrityError("MAC mismatch");
    }
    for (const [tokenHash, record] of Object.entries(state.records)) {
      if (record.lease.tokenHash !== tokenHash || typeof record.lease.projectId !== "string"
        || typeof record.lease.immutableProjectUuid !== "string" || !Number.isInteger(record.lease.projectGeneration)
        || (record.revokedAt !== undefined && typeof record.revokedAt !== "string")) {
        throw new ProjectLeaseStoreIntegrityError("invalid lease record");
      }
    }
    return state;
  }

  function writeState(state: Omit<ProjectLeaseStoreState, "checksum" | "mac">): void {
    const withChecksum = { ...state, checksum: checksum(state) };
    writeJsonFileAtomic(deps.filePath, { ...withChecksum, mac: mac(withChecksum, deps.macKey) });
  }

  function mutate<T>(callback: (state: ProjectLeaseStoreState) => { result: T; changed: boolean }): T {
    const held = deps.lock?.acquire();
    try {
      const state = readState();
      const outcome = callback(state);
      if (outcome.changed) {
        writeState({
          schemaVersion: state.schemaVersion,
          revision: state.revision + 1,
          keyId: state.keyId,
          records: state.records,
        });
      }
      return outcome.result;
    } finally {
      if (held && deps.lock) deps.lock.release(held);
    }
  }

  function recordIssued(lease: StoredProjectLease): StoredProjectLease {
    if (!lease.tokenHash || !lease.projectId || !lease.immutableProjectUuid || !Number.isInteger(lease.projectGeneration)) {
      throw new Error("Invalid project lease record");
    }
    return mutate((state) => {
      const existing = state.records[lease.tokenHash];
      if (existing) {
        if (!sameLease(existing.lease, lease)) throw new Error(`lease record conflict: ${lease.tokenHash}`);
        if (existing.revokedAt) throw new Error(`lease already revoked: ${lease.tokenHash}`);
        return { result: { ...existing.lease }, changed: false };
      }
      state.records[lease.tokenHash] = { lease: { ...lease } };
      return { result: { ...lease }, changed: true };
    });
  }

  function revoke(tokenHash: string, revokedAt: string): StoredProjectLeaseRecord {
    return mutate((state) => {
      const existing = state.records[tokenHash];
      if (!existing) throw new Error(`lease not found: ${tokenHash}`);
      if (existing.revokedAt) return { result: cloneRecord(existing), changed: false };
      existing.revokedAt = revokedAt;
      return { result: cloneRecord(existing), changed: true };
    });
  }

  function read(tokenHash: string): StoredProjectLeaseRecord | undefined {
    const value = readState().records[tokenHash];
    return value ? cloneRecord(value) : undefined;
  }

  function list(): StoredProjectLeaseRecord[] {
    return Object.values(readState().records).map(cloneRecord);
  }

  return {
    recordIssued,
    revoke,
    read,
    list,
    isRevoked: (tokenHash: string) => Boolean(read(tokenHash)?.revokedAt),
  };
}

export type ProjectLeaseStore = ReturnType<typeof createProjectLeaseStore>;
