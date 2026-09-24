import fs from "node:fs";
import path from "node:path";

import { retryOnSharingViolation } from "../jsonFile";
import { logWarn } from "../logging/logger";

/**
 * 素材已经落进项目之后的收尾清理：暂存目录、已被硬链接走的临时副本、跨盘搬运后的源文件。
 *
 * 为什么单独一处（2026-09-24 Windows 巡检）：项目文件夹在同步盘里或被杀毒扫描时，别的程序会在文件
 * 刚写出来的那一刻把它打开；Windows 上此时删文件、删目录会 EBUSY/EPERM（POSIX 允许，macOS 碰不到）。
 * 旧代码把这一步写在 `finally` 里直接 await / 直接抛，于是「素材已经好好落进项目」被一句清理错误
 * 改写成「本地素材复制失败」，用户看到的是导入失败，项目里却多了一份没人认领的文件。
 *
 * 规矩：清理失败**永远不改写**前面那一步的结果。异步清理用 Node 自带的 rm 退避重试
 * （`maxRetries` / `retryDelay`，官方就是为 Windows 这类瞬时占用准备的），同步清理用仓库唯一一份
 * `retryOnSharingViolation`；仍失败只记日志。留下的暂存目录由下一次导入按年龄回收。
 */
const RM_RETRY = { maxRetries: 5, retryDelay: 100 } as const;
export const UPLOAD_STAGING_PREFIX = ".nomi-upload-";
const ABANDONED_STAGING_AGE_MS = 10 * 60_000;

export async function removeScratchAfterUse(target: string): Promise<void> {
  try {
    await fs.promises.rm(target, { recursive: true, force: true, ...RM_RETRY });
  } catch (error) {
    logWarn("assets", "scratch-cleanup-deferred", { name: path.basename(target) }, error);
  }
}

export function removeScratchAfterUseSync(target: string): void {
  try {
    retryOnSharingViolation(() => fs.rmSync(target, { recursive: true, force: true }));
  } catch (error) {
    logWarn("assets", "scratch-cleanup-deferred", { name: path.basename(target) }, error);
  }
}

/** 进程被杀、或清理一直删不掉时留在项目根下的 `.nomi-upload-*`：超过 10 分钟没人用就收走。 */
export function reapAbandonedUploadStaging(projectRoot: string, nowMs = Date.now()): void {
  let names: string[];
  try {
    names = fs.readdirSync(projectRoot).filter((name) => name.startsWith(UPLOAD_STAGING_PREFIX));
  } catch {
    return;
  }
  for (const name of names) {
    const directory = path.join(projectRoot, name);
    try {
      if (nowMs - fs.statSync(directory).mtimeMs < ABANDONED_STAGING_AGE_MS) continue;
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // 下一次导入再收。
    }
  }
}
