import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fsyncIfDurable } from "./durability";
import { blockingWaitAllowed, isSharingViolation, SHARING_RETRY_DELAYS_MS } from "./sharingRetry";

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
/**
 * 同步睡眠：只服务「结构上无法 await」的同步调用方（清单锁、同步 IPC、同步建项目等），它们随后面的存盘主人搬走。
 * 保存热路径在 {@link runWithoutBlockingWait} 里，不会走到这里（见 sharingRetry.ts）。
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export { isSharingViolation };

/**
 * 同步文件操作撞上共享冲突时按短退避重试（总预算约 400ms），之后把原错误如实抛出。
 * 文件与目录的 rename / 删除 / 读取都用这一份策略——不各自手写重试。
 * 在 {@link runWithoutBlockingWait} 里（保存热路径）不睡：立即再试一次就抛，由上层定时器重排整次保存。
 */
export function retryOnSharingViolation<T>(operation: () => T): T {
  const delays = blockingWaitAllowed() ? SHARING_RETRY_DELAYS_MS : [0];
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (!isSharingViolation(error) || attempt >= delays.length) throw error;
      if (delays[attempt] > 0) sleepSync(delays[attempt]);
    }
  }
}

export function renameSyncWithRetry(from: string, to: string): void {
  retryOnSharingViolation(() => fs.renameSync(from, to));
}

export type WriteJsonFileAtomicOptions = Readonly<{
  mode?: number;
}>;

/** 返回刚写下的那份字节的 sha256（十六进制）：调用方要内容指纹时用它，不必再把文件整读回来。 */
export function writeJsonFileAtomic(filePath: string, value: unknown, options: WriteJsonFileAtomicOptions = {}): string {
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
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    fs.writeFileSync(fd, bytes);
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
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
