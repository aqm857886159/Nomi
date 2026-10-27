import { spendAuthorizationGates } from "../shared/productionSpendAuthority";
// 付费卡上「这一次出价」的写法（2026-09-30 付费卡逐镜；D2 第③步加交接）：摆出来、去掉 / 恢复一镜、交给画布、关掉、
// 全决定了自己关。判据（哪几镜没决定、能摆哪几镜、交接到哪一步）住在 `electron/shared/productionGenerationPresentation.ts`，
// 这里只写。命令（generation.present / generation.shot.remove / generation.shot.restore / generation.handover /
// generation.handover.bind / generation.handover.settle / generation.withdraw）与仓库写入口的收尾（settlePresentation）
// 共用这一份手法，reducer 只转进来。交接三条只走主进程（渲染层的命令白名单里没有它们）。
import { currentOfferFrom, resolveUndecidedGenerationShotScope } from "../shared/agentCapabilities/generationShotScope";
import {
  currentPresentation,
  generationPresentationOutcome,
  handOverOfCanvasRun,
  offerShots,
  planShotIds,
  presentationIsOpen,
  presentationResolved,
  projectPolicyDecisionDeadlineFromOwnerClock,
  resolvedCloser,
  shotEverSent,
  standingShotIds,
} from "../shared/productionGenerationPresentation";
import type { ProductionCommandEffect } from "./productionRunReducer";
import { hasUnsettledLiability, revokeWaitingAndUnseal, unsealedGenerationPlanFields } from "./productionGenerationPlanEdits";
import {
  GENERATION_HAND_OVER_OUTCOMES,
  type GenerationHandOver,
  type GenerationHandOverOutcome,
  type GenerationHandOverSettlement,
  type GenerationPresentation,
  type GenerationPresentationCloser,
  type ProductionGenerationPlan,
  type ProductionRun,
} from "./productionRunTypes";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";

const CLOSERS: ReadonlySet<GenerationPresentationCloser> = new Set(["resolved", "user_closed", "user_wrote", "stopped"]);

/** 命令里带来的关卡原因；认不出的一律当成 × 的那一种（用户关的）。 */
export function parsePresentationCloser(value: unknown): GenerationPresentationCloser {
  return typeof value === "string" && CLOSERS.has(value as GenerationPresentationCloser)
    ? value as GenerationPresentationCloser
    : "user_closed";
}

/**
 * 关掉这一次出价（收回 / 被下一次出价顶掉 / 全决定了）。每一条关卡的路都经这里，所以「交出去、还没绑上画布那一份同意的镜」
 * 也只在这里收尾：出价一关它就再也绑不上（`bindHandOvers` 拒），当场记成收回——一下都没交。已经绑上、还没轮到的归画布那一侧
 * （账本的变更订阅 `withdrawQueuedHandOvers` 当场收回同意），已经在交的照常交完、把结论写回它自己那一笔。
 */
function closeCurrent(plan: ProductionGenerationPlan, now: string, by: GenerationPresentationCloser): ProductionGenerationPlan {
  const presentations = plan.presentations ?? [];
  const current = presentations.at(-1);
  if (!current || current.closed) return plan;
  const withdrawnBy = by === "resolved" || by === "handed_to_canvas" ? "user_closed" : by;
  const handOvers = current.handOvers?.map((entry): GenerationHandOver => entry.settled || entry.canvasRunId ? entry
    : { ...entry, settled: { at: now, outcome: "withdrawn", withdrawnBy } });
  return { ...plan, presentations: [...presentations.slice(0, -1), { ...current, ...(handOvers ? { handOvers } : {}), closed: { at: now, by } }], updatedAt: now };
}

