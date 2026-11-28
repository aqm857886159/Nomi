import pLimit from "p-limit";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { readJsonFile, readJsonFileAsync, writeJsonFileAtomic, writeJsonFileAtomicAsync } from "../jsonFile";
import { assertInsideWorkspace, workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";
import {
  acquireWorkspaceManifestLock,
  assertWorkspaceManifestLockOwned,
  assertWorkspaceManifestLockOwnedAsync,
  releaseWorkspaceManifestLock,
  releaseWorkspaceManifestLockAsync,
  tryAcquireWorkspaceManifestLock,
  type WorkspaceManifestLockOptions,
  type WorkspaceManifestLockLease,
} from "./workspaceManifestLock";

export type WorkspaceManifestTransaction = {
  canonicalRootPath: string;
  manifestPath: string;
  exists: (filePath: string) => boolean;
  readJson: (filePath: string) => unknown | null;
  replaceJson: (filePath: string, value: unknown) => unknown;
  copyFile: (sourcePath: string, targetPath: string) => void;
  writeFile: (filePath: string, data: Uint8Array) => void;
};

type StagedWorkspaceManifestOperation =
  | { type: "replace-json"; target: string; expected: unknown }
  | { type: "copy-file"; source: string; target: string }
  | { type: "write-file"; target: string; data: Uint8Array };

type WorkspaceManifestTransactionExecution = {
  transaction: WorkspaceManifestTransaction;
  commit: () => void;
  commitAsync: () => Promise<void>;
};

type PreloadedJsonEntry =
  | { status: "missing" }
  | { status: "ok"; value: unknown }
  | { status: "error"; error: unknown };

function canonicalTransactionPath(lease: WorkspaceManifestLockLease, filePath: string): string {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) {
    return assertInsideWorkspace(lease.canonicalRootPath, fs.realpathSync(resolved));
  }
  return assertInsideWorkspace(lease.canonicalRootPath, resolved);
}

async function canonicalTransactionPathAsync(lease: WorkspaceManifestLockLease, filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  try {
    const real = await fs.promises.realpath(resolved);
    return assertInsideWorkspace(lease.canonicalRootPath, real);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return assertInsideWorkspace(lease.canonicalRootPath, resolved);
    }
    throw error;
  }
}

function serializableValue(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Workspace manifest transaction value is not JSON serializable");
  }
  return JSON.parse(serialized);
}

function persistJson(lease: WorkspaceManifestLockLease, target: string, expected: unknown): unknown {
  assertWorkspaceManifestLockOwned(lease);
  writeJsonFileAtomic(target, expected);
  const persisted = readJsonFile(target);
  if (!isDeepStrictEqual(persisted, expected)) {
    throw new Error("Workspace manifest transaction verification failed");
  }
  assertWorkspaceManifestLockOwned(lease);
  return persisted;
}

async function persistJsonAsync(lease: WorkspaceManifestLockLease, target: string, expected: unknown): Promise<unknown> {
  await assertWorkspaceManifestLockOwnedAsync(lease);
  await writeJsonFileAtomicAsync(target, expected);
  const persisted = await readJsonFileAsync(target);
  if (!isDeepStrictEqual(persisted, expected)) {
    throw new Error("Workspace manifest transaction verification failed");
  }
  await assertWorkspaceManifestLockOwnedAsync(lease);
  return persisted;
}

function persistFile(lease: WorkspaceManifestLockLease, target: string, data: Uint8Array): void {
  assertWorkspaceManifestLockOwned(lease);
  const verifiedTarget = canonicalTransactionPath(lease, target);
  fs.mkdirSync(path.dirname(verifiedTarget), { recursive: true });
  fs.writeFileSync(verifiedTarget, data);
  assertWorkspaceManifestLockOwned(lease);
}

async function persistFileAsync(lease: WorkspaceManifestLockLease, target: string, data: Uint8Array): Promise<void> {
  await assertWorkspaceManifestLockOwnedAsync(lease);
  const verifiedTarget = await canonicalTransactionPathAsync(lease, target);
  await fs.promises.mkdir(path.dirname(verifiedTarget), { recursive: true });
  await fs.promises.writeFile(verifiedTarget, data);
  await assertWorkspaceManifestLockOwnedAsync(lease);
}

