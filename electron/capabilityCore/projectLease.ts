import crypto from "node:crypto";

import type { ProjectLeaseStore } from "./projectLeaseStore";

export const PROJECT_LEASE_VERSION = 1 as const;
export const PROJECT_LEASE_ALGORITHM = "HMAC-SHA256" as const;
export const PROJECT_LEASE_AUDIENCE = "nomi-mcp" as const;

export type ProjectSelectionHandleV1 = {
  version: typeof PROJECT_LEASE_VERSION;
  keyId: string;
  algorithm: typeof PROJECT_LEASE_ALGORITHM;
  issuer: "nomi-main";
  handleId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  canonicalRootDigest: string;
  manifestDigest: string;
  audience: typeof PROJECT_LEASE_AUDIENCE;
  sessionNonce: string;
  issuedAt: string;
  expiresAt: string;
  revocationEpoch: number;
  scopeSet: string[];
  mac: string;
};

export type ProjectLeaseV1 = {
  version: typeof PROJECT_LEASE_VERSION;
  keyId: string;
  algorithm: typeof PROJECT_LEASE_ALGORITHM;
  issuer: "nomi-main";
  projectId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  canonicalRootDigest: string;
  manifestDigest: string;
  audience: typeof PROJECT_LEASE_AUDIENCE;
  leasePrincipal: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  scopeSet: string[];
  scopeHash: string;
  revocationEpoch: number;
  connectionNonce: string;
  mac: string;
};

export type ProjectLeaseAuthorityDeps = {
  macKey: string | NodeJS.TypedArray;
  keyId?: string;
  store: ProjectLeaseStore;
  now?: () => string;
  randomId?: () => string;
  defaultTtlMs?: number;
};

export type ProjectSelectionInput = {
  immutableProjectUuid: string;
  projectGeneration: number;
  canonicalRootDigest: string;
  manifestDigest: string;
  scopeSet: string[];
  revocationEpoch?: number;
  ttlMs?: number;
};

export type ProjectLeaseInput = {
  projectId: string;
  leasePrincipal: string;
  sessionId: string;
  connectionNonce: string;
  ttlMs?: number;
};

export type ProjectLeaseExpectation = Partial<Pick<ProjectLeaseV1,
  "projectId" | "immutableProjectUuid" | "projectGeneration" | "canonicalRootDigest"
  | "manifestDigest" | "sessionId" | "connectionNonce" | "revocationEpoch">> & {
  scope?: string;
};

export class ProjectLeaseScopeError extends Error {
  readonly code = "project_scope_changed";

  constructor(message = "Project lease scope is invalid") {
    super(message);
    this.name = "ProjectLeaseScopeError";
  }
}

export class ProjectLeaseExpiredError extends Error {
  readonly code = "lease_expired";

  constructor() {
    super("Project lease has expired");
    this.name = "ProjectLeaseExpiredError";
  }
}

export class ProjectLeaseRevokedError extends Error {
  readonly code = "lease_revoked";

  constructor() {
    super("Project lease has been revoked");
    this.name = "ProjectLeaseRevokedError";
  }
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Project lease payload must be JSON serializable");
}

function keyBuffer(value: string | NodeJS.TypedArray): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function sign(value: Omit<ProjectSelectionHandleV1, "mac"> | Omit<ProjectLeaseV1, "mac">, key: string | NodeJS.TypedArray): string {
  return crypto.createHmac("sha256", keyBuffer(key)).update(stableJson(value)).digest("base64url");
}

function encode(value: ProjectSelectionHandleV1 | ProjectLeaseV1): string {
  return Buffer.from(stableJson(value), "utf8").toString("base64url");
}

function decode(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProjectLeaseScopeError("Project lease handle is malformed");
  }
}

function normalizeScope(scopeSet: string[]): string[] {
  const normalized = Array.from(new Set(scopeSet.map((scope) => String(scope).trim()).filter(Boolean))).sort();
  if (normalized.length === 0) throw new ProjectLeaseScopeError("Project lease scope is empty");
  return normalized;
}

function verifyShape(value: Record<string, unknown>, kind: "handle" | "lease"): void {
  if (value.version !== PROJECT_LEASE_VERSION || value.algorithm !== PROJECT_LEASE_ALGORITHM
    || value.issuer !== "nomi-main" || value.audience !== PROJECT_LEASE_AUDIENCE
    || typeof value.keyId !== "string" || typeof value.mac !== "string") {
    throw new ProjectLeaseScopeError(`Project ${kind} signature shape is invalid`);
  }
}

function checkExpiry(value: { expiresAt: string }, now: string): void {
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(now) >= Date.parse(value.expiresAt)) throw new ProjectLeaseExpiredError();
}

