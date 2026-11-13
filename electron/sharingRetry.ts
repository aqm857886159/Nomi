/**
 * 「文件被别的程序占着」的重试策略——全仓唯一一处（P1）。
 *
 * Windows 上杀毒 / 索引器 / 同步盘会短暂开着刚写出的文件，改名 / 删除 / 硬链接立刻 EPERM / EBUSY / EACCES
 * （POSIX 上不存在）。锁通常几十毫秒内释放——graceful-fs / write-file-atomic 一类的标准解法就是短退避重试。
 * 两种形态共用同一个判定和同一套退避表：
 *
 * 1. 同步调用方（`jsonFile.retryOnSharingViolation`，结构上无法 await 的保存事务、清单锁、同步 IPC 等）：
 *    在主进程上原地睡着退避。这是已知的冻结，留给「把保存搬出主进程」那一刀解决（方向检查 2026-11-13-main-thread-sync-wait）。
 * 2. 已经在 async 函数里的调用方：用 {@link retryOnSharingViolationAsync}，定时器退避，不睡。
 */

/** 别的进程（杀毒 / 索引器 / 同步盘）短暂开着这个文件或它下面的文件时，Windows 给的三种错误码。 */
export function isSharingViolation(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

/** 默认退避表（总预算约 400ms）：同步助手用它；异步调用方不另给就也用它。 */
export const SHARING_RETRY_DELAYS_MS: readonly number[] = [10, 30, 60, 100, 200];
/** 导出改名这类「值得多等一会」的异步调用方：总预算约 2.6 秒。 */
export const SHARING_RETRY_LONG_DELAYS_MS: readonly number[] = [10, 30, 60, 100, 200, 400, 800, 1000];

export type AsyncSharingRetryOptions = Readonly<{
  /** 第 attempt 次失败后等多久再试（attempt 从 0 起）；返回 null = 不再试。默认用 {@link SHARING_RETRY_DELAYS_MS}。 */
  delayMs?: (attempt: number) => number | null;
  /** 测试缝。 */
  wait?: (ms: number) => Promise<void>;
}>;

/** 把一张退避表（毫秒数组）变成 `delayMs` 回调：用完就不再试。 */
export const delaysFromTable = (table: readonly number[]) => (attempt: number): number | null => table[attempt] ?? null;

const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 撞上共享冲突就用定时器退避重试整个 `operation`（可以是同步或异步函数）；不是共享冲突的错立刻抛，退避用完把最后一次的错如实抛出。 */
export async function retryOnSharingViolationAsync<T>(
  operation: () => T | Promise<T>,
  options: AsyncSharingRetryOptions = {},
): Promise<T> {
  const delayMs = options.delayMs ?? delaysFromTable(SHARING_RETRY_DELAYS_MS);
  const wait = options.wait ?? defaultWait;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isSharingViolation(error)) throw error;
      const delay = delayMs(attempt);
      if (delay === null) throw error;
      await wait(delay);
    }
  }
}
