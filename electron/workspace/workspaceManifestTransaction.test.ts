import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WorkspaceManifestLockBusyError,
  releaseWorkspaceManifestLock,
  tryAcquireWorkspaceManifestLock,
} from "./workspaceManifestLock";
import {
  withWorkspaceManifestTransaction,
  withWorkspaceManifestTransactionSync,
  type WorkspaceManifestTransaction,
} from "./workspaceManifestTransaction";

const _compileTimeRejectsAsyncTransactionCallback = (): void => {
  // @ts-expect-error synchronous manifest transactions reject Promise-like callback results
  withWorkspaceManifestTransactionSync("/compile-time-only", async () => "not-sync");
};

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-workspace-manifest-transaction-"));
  tempRoots.push(root);
  return root;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("workspace manifest transaction", () => {
  it("re-reads, atomically replaces, and verifies JSON under one canonical-root lock", async () => {
    const modulePath = "./workspaceManifestTransaction";
    const transactionModule = await import(/* @vite-ignore */ modulePath).catch(() => null);

    expect(transactionModule).not.toBeNull();
    if (!transactionModule) return;

    const root = makeTempDir();
    const manifestPath = path.join(root, ".nomi", "project.json");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ id: "project-1", revision: 4 }));

    const result = transactionModule.withWorkspaceManifestTransactionSync(
      root,
      (transaction: WorkspaceManifestTransaction) => {
        expect(transaction.canonicalRootPath).toBe(fs.realpathSync(root));
        expect(transaction.readJson(manifestPath)).toEqual({ id: "project-1", revision: 4 });
        return transaction.replaceJson(manifestPath, { id: "project-1", revision: 5 });
      },
    );

    expect(result).toEqual({ id: "project-1", revision: 5 });
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8"))).toEqual({
      id: "project-1",
      revision: 5,
    });
  });

  it("rejects a runtime Promise-like callback before publishing staged sync mutations", () => {
    const root = makeTempDir();
    const manifestPath = path.join(root, ".nomi", "project.json");
    const copiedPath = path.join(fs.realpathSync(root), ".nomi", "project.before-async.json");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const before = `${JSON.stringify({ id: "project-1", revision: 4 }, null, 2)}\n`;
    fs.writeFileSync(manifestPath, before);
    const callFromUntypedJavaScript = withWorkspaceManifestTransactionSync as unknown as (
      actualRootPath: string,
      callback: (transaction: {
        readJson: (filePath: string) => unknown;
        replaceJson: (filePath: string, value: unknown) => unknown;
        copyFile: (sourcePath: string, targetPath: string) => void;
      }) => unknown,
    ) => unknown;

    expect(() =>
      callFromUntypedJavaScript(root, async (transaction) => {
        transaction.replaceJson(manifestPath, { id: "project-1", revision: 5 });
        expect(transaction.readJson(manifestPath)).toEqual({ id: "project-1", revision: 5 });
        transaction.copyFile(manifestPath, copiedPath);
        return "not-sync";
      }),
    ).toThrow(/Promise-like/i);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
    expect(fs.existsSync(copiedPath)).toBe(false);

    const after = tryAcquireWorkspaceManifestLock(root);
    releaseWorkspaceManifestLock(after);
  });

  it("observes a discarded callback that rejects after the sync guard releases", async () => {
    const root = makeTempDir();
    const canonicalRoot = fs.realpathSync(root);
    const manifestPath = path.join(canonicalRoot, ".nomi", "project.json");
    const copiedPath = path.join(canonicalRoot, ".nomi", "project.before-late-reject.json");
    const binaryPath = path.join(canonicalRoot, "assets", "generated", "late-reject.bin");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const before = `${JSON.stringify({ id: "project-1", revision: 4 }, null, 2)}\n`;
    fs.writeFileSync(manifestPath, before);
    const lateError = new Error("late async callback rejection");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const callFromUntypedJavaScript = withWorkspaceManifestTransactionSync as unknown as (
      actualRootPath: string,
      callback: (transaction: {
        replaceJson: (filePath: string, value: unknown) => unknown;
        copyFile: (sourcePath: string, targetPath: string) => void;
        writeFile: (filePath: string, data: Uint8Array) => void;
      }) => unknown,
    ) => unknown;

    process.on("unhandledRejection", onUnhandled);
    try {
      expect(() =>
        callFromUntypedJavaScript(root, async (transaction) => {
          transaction.replaceJson(manifestPath, { id: "project-1", revision: 5 });
          transaction.copyFile(manifestPath, copiedPath);
          transaction.writeFile(binaryPath, Uint8Array.of(1, 2, 3));
          await new Promise<void>((resolve) => setImmediate(resolve));
          throw lateError;
        }),
      ).toThrow(/Promise-like/i);
      expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
      expect(fs.existsSync(copiedPath)).toBe(false);
      expect(fs.existsSync(binaryPath)).toBe(false);

      const after = tryAcquireWorkspaceManifestLock(root);
      releaseWorkspaceManifestLock(after);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("holds the manifest lock until an async transaction callback settles", async () => {
    const root = makeTempDir();
    const entered = deferred();
    const finish = deferred();
    const transaction = withWorkspaceManifestTransaction(root, async () => {
      entered.resolve();
      await finish.promise;
      return "done";
    });

    await entered.promise;
    expect(() =>
      tryAcquireWorkspaceManifestLock(root, {
        ownerId: "early-contender",
        randomId: () => "early-contender-nonce",
      }),
    ).toThrow(WorkspaceManifestLockBusyError);

    finish.resolve();
    await expect(transaction).resolves.toBe("done");
    const after = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "after-callback",
      randomId: () => "after-callback-nonce",
    });
    releaseWorkspaceManifestLock(after);
  });

  it("releases after an async callback rejects while preserving the callback error", async () => {
    const root = makeTempDir();
    const entered = deferred();
    const finish = deferred();
    const callbackError = new Error("async callback failed");
    const transaction = withWorkspaceManifestTransaction(root, async () => {
      entered.resolve();
      await finish.promise;
      throw callbackError;
    });

    await entered.promise;
    expect(() => tryAcquireWorkspaceManifestLock(root)).toThrow(WorkspaceManifestLockBusyError);
    finish.resolve();
    await expect(transaction).rejects.toBe(callbackError);

    const after = tryAcquireWorkspaceManifestLock(root);
    releaseWorkspaceManifestLock(after);
  });
});
