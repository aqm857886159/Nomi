import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { readFile, writeFile, writeFileSync } from "atomically";

import { isDurable } from "./durability";
import {
  isSharingViolation,
  retryOnSharingViolationAsync,
  SHARING_RETRY_BUDGET_MS,
  SHARING_RETRY_DELAYS_MS,
  type AsyncSharingRetryOptions,
} from "./sharingRetry";

/**
 * Atomically (over)write a JSON file via `atomically`, bridging Nomi's single
 * durability switch (`isDurable()`) and Windows sharing-violation retry boundary.
 *
 * Serialize to a temp file in the SAME directory (so the final rename stays on
 * one filesystem and is atomic on POSIX), fsync it when `isDurable()` is true,
 * then rename over the target. On a crash / power loss or `ENOSPC` / short write
 * the target is always either the previous complete file or the new complete
 * file — never a truncated, corrupt one.
 */

const DEFAULT_JSON_FILE_MODE = 0o666;
const monotonicNowMs = (): number => process.uptime() * 1_000;

/** 判定和退避表的唯一一份在 sharingRetry.ts；这里转出判定与异步退避，现有调用方不必分两行导入。 */
export { isSharingViolation, retryOnSharingViolationAsync };

/**
 * 同步文件操作撞上共享冲突时按共享总预算（400ms，无 Atomics.wait）重试，之后把原错误如实抛出。
 * 热路径与已经在 async 函数里的调用方走 writeJsonFileAtomicAsync / renameWithRetry /
 * sharingRetry.retryOnSharingViolationAsync（定时器退避，不占事件循环）。
 */
export function retryOnSharingViolation<T>(operation: () => T): T {
  const deadline = monotonicNowMs() + SHARING_RETRY_BUDGET_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (
        !isSharingViolation(error) ||
        (attempt >= SHARING_RETRY_DELAYS_MS.length && monotonicNowMs() >= deadline)
      ) {
        throw error;
      }
    }
  }
}

/** One attempt for checked transactions and callers that own their own retry loop. */
export function renameOnce(from: string, to: string): Promise<void> {
  return fs.promises.rename(from, to);
}

/** One attempt for checked transactions and synchronous best-effort callers. */
export function renameSyncOnce(from: string, to: string): void {
  fs.renameSync(from, to);
}

export function renameSyncWithRetry(from: string, to: string): void {
  retryOnSharingViolation(() => renameSyncOnce(from, to));
}

export function renameWithRetry(from: string, to: string, options?: AsyncSharingRetryOptions): Promise<void> {
  return retryOnSharingViolationAsync(() => fs.promises.rename(from, to), options);
}

export type WriteJsonFileAtomicOptions = Readonly<{
  mode?: number;
}>;

export type ReadJsonFileAsyncOptions = Readonly<{
  retrySharingViolation?: boolean;
}>;

function serializeJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createTempPathTracker(stagedPaths: string[]): (targetPath: string) => string {
  return (targetPath: string): string => {
    const tempPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`,
    );
    stagedPaths.push(tempPath);
    return tempPath;
  };
}

export async function writeJsonFileAtomicAsync(
  filePath: string,
  value: unknown,
  options: WriteJsonFileAtomicOptions = {},
): Promise<void> {
  const bytes = serializeJsonBytes(value);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const stagedPaths: string[] = [];
  try {
    await writeFile(filePath, Readable.from([bytes]), {
      chown: false,
      mode: options.mode ?? DEFAULT_JSON_FILE_MODE,
      fsync: isDurable(),
      fsyncWait: true,
      timeout: SHARING_RETRY_BUDGET_MS,
      tmpCreate: createTempPathTracker(stagedPaths),
      tmpPurge: false,
    });
  } finally {
    await Promise.all(
      stagedPaths.map((stagedPath) => fs.promises.rm(stagedPath, { force: true }).catch(() => undefined)),
    );
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown, options: WriteJsonFileAtomicOptions = {}): void {
  const bytes = serializeJsonBytes(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagedPaths: string[] = [];
  try {
    retryOnSharingViolation(() =>
      writeFileSync(filePath, bytes, {
        chown: false,
        mode: options.mode ?? DEFAULT_JSON_FILE_MODE,
        fsync: isDurable(),
        fsyncWait: true,
        timeout: 0,
        tmpCreate: createTempPathTracker(stagedPaths),
        tmpPurge: false,
      }),
    );
  } finally {
    for (const stagedPath of stagedPaths) {
      try {
        fs.rmSync(stagedPath, { force: true });
      } catch {
        // Preserve the originating write, close, or rename outcome.
      }
    }
  }
}

export async function readJsonFileAsync(filePath: string, options: ReadJsonFileAsyncOptions = {}): Promise<unknown> {
  const raw = await readFile(filePath, {
    encoding: "utf8",
    timeout: options.retrySharingViolation ? SHARING_RETRY_BUDGET_MS : 0,
  });
  return JSON.parse(raw);
}

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
