import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { PROJECT_SAVE_IN_USE_ERROR_NAME } from "../shared/contracts/projectSaveFailure";
import { isSharingViolation, retryOnSharingViolationAsync, SAVE_RETRY_BUDGET_MS, saveRetryDelayMs } from "../sharingRetry";

/**
 * 保存撞上「文件被别的程序占着」（Windows 杀毒 / 同步盘，EPERM / EBUSY / EACCES）：用定时器按 50 / 100 / 200 / 400 / 800 / 1000…
 * 毫秒重排（节奏表在 sharingRetry.ts），总上限 60 秒。等待期间不占后台主线——别的请求照常响应。
 * 重排的只是「还没提交」的那一段：清单一旦写上，提交后的各步由 workspaceRepository 自己在后台补写，不回到这里。
 */
export { SAVE_RETRY_BUDGET_MS };

/** 重试满 60 秒仍是共享冲突：说清「被占用」，不是「没权限」（原错误留在 cause 上，错误码照实带着）。 */
export class ProjectSaveInUseError extends Error {
  readonly code: string | undefined;
  readonly errno: number | undefined;
  readonly syscall: string | undefined;
  constructor(cause: unknown) {
    super("Project file is held open by another program (antivirus or a sync drive); the changes are still in memory");
    this.name = PROJECT_SAVE_IN_USE_ERROR_NAME;
    const c = (cause ?? {}) as { code?: string; errno?: number; syscall?: string };
    this.code = c.code;
    this.errno = c.errno;
    this.syscall = c.syscall;
    Object.defineProperty(this, "cause", { configurable: true, value: cause });
  }
}

/** 真没权限：错误码是 EACCES / EPERM，且出错那个文件所在的目录本身就不可写——等多久也不会好，不当成占用。 */
async function isPlainWriteDenied(error: unknown): Promise<boolean> {
  const e = error as { code?: string; path?: unknown } | null;
  if (e?.code !== "EACCES" && e?.code !== "EPERM") return false;
  if (typeof e.path !== "string") return false;
  try {
    await fsp.access(path.dirname(e.path), fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

export type SaveRetryDeps = Readonly<{ wait?: (ms: number) => Promise<void>; now?: () => number }>;

export async function saveWithSharingRetry<T>(run: () => Promise<T>, deps: SaveRetryDeps = {}): Promise<T> {
  try {
    return await retryOnSharingViolationAsync(run, {
      delayMs: saveRetryDelayMs,
      budgetMs: SAVE_RETRY_BUDGET_MS,
      giveUp: isPlainWriteDenied,
      ...deps,
    });
  } catch (error) {
    // 共享冲突一路重试到预算用完：报「被占用」。真没权限（目录不可写）与其它错误原样抛出。
    if (isSharingViolation(error) && !(await isPlainWriteDenied(error))) throw new ProjectSaveInUseError(error);
    throw error;
  }
}
