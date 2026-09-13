import fs from "node:fs";
import path from "node:path";
import {
  PROVIDER_ADAPTER_STORE_LOCK_LEASE_MS,
  isTerminalAdapterStage,
  providerAdapterStorePath,
} from "./store";
import type { AdapterModeResult, ProviderAdapterRun } from "./types";

/**
 * 「状态机不许停在中间态」——这条不变量归本模块管。
 *
 * 2026-09-11 真机实证的死锁：某模型验证失败 → `finishWithError` 写盘 → 文件租约锁 3s 自旋
 * 拿不到 → 抛异常 → 而 `process()` 是 fire-and-forget，没人 catch → run 永久停在 `certifying`、
 * cancel 被拒、错误原文丢失，只有重启 app 才转 failed。
 *
 * 根因不是锁，是**失败路径与主路径不等强**：主路径的失败可以进 catch，catch 自己的失败无人兜底。
 * 本模块把「终态写一定要落地」做成三层，层层都是**会响的**检测器，不是静默兜底：
 *   1. 同步直写（绝大多数情况一次就成）
 *   2. 失败 → 异步指数退避重试，总预算**必须长过锁租约 TTL**（见下面的不变量）
 *   3. 仍失败 → append-only `provider-adapters.errors.jsonl`，启动时补偿扫描强制终态化
 * 外加一个 reaper：任何非终态且已过 deadline 的 run，每 30s 强制 `timed_out`。
 */

/**
 * 为什么退避总预算必须 > 锁租约 TTL：
 *
 * `ProviderAdapterStore.mutate` 是**全同步**的，所以同一个进程里两次 mutate 永远不会交错——
 * 「锁被占」只可能是别的进程持有，或者某个进程被 kill 之后**留下了还没到期的租约**。
 * 租约 TTL 是 30s（store 里的 `leaseMs`），`reclaimExpired` 要等它过期才接管。
 * 原来的 3s 自旋窗口**结构上不可能**熬过一个 30s 的陈旧租约——每一次终态写都必然超时。
 * 这就是那次死锁的直接原因：不是「锁偶尔慢」，是「等待上限短于租约上限」。
 *
 * 所以退避预算与租约 TTL 的大小关系是一条可机检的不变量，写死在这里并在构造时断言。
 */
export const TERMINAL_WRITE_BACKOFF_MS: readonly number[] = [3_000, 6_000, 12_000, 24_000];

export function terminalWriteBudgetMs(backoff: readonly number[] = TERMINAL_WRITE_BACKOFF_MS): number {
  return backoff.reduce((total, step) => total + step, 0);
}

export function assertTerminalWriteOutlastsLease(
  backoff: readonly number[] = TERMINAL_WRITE_BACKOFF_MS,
  leaseMs: number = PROVIDER_ADAPTER_STORE_LOCK_LEASE_MS,
): void {
  const budget = terminalWriteBudgetMs(backoff);
  if (budget <= leaseMs)
    throw new Error(
      `Terminal write retry budget (${budget}ms) must outlast the store lock lease (${leaseMs}ms); `
        + "a shorter budget can never outlive a stale lease and the run would stay non-terminal.",
    );
}

/**
 * 记录这一族的日志**绝不能反过来毁掉失败路径本身**。
 * 实测栽过：`logError` 在非 Electron 宿主（vitest）里拿不到 `app` 会抛，
 * 而它正好被写在 `executeRun` 的 catch 里——于是「兜住失败」的那只手自己把 promise 又拒了一次，
 * 变回本 PR 要消灭的那个未处理 rejection。观测是辅助，不许成为新的失败源。
 */
export function neverThrows(record: () => void): void {
  try { record(); } catch { /* observability must never break the failure path */ }
}

export type TerminalWriteFailure = {
  schemaVersion: 1;
  runId: string;
  stage: ProviderAdapterRun["stage"];
  message: string;
  recordedAt: string;
  /** 最后一次写盘失败的原因（脱敏后的字符串），给人看的，不参与判断。 */
  writeError: string;
};

export function terminalErrorJournalPath(storePath = providerAdapterStorePath()): string {
  return `${storePath}.errors.jsonl`;
}