/**
 * 这一次出价摆哪几镜（`generate` 动词）。规则只有一条 `resolveUndecidedGenerationShotScope`（2026-10-27 用户拍板）：
 *   · 点名了（`shotIds`）→ 就是这几镜（计划里任何一镜，重试照常）；
 *   · 没点名 → 最近一张卡（开着或已关）上还没定、还勾在这一批里的镜；从没出过价 = 勾着、没送过、没去掉过的；
 *   · 一镜不剩 → 拒（`generation_input_invalid`，正文逐镜说状态、给下一步），不回退成「整份再来一轮」。
 * 摆的镜里只要有一镜送过（或者这是一份被删掉的草稿），就必须等之前的每一笔都落定（`hasUnsettledLiability`）：一次新出价
 * 不许把一笔结果未知的提交盖掉。没送过的镜可以在别的镜还在跑的时候摆出来。
 */
function presentationScope(run: ProductionRun, requested: unknown): string[] {
  const plan = run.generationPlan!;
  const ids = planShotIds(plan);
  const outcome = generationPresentationOutcome(run);
  const scope = resolveUndecidedGenerationShotScope({
    door: "present", planShotIds: ids, requested, currentOffer: currentOfferFrom(outcome),
    offerable: outcome
      ? ids.filter((shotId) => plan.shots?.find((shot) => shot.shotId === shotId)?.included !== false)
      : standingShotIds(run).filter((shotId) => !shotEverSent(run, shotId)),
  });
  // 用户删掉的草稿（cancelled）重新摆出来，同样要等之前的每一笔都落定。
  if ((plan.state === "cancelled" || scope.some((shotId) => shotEverSent(run, shotId))) && hasUnsettledLiability(run)) {
    throw Object.assign(new Error("generation_reconciliation_required: a previous attempt for these shots is unsettled or in flight"),
      { code: "generation_reconciliation_required" });
  }
  return scope;
}

/**
 * `generate` 动词：把这一次出价摆到用户面前（摆哪几镜见 `presentationScope`）。上一次出价还开着 → 被这一次取代（关成 stopped）；
 * 一次没点完、还在等人的授权先撤掉。之前的每一笔都落定了 → 这是一次新的请求（计划与 Run 回到草稿，整份解封，点了再开跑）；
 * 还有镜在路上 → 只解封这一次摆的镜，在路上的照常跑。每一次出价换一个报价身份（planVersion + 1）。
 */
export function presentGenerationPlan(current: ProductionRun, requested: unknown, now: string, policySnapshot?: ProjectAgentApprovalPolicy): ProductionRun {
  if (!current.generationPlan) throw new Error("Generation plan not found");
  let run = revokeWaitingAndUnseal(current, now, "Present");
  const scope = presentationScope(run, requested);
  const reopened = run.generationPlan!;
  const superseded = closeCurrent(reopened, now, "stopped");
  const inScope = new Set(scope);
  const settled = !hasUnsettledLiability(run);
  const base = settled ? unsealedGenerationPlanFields(superseded, now) : superseded;
  const generationPlan: ProductionGenerationPlan = {
    ...base,
    ...(base.state === "cancelled" ? { state: "draft" as const } : {}),
    candidate: base.shots?.find((shot) => inScope.has(shot.shotId))?.candidate ?? base.candidate,
    ...(base.shots
      ? { shots: base.shots.map((shot) => inScope.has(shot.shotId)
          ? { ...shot, included: true, contract: undefined, candidate: { ...shot.candidate, sealedContractHash: undefined }, updatedAt: now }
          : shot) }
      : {}),
    presentations: [...(superseded.presentations ?? []), {
      presentationId: `${run.runId}:presentation:${(superseded.presentations?.length ?? 0) + 1}`,
      presentationEpoch: (superseded.presentations?.at(-1)?.presentationEpoch ?? superseded.presentations?.length ?? 0) + 1,
      ...(policySnapshot ? { policySnapshot: structuredClone(policySnapshot) } : {}),
      ...(policySnapshot?.mode === "direct" ? {
        policyDecisionState: "pending" as const,
        ...(projectPolicyDecisionDeadlineFromOwnerClock(now) ? { policyDecisionDeadlineAt: projectPolicyDecisionDeadlineFromOwnerClock(now) } : {}),
      } : {}),
      shotIds: scope, openedAt: now, fromGate: spendAuthorizationGates(run).length,
    }],
    updatedAt: now,
  };
  run = {
    ...run,
    // 前面的活都落定了、又摆出新的一次：这是一次新的请求（Run 回到草稿，点了再开跑）。还有活在跑就不动它的状态。
    ...(settled && (current.generationPlan.state === "submitted" || current.generationPlan.state === "cancelled") ? { status: "draft" as const } : {}),
    planVersion: run.planVersion + 1,
    generationPlan,
    updatedAt: now,
  };
  return run;
}

