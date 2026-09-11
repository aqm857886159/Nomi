// 「有一笔生成在等你点头」的**宿主投影**（纯函数，唯一 owner）。
//
// ── 它在解决哪个真实摩擦 ──
//
// Agent 在面板里说「好，我来生成」，然后……什么也没有。草稿静静躺在 Run 里（阶段 4 之后
// 它还会落成画布上的占位节点），而「要不要花这笔钱」这个问题在**用户看得见的地方一个字都没出现**。
// 用户要么以为已经在跑了，要么得自己去画布上把每个节点点一遍。
//
// 这个文件补的就是那条数据通道：把「等人点头的那笔生成」投影成一张卡需要的全部事实。
//
// ── 两条硬约束（照抄 docs/research/2026-09-10-permission-rework-prior-art 的 1-4 / 1-5）──
//
// ① **价格是数字，不是标签**，而且必须由**宿主**算。价目住在目录的 `model.pricing` 里，
//    渲染层根本读不到；让它从 `args` 反推价格，就等于让卡自己编一个数出来。
// ② **算不出就说算不出**，绝不落成 0。三种可能（免费 / 算不出 / 真的零元）里，
//    印 0 恰好是唯一会被读成「这次不花钱」的那一种。`ShotPrice` 的 `{ known:false }` 一路带到卡上。
//
// ── 为什么只投影 `origin.host === "nomi"` 的那些 ──
//
// 外部 MCP 宿主（Claude Desktop / Codex …）那条路有它自己的确认形态（elicitation + 倒计时，
// 由另一条分支负责），它的用户此刻根本没在看 Nomi 的面板。面板里的卡只服务**面板里发生的事**。
// 把两者混在一格里，就会出现「外部客户端问的那一笔，在 Nomi 面板上等着一个永远不会来的人」。
import type { PlanCandidate } from "../capabilityCore/executionContract";
import { deriveShotPrice, type ModelPricing, type ShotPrice } from "./shotPricing";
import type { ProductionGenerationPlan, ProductionRun } from "./productionRunTypes";
import type { PendingSpendConfirm, PendingSpendShot } from "../shared/contracts/pendingSpendConfirm";

/** Agent lane 自己发起的那条路。`generationTransportAdapters` 的 `plan()` 就是这么盖的章。 */
export const IN_APP_AGENT_ORIGIN_HOST = "nomi";

export type { PendingSpendConfirm, PendingSpendShot } from "../shared/contracts/pendingSpendConfirm";

function candidatePrice(candidate: PlanCandidate, resolvePricing: PricingResolver): ShotPrice {
  return deriveShotPrice({
    candidate: { providerId: candidate.providerId, modelId: candidate.modelId, parameters: candidate.parameters ?? {} },
    resolvePricing,
  });
}

type PricingResolver = (providerId: string, modelId: string) => ModelPricing | undefined;

function shotsOf(plan: ProductionGenerationPlan, resolvePricing: PricingResolver): PendingSpendShot[] {
  const entries = (plan.shots ?? []).filter((shot) => shot.included !== false);
  const source = entries.length > 0
    ? entries.map((shot) => ({ shotId: shot.shotId, nodeId: shot.nodeId, candidate: shot.candidate }))
    : [{ shotId: plan.candidate.candidateId, nodeId: plan.nodeId, candidate: plan.candidate }];
  return source.map((entry, index) => ({
    shotId: entry.shotId,
    ...(entry.nodeId ? { nodeId: entry.nodeId } : {}),
    index: index + 1,
    prompt: entry.candidate.prompt ?? "",
    providerId: entry.candidate.providerId,
    modelId: entry.candidate.modelId,
    ...(entry.candidate.mode ? { mode: entry.candidate.mode } : {}),
    ...(entry.candidate.modeId ? { modeId: entry.candidate.modeId } : {}),
    parameters: { ...(entry.candidate.parameters ?? {}) },
    price: candidatePrice(entry.candidate, resolvePricing),
  }));
}

/**
 * 这个 Run 里有没有一笔「等人点头」的生成？没有 → `undefined`（那时面板上一张卡都不该出现）。
 *
 * 刻意**不**投影 `submitted` / `cancelled`：那两档已经不是「等你决定」了，
 * 它们各有自己的界面（任务卡 / 收据行），再出一张确认卡就是在问一个已经答过的问题。
 */
export function projectPendingSpendConfirm(
  run: ProductionRun,
  resolvePricing: PricingResolver,
): PendingSpendConfirm | undefined {
  if (run.origin.host !== IN_APP_AGENT_ORIGIN_HOST) return undefined;
  const plan = run.generationPlan;
  if (!plan) return undefined;
  let gateId: string | undefined;
  if (plan.state === "sealed") {
    const gate = run.gates.find((candidate) => candidate.gateId === plan.authorizationGateId);
    // 封印了却没有一道在等的门 = 这笔已经被决定过了，不该再问一次。
    if (!gate || gate.status !== "waiting") return undefined;
    gateId = gate.gateId;
  } else if (plan.state !== "draft") {
    return undefined;
  }
  const shots = shotsOf(plan, resolvePricing);
  if (shots.length === 0) return undefined;
  const knownSubtotal = shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0);
  return Object.freeze({
    projectId: run.projectId,
    runId: run.runId,
    operationId: plan.operationId,
    planVersion: run.planVersion,
    candidateRevision: plan.candidate.revision,
    ...(gateId ? { gateId } : {}),
    currency: run.budget.currency,
    shots: Object.freeze(shots),
    knownSubtotal,
    unknownShotCount: shots.filter((shot) => !shot.price.known).length,
  });
}

/**
 * 一个项目里所有等人点头的那些。**只出一张卡**是产品裁决（定稿 ⑤：介入槽同时只显示一张），
 * 所以这里按 `updatedAt` 升序返回，调用方取第一条、把 `length` 当「还有 N 条」。
 */
export function listPendingSpendConfirms(
  runs: readonly ProductionRun[],
  resolvePricing: PricingResolver,
): readonly PendingSpendConfirm[] {
  return Object.freeze(
    runs
      .slice()
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((run) => projectPendingSpendConfirm(run, resolvePricing))
      .filter((value): value is PendingSpendConfirm => Boolean(value)),
  );
}
