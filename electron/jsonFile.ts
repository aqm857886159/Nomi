import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fsyncIfDurable } from "./durability";
import { isSharingViolation, SHARING_RETRY_DELAYS_MS } from "./sharingRetry";

/**
 * Atomically (over)write a JSON file.
 *
 * Serialize to a temp file in the SAME directory (so the final rename stays on
 * one filesystem and is atomic on POSIX), fsync it for durability, then rename
 * over the target. On a crash / power loss the target is always either the
 * previous complete file or the new complete file — never a truncated, corrupt
 * one. This protects the user's most valuable data (`project.json`) from the
 * "saved while crashing → lost the whole project" failure mode.
 *
 * Mirrors the temp+rename pattern already used by the model catalog writer in
 * runtime.ts; that copy lives inside a 3150-line module and is left to the
 * planned runtime.ts split — new call sites should use this shared util.
 */
/** 同步睡眠（sync IPC 上下文无法 await；Atomics.wait 是 Node 主线程的标准同步等待）。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 判定和退避表的唯一一份在 sharingRetry.ts；这里转出判定，现有调用方不改。 */
export { isSharingViolation };

/**
 * 同步文件操作撞上共享冲突时按短退避重试（总预算约 400ms），之后把原错误如实抛出。
 * 文件与目录的 rename / 删除 / 读取都用这一份策略——不各自手写重试。已经在 async 函数里的调用方改用
 * sharingRetry.retryOnSharingViolationAsync（定时器退避，不睡）。
 */
export function retryOnSharingViolation<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (!isSharingViolation(error) || attempt >= SHARING_RETRY_DELAYS_MS.length) throw error;
      sleepSync(SHARING_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export function renameSyncWithRetry(from: string, to: string): void {
  retryOnSharingViolation(() => fs.renameSync(from, to));
}

export type WriteJsonFileAtomicOptions = Readonly<{
  mode?: number;
}>;

export function writeJsonFileAtomic(filePath: string, value: unknown, options: WriteJsonFileAtomicOptions = {}): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  const removeTemp = (): void => {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Preserve the originating write, close, or rename error.
    }
  };
  let fd: number;
  try {
    fd = fs.openSync(tempPath, "w", options.mode);
  } catch (error) {
    removeTemp();
    throw error;
  }
  let fileError: unknown;
  try {
    if (options.mode !== undefined) fs.fchmodSync(fd, options.mode);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncIfDurable(fd);
  } catch (error) {
    fileError = error;
  }
  try {
    fs.closeSync(fd);
  } catch (error) {
    fileError ??= error;
  }
  if (fileError !== undefined) {
    removeTemp();
    throw fileError;
  }
  try {
    renameSyncWithRetry(tempPath, filePath);
  } catch (error) {
    removeTemp();
    throw error;
  }
}

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
