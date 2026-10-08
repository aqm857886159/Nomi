// 「这一次出价摆了哪几镜、每一镜决定了没有、卡怎么关的」的唯一读口（2026-09-30 付费卡逐镜）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 付费卡以前只有一个「仍要生成」：点下去宿主就把别的镜从这一批里删掉再封印，第 2 张悄悄消失、再没有卡问过它；
// Agent 却被告知「都开始了」（用户实见 U01 / U02）。用户拍板「点了的生成，去掉的不生成」：每一镜单独决定。
//
// 事实只有三样，都在 Run 里：
//   · 这一次出价（`plan.presentations` 的最后一条）：摆了哪几镜、开着没有、关的原因；
//   · 点了「生成这张」的镜：这一次出价开出来之后，有一份**已批准**的授权（门）盖着它；
//   · 点了「去掉这张」的镜：记在这一次出价的 `removed` 里（多镜计划同一条命令里也让它退出这一批 `included: false`）。
// 卡的投影、Agent 的回执、画布小标都从这里读同一份，不各自数镜头。纯函数，主进程与渲染层共用。
import type {
  GenerationPresentation,
  GenerationPresentationCloser,
  ProductionGenerationPlan,
  ProductionRun,
} from "../productionRun/productionRunTypes";
import { spendAuthorizationGates } from "./productionSpendAuthority";
import { jobEndedBeforeAcceptance, jobsForShot } from "./productionShotJobs";
import { DEFAULT_PROJECT_AGENT_APPROVAL_POLICY } from "./agentCapabilities/capabilityApprovalPolicy";
import { PROJECT_AGENT_PREPARING_DEADLINE_MS } from "./projectAgentPreparingDeadline";

type PlanView = Pick<ProductionGenerationPlan, "state" | "candidate" | "shots" | "presentations">;

/** The policy owner gives a pending decision the same bounded lifetime as its durable receipt writes. */
export function projectPolicyDecisionDeadlineAt(openedAt: string): string | undefined {
  const openedMs = Date.parse(openedAt);
  return Number.isFinite(openedMs)
    ? new Date(openedMs + PROJECT_AGENT_PREPARING_DEADLINE_MS).toISOString()
    : undefined;
}

/** New writes are anchored to the owner's wall clock; injected historical timestamps in replay/tests must not expire immediately. */
export function projectPolicyDecisionDeadlineFromOwnerClock(openedAt: string): string | undefined {
  const openedMs = Date.parse(openedAt);
  if (!Number.isFinite(openedMs)) return undefined;
  return new Date(Math.max(openedMs, Date.now()) + PROJECT_AGENT_PREPARING_DEADLINE_MS).toISOString();
}

/** 这一次出价（最后一条）。没有 = 草稿从没摆到用户面前过。 */
export function currentPresentation(plan: Pick<ProductionGenerationPlan, "presentations"> | undefined): GenerationPresentation | undefined {
  return plan?.presentations?.at(-1);
}

/** 卡此刻开着（有一次出价、还没关）。 */
export function presentationIsOpen(plan: Pick<ProductionGenerationPlan, "presentations"> | undefined): boolean {
  const current = currentPresentation(plan);
  return Boolean(current && !current.closed);
}

/** 投影用的「草稿还没摆出来」：draft 且没有一次开着的出价（任务面板据此不把它算成任务）。 */
export function draftCardHidden(plan: Pick<ProductionGenerationPlan, "state" | "presentations"> | undefined): boolean {
  return Boolean(plan && plan.state === "draft" && !presentationIsOpen(plan));
}

/** 计划里每一镜的 id（单镜旧形态只有顶层候选那一镜）。 */
export function planShotIds(plan: Pick<ProductionGenerationPlan, "candidate" | "shots">): string[] {
  return plan.shots?.length ? plan.shots.map((shot) => shot.shotId) : [plan.candidate.candidateId];
}

/** 这一镜在这一次出价里有没有一份**已批准**的授权（用户在卡上点了「生成这张」，或全自动档替他批了）。 */
function approvedIn(run: Pick<ProductionRun, "gates">, shotId: string, presentation: GenerationPresentation): boolean {
  return spendAuthorizationGates(run).slice(presentation.fromGate).some((gate) => gate.status === "approved"
    && gate.authorizationEnvelope.jobs.some((job) => job.shotId === shotId));
}

/** 这一镜在**这一次出价**里已经批过了（没有开着的出价时：批过就算）。封印只给这一次出价里还没批的镜。 */
export function shotApprovedInCurrentPresentation(run: Pick<ProductionRun, "gates" | "generationPlan">, shotId: string): boolean {
  const presentation = currentPresentation(run.generationPlan);
  return presentation && !presentation.closed ? approvedIn(run, shotId, presentation) : everAuthorized(run, shotId);
}

