/**
 * 「文件被别的程序占着」的重试策略——全仓唯一一处（P1）。
 *
 * Windows 上杀毒 / 索引器 / 同步盘会短暂开着刚写出的文件，改名 / 删除 / 硬链接立刻 EPERM / EBUSY / EACCES
 * （POSIX 上不存在）。三种形态共用同一个判定和同一套退避表：
 *
 * 1. 同步调用方（`jsonFile.retryOnSharingViolation`，结构上无法 await 的清单锁、同步 IPC 等）：原地睡着退避。
 *    这是主进程上的原地睡，所以只给「结构上只能同步」的调用方留着，随后面的存盘主人搬走。
 * 2. 保存路径：调用方**显式**传 `{ noWait: true }`（见 {@link SyncSharingRetryOptions}），同步助手不睡——立即再试一次、
 *    还不行就抛，由上层 {@link retryOnSharingViolationAsync} 用定时器重排（后台主线在等待期间照常响应别的请求）。
 *    没传的调用方行为逐字不变；不靠任何隐式上下文切换行为。
 * 3. 已经在 async 函数里的调用方：直接用 {@link retryOnSharingViolationAsync}，不睡。
 */

/** 别的进程（杀毒 / 索引器 / 同步盘）短暂开着这个文件或它下面的文件时，Windows 给的三种错误码。 */
export function isSharingViolation(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

/** 今天的同步退避表（总预算约 400ms）：同步调用方原样沿用；异步调用方默认也不短于它。 */
export const SHARING_RETRY_DELAYS_MS: readonly number[] = [10, 30, 60, 100, 200];
/** 导出改名这类「值得多等一会」的异步调用方：总预算约 2.6 秒。 */
export const SHARING_RETRY_LONG_DELAYS_MS: readonly number[] = [10, 30, 60, 100, 200, 400, 800, 1000];

/** 同步助手的选项。`noWait`：不原地睡，立即再试一次就抛——只给「上层会用定时器重排」的保存路径显式传。 */
export type SyncSharingRetryOptions = Readonly<{ noWait?: boolean }>;

/**
 * 保存撞上占用时的重排节奏：50 / 100 / 200 / 400 / 800 / 1000… 毫秒，总上限 60 秒。
 * 提交前的整段（取锁 → 读 → 写清单）和提交后各步（注册表、同步基线）的后台补写共用这一张表。
 */
export const SAVE_RETRY_BUDGET_MS = 60_000;
const SAVE_RETRY_STEPS_MS = [50, 100, 200, 400, 800] as const;
export const saveRetryDelayMs = (attempt: number): number => SAVE_RETRY_STEPS_MS[attempt] ?? 1000;

export type AsyncSharingRetryOptions = Readonly<{
  /** 第 attempt 次失败后等多久再试（attempt 从 0 起）；返回 null = 不再试。默认用 {@link SHARING_RETRY_DELAYS_MS}。 */
  delayMs?: (attempt: number) => number | null;
  /** 总预算（毫秒，从第一次失败起算）；用完仍失败就把最后一次的错如实抛出。默认不设（只看 delayMs）。 */
  budgetMs?: number;
  /** 返回 true = 这次错不用等了（比如真没权限），立刻抛。 */
  giveUp?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
  /** 测试缝。 */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}>;

/** 把一张退避表（毫秒数组）变成 `delayMs` 回调：用完就不再试。 */
export const delaysFromTable = (table: readonly number[]) => (attempt: number): number | null => table[attempt] ?? null;

const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 撞上共享冲突就用定时器退避重试整个 `operation`（可以是同步或异步函数）；不是共享冲突的错立刻抛。 */
export async function retryOnSharingViolationAsync<T>(
  operation: () => T | Promise<T>,
  options: AsyncSharingRetryOptions = {},
): Promise<T> {
  const delayMs = options.delayMs ?? ((attempt) => SHARING_RETRY_DELAYS_MS[attempt] ?? null);
  const wait = options.wait ?? defaultWait;
  const now = options.now ?? Date.now;
  let firstFailureAt: number | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isSharingViolation(error)) throw error;
      firstFailureAt ??= now();
      const delay = delayMs(attempt);
      if (delay === null) throw error;
      if (options.budgetMs !== undefined && now() - firstFailureAt + delay > options.budgetMs) throw error;
      if (await options.giveUp?.(error, attempt)) throw error;
      await wait(delay);
    }
  }
}
