/**
 * 「文件被别的程序占着」的重试策略——全仓唯一一处（P1）。
 *
 * Windows 上杀毒 / 索引器 / 同步盘会短暂开着刚写出的文件，改名 / 删除 / 硬链接立刻 EPERM / EBUSY / EACCES
 * （POSIX 上不存在）。锁通常几十毫秒内释放——graceful-fs / write-file-atomic 一类的标准解法就是短退避重试。
 * 两种形态共用同一个判定和同一套退避表：
 *
 * 1. 整份 JSON 原子读写由 `jsonFile.ts` 委托 `atomically`（异步版用定时器退避，不占事件循环）；
 *    已有成品文件/目录的覆盖改名、删除、硬链接在 `async` 函数里走 {@link retryOnSharingViolationAsync}。
 * 2. 结构上无法 await 的同步调用方（`jsonFile.retryOnSharingViolation`）共享同一份判定与总预算
 *    {@link SHARING_RETRY_BUDGET_MS}（无 `Atomics.wait`）。
 */

/** 别的进程（杀毒 / 索引器 / 同步盘）短暂开着这个文件或它下面的文件时，Windows 给的三种错误码。 */
export function isSharingViolation(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

/** 默认退避表（总预算 400ms）：同步与异步调用方的统一默认预算。 */
export const SHARING_RETRY_DELAYS_MS: readonly number[] = [10, 30, 60, 100, 200];
/** 默认退避总毫秒预算（400ms）：供 atomically 异步超时与同步单调时钟退避共用。 */
export const SHARING_RETRY_BUDGET_MS: number = SHARING_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
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
