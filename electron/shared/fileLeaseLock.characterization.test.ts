import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupTestTemp, makeTempDir } from "../../scripts/_test-temp.mjs";
import {
  WorkspaceManifestLockBusyError,
  WorkspaceManifestLockLostError,
  acquireWorkspaceManifestLock,
  releaseWorkspaceManifestLock,
  tryAcquireWorkspaceManifestLock,
} from "../workspace/workspaceManifestLock";
import { withWorkspaceManifestStagedTransaction } from "../workspace/workspaceManifestTransaction";

const roots: string[] = [];
function makeRoot(): string {
  const root = makeTempDir("manifest-characterization");
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) cleanupTestTemp(root);
});

it("keeps a live workspace owner exclusive regardless of elapsed time", async () => {
  const root = makeRoot();
  const lease = tryAcquireWorkspaceManifestLock(root, { nowMs: () => 1 });
  await expect(acquireWorkspaceManifestLock(root, {
    nowMs: () => Number.MAX_SAFE_INTEGER, waitTimeoutMs: 0,
  })).rejects.toBeInstanceOf(WorkspaceManifestLockBusyError);
  releaseWorkspaceManifestLock(lease);
  const next = await acquireWorkspaceManifestLock(root);
  expect(next.owner.nonce).not.toBe(lease.owner.nonce);
  releaseWorkspaceManifestLock(next);
});

it("takes over a dead PID and leaves the replacement intact when the former owner releases", () => {
  const root = makeRoot();
  const old = tryAcquireWorkspaceManifestLock(root, { pid: 101 });
  const next = tryAcquireWorkspaceManifestLock(root, { pid: 202, processLiveness: () => "dead" });
  expect(() => releaseWorkspaceManifestLock(old)).toThrow(WorkspaceManifestLockLostError);
  expect(JSON.parse(fs.readFileSync(path.join(next.lockDir, "owner.json"), "utf8"))).toEqual(next.owner);
  releaseWorkspaceManifestLock(next);
});

it.each(["EPERM", "EACCES"])("retries transient %s on release", (code) => {
  const lease = tryAcquireWorkspaceManifestLock(makeRoot());
  const renameSync = fs.renameSync;
  const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw Object.assign(new Error("sharing violation"), { code });
  }).mockImplementation(renameSync);
  releaseWorkspaceManifestLock(lease);
  expect(rename).toHaveBeenCalledTimes(2);
  expect(fs.existsSync(lease.lockDir)).toBe(false);
});

it("runs staged callbacks in submission order after a held lock and a rejected callback", async () => {
  const root = makeRoot();
  const held = tryAcquireWorkspaceManifestLock(root);
  const order: string[] = [];
  const failed = withWorkspaceManifestStagedTransaction(root, () => {
    order.push("first");
    throw new Error("first write failed");
  });
  const succeeded = withWorkspaceManifestStagedTransaction(root, () => {
    order.push("second");
    return "committed";
  });
  expect(order).toEqual([]);
  releaseWorkspaceManifestLock(held);
  await expect(failed).rejects.toThrow("first write failed");
  await expect(succeeded).resolves.toBe("committed");
  expect(order).toEqual(["first", "second"]);
});