/** Append-only：这条旁路存在的前提就是「主存写不进去」，所以它绝不能也走同一把锁。 */
export function appendTerminalWriteFailure(journalPath: string, entry: TerminalWriteFailure): void {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.appendFileSync(journalPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function readTerminalWriteFailures(journalPath: string): TerminalWriteFailure[] {
  let raw: string;
  try {
    raw = fs.readFileSync(journalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const entries: TerminalWriteFailure[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as TerminalWriteFailure;
      // 半行（写到一半断电）只跳过这一行，不让整条旁路作废。
      if (parsed && typeof parsed.runId === "string" && parsed.runId) entries.push(parsed);
    } catch { /* a torn trailing line is expected on an append-only journal */ }
  }
  return entries;
}

/** 补偿成功后把这些 run 的条目划掉；重写整份文件（它按定义很短）。 */
export function dropTerminalWriteFailures(journalPath: string, runIds: readonly string[]): void {
  if (!runIds.length) return;
  const remaining = readTerminalWriteFailures(journalPath).filter((entry) => !runIds.includes(entry.runId));
  if (!remaining.length) {
    try { fs.rmSync(journalPath, { force: true }); } catch { /* journal is best-effort bookkeeping */ }
    return;
  }
  fs.writeFileSync(journalPath, `${remaining.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

export type TerminalWriteGuaranteeDeps = {
  /** 真正把 run 写成终态的那一下；抛错 = 这一轮没写成。 */
  write: (runId: string, stage: ProviderAdapterRun["stage"], message: string) => void;
  /** 读当前 run，用来判断「是不是已经有人写成终态了」。 */
  read: (runId: string) => ProviderAdapterRun | undefined;
  /**
   * 旁路日志的落点。允许传一个函数：默认路径要读 settings root，而 store 的默认构造
   * 发生在**任何**宿主里（含测试与工具进程）——构造期就去解析它等于把一条只在
   * 「写盘失败」时才需要的路径变成所有人的启动依赖。按需解析。
   */
  journalPath: string | (() => string);
  now?: () => string;
  backoffMs?: readonly number[];
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onGiveUp?: (entry: TerminalWriteFailure) => void;
  /** run 终态化的同时掐掉它还在飞的那一步（AbortController）。 */
  abort?: (runId: string) => void;
};

/**
 * 一个 run 一条重试链。`settle` 保证「要么 run 变成终态，要么 errors.jsonl 里留下一条」，
 * 两者都不发生是不允许的状态——这就是本模块要钉死的那条不变量。
 */
export class TerminalWriteGuarantee {
  private readonly backoff: readonly number[];
  private readonly now: () => string;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly pendingTimers = new Map<string, unknown>();
  private readonly settled = new Map<string, Promise<void>>();

  private get journalPath(): string {
    return typeof this.deps.journalPath === "function" ? this.deps.journalPath() : this.deps.journalPath;
  }

  constructor(private readonly deps: TerminalWriteGuaranteeDeps) {
    this.backoff = deps.backoffMs ?? TERMINAL_WRITE_BACKOFF_MS;
    assertTerminalWriteOutlastsLease(this.backoff);
    this.now = deps.now ?? (() => new Date().toISOString());
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /**
   * 同步试一次；成功就结束。失败才排进异步退避链（**不阻塞主线程**——原来的做法是
   * `Atomics.wait` 同步自旋，把 Electron 主进程一起冻住，既救不了锁又卡住界面）。
   */
  settle(runId: string, stage: ProviderAdapterRun["stage"], message: string): Promise<void> {
    // 终态一旦定下，还在飞的那一步就没有意义了——先掐，再谈写盘成不成功。
    this.deps.abort?.(runId);
    let firstError: unknown;
    try {
      this.deps.write(runId, stage, message);
      return Promise.resolve();
    } catch (error) {
      firstError = error;
    }
    const existing = this.settled.get(runId);
    if (existing) return existing;
    const chain = this.retryChain(runId, stage, message, firstError).finally(() => {
      this.settled.delete(runId);
      this.pendingTimers.delete(runId);
    });
    this.settled.set(runId, chain);
    return chain;
  }

  /** 启动补偿：旁路里还躺着的 run，只要还没终态就再写一次。 */
  compensate(): { repaired: string[]; stillFailing: string[] } {
    const repaired: string[] = [];
    const stillFailing: string[] = [];
    const journalPath = this.journalPath;
    for (const entry of readTerminalWriteFailures(journalPath)) {
      const current = this.deps.read(entry.runId);
      if (!current || isTerminalAdapterStage(current.stage)) {
        repaired.push(entry.runId);
        continue;
      }
      try {
        this.deps.write(entry.runId, entry.stage, entry.message);
        repaired.push(entry.runId);
      } catch {
        stillFailing.push(entry.runId);
      }
    }
    dropTerminalWriteFailures(journalPath, repaired);
    return { repaired, stillFailing };
  }

  /** 等所有在飞的重试链跑完。测试用它拿确定性，不靠墙钟轮询（R18）。 */
  flush(): Promise<void> {
    return Promise.all([...this.settled.values()]).then(() => undefined);
  }

  /** 关停时别把定时器留在 event loop 上（测试里会拖住进程）。 */
  dispose(): void {
    for (const handle of this.pendingTimers.values()) this.clearTimer(handle);
    this.pendingTimers.clear();
  }

  private async retryChain(
    runId: string,
    stage: ProviderAdapterRun["stage"],
    message: string,
    firstError: unknown,
  ): Promise<void> {
    let lastError = firstError;
    for (const delayMs of this.backoff) {
      await new Promise<void>((resolve) => {
        this.pendingTimers.set(runId, this.setTimer(resolve, delayMs));
      });
      // 读也可能抛（盘被删/权限变了）；读不到就当「还没终态」继续重试，别让读失败终结这条链。
      let current: ProviderAdapterRun | undefined;
      try { current = this.deps.read(runId); } catch { current = undefined; }
      // 别人（reaper / 另一个进程 / cancel）已经写成终态了：目标达成，收工。
      if (current && isTerminalAdapterStage(current.stage)) return;
      try {
        this.deps.write(runId, stage, message);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    const entry: TerminalWriteFailure = {
      schemaVersion: 1,
      runId,
      stage,
      message,
      recordedAt: this.now(),
      writeError: lastError instanceof Error ? lastError.message : String(lastError),
    };
    try {
      appendTerminalWriteFailure(this.journalPath, entry);
    } catch (journalError) {
      // 旁路自己也写不进去（盘满/只读）。这条链到此为止，但**必须响**：
      // 交给 onGiveUp 去打日志，绝不能变成一个 unhandled rejection 悄悄消失——
      // 那正是这次要修的那个 bug 的形状。
      this.deps.onGiveUp?.({ ...entry, writeError: `${entry.writeError} (journal write failed: ${journalError instanceof Error ? journalError.message : String(journalError)})` });
      return;
    }
    this.deps.onGiveUp?.(entry);
  }
}

export type TerminalReaperDeps = {
  /** 当前所有非终态的 run。 */
  activeRuns: () => readonly ProviderAdapterRun[];
  /** 把这个 run 强制终态化（服务层的 finishTerminal）。 */
  forceTimeout: (runId: string, message: string) => void;
  now: () => string;
  intervalMs?: number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export const TERMINAL_REAPER_INTERVAL_MS = 30_000;

/**
 * 看门狗：deadline 过了还非终态的 run，强制 `timed_out`。
 * 这是「不许停在中间态」的最后一道；它**不吞任何东西**——被它收掉的 run 会带着
 * 明确的超时理由出现在会话里，用户和驱动 Agent 都看得见。
 */
export class TerminalReaper {
  private handle: unknown;

  constructor(private readonly deps: TerminalReaperDeps) {}

  start(): void {
    if (this.handle !== undefined) return;
    const every = this.deps.setInterval ?? ((callback, ms) => setInterval(callback, ms));
    this.handle = every(() => this.sweep(), this.deps.intervalMs ?? TERMINAL_REAPER_INTERVAL_MS);
    (this.handle as { unref?: () => void })?.unref?.();
  }

  stop(): void {
    if (this.handle === undefined) return;
    const cancel = this.deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    cancel(this.handle);
    this.handle = undefined;
  }

  sweep(): string[] {
    const at = Date.parse(this.deps.now());
    const reaped: string[] = [];
    for (const run of this.deps.activeRuns()) {
      if (isTerminalAdapterStage(run.stage)) continue;
      if (!run.deadlineAt || Date.parse(run.deadlineAt) > at) continue;
      reaped.push(run.id);
      this.deps.forceTimeout(run.id, "Adapter run deadline expired; the watchdog closed it out");
    }
    return reaped;
  }
}

/**
 * 把一个非终态 run 写成终态失败的那一下。抽成自由函数是为了让
 * `ProviderAdapterService` 只保留「什么时候终态化」的编排，「怎么终态化」住在这里，
 * 也让 `TerminalWriteGuarantee` 的重试链和服务层调的是**同一份**实现（没有第二条路）。
 */
export function writeAdapterTerminalFailure(input: {
  store: {
    getRun: (id: string) => ProviderAdapterRun | undefined;
    upsertRun: (run: ProviderAdapterRun) => ProviderAdapterRun;
  };
  catalogFail: (run: ProviderAdapterRun) => void;
  buildRun: (input: {
    existing: ProviderAdapterRun;
    stage: ProviderAdapterRun["stage"];
    error: string;
    failureStage: AdapterModeResult["stage"];
    finishedAt: string;
  }) => ProviderAdapterRun;
  redact: (message: string) => string;
  now: () => string;
  id: string;
  stage: ProviderAdapterRun["stage"];
  message: string;
}): ProviderAdapterRun | undefined {
  const existing = input.store.getRun(input.id);
  if (!existing || isTerminalAdapterStage(existing.stage)) return existing;
  const failureStage: AdapterModeResult["stage"] = existing.stage === "discovering_docs"
    ? "docs"
    : existing.stage === "compiling"
      ? "compile"
      : existing.stage === "testing"
        // 自检失败停在「凭据」那一段。`verify_asset` 从 2026-09-11 起只留给本地 ComfyUI 候选
        // 那条免费的真实产物校验（types.ts:160）——HTTP 供应商这条路已经不发真实生成了。
        ? "credential"
        : "promote";
  const run = input.buildRun({
    existing,
    stage: input.stage,
    error: input.redact(input.message),
    failureStage,
    finishedAt: input.now(),
  });
  input.catalogFail(run);
  input.store.upsertRun(run);
  return run;
}

/**
 * 一次装好「终态保证 + 看门狗」两件套。服务层只给它四个钩子，
 * 剩下的接线（旁路日志路径、退避档位、放弃时怎么响）都住在本模块。
 */
export function createTerminalMachinery(hooks: {
  write: (runId: string, stage: ProviderAdapterRun["stage"], message: string) => void;
  read: (runId: string) => ProviderAdapterRun | undefined;
  activeRuns: () => readonly ProviderAdapterRun[];
  forceTimeout: (runId: string, message: string) => void;
  now: () => string;
  log: (entry: TerminalWriteFailure) => void;
  abort: (runId: string) => void;
  /** 测试注入档（服务层直接把它的 dependencies 递进来，不用逐个挑）。 */
  options?: {
    terminalErrorJournalPath?: string;
    terminalWriteBackoffMs?: readonly number[];
    terminalWriteTimer?: (callback: () => void, ms: number) => unknown;
    reaperIntervalMs?: number;
  };
}): { guarantee: TerminalWriteGuarantee; reaper: TerminalReaper } {
  const journalPath = hooks.options?.terminalErrorJournalPath;
  const backoffMs = hooks.options?.terminalWriteBackoffMs;
  const reaperIntervalMs = hooks.options?.reaperIntervalMs;
  return {
    guarantee: new TerminalWriteGuarantee({
      write: hooks.write,
      read: hooks.read,
      journalPath: journalPath ?? (() => terminalErrorJournalPath()),
      now: hooks.now,
      ...(backoffMs ? { backoffMs } : {}),
      ...(hooks.options?.terminalWriteTimer ? { setTimer: hooks.options.terminalWriteTimer } : {}),
      onGiveUp: hooks.log,
      abort: hooks.abort,
    }),
    reaper: new TerminalReaper({
      activeRuns: hooks.activeRuns,
      forceTimeout: hooks.forceTimeout,
      now: hooks.now,
      ...(reaperIntervalMs ? { intervalMs: reaperIntervalMs } : {}),
    }),
  };
}
