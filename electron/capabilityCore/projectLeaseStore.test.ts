import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectLeaseStoreIntegrityError,
  createProjectLeaseStore,
} from "./projectLeaseStore";

const tempDirs: string[] = [];

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-lease-store-"));
  tempDirs.push(dir);
  return {
    dir,
    store: createProjectLeaseStore({
      filePath: path.join(dir, "leases.json"),
      macKey: "lease-store-key",
      keyId: "lease-store-v1",
    }),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("ProjectLeaseStore", () => {
  it("persists issued and revoked leases across a new store instance", () => {
    const { dir, store } = makeStore();
    const lease = { tokenHash: "hash-1", projectId: "project-1", immutableProjectUuid: "uuid-1", projectGeneration: 2 };
    expect(store.recordIssued(lease)).toEqual(lease);
    expect(store.read("hash-1")).toEqual({ lease, revokedAt: undefined });
    expect(store.revoke("hash-1", "2026-08-23T00:00:00.000Z")).toMatchObject({ lease: { tokenHash: "hash-1" }, revokedAt: "2026-08-23T00:00:00.000Z" });

    const restarted = createProjectLeaseStore({ filePath: path.join(dir, "leases.json"), macKey: "lease-store-key", keyId: "lease-store-v1" });
    expect(restarted.read("hash-1")?.revokedAt).toBe("2026-08-23T00:00:00.000Z");
    expect(restarted.isRevoked("hash-1")).toBe(true);
  });

  it("is idempotent for the same lease and rejects a conflicting identity", () => {
    const { store } = makeStore();
    const lease = { tokenHash: "hash-1", projectId: "project-1", immutableProjectUuid: "uuid-1", projectGeneration: 2 };
    expect(store.recordIssued(lease)).toEqual(lease);
    expect(store.recordIssued(lease)).toEqual(lease);
    expect(() => store.recordIssued({ ...lease, projectId: "project-2" })).toThrow(/lease record conflict/);
    expect(() => store.revoke("missing", "2026-08-23T00:00:00.000Z")).toThrow(/lease not found/);
  });

  it("rejects a corrupt state without rewriting it", () => {
    const { dir, store } = makeStore();
    const lease = { tokenHash: "hash-1", projectId: "project-1", immutableProjectUuid: "uuid-1", projectGeneration: 2 };
    store.recordIssued(lease);
    const filePath = path.join(dir, "leases.json");
    const before = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, before.replace('"hash-1"', '"hash-tampered"'));
    expect(() => store.list()).toThrow(ProjectLeaseStoreIntegrityError);
    expect(fs.readFileSync(filePath, "utf8")).not.toBe(before);
    expect(fs.readFileSync(filePath, "utf8")).toContain("hash-tampered");
  });
});