/** Record that the policy-owned automatic decision failed after this card was opened. */
export function markGenerationPolicyDecisionFailed(current: ProductionRun, now: string): ProductionRun {
  const plan = current.generationPlan;
  const presentation = currentPresentation(plan);
  if (!plan || plan.state !== "draft" || !presentation || presentation.closed
    || presentation.policySnapshot?.mode !== "direct") return current;
  if (presentation.policyDecisionState === "failed") return current;
  return {
    ...current,
    generationPlan: {
      ...plan,
      presentations: [...(plan.presentations ?? []).slice(0, -1), { ...presentation, policyDecisionState: "failed" }],
      updatedAt: now,
    },
    updatedAt: now,
  };
}

/**
 * 卡上「不生成 ×」：这一镜不生成，这一次出价里记下来（以后也不再自动摆上卡；再点一次恢复）；多镜计划同一条命令里让它退出
 * 这一批（`included: false`）。只收这一次出价里还没决定的镜、和确定没发出去的镜。一次点击失败留下的那份等人的授权一并撤掉。
 */
export function removePresentedShot(current: ProductionRun, shotId: string, now: string): ProductionRun {
  const plan = current.generationPlan;
  if (!plan || !presentationIsOpen(plan)) throw new Error("generation_quote_changed: no open presentation to remove a shot from");
  const state = offerShots(current).find((shot) => shot.shotId === shotId)?.state;
  if (state !== "undecided" && state !== "not_sent") throw new Error(`generation_quote_changed: shot ${shotId} is not waiting on the card`);
  // 只撤盖着这一镜的那份等人的授权：别的镜正在点的那一下不受影响。
  const run = revokeWaitingAndUnseal(current, now, "Remove", shotId);
  const live = run.generationPlan!;
  const presentations = live.presentations ?? [];
  const presentation = presentations.at(-1)!;
  const generationPlan: ProductionGenerationPlan = {
    ...live,
    ...(live.shots ? { shots: live.shots.map((shot) => shot.shotId === shotId ? { ...shot, included: false, updatedAt: now } : shot) } : {}),
    presentations: [...presentations.slice(0, -1), { ...presentation, removed: [...(presentation.removed ?? []), { shotId, at: now }] }],
    updatedAt: now,
  };
  return { ...run, generationPlan, updatedAt: now };
}

function cardChanged(message: string): Error {
  return Object.assign(new Error(`generation_quote_changed: ${message}`), { code: "generation_quote_changed" });
}

/** 换掉这一次出价（最后一条）的某几样，其余原样。 */
function withCurrentPresentation(run: ProductionRun, now: string, edit: (presentation: GenerationPresentation, plan: ProductionGenerationPlan) => Partial<ProductionGenerationPlan> & { presentation: GenerationPresentation }): ProductionRun {
  const plan = run.generationPlan!;
  const presentations = plan.presentations ?? [];
  const { presentation, ...planPatch } = edit(presentations.at(-1)!, plan);
  return { ...run, generationPlan: { ...plan, ...planPatch, presentations: [...presentations.slice(0, -1), presentation], updatedAt: now }, updatedAt: now };
}

/** 这一次出价里这一镜最后一笔交接的下标（换它，不换更早的那几笔）。 */
function latestHandOverIndex(presentation: GenerationPresentation, shotId: string): number {
  const entries = presentation.handOvers ?? [];
  for (let index = entries.length - 1; index >= 0; index -= 1) if (entries[index].shotId === shotId) return index;
  return -1;
}

