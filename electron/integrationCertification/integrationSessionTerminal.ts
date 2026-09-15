import { PROVIDER_ADAPTER_BATCH_TIMEOUT_MS } from "../providerAdapter/serviceLifecycle";
import {
  TERMINAL_REAPER_INTERVAL_MS,
  TerminalReaper,
  terminalWriteBudgetMs,
} from "../providerAdapter/terminalGuarantee";
import { INTEGRATION_STAGES, type IntegrationStage } from "../shared/integrationContract";

/**
 * 「每个接入会话都在有限时间内落终态，cancel 在任何非终态都可达」——这条不变量归
 * **会话层**（`IntegrationSessionService`）管，本模块是它的实现。
 *
 * 为什么会话层需要自己的一份，而不是继续借 run 的：
 * 2026-09-11 真机死锁之后，`providerAdapter/terminalGuarantee.ts` 把 **run** 的终态保证做齐了
 * （退避重试 + errors.jsonl 旁路 + 看门狗）。会话层却是**借**那份保证的——
 * `syncHttpCertification` 只在「会话是 http-api-provider 且已经拿到 childRunRef 且那个 run
 * 还在盘上」时才跟着 run 走。三种状态从借来的保证下面漏下去，每一种都复现过：
 *   1. `comfyui-workflow` 会话：本地那条**免费**自检压根不走 `ProviderAdapterService.process()`，
 *      从头到尾没有 run 可借。
 *   2. `http-api-provider` 会话在「`certifying` 意图已落盘、`startHttp` 还没返回」这个窗口里
 *      被打断（进程死 / 上游吊死）：盘上 `certifying`、没有 childRunRef。
 *   3. run 记录已被 `deleteRunsForVendors` 删掉（连接被删）而会话还引用着它。
 * 三种里 `cancel` 都直接抛 `Cannot cancel certification in progress`，于是用户和驱动 Agent
 * 双双没有出口——正是「接入验证一直转然后全部失败、只能重启 app」那条投诉的形状。
 *
 * 本模块只做两件事，都是**会响的**，不是静默兜底：
 *   - 给每个进入 `certifying` 的会话一个落盘的 deadline，并用**同一只**看门狗
 *     （`TerminalReaper`，run 层那只）把过期的非终态会话收成 `failed`，理由写明。
 *   - 把「放弃本地会话」从「撤销远端」里拆出来：cancel 永远可达，撤不掉的如实标注。
 */

/** 会话层的终态词表。run 层的那份在 `store.isTerminalAdapterStage`，两边各管自己的状态机。 */
const TERMINAL_INTEGRATION_STAGES: ReadonlySet<string> = new Set<string>(
  INTEGRATION_STAGES.filter((stage) => ["completed", "partial", "failed", "cancelled"].includes(stage)),
);

export function isTerminalIntegrationStage(stage: string): boolean {
  return TERMINAL_INTEGRATION_STAGES.has(stage);
}

/** 会话中间态：这两个阶段之外的阶段都在等人动手，等多久都不算卡死。 */
export function isCertifyingIntegrationStage(stage: string): stage is IntegrationStage {
  return stage === "certifying" || stage === "committing";
}

/**
 * 会话的认证 deadline 必须**长过**它下面那条 run 把自己收干净所需的全部时间，
 * 否则会话看门狗会在 run 还有合法机会收敛时先把会话判死——那是拿一个假失败换一个真卡死，
 * 而且两层会给出互相矛盾的结论（会话 failed、run 随后 completed）。
 *
 * run 收干净最坏需要：批次 deadline（5min）＋ 终态写退避预算（45s）＋ 看门狗一个周期（30s）。
 * 所以会话 deadline 从这三项**派生**，不是拍一个数字（09-10 用户退回过 #690 那种改常量的修法）。
 */
export const INTEGRATION_CERTIFYING_DEADLINE_MS = 10 * 60_000;

export function runSettlementCeilingMs(
  batchTimeoutMs: number = PROVIDER_ADAPTER_BATCH_TIMEOUT_MS,
): number {
  return batchTimeoutMs + terminalWriteBudgetMs() + TERMINAL_REAPER_INTERVAL_MS;
}

export function assertSessionDeadlineOutlastsRunSettlement(
  sessionDeadlineMs: number = INTEGRATION_CERTIFYING_DEADLINE_MS,
  batchTimeoutMs: number = PROVIDER_ADAPTER_BATCH_TIMEOUT_MS,
): void {
  const ceiling = runSettlementCeilingMs(batchTimeoutMs);
  if (sessionDeadlineMs <= ceiling)
    throw new Error(
      `Integration session certification deadline (${sessionDeadlineMs}ms) must outlast the child run's `
        + `settlement ceiling (${ceiling}ms = batch ${batchTimeoutMs} + terminal write ${terminalWriteBudgetMs()} `
        + `+ reaper ${TERMINAL_REAPER_INTERVAL_MS}); a shorter deadline fails the session while the run can still succeed.`,
    );
}

export function integrationCertifyingDeadlineAt(
  startedAt: string,
  budgetMs: number = INTEGRATION_CERTIFYING_DEADLINE_MS,
): string {
  assertSessionDeadlineOutlastsRunSettlement(budgetMs);
  return new Date(Date.parse(startedAt) + budgetMs).toISOString();
}

export type ReapableIntegrationSession = {
  id: string;
  stage: string;
  certifyingDeadlineAt?: string;
};

/**
 * 会话层的看门狗。**复用 run 层那只 `TerminalReaper`**（只换一把「什么算终态」的尺子和
 * 一句理由），因为「非终态 + deadline 已过 → 强制终态」在两层是同一条判据；
 * 各写一只就等于同一条不变量有两份判据，日后只会改到其中一份。
 */
export function createIntegrationSessionReaper(hooks: {
  activeSessions: () => readonly ReapableIntegrationSession[];
  forceTimeout: (sessionId: string) => void;
  now: () => string;
  intervalMs?: number;
}): TerminalReaper {
  return new TerminalReaper({
    activeRuns: () =>
      hooks.activeSessions().map((session) => ({
        id: session.id,
        stage: session.stage,
        ...(session.certifyingDeadlineAt ? { deadlineAt: session.certifyingDeadlineAt } : {}),
      })),
    isTerminal: isTerminalIntegrationStage,
    forceTimeout: (sessionId) => hooks.forceTimeout(sessionId),
    now: hooks.now,
    ...(hooks.intervalMs ? { intervalMs: hooks.intervalMs } : {}),
    timeoutMessage: "Integration session certification deadline expired; the watchdog closed it out",
  });
}
