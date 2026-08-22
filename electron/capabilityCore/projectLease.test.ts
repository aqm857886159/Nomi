import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectLeaseExpiredError,
  ProjectLeaseScopeError,
  createProjectLeaseAuthority,
} from "./projectLease";
import { createProjectLeaseStore } from "./projectLeaseStore";

const tempDirs: string[] = [];

function makeAuthority() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-lease-"));
  tempDirs.push(dir);
  let tick = 0;
  const now = () => `2026-08-23T00:00:${String(tick).padStart(2, "0")}.000Z`;
  const advance = (seconds: number) => { tick += seconds; };
  const store = createProjectLeaseStore({ filePath: path.join(dir, "leases.json"), macKey: "store-key" });
  const authority = createProjectLeaseAuthority({
    macKey: "authority-key",
    keyId: "authority-v1",
    store,
    now,
    randomId: (() => {
      let index = 0;
      return () => `id-${++index}`;
    })(),
  });
  return { authority, store, advance };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const selection = {
  immutableProjectUuid: "uuid-1",
  projectGeneration: 3,
  canonicalRootDigest: "root-digest-1",
  manifestDigest: "manifest-digest-1",
  scopeSet: ["context:read", "generation:submit"],
};

describe("ProjectLeaseAuthority", () => {
  it("issues a signed selection handle and project lease that survive restart", () => {
    const { authority, store } = makeAuthority();
    const handle = authority.issueSelectionHandle(selection);
    const lease = authority.issueLease(handle.token, {
      projectId: "project-1",
      leasePrincipal: "mcp:codex",
      sessionId: "session-1",
      connectionNonce: "connection-1",
    });

    expect(lease.lease).toMatchObject({ projectId: "project-1", projectGeneration: 3, audience: "nomi-mcp" });
    expect(authority.verifyLease(lease.token, { projectId: "project-1", sessionId: "session-1" })).toMatchObject({ projectId: "project-1" });

    const restarted = createProjectLeaseAuthority({ macKey: "authority-key", keyId: "authority-v1", store });
    expect(restarted.verifyLease(lease.token, { projectId: "project-1", sessionId: "session-1" })).toEqual(lease.lease);
  });

  it("rejects expiry, tampering, foreign scope and revoked leases", () => {
    const { authority, advance } = makeAuthority();
    const handle = authority.issueSelectionHandle({ ...selection, ttlMs: 5_000 });
    const lease = authority.issueLease(handle.token, {
      projectId: "project-1",
      leasePrincipal: "mcp:codex",
      sessionId: "session-1",
      connectionNonce: "connection-1",
      ttlMs: 5_000,
    });
    expect(() => authority.verifyLease(lease.token, { projectId: "project-2" })).toThrow(ProjectLeaseScopeError);
    expect(() => authority.verifyLease(`${lease.token.slice(0, -1)}x`)).toThrow(ProjectLeaseScopeError);
    advance(6);
    expect(() => authority.verifyLease(lease.token)).toThrow(ProjectLeaseExpiredError);

    const freshHandle = authority.issueSelectionHandle(selection);
    const freshLease = authority.issueLease(freshHandle.token, {
      projectId: "project-1",
      leasePrincipal: "mcp:codex",
      sessionId: "session-2",
      connectionNonce: "connection-2",
    });
    authority.revoke(freshLease.token);
    expect(() => authority.verifyLease(freshLease.token)).toThrow(/revoked/);
  });

  it("derives a stable scope hash and never trusts a client-supplied project id", () => {
    const { authority } = makeAuthority();
    const first = authority.issueSelectionHandle({ ...selection, scopeSet: ["b", "a", "a"] });
    const second = authority.issueSelectionHandle({ ...selection, scopeSet: ["a", "b"] });
    const leaseA = authority.issueLease(first.token, { projectId: "project-1", leasePrincipal: "mcp:codex", sessionId: "s-1", connectionNonce: "c-1" });
    const leaseB = authority.issueLease(second.token, { projectId: "project-1", leasePrincipal: "mcp:codex", sessionId: "s-2", connectionNonce: "c-2" });
    expect(leaseA.lease.scopeHash).toBe(leaseB.lease.scopeHash);
    expect(() => authority.verifyLease(leaseA.token, { projectId: "project-forged", immutableProjectUuid: "uuid-1" })).toThrow(ProjectLeaseScopeError);
  });

  it("upgrades only the current lease scope, preserves its project/session binding, and caps expiry", () => {
    const { authority } = makeAuthority();
    const handle = authority.issueSelectionHandle({ ...selection, scopeSet: ["context:read"] });
    const lease = authority.issueLease(handle.token, {
      projectId: "project-1",
      leasePrincipal: "mcp:codex",
      sessionId: "session-1",
      connectionNonce: "connection-1",
      ttlMs: 60_000,
    });

    const upgraded = authority.upgradeLeaseScope(lease.token, ["context:read", "generation:gate"]);
    expect(upgraded.lease).toMatchObject({
      projectId: "project-1",
      immutableProjectUuid: "uuid-1",
      projectGeneration: 3,
      sessionId: "session-1",
      connectionNonce: "connection-1",
      scopeSet: ["context:read", "generation:gate"],
    });
    expect(Date.parse(upgraded.lease.expiresAt)).toBeLessThanOrEqual(Date.parse(lease.lease.expiresAt));
    expect(authority.verifyLease(upgraded.token, { scope: "generation:gate", sessionId: "session-1" })).toMatchObject({
      projectId: "project-1",
      scopeSet: ["context:read", "generation:gate"],
    });
    expect(() => authority.upgradeLeaseScope(lease.token, ["generation:submit"])).toThrow(ProjectLeaseScopeError);
  });
});