/**
 * 卡上点了「生成」/「再试一次」，或「直接生成」档的策略决定（D2 第③步）：这几镜交给画布，逐镜走画布单节点提交。
 * 只收这一次出价里还没决定的镜、和确定没发出去的镜（「再试一次」再记一笔）；结果未知的不许再交一次（钱可能已经花了）。
 * 记下来那一刻起，这几镜在卡上是「正在发出」、在画布占位上是「排队中」——不再是「等你确认」（宿主的一个状态，两边读同一份）。
 * `policy` 只有主进程写得出：渲染层的命令白名单里没有这条命令，卡上那条宿主动作只写 `gesture`。
 */
export function handOverPresentedShots(current: ProductionRun, requested: unknown, by: unknown, now: string): ProductionRun {
  const plan = current.generationPlan;
  const presentation = currentPresentation(plan);
  if (!plan || !presentation || presentation.closed) throw cardChanged("no open presentation to hand over");
  if (by !== "gesture" && by !== "policy") throw new Error("Invalid hand-over decider");
  if (by === "policy" && (presentation.policySnapshot?.mode !== "direct" || presentation.policyDecisionState === "failed")) {
    throw Object.assign(new Error("generation_policy_not_direct: this presentation was not opened under the direct-generation policy"), { code: "generation_policy_not_direct" });
  }
  const shotIds = Array.isArray(requested) ? [...new Set(requested.filter((value): value is string => typeof value === "string" && value.trim() !== ""))] : [];
  const eligible = new Set(offerShots(current).filter((shot) => shot.state === "undecided" || shot.state === "not_sent").map((shot) => shot.shotId));
  if (shotIds.length === 0 || shotIds.some((shotId) => !eligible.has(shotId))) throw cardChanged("a shot is no longer waiting on the card");
  // 一次点击没点完留下的那份等人的授权（旧卡 / 外部宿主那条路）先撤掉：交给画布之后它再也不会被点。
  const run = revokeWaitingAndUnseal(current, now, "Hand over");
  return withCurrentPresentation(run, now, (live) => ({
    presentation: { ...live, handOvers: [...(live.handOvers ?? []), ...shotIds.map((shotId): GenerationHandOver => ({ shotId, by, at: now }))] },
  }));
}

/**
 * 渲染层为交出去的那几镜开好了画布那一份同意：把画布单镜 Run 的号绑到交接上。只绑这一次出价里还在交、还没绑的那一笔
 * （同一个号重放 = 原样），节点必须就是这一镜落在画布上的那个节点。之后只有这个画布 Run 认领得到这一镜（`decideShotClaim`）。
 * 出价已经关了（用户在两步之间点了取消）→ 拒：渲染层收回刚开的同意，一镜都不交。
 */
export function bindHandOvers(current: ProductionRun, raw: unknown, now: string): ProductionRun {
  const plan = current.generationPlan;
  const presentation = currentPresentation(plan);
  if (!plan || !presentation || presentation.closed) throw cardChanged("the presentation closed before the canvas took the shots");
  const bindings = Array.isArray(raw) ? raw : [];
  if (bindings.length === 0) throw new Error("Hand-over bindings are required");
  const handOvers = [...(presentation.handOvers ?? [])];
  for (const value of bindings) {
    const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const shotId = typeof entry.shotId === "string" ? entry.shotId : "";
    const canvasRunId = typeof entry.canvasRunId === "string" ? entry.canvasRunId : "";
    const nodeId = typeof entry.nodeId === "string" ? entry.nodeId : "";
    const index = latestHandOverIndex({ ...presentation, handOvers }, shotId);
    const handOver = index >= 0 ? handOvers[index] : undefined;
    if (!shotId || !canvasRunId || !handOver || handOver.settled) throw cardChanged(`shot ${shotId} is not being handed over`);
    if (handOver.canvasRunId && handOver.canvasRunId !== canvasRunId) throw cardChanged(`shot ${shotId} is already bound to another canvas run`);
    const landedNode = plan.shots?.length ? plan.shots.find((shot) => shot.shotId === shotId)?.nodeId : plan.nodeId;
    if (!landedNode || landedNode !== nodeId) throw cardChanged(`shot ${shotId} is not on canvas node ${nodeId}`);
    handOvers[index] = { ...handOver, canvasRunId };
  }
  return withCurrentPresentation(current, now, (live) => ({ presentation: { ...live, handOvers } }));
}