/** 这一镜有没有过任何一份授权（生成过 / 正在生成）。生成过的不再摆上卡问一次。 */
function everAuthorized(run: Pick<ProductionRun, "gates">, shotId: string): boolean {
  return spendAuthorizationGates(run).some((gate) => gate.status === "approved"
    && gate.authorizationEnvelope.jobs.some((job) => job.shotId === shotId));
}

function shotOf(plan: PlanView, shotId: string) {
  return plan.shots?.find((shot) => shot.shotId === shotId);
}

/** 用户在这一次出价里去掉的那几镜（按点的先后）。 */
function removedIn(_plan: PlanView, presentation: GenerationPresentation): string[] {
  return (presentation.removed ?? []).map((entry) => entry.shotId);
}

/** 用户在任何一次出价里去掉过的镜：去掉的不再自动摆上卡。 */
function removedEver(plan: PlanView): Set<string> {
  return new Set((plan.presentations ?? []).flatMap((presentation) => (presentation.removed ?? []).map((entry) => entry.shotId)));
}

/** 用户在卡上点过「去掉这张 / 这段」的镜（任何一次出价里）。画布小标据此说「已去掉，不生成」。 */
export function removedShotIds(run: Pick<ProductionRun, "generationPlan">): string[] {
  return run.generationPlan ? [...removedEver(run.generationPlan)] : [];
}

/** 画布在这一次出价开着的时候接手了的那几镜（它们由画布生成，不再归这张卡）。 */
function takenByCanvasIn(plan: PlanView, presentation: GenerationPresentation): string[] {
  return presentation.shotIds.filter((shotId) => shotOf(plan, shotId)?.claim?.by === "canvas");
}

/**
 * 这一次出价里**还没决定**的镜（按计划顺序）。卡上摆的就是它们，标题数的也是它们。
 * 没有开着的出价 → 空。一镜正在点（门在等）也算没决定：点失败了它还得在卡上等人。
 */
export function undecidedShotIds(run: Pick<ProductionRun, "gates" | "generationPlan">): string[] {
  const plan = run.generationPlan;
  const presentation = currentPresentation(plan);
  if (!plan || !presentation || presentation.closed) return [];
  return undecidedIn(run, plan, presentation);
}

function undecidedIn(run: Pick<ProductionRun, "gates">, plan: PlanView, presentation: GenerationPresentation): string[] {
  const removed = new Set(removedIn(plan, presentation));
  const taken = new Set(takenByCanvasIn(plan, presentation));
  return presentation.shotIds.filter((shotId) => !removed.has(shotId) && !taken.has(shotId)
    && !approvedIn(run, shotId, presentation));
}

/**
 * 不点名地再出价时，计划里还算数的镜：勾在这一批里、也没被用户去掉过的（Q9：旧版本静默移出的 `included: false`
 * 不自动复活；用户点过「去掉这张」的也不自动回来——他要的话，Agent 点名就行）。
 */
export function standingShotIds(run: Pick<ProductionRun, "generationPlan">): string[] {
  const plan = run.generationPlan;
  if (!plan) return [];
  const removed = removedEver(plan);
  return planShotIds(plan).filter((shotId) => shotOf(plan, shotId)?.included !== false && !removed.has(shotId));
}

/** 这一镜有没有被批过（生成过 / 正在生成）。再出价时先问没批过的（Q5）。 */
export function shotEverAuthorized(run: Pick<ProductionRun, "gates">, shotId: string): boolean {
  return everAuthorized(run, shotId);
}

/** 这一次出价是不是该自己关了：开着，而且一镜都不剩（全决定了）。 */
export function presentationResolved(run: Pick<ProductionRun, "gates" | "generationPlan">): boolean {
  const plan = run.generationPlan;
  const presentation = currentPresentation(plan);
  return Boolean(plan && presentation && !presentation.closed && undecidedIn(run, plan, presentation).length === 0);
}

/**
 * 这一次出价的结局——**Agent 的回执只读它**（宿主给一个值，回执只渲染；以后原样成为工具调用的输出）。
 * `undecided` 的原因就是卡关掉的原因（× / 用户打了字 / 被停）；卡还开着时原因是 `open`。
 */
export type GeneratePresentationOutcome = Readonly<{
  closedBy: GenerationPresentationCloser | "open";
  /** 用户点了「生成这张」、已经交给生成的镜。 */
  generating: readonly string[];
  /** 用户点了「生成这张」，但派发在出站之前就失败了（账本证明没写出去：没花钱）。 */
  failedBeforeSending: readonly string[];
  removed: readonly string[];
  takenByCanvas: readonly string[];
  undecided: readonly Readonly<{ shotId: string; reason: GenerationPresentationCloser | "open" }>[];
}>;