export function createProjectLeaseAuthority(deps: ProjectLeaseAuthorityDeps) {
  const keyId = deps.keyId ?? "project-lease-v1";
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const defaultTtlMs = deps.defaultTtlMs ?? 5 * 60_000;

  function expiresAt(startedAt: string, ttlMs: number | undefined, cap?: string): string {
    if (ttlMs !== undefined && (!Number.isInteger(ttlMs) || ttlMs <= 0)) throw new ProjectLeaseScopeError("Project lease TTL is invalid");
    const candidate = new Date(Date.parse(startedAt) + (ttlMs ?? defaultTtlMs)).toISOString();
    return cap && Date.parse(cap) < Date.parse(candidate) ? cap : candidate;
  }

  function verifySigned<T extends ProjectSelectionHandleV1 | ProjectLeaseV1>(token: string, kind: "handle" | "lease"): T {
    const value = decode(token);
    verifyShape(value, kind);
    const unsigned = { ...value, mac: undefined } as unknown as Omit<ProjectSelectionHandleV1, "mac"> | Omit<ProjectLeaseV1, "mac">;
    if (value.keyId !== keyId || value.mac !== sign(unsigned, deps.macKey)) {
      throw new ProjectLeaseScopeError(`Project ${kind} signature is invalid`);
    }
    return value as T;
  }

  function verifySelectionHandle(token: string, expected: Partial<ProjectSelectionHandleV1> = {}): ProjectSelectionHandleV1 {
    const handle = verifySigned<ProjectSelectionHandleV1>(token, "handle");
    checkExpiry(handle, now());
    if (typeof handle.handleId !== "string" || !handle.handleId || typeof handle.immutableProjectUuid !== "string"
      || !Number.isInteger(handle.projectGeneration) || typeof handle.canonicalRootDigest !== "string"
      || typeof handle.manifestDigest !== "string" || typeof handle.sessionNonce !== "string"
      || !Array.isArray(handle.scopeSet) || !Number.isInteger(handle.revocationEpoch)) {
      throw new ProjectLeaseScopeError("Project selection handle fields are invalid");
    }
    for (const [key, value] of Object.entries(expected)) {
      if (value !== undefined && stableJson(handle[key as keyof ProjectSelectionHandleV1]) !== stableJson(value)) {
        throw new ProjectLeaseScopeError(`Project selection handle ${key} does not match current scope`);
      }
    }
    return { ...handle, scopeSet: normalizeScope(handle.scopeSet) };
  }

  function issueSelectionHandle(input: ProjectSelectionInput): { token: string; handle: ProjectSelectionHandleV1 } {
    const issuedAt = now();
    const scopeSet = normalizeScope(input.scopeSet);
    if (!input.immutableProjectUuid || !input.canonicalRootDigest || !input.manifestDigest || !Number.isInteger(input.projectGeneration)) {
      throw new ProjectLeaseScopeError("Project selection identity is incomplete");
    }
    const handleWithoutMac: Omit<ProjectSelectionHandleV1, "mac"> = {
      version: PROJECT_LEASE_VERSION,
      keyId,
      algorithm: PROJECT_LEASE_ALGORITHM,
      issuer: "nomi-main",
      handleId: randomId(),
      immutableProjectUuid: input.immutableProjectUuid,
      projectGeneration: input.projectGeneration,
      canonicalRootDigest: input.canonicalRootDigest,
      manifestDigest: input.manifestDigest,
      audience: PROJECT_LEASE_AUDIENCE,
      sessionNonce: randomId(),
      issuedAt,
      expiresAt: expiresAt(issuedAt, input.ttlMs),
      revocationEpoch: input.revocationEpoch ?? 0,
      scopeSet,
    };
    const handle: ProjectSelectionHandleV1 = { ...handleWithoutMac, mac: sign(handleWithoutMac, deps.macKey) };
    return { token: encode(handle), handle };
  }

  function issueLease(handleToken: string, input: ProjectLeaseInput): { token: string; lease: ProjectLeaseV1 } {
    const handle = verifySelectionHandle(handleToken);
    if (!input.projectId || !input.leasePrincipal || !input.sessionId || !input.connectionNonce) throw new ProjectLeaseScopeError("Project lease identity is incomplete");
    const issuedAt = now();
    const withoutMac: Omit<ProjectLeaseV1, "mac"> = {
      version: PROJECT_LEASE_VERSION,
      keyId,
      algorithm: PROJECT_LEASE_ALGORITHM,
      issuer: "nomi-main",
      projectId: input.projectId,
      immutableProjectUuid: handle.immutableProjectUuid,
      projectGeneration: handle.projectGeneration,
      canonicalRootDigest: handle.canonicalRootDigest,
      manifestDigest: handle.manifestDigest,
      audience: PROJECT_LEASE_AUDIENCE,
      leasePrincipal: input.leasePrincipal,
      sessionId: input.sessionId,
      issuedAt,
      expiresAt: expiresAt(issuedAt, input.ttlMs, handle.expiresAt),
      nonce: randomId(),
      scopeSet: [...handle.scopeSet],
      scopeHash: digest(handle.scopeSet),
      revocationEpoch: handle.revocationEpoch,
      connectionNonce: input.connectionNonce,
    };
    const lease: ProjectLeaseV1 = { ...withoutMac, mac: sign(withoutMac, deps.macKey) };
    const token = encode(lease);
    deps.store.recordIssued({
      tokenHash: digest(token),
      projectId: lease.projectId,
      immutableProjectUuid: lease.immutableProjectUuid,
      projectGeneration: lease.projectGeneration,
    });
    return { token, lease };
  }

  /**
   * Create a short-lived scope upgrade for the same verified project/session.
   * The caller must have already verified the human approval that permits the
   * expansion; this authority only preserves the lease binding and refuses
   * shrinking or rebinding it.
   */
  function upgradeLeaseScope(token: string, scopeSet: string[]): { token: string; lease: ProjectLeaseV1 } {
    const current = verifyLease(token);
    const normalized = normalizeScope(scopeSet);
    if (current.scopeSet.some((scope) => !normalized.includes(scope))) {
      throw new ProjectLeaseScopeError("Project lease scope cannot be reduced");
    }
    if (stableJson(current.scopeSet) === stableJson(normalized)) return { token, lease: current };
    const issuedAt = now();
    const withoutMac: Omit<ProjectLeaseV1, "mac"> = {
      version: PROJECT_LEASE_VERSION,
      keyId,
      algorithm: PROJECT_LEASE_ALGORITHM,
      issuer: "nomi-main",
      projectId: current.projectId,
      immutableProjectUuid: current.immutableProjectUuid,
      projectGeneration: current.projectGeneration,
      canonicalRootDigest: current.canonicalRootDigest,
      manifestDigest: current.manifestDigest,
      audience: PROJECT_LEASE_AUDIENCE,
      leasePrincipal: current.leasePrincipal,
      sessionId: current.sessionId,
      issuedAt,
      expiresAt: expiresAt(issuedAt, undefined, current.expiresAt),
      nonce: randomId(),
      scopeSet: normalized,
      scopeHash: digest(normalized),
      revocationEpoch: current.revocationEpoch,
      connectionNonce: current.connectionNonce,
    };
    const lease: ProjectLeaseV1 = { ...withoutMac, mac: sign(withoutMac, deps.macKey) };
    const upgradedToken = encode(lease);
    deps.store.recordIssued({
      tokenHash: digest(upgradedToken),
      projectId: lease.projectId,
      immutableProjectUuid: lease.immutableProjectUuid,
      projectGeneration: lease.projectGeneration,
    });
    return { token: upgradedToken, lease };
  }

  function verifyLease(token: string, expected: ProjectLeaseExpectation = {}): ProjectLeaseV1 {
    const lease = verifySigned<ProjectLeaseV1>(token, "lease");
    checkExpiry(lease, now());
    if (!lease.projectId || !lease.immutableProjectUuid || !Number.isInteger(lease.projectGeneration)
      || !lease.canonicalRootDigest || !lease.manifestDigest || !lease.leasePrincipal || !lease.sessionId
      || !lease.connectionNonce || !Array.isArray(lease.scopeSet) || lease.scopeHash !== digest(normalizeScope(lease.scopeSet))) {
      throw new ProjectLeaseScopeError("Project lease fields are invalid");
    }
    const stored = deps.store.read(digest(token));
    if (!stored || stored.lease.projectId !== lease.projectId || stored.lease.immutableProjectUuid !== lease.immutableProjectUuid
      || stored.lease.projectGeneration !== lease.projectGeneration) throw new ProjectLeaseScopeError("Project lease is not registered");
    if (stored.revokedAt) throw new ProjectLeaseRevokedError();
    for (const [key, value] of Object.entries(expected)) {
      if (key === "scope") {
        if (typeof value === "string" && !lease.scopeSet.includes(value)) throw new ProjectLeaseScopeError("Project lease scope is insufficient");
      } else if (value !== undefined && stableJson(lease[key as keyof ProjectLeaseV1]) !== stableJson(value)) {
        throw new ProjectLeaseScopeError(`Project lease ${key} does not match current scope`);
      }
    }
    return { ...lease, scopeSet: normalizeScope(lease.scopeSet) };
  }

  function revoke(token: string): void {
    const lease = verifySigned<ProjectLeaseV1>(token, "lease");
    deps.store.revoke(digest(token), now());
    void lease;
  }

  return { issueSelectionHandle, verifySelectionHandle, issueLease, upgradeLeaseScope, verifyLease, revoke };
}

export type ProjectLeaseAuthority = ReturnType<typeof createProjectLeaseAuthority>;