const SETTLE_OUTCOMES: ReadonlySet<GenerationHandOverOutcome> = new Set(GENERATION_HAND_OVER_OUTCOMES);
const WITHDRAWN_BY: ReadonlySet<NonNullable<GenerationHandOverSettlement["withdrawnBy"]>> = new Set(["removed", "user_closed", "user_wrote", "stopped"]);

function settlementOf(payload: Record<string, unknown>, now: string): GenerationHandOverSettlement {
  const outcome = payload.outcome as GenerationHandOverSettlement["outcome"];
  const failure = payload.failure && typeof payload.failure === "object" ? payload.failure as Record<string, unknown> : undefined;
  const withdrawnBy = WITHDRAWN_BY.has(payload.withdrawnBy as never) ? payload.withdrawnBy as NonNullable<GenerationHandOverSettlement["withdrawnBy"]> : "user_closed";
  return {
    at: now, outcome,
    ...(outcome === "withdrawn" ? { withdrawnBy } : {}),
    ...(outcome === "not_sent" ? { failure: {
      kind: failure?.kind === "parameter_rejected" ? "parameter_rejected" as const : "not_sent" as const,
      code: typeof failure?.code === "string" && failure.code ? failure.code : "not_sent",
    } } : {}),
  };
}

/**
 * 交出去的那一镜最后怎样了（交到了 / 结果未知 / 没发出去 / 还没轮到就被收回）：
 *   · 带 `canvasRunId` = 画布那一侧写回，只认绑着这个画布 Run 的那一笔；
 *   · 不带 = 主进程替还没绑上画布的那一笔收尾（渲染层没开出画布那一份同意：节点不在 / 本机判定发不出去 / 窗口没了），
 *     只认还没绑的那一笔，只能是「没发出去」或「收回」——它一下都没交，说不出交到了或结果未知。
 * 已经落定的原样（幂等）；出价已经关了也照写（回执要读它）。用户在任务列表里把排队的这一镜去掉（`withdrawn` + `removed`）
 * = 他不要这一镜：出价开着时同时记成「不生成」（和卡上点「不生成 ×」同一件事）。
 */
export function settleHandOver(current: ProductionRun, payload: Record<string, unknown>, now: string): ProductionRun {
  const plan = current.generationPlan;
  const shotId = typeof payload.shotId === "string" ? payload.shotId : "";
  const canvasRunId = typeof payload.canvasRunId === "string" && payload.canvasRunId ? payload.canvasRunId : undefined;
  const outcome = payload.outcome as GenerationHandOverSettlement["outcome"];
  if (!plan || !currentPresentation(plan) || !shotId || !SETTLE_OUTCOMES.has(outcome)) throw new Error("Invalid hand-over settlement");
  if (!canvasRunId && outcome !== "not_sent" && outcome !== "withdrawn") throw new Error("Invalid hand-over settlement: an unbound hand-over was never sent");
  // 绑着画布 Run 的那一笔按画布 Run 认（不管它那一次出价此刻还是不是当前那一次：交到一半被收回 / 被顶掉的镜，结论照样写回它自己那一笔）；
  // 没绑上的只可能是当前这一次出价里的（渲染层还在开同意，出价一关它就当场记成收回了）。
  const presentations = plan.presentations ?? [];
  const found = canvasRunId ? handOverOfCanvasRun(plan, canvasRunId) : (() => {
    const handOverIndex = latestHandOverIndex(presentations.at(-1)!, shotId);
    return handOverIndex >= 0 ? { presentationIndex: presentations.length - 1, handOverIndex, handOver: presentations.at(-1)!.handOvers![handOverIndex] } : undefined;
  })();
  if (!found || found.handOver.shotId !== shotId || found.handOver.settled || found.handOver.canvasRunId !== canvasRunId) return current;
  const presentation = presentations[found.presentationIndex];
  const live = found.presentationIndex === presentations.length - 1 && !presentation.closed;
  const settlement = settlementOf(payload, now);
  const removedNow = live && settlement.withdrawnBy === "removed";
  // 「直接生成」档替用户交出去的那一镜没交到（没发出去 / 结果未知）：这一次出价退回给人决定（和刹车同一个落点），卡当场出现在原处。
  const policyFailed = live && found.handOver.by === "policy" && (outcome === "not_sent" || outcome === "unknown")
    && presentation.policySnapshot?.mode === "direct" && presentation.policyDecisionState !== "failed";
  const settled: GenerationPresentation = {
    ...presentation,
    handOvers: (presentation.handOvers ?? []).map((entry, at) => at === found.handOverIndex ? { ...entry, settled: settlement } : entry),
    ...(removedNow ? { removed: [...(presentation.removed ?? []), { shotId, at: now }] } : {}),
    ...(policyFailed ? { policyDecisionState: "failed" as const } : {}),
  };
  return {
    ...current,
    generationPlan: {
      ...plan,
      presentations: presentations.map((entry, at) => at === found.presentationIndex ? settled : entry),
      ...(removedNow && plan.shots ? { shots: plan.shots.map((shot) => shot.shotId === shotId ? { ...shot, included: false, updatedAt: now } : shot) } : {}),
      updatedAt: now,
    },
    updatedAt: now,
  };
}