export function generationPresentationOutcome(run: Pick<ProductionRun, "gates" | "generationPlan" | "jobs">): GeneratePresentationOutcome | undefined {
  const plan = run.generationPlan;
  const presentation = currentPresentation(plan);
  if (!plan || !presentation) return undefined;
  const closedBy: GenerationPresentationCloser | "open" = presentation.closed?.by ?? "open";
  const taken = takenByCanvasIn(plan, presentation);
  const clicked = presentation.shotIds.filter((shotId) => !taken.includes(shotId) && approvedIn(run, shotId, presentation));
  const failed = clicked.filter((shotId) => failedBeforeSendingIn(run, shotId, presentation));
  return Object.freeze({
    closedBy,
    generating: clicked.filter((shotId) => !failed.includes(shotId)),
    failedBeforeSending: failed,
    removed: removedIn(plan, presentation),
    takenByCanvas: taken,
    undecided: undecidedIn(run, plan, presentation).map((shotId) => ({ shotId, reason: closedBy })),
  });
}

/**
 * 这一镜在这一次出价里批出来的每一次尝试，都结束在被受理之前——没写出去，或供应商当场明确拒绝（`productionShotJobs.jobEndedBeforeAcceptance`）。
 * 「这一次出价里批出来的」= job 记的授权摘要属于这一次出价开出来之后建的门（和 `approvedIn` 同一条边界，不比时间戳）。
 */
function failedBeforeSendingIn(run: Pick<ProductionRun, "gates" | "generationPlan" | "jobs">, shotId: string, presentation: GenerationPresentation): boolean {
  const digests = new Set(spendAuthorizationGates(run).slice(presentation.fromGate).map((gate) => gate.authorizationDigest));
  const jobs = jobsForShot(run, shotId).filter((job) => job.authorizationDigest !== undefined && digests.has(job.authorizationDigest));
  return jobs.length > 0 && jobs.every(jobEndedBeforeAcceptance);
}

/**
 * 旧 Run → 现在的形状（读盘归一，唯一一处）。上一版用 `cardHidden` 说「卡在不在」：
 *   · `cardHidden: true` → 没有开着的出价；
 *   · 草稿没有 `cardHidden` → 卡是开着的（旧默认「缺省 = 卡可见」），出价摆的是勾进这一批的那几镜；
 *   · 已封印、门还在等 → 同上，卡开着（那道门还在等人）。
 * 已经是新形状（有 `presentations`）就原样返回。
 */
export function normalizeLegacyPresentation<T extends Pick<ProductionRun, "gates" | "generationPlan">>(run: T): T {
  const plan = run.generationPlan as (ProductionGenerationPlan & { cardHidden?: boolean }) | undefined;
  if (!plan) return run;
  if (plan.presentations) {
    if (plan.presentations.every((presentation) => presentation.presentationId
      && presentation.presentationEpoch !== undefined
      && presentation.policySnapshot
      && (presentation.policySnapshot.mode !== "project" || presentation.policyDecisionDeadlineAt))) return run;
    const presentations = plan.presentations.map((presentation, index) => ({
      ...presentation,
      presentationId: presentation.presentationId ?? `${plan.operationId}:presentation:${index + 1}`,
      presentationEpoch: presentation.presentationEpoch ?? index + 1,
      policySnapshot: presentation.policySnapshot ?? DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
      ...(presentation.policySnapshot?.mode === "project" && !presentation.policyDecisionDeadlineAt
        ? (() => {
            const deadline = projectPolicyDecisionDeadlineAt(presentation.openedAt);
            return deadline ? { policyDecisionDeadlineAt: deadline } : {};
          })()
        : {}),
    }));
    return { ...run, generationPlan: { ...plan, presentations } as ProductionGenerationPlan };
  }
  if (!("cardHidden" in plan || plan.state === "draft" || plan.state === "sealed")) return run;
  const { cardHidden, ...rest } = plan;
  const gates = spendAuthorizationGates(run);
  const firstWaiting = gates.findIndex((gate) => gate.status === "waiting");
  const open = cardHidden !== true && (plan.state === "draft" || (plan.state === "sealed" && firstWaiting >= 0));
  const shotIds = plan.shots?.length
    ? plan.shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId)
    : [plan.candidate.candidateId];
  return {
    ...run,
    // 门在等的那一份属于这一次出价（它就是卡上那一下还没点完的点击）。
    generationPlan: { ...rest, ...(open ? { presentations: [{
      presentationId: `${plan.operationId}:presentation:1`,
      presentationEpoch: 1,
      policySnapshot: DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
      shotIds, openedAt: plan.updatedAt, fromGate: firstWaiting >= 0 ? firstWaiting : gates.length,
    }] } : {}) } as ProductionGenerationPlan,
  };
}
