import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canCreateSymlink } from "../testSupport/canCreateSymlink";
import {
  WorkspaceManifestLockBusyError,
  WorkspaceManifestLockLostError,
  acquireWorkspaceManifestLock,
  releaseWorkspaceManifestLock,
  tryAcquireWorkspaceManifestLock,
} from "./workspaceManifestLock";

const tempRoots: string[] = [];
const canCreateDirSymlink = canCreateSymlink("dir");

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(prefix = "nomi-workspace-manifest-lock-"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function lockDir(root: string): string {
  return path.join(fs.realpathSync(root), ".nomi", "manifest-transaction.lock");
}

describe("workspace manifest lock", () => {
  it("keeps sync callers fail-closed while an async caller waits and acquires after release", async () => {
    const root = makeTempDir();
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "owner-a",
      randomId: () => "nonce-a",
    });

    expect(() =>
      tryAcquireWorkspaceManifestLock(root, {
        ownerId: "owner-b",
        randomId: () => "nonce-b",
      }),
    ).toThrow(WorkspaceManifestLockBusyError);

    const waiting = acquireWorkspaceManifestLock(root, {
      ownerId: "owner-c",
      randomId: () => "nonce-c",
      retryDelayMs: 1,
      waitTimeoutMs: 1_000,
    });
    releaseWorkspaceManifestLock(held);

    const acquired = await waiting;
    expect(acquired.owner.ownerId).toBe("owner-c");
    releaseWorkspaceManifestLock(acquired);
  });

  it("never steals a live owner based on elapsed time", () => {
    const root = makeTempDir();
    const held = tryAcquireWorkspaceManifestLock(root, {
      host: "host-a",
      pid: 101,
      processStartedAtMs: 10,
      nowMs: () => 100,
      ownerId: "live-owner",
      randomId: () => "live-nonce",
    });

    expect(() =>
      tryAcquireWorkspaceManifestLock(root, {
        host: "host-a",
        pid: 202,
        nowMs: () => Number.MAX_SAFE_INTEGER,
        initializationGraceMs: 0,
        processLiveness: () => "alive",
        ownerId: "contender",
        randomId: () => "contender-nonce",
      }),
    ).toThrow(WorkspaceManifestLockBusyError);

    releaseWorkspaceManifestLock(held);
  });

  it("fails closed for another host even when the recorded PID appears dead", () => {
    const root = makeTempDir();
    const held = tryAcquireWorkspaceManifestLock(root, {
      host: "host-a",
      pid: 101,
      ownerId: "host-a-owner",
      randomId: () => "host-a-nonce",
    });

    expect(() =>
      tryAcquireWorkspaceManifestLock(root, {
        host: "host-b",
        pid: 202,
        processLiveness: () => "dead",
        ownerId: "host-b-owner",
        randomId: () => "host-b-nonce",
      }),
    ).toThrow(WorkspaceManifestLockBusyError);

    releaseWorkspaceManifestLock(held);
  });

  it("recovers a same-host dead owner only after atomically quarantining it", () => {
    const root = makeTempDir();
    const dead = tryAcquireWorkspaceManifestLock(root, {
      host: "host-a",
      pid: 101,
      ownerId: "dead-owner",
      randomId: () => "dead-nonce",
    });

    const recovered = tryAcquireWorkspaceManifestLock(root, {
      host: "host-a",
      pid: 202,
      processLiveness: (pid) => (pid === 101 ? "dead" : "alive"),
      ownerId: "new-owner",
      randomId: () => "new-nonce",
    });

    expect(recovered.owner.ownerId).toBe("new-owner");
    expect(() => releaseWorkspaceManifestLock(dead)).toThrow(WorkspaceManifestLockLostError);
    releaseWorkspaceManifestLock(recovered);
  });

  it("treats release as committed after the owner-dir rename and safely reclaims failed cleanup", () => {
    const root = makeTempDir();
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "releasing-owner",
      randomId: () => "releasing-owner-nonce",
    });
    const realRm = fs.rmSync.bind(fs);
    let failReleaseCleanup = true;
    const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(((target, options) => {
      if (failReleaseCleanup && String(target).includes("release-")) {
        failReleaseCleanup = false;
        throw new Error("simulated release quarantine cleanup failure");
      }
      return realRm(target, options);
    }) as typeof fs.rmSync);

    expect(() => releaseWorkspaceManifestLock(held)).not.toThrow();
    rmSpy.mockRestore();
    expect(fs.existsSync(lockDir(root))).toBe(false);

    const next = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "next-owner",
      randomId: () => "next-owner-nonce",
    });
    releaseWorkspaceManifestLock(next);
  });

  it("does not reclaim an incomplete owner record until initialization grace expires", () => {
    const root = makeTempDir();
    const incomplete = lockDir(root);
    fs.mkdirSync(incomplete, { recursive: true });

    expect(() =>
      tryAcquireWorkspaceManifestLock(root, {
        initializationGraceMs: 60_000,
        ownerId: "contender",
        randomId: () => "contender-nonce",
      }),
    ).toThrow(WorkspaceManifestLockBusyError);

    fs.utimesSync(incomplete, new Date(0), new Date(0));
    const acquired = tryAcquireWorkspaceManifestLock(root, {
      initializationGraceMs: 1,
      ownerId: "after-grace",
      randomId: () => "after-grace-nonce",
    });
    releaseWorkspaceManifestLock(acquired);
  });

  it("re-reads the published owner before allowing the critical section", () => {
    const root = makeTempDir();
    const publishedLockDir = lockDir(root);
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      realRename(source, target);
      if (path.resolve(String(target)) === path.resolve(publishedLockDir)) {
        const ownerPath = path.join(publishedLockDir, "owner.json");
        const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
        fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, nonce: "tampered" }));
      }
    });

    expect(() =>
      tryAcquireWorkspaceManifestLock(root, {
        ownerId: "candidate",
        randomId: () => "candidate-nonce",
      }),
    ).toThrow(WorkspaceManifestLockLostError);
    expect(fs.existsSync(publishedLockDir)).toBe(true);
  });

  (canCreateDirSymlink ? it : it.skip)("maps a symlink alias and direct path to the same canonical lock", () => {
    const root = makeTempDir();
    const aliasParent = makeTempDir("nomi-workspace-manifest-lock-alias-");
    const alias = path.join(aliasParent, "workspace-alias");
    fs.symlinkSync(root, alias, "dir");
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "direct-owner",
      randomId: () => "direct-nonce",
    });

    expect(() =>
      tryAcquireWorkspaceManifestLock(alias, {
        ownerId: "alias-owner",
        randomId: () => "alias-nonce",
      }),
    ).toThrow(WorkspaceManifestLockBusyError);

    releaseWorkspaceManifestLock(held);
  });
});
