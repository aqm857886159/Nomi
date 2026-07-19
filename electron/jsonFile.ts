import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

/**
 * Windows 文件锁重试（EPERM/EBUSY/EACCES）：rename 覆盖目标时，目标/临时文件可能被杀毒实时
 * 扫描、搜索索引器、云同步或并行实例短暂持有 → rename 立刻 EPERM（POSIX 上不存在此问题）。
 * 锁通常几十毫秒内释放——graceful-fs / write-file-atomic 的标准解法就是短退避重试。
 * 高频写场景（模型启停连点、批量 upsert）撞锁概率高，重试把它从「用户看到操作失败」
 * 变成「几十毫秒内静默成功」；真持锁不放（>~400ms）才把原错误如实抛出。
 */
const RENAME_RETRY_DELAYS_MS = [10, 30, 60, 100, 200];

export function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      const retriable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!retriable || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
      sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tempPath, "w");
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    renameSyncWithRetry(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // best-effort cleanup; surface the original rename error below
    }
    throw error;
  }
}

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