/**
 * 卡上「不生成 ×」再点一次（D2 第③步 Q1-A：可撤回）：这一镜回到这一次出价里等人决定。只收这一次出价里去掉的镜；
 * 多镜计划同时把它勾回这一批（`included: true`）。
 */
export function restorePresentedShot(current: ProductionRun, shotId: string, now: string): ProductionRun {
  const plan = current.generationPlan;
  const presentation = currentPresentation(plan);
  if (!plan || !presentation || presentation.closed) throw cardChanged("no open presentation to restore a shot to");
  if (!(presentation.removed ?? []).some((entry) => entry.shotId === shotId)) throw cardChanged(`shot ${shotId} was not removed from this card`);
  return withCurrentPresentation(current, now, (live, livePlan) => ({
    presentation: { ...live, removed: (live.removed ?? []).filter((entry) => entry.shotId !== shotId) },
    ...(livePlan.shots ? { shots: livePlan.shots.map((shot) => shot.shotId === shotId ? { ...shot, included: true, updatedAt: now } : shot) } : {}),
  }));
}

/**
 * 收回**这一次出价**，计划留着（× / 用户在卡待决时打了字 / 问这句话的那个回合没了）。三种都不是「不要这份草稿」：
 * 镜头、参数、锚点一个不动，画布占位一个不删，已经点过「生成这张」的镜照样在生成；只把这一次出价关掉（记下为什么），
 * 还在等人决定的那份授权撤掉。幂等：没有开着的出价就原样返回。
 */
export function withdrawGenerationPresentation(current: ProductionRun, now: string, by: GenerationPresentationCloser): ProductionRun {
  const plan = current.generationPlan;
  if (!plan) throw new Error("Generation plan not found");
  if (!presentationIsOpen(plan)) return current;
  const run = revokeWaitingAndUnseal(current, now, "Withdraw");
  return { ...run, generationPlan: closeCurrent(run.generationPlan!, now, by), updatedAt: now };
}

/**
 * 仓库写入口每条命令之后问一次：这一次出价是不是全决定了（每一镜都交到了画布 / 被去掉 / 在节点上被拿走 / 制作批过）。
 * 是 → 关掉（有镜是卡交给画布的 → `handed_to_canvas`，否则 `resolved`），作为自己的事件与那条命令同一次落盘。
 * 哪条命令让最后一镜决定了都一样（交接落定、去掉那一镜、节点上认领、批准那一镜的决门）。
 */
export function settlePresentation(run: ProductionRun, now: string): ProductionCommandEffect | null {
  if (!presentationResolved(run)) return null;
  const plan = run.generationPlan!;
  const closed = closeCurrent(plan, now, resolvedCloser(currentPresentation(plan)));
  return {
    run: { ...run, generationPlan: closed, updatedAt: now },
    eventType: "generation.presentation.closed",
    message: currentPresentation(closed)?.closed?.by ?? "resolved",
  };
}
