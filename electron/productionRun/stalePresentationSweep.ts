import { currentPresentation } from "../shared/productionGenerationPresentation";
// 重启之后，把「上一个进程摆出去、还没人答」的那几次**出价**撤回（裁决 C，2026-09-22 二次裁决）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 「等用户点头」只活在内存里（审批闸的等待表）：进程一死，等的那个回合就没了。但盘上那份计划
// 还是「已摆出、未决」，于是重开之后面板照旧投影出一张卡——一张**没有任何人在等**的卡。用户点了
// 「生成」，钱花了，Agent 那头却没有回合接这个结果；他要是没点，它就一直挂在那儿。
//
// ── 撤回的是哪一层 ──
//
// 撤回**那一次出价**，不是那份计划：回到 draft / 未 present（`withdrawGenerationPresentation`）。
// 镜头、参数、锚点、画布上的占位一个不动；用户再说一句「生成」= 对同一份草稿重新出价。
// **不写 cancelled**——应用重启不是用户说「不」，× 才是。× 过的计划早已是终态，不在这条清扫的范围里。
//
// ── 为什么按「早于本进程启动」判，而不是「项目一打开就扫」──
//
// 清扫挂在「打开 / 切换项目」的补齐钩子上，它在一个进程里会跑很多次。本进程里摆出去的卡有人在等
// （lane 的回合挂在闸上；回合没了的那几条路——按停止 / 关窗 / 切项目——自己会撤回），
// 扫到它就是把用户正看着的卡抽走。所以判据是「这次出价发生在本进程启动之前」，不是「现在没人认领它」。

import type { ProductionRun } from "./productionRunTypes";
import { awaitingSpendDecision } from "./productionPendingSpend";

/** 本进程的启动时刻（模块装载那一刻）。测试可注入别的值。 */
export const PROCESS_STARTED_AT = new Date().toISOString();

export type StalePresentationSweepDeps = Readonly<{
  listRuns(projectId: string): readonly ProductionRun[];
  withdraw(projectId: string, operationId: string, now: string, reason: "stopped"): unknown | Promise<unknown>;
  now?(): string;
  processStartedAt?: string;
  onError?(operationId: string, error: unknown): void;
}>;

/** 返回被撤回出价的 operationId（给日志与测试看）。逐条 try/catch：一条坏账本不挡别的。 */
export async function withdrawStalePresentations(deps: StalePresentationSweepDeps, projectId: string): Promise<readonly string[]> {
  const startedAt = deps.processStartedAt ?? PROCESS_STARTED_AT;
  const withdrawn: string[] = [];
  for (const run of deps.listRuns(projectId)) {
    const awaiting = awaitingSpendDecision(run);
    if (!awaiting) continue;
    // A project-policy decision has a read-side deadline precisely because its
    // failure marker may be lost. Keep the durable card for manual recovery;
    // startup cleanup must not turn that safety net back into a disappearance.
    const presentation = currentPresentation(awaiting.plan);
    if (presentation?.policySnapshot?.mode === "project" && presentation.policyDecisionState !== "failed") continue;
    // 这一次出价开出来的那一刻；ISO 串同宽，字典序即时间序。
    const openedAt = currentPresentation(awaiting.plan)?.openedAt ?? awaiting.plan.updatedAt;
    if (openedAt.localeCompare(startedAt) >= 0) continue;
    try {
      // 问这句话的那个回合随上一个进程没了：这一次出价关成 stopped（没决定的镜记「被停」）。
      await deps.withdraw(projectId, awaiting.plan.operationId, deps.now?.() ?? new Date().toISOString(), "stopped");
      withdrawn.push(awaiting.plan.operationId);
    } catch (error) {
      deps.onError?.(awaiting.plan.operationId, error);
    }
  }
  return Object.freeze(withdrawn);
}