async function preloadJsonCandidate(lease: WorkspaceManifestLockLease, candidatePath: string): Promise<[string, PreloadedJsonEntry]> {
  const target = await canonicalTransactionPathAsync(lease, candidatePath);
  try {
    await fs.promises.access(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [target, { status: "missing" }];
    }
    return [target, { status: "error", error }];
  }
  try {
    return [target, { status: "ok", value: await readJsonFileAsync(target) }];
  } catch (error) {
    return [target, { status: "error", error }];
  }
}

function createTransaction(
  lease: WorkspaceManifestLockLease,
  mode: "immediate" | "staged",
  options: { skipStageSyncAssertOwned?: boolean; preloadedJson?: Map<string, PreloadedJsonEntry> } = {},
): WorkspaceManifestTransactionExecution {
  const operations: StagedWorkspaceManifestOperation[] = [];
  const stagedJson = new Map<string, unknown>();
  const stagedPaths = new Set<string>();
  const checkStageOwner = (): void => {
    if (!options.skipStageSyncAssertOwned) assertWorkspaceManifestLockOwned(lease);
  };

  const exists = (filePath: string): boolean => {
    checkStageOwner();
    const target = canonicalTransactionPath(lease, filePath);
    return stagedPaths.has(target) || fs.existsSync(target);
  };

  const readJson = (filePath: string): unknown | null => {
    checkStageOwner();
    const target = canonicalTransactionPath(lease, filePath);
    if (stagedJson.has(target)) {
      return serializableValue(stagedJson.get(target));
    }
    const preloaded = options.preloadedJson?.get(target);
    if (preloaded) {
      options.preloadedJson?.delete(target);
      if (preloaded.status === "missing") return null;
      if (preloaded.status === "error") throw preloaded.error;
      return preloaded.value;
    }
    return fs.existsSync(target) ? readJsonFile(target) : null;
  };

  const replaceJson = (filePath: string, value: unknown): unknown => {
    checkStageOwner();
    const target = canonicalTransactionPath(lease, filePath);
    const expected = serializableValue(value);
    if (mode === "staged") {
      operations.push({ type: "replace-json", target, expected });
      stagedJson.set(target, expected);
      stagedPaths.add(target);
      return serializableValue(expected);
    }
    return persistJson(lease, target, expected);
  };

  const copyFile = (sourcePath: string, targetPath: string): void => {
    checkStageOwner();
    const source = canonicalTransactionPath(lease, sourcePath);
    const target = canonicalTransactionPath(lease, targetPath);
    if (mode === "staged") {
      if (!fs.existsSync(source) && !stagedPaths.has(source)) {
        fs.accessSync(source, fs.constants.R_OK);
      }
      operations.push({ type: "copy-file", source, target });
      stagedPaths.add(target);
    } else {
      fs.copyFileSync(source, target);
      assertWorkspaceManifestLockOwned(lease);
    }
  };

  const writeFile = (filePath: string, data: Uint8Array): void => {
    checkStageOwner();
    const target = canonicalTransactionPath(lease, filePath);
    const bytes = Uint8Array.from(data);
    if (mode === "staged") {
      operations.push({ type: "write-file", target, data: bytes });
      stagedPaths.add(target);
    } else {
      persistFile(lease, target, bytes);
    }
  };

  return {
    transaction: {
      canonicalRootPath: lease.canonicalRootPath,
      manifestPath: workspaceProjectFile(lease.canonicalRootPath),
      exists,
      readJson,
      replaceJson,
      copyFile,
      writeFile,
    },
    commit() {
      for (const operation of operations) {
        assertWorkspaceManifestLockOwned(lease);
        if (operation.type === "replace-json") {
          persistJson(lease, operation.target, operation.expected);
        } else if (operation.type === "copy-file") {
          fs.copyFileSync(operation.source, operation.target);
          assertWorkspaceManifestLockOwned(lease);
        } else {
          persistFile(lease, operation.target, operation.data);
        }
      }
    },
    async commitAsync() {
      for (const operation of operations) {
        await assertWorkspaceManifestLockOwnedAsync(lease);
        if (operation.type === "replace-json") {
          await persistJsonAsync(lease, operation.target, operation.expected);
        } else if (operation.type === "copy-file") {
          await fs.promises.copyFile(operation.source, operation.target);
          await assertWorkspaceManifestLockOwnedAsync(lease);
        } else {
          await persistFileAsync(lease, operation.target, operation.data);
        }
      }
    },
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function runTransactionSync<T>(
  lease: WorkspaceManifestLockLease,
  callback: (transaction: WorkspaceManifestTransaction) => T,
): T {
  let result: T | undefined;
  let callbackError: unknown;
  let callbackFailed = false;
  try {
    assertWorkspaceManifestLockOwned(lease);
    const execution = createTransaction(lease, "staged");
    result = callback(execution.transaction);
    if (isPromiseLike(result)) {
      void result.then(undefined, () => undefined);
      throw new TypeError("Synchronous workspace manifest transaction callback returned a Promise-like value");
    }
    execution.commit();
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }

  let releaseError: unknown;
  try {
    releaseWorkspaceManifestLock(lease);
  } catch (error) {
    releaseError = error;
  }

  if (callbackFailed) throw callbackError;
  if (releaseError !== undefined) throw releaseError;
  return result as T;
}

async function runTransactionStagedAsync<T>(
  lease: WorkspaceManifestLockLease,
  callback: (transaction: WorkspaceManifestTransaction) => T,
): Promise<T> {
  let result: T | undefined;
  let callbackError: unknown;
  let callbackFailed = false;
  try {
    await assertWorkspaceManifestLockOwnedAsync(lease);
    const preloadedEntries = await Promise.all([
      preloadJsonCandidate(lease, workspaceProjectFile(lease.canonicalRootPath)),
      preloadJsonCandidate(lease, workspaceProjectBackupFile(lease.canonicalRootPath)),
    ]);
    const execution = createTransaction(lease, "staged", {
      skipStageSyncAssertOwned: true,
      preloadedJson: new Map(preloadedEntries),
    });
    result = callback(execution.transaction);
    if (isPromiseLike(result)) {
      void result.then(undefined, () => undefined);
      throw new TypeError("Synchronous workspace manifest transaction callback returned a Promise-like value");
    }
    await execution.commitAsync();
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }

  let releaseError: unknown;
  try {
    await releaseWorkspaceManifestLockAsync(lease);
  } catch (error) {
    releaseError = error;
  }

  if (callbackFailed) throw callbackError;
  if (releaseError !== undefined) throw releaseError;
  return result as T;
}

async function runTransactionAsync<T>(
  lease: WorkspaceManifestLockLease,
  callback: (transaction: WorkspaceManifestTransaction) => T | Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let callbackError: unknown;
  let callbackFailed = false;
  try {
    await assertWorkspaceManifestLockOwnedAsync(lease);
    result = await callback(createTransaction(lease, "immediate").transaction);
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }

  let releaseError: unknown;
  try {
    await releaseWorkspaceManifestLockAsync(lease);
  } catch (error) {
    releaseError = error;
  }

  if (callbackFailed) throw callbackError;
  if (releaseError !== undefined) throw releaseError;
  return result as T;
}

export function withWorkspaceManifestTransactionSync<T>(
  actualRootPath: string,
  callback: (transaction: WorkspaceManifestTransaction) => T extends PromiseLike<unknown> ? never : T,
  lockOptions: WorkspaceManifestLockOptions = {},
): T {
  return runTransactionSync(tryAcquireWorkspaceManifestLock(actualRootPath, lockOptions), callback);
}

/** Wait without blocking the owner, then preserve synchronous staged validation and async commit semantics. */
const stagedTransactionLimits = new Map<string, ReturnType<typeof pLimit>>();

export async function withWorkspaceManifestStagedTransaction<T>(
  actualRootPath: string,
  callback: (transaction: WorkspaceManifestTransaction) => T extends PromiseLike<unknown> ? never : T,
  lockOptions: WorkspaceManifestLockOptions = {},
): Promise<T> {
  const canonicalRoot = fs.realpathSync(actualRootPath);
  const limit = stagedTransactionLimits.get(canonicalRoot) ?? pLimit(1);
  stagedTransactionLimits.set(canonicalRoot, limit);
  try {
    return await limit(async () => {
      const lease = await acquireWorkspaceManifestLock(canonicalRoot, lockOptions);
      return runTransactionStagedAsync(lease, callback);
    });
  } finally {
    if (stagedTransactionLimits.get(canonicalRoot) === limit && limit.activeCount === 0 && limit.pendingCount === 0) stagedTransactionLimits.delete(canonicalRoot);
  }
}

export async function withWorkspaceManifestTransaction<T>(
  actualRootPath: string,
  callback: (transaction: WorkspaceManifestTransaction) => T | Promise<T>,
  lockOptions: WorkspaceManifestLockOptions = {},
): Promise<T> {
  const lease = await acquireWorkspaceManifestLock(actualRootPath, lockOptions);
  return runTransactionAsync(lease, callback);
}
