import { spendAuthorizationGates } from "../shared/productionSpendAuthority";
// 付费卡上「这一次出价」的写法（2026-09-30 付费卡逐镜）：摆出来、去掉一镜、关掉、全决定了自己关。
// 判据（哪几镜没决定、能摆哪几镜）住在 `electron/shared/productionGenerationPresentation.ts`，这里只写。
// 三条命令（generation.present / generation.shot.remove / generation.withdraw）与仓库写入口的收尾
// （settlePresentation）共用这一份手法，reducer 只转进来。
import { resolveGenerationShotScope } from "../shared/agentCapabilities/generationShotScope";
import {
  currentPresentation,
  planShotIds,
  presentationIsOpen,
  presentationResolved,
  projectPolicyDecisionDeadlineFromOwnerClock,
  shotEverAuthorized,
  standingShotIds,
  undecidedShotIds,
} from "../shared/productionGenerationPresentation";
import type { ProductionCommandEffect } from "./productionRunReducer";
import { hasUnsettledLiability, revokeWaitingAndUnseal, unsealedGenerationPlanFields } from "./productionGenerationPlanEdits";
import type {
  GenerationPresentationCloser,
  ProductionGenerationPlan,
  ProductionRun,
} from "./productionRunTypes";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";

const CLOSERS: ReadonlySet<GenerationPresentationCloser> = new Set(["resolved", "user_closed", "user_wrote", "stopped"]);

/** 命令里带来的关卡原因；认不出的一律当成 × 的那一种（用户关的）。 */
export function parsePresentationCloser(value: unknown): GenerationPresentationCloser {
  return typeof value === "string" && CLOSERS.has(value as GenerationPresentationCloser)
    ? value as GenerationPresentationCloser
    : "user_closed";
}

function closeCurrent(plan: ProductionGenerationPlan, now: string, by: GenerationPresentationCloser): ProductionGenerationPlan {
  const presentations = plan.presentations ?? [];
  const current = presentations.at(-1);
  if (!current || current.closed) return plan;
  return { ...plan, presentations: [...presentations.slice(0, -1), { ...current, closed: { at: now, by } }], updatedAt: now };
}

/**
 * 这一次出价摆哪几镜（`generate` 动词，2026-09-30 付费卡逐镜）：
 *   · 点名了（`shotIds`）→ 就是这几镜；
 *   · 没点名 → 计划里还算数的镜里**没批过的**（Q5：生成过的不再问一次）；一镜都不剩时，就是对整份草稿再来一轮
 *     （每一镜都生成过了，他又说「生成」——新的一轮、新的尝试，和以前「下一批」同一个意思）。
 * 摆的镜里只要有一镜批过（或者这是一份被删掉的草稿），就必须等之前的每一笔都落定（`hasUnsettledLiability`）：一次新出价
 * 不许把一笔结果未知的提交盖掉。没批过的镜可以在别的镜还在跑的时候摆出来（× 掉之后再说「生成」就是这一种）。
 */
function presentationScope(run: ProductionRun, requested: unknown): string[] {
  const plan = run.generationPlan!;
  const named = requested === undefined ? undefined : resolveGenerationShotScope(planShotIds(plan), requested);
  const standing = named ?? standingShotIds(run);
  const fresh = standing.filter((shotId) => !shotEverAuthorized(run, shotId));
  const scope = named ?? (fresh.length > 0 ? fresh : standing);
  // 用户删掉的草稿（cancelled）重新摆出来，同样要等之前的每一笔都落定。
  if ((plan.state === "cancelled" || scope.some((shotId) => shotEverAuthorized(run, shotId))) && hasUnsettledLiability(run)) {
    throw Object.assign(new Error("generation_reconciliation_required: a previous attempt for these shots is unsettled or in flight"),
      { code: "generation_reconciliation_required" });
  }
  if (scope.length === 0) {
    throw Object.assign(new Error("generation_nothing_to_present: there are no shots left in this draft to put in front of the user"),
      { code: "generation_nothing_to_present" });
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
      ...(policySnapshot?.mode === "project" ? {
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
    || presentation.policySnapshot?.mode !== "project") return current;
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
 * 卡上「去掉这张」：这一镜不生成，这一次出价里记下来（以后也不再自动摆上卡）；多镜计划同一条命令里让它退出
 * 这一批（`included: false`）。只收这一次出价里还没决定的镜。一次点击失败留下的那份等人的授权一并撤掉。
 */
export function removePresentedShot(current: ProductionRun, shotId: string, now: string): ProductionRun {
  const plan = current.generationPlan;
  if (!plan || !presentationIsOpen(plan)) throw new Error("generation_quote_changed: no open presentation to remove a shot from");
  if (!undecidedShotIds(current).includes(shotId)) throw new Error(`generation_quote_changed: shot ${shotId} is not waiting on the card`);
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
 * 仓库写入口每条命令之后问一次：这一次出价是不是全决定了（每一镜都点了「生成这张」或「去掉这张」）。是 → 关掉
 * （`resolved`），作为自己的事件与那条命令同一次落盘。哪条命令让最后一镜决定了都一样（批准那一镜的决门、去掉那一镜）。
 */
export function settlePresentation(run: ProductionRun, now: string): ProductionCommandEffect | null {
  if (!presentationResolved(run)) return null;
  const plan = run.generationPlan!;
  const closed = closeCurrent(plan, now, "resolved");
  return {
    run: { ...run, generationPlan: closed, updatedAt: now },
    eventType: "generation.presentation.closed",
    message: currentPresentation(closed)?.closed?.by ?? "resolved",
  };
}
