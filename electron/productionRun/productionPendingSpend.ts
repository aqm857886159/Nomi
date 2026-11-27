import { directGenerationBrakeForRun, withHandedOverAttempts } from "../shared/agentCapabilities/directGenerationBrakes";
import { generationShotKind } from "../shared/generationShotKind";
import { productionNodeIdForShot } from "../shared/productionShotPhase";
import { createHash } from "node:crypto";
// 「有一笔生成在等你点头」的**宿主投影**（纯函数，唯一 owner）。
//
// ── 它在解决哪个真实摩擦 ──
//
// Agent 在面板里说「好，我来生成」，然后……什么也没有。草稿静静躺在 Run 里（它已经落成画布上的节点），
// 而「要不要花这笔钱」这个问题在**用户看得见的地方一个字都没出现**。这个文件补的就是那条数据通道：
// 把「等人点头的那一次出价」投影成一张卡需要的、**节点读不到**的事实。
//
// ── D2 第③步之后卡上没有第二份参数 ──
//
// 一镜要发什么（模型、比例、时长、提示词、参考、价格）只住在画布节点上：卡上的指向元素和那一行只读摘要都读节点本身，
// 价格也由渲染层按节点、用画布批量估价同一个函数现算（算不出整行不印，绝不印 0）。这里只给卡：出价的身份、摆着哪几镜、
// 每一镜指向哪个节点、Agent 起草时选的模型（「Nomi 选的」判据）、每一镜在这一次出价里走到了哪一步（还没决定 / 正在交给画布 /
// 交到了 / 没发出去 / 结果未知 / 去掉了 / 节点上自己生成了）。
//
// ── 为什么只投影 `origin.host === "nomi"` 的那些 ──
//
// 外部 MCP 宿主（Claude Desktop / Codex …）那条路有它自己的确认形态（elicitation + 倒计时，
// 由另一条分支负责），它的用户此刻根本没在看 Nomi 的面板。面板里的卡只服务**面板里发生的事**。
import type { ProductionGenerationPlan, ProductionRun } from "./productionRunTypes";
import type { PendingSpendConfirm, PendingSpendShot } from "../shared/contracts/pendingSpendConfirm";
import {
  currentPresentation,
  everyShotRemoved,
  IN_APP_AGENT_ORIGIN_HOST,
  offerShots,
  planShotIds,
  presentationIsOpen,
  type OfferShot,
} from "../shared/productionGenerationPresentation";

export type { PendingSpendConfirm, PendingSpendShot } from "../shared/contracts/pendingSpendConfirm";

export type PendingSpendIdentity = Readonly<{
  presentationId?: string;
  presentationEpoch?: number;
  planVersion: number;
  quoteId: string;
}>;

/** Fail closed when an action came from a card version that is no longer current. */
export function assertPendingSpendIdentity(pending: PendingSpendConfirm, expected: PendingSpendIdentity): void {
  if (pending.quoteId !== expected.quoteId
    || pending.planVersion !== expected.planVersion
    || pending.presentationId !== expected.presentationId
    || pending.presentationEpoch !== expected.presentationEpoch) {
    throw Object.assign(new Error("generation_presentation_stale"), { code: "generation_presentation_stale" });
  }
}

function projectionErrorCard(run: ProductionRun, error: unknown): PendingSpendConfirm {
  const presentation = currentPresentation(run.generationPlan);
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "pending_spend_projection_failed";
  return Object.freeze({
    projectId: run.projectId, runId: run.runId, operationId: run.generationPlan?.operationId ?? run.runId,
    planVersion: run.planVersion, quoteId: `error:${presentation?.presentationId ?? run.runId}:${run.planVersion}`,
    ...(presentation?.presentationId ? { presentationId: presentation.presentationId } : {}),
    ...(presentation?.presentationEpoch !== undefined ? { presentationEpoch: presentation.presentationEpoch } : {}),
    ...(presentation?.policySnapshot ? { policySnapshot: structuredClone(presentation.policySnapshot) } : {}),
    handOverRevision: presentation?.handOvers?.length ?? 0,
    currency: run.budget.currency, shots: Object.freeze([]),
    error: { code, message: error instanceof Error ? error.message : String(error) },
  });
}

/** 这一镜要不要摆在卡上：还在等人（没决定 / 没发出去 / 结果未知），或卡自己正在把它交给画布（显示「正在发出 k/N」）。 */
function needsTheCard(shot: OfferShot): boolean {
  switch (shot.state) {
    case "undecided": case "not_sent": case "unknown": return true;
    // 「直接生成」档的策略在交：不出卡（用户拍板「不再逐次问」），节点上照常显示排队 / 生成中。
    case "handing_over": return shot.handOver?.by === "gesture";
    case "removed": case "taken_by_canvas": case "sent": case "approved": return false;
  }
}

/**
 * 「这份计划此刻**正摆在用户面前等他**吗」——这条判据只有这一份，读者只有 `projectPendingSpendConfirm`。
 * 启动清扫（`stalePresentationSweep`）不读它：上一个进程开着的出价不管还等不等人一律收回（重启后不出卡）。
 */
function awaitingSpendDecision(
  run: ProductionRun,
): Readonly<{ plan: ProductionGenerationPlan; shots: readonly OfferShot[]; manualDecisionRequired?: true }> | undefined {
  if (run.origin.host !== IN_APP_AGENT_ORIGIN_HOST) return undefined;
  const plan = run.generationPlan;
  // 计划已取消（用户删了这份草稿）：没有要问的了。
  if (!plan || plan.state === "cancelled") return undefined;
  // 卡在不在，只看这一次出价：开着、而且还有镜要摆在卡上。全决定了（交到了 / 去掉了 / 节点上拿走了）这一次出价自己关掉；
  // 全部去掉的那一张留着（主按钮置灰、还能恢复，要关点「取消」）。
  if (!presentationIsOpen(plan)) return undefined;
  const shots = offerShots(run);
  if (!shots.some(needsTheCard) && !everyShotRemoved(shots)) return undefined;
  // 「直接生成」档正在替用户决这一笔（草稿落盘到交给画布之间那一段）。它不在等人，别摆卡；策略答不了、代答失败时照旧出卡。
  const presentation = currentPresentation(plan);
  const projectPolicyPending = presentation?.policySnapshot?.mode === "direct" && presentation.policyDecisionState !== "failed";
  const deadlineMs = presentation?.policyDecisionDeadlineAt ? Date.parse(presentation.policyDecisionDeadlineAt) : Number.NaN;
  if (projectPolicyPending && Number.isFinite(deadlineMs) && deadlineMs > Date.now()) return undefined;
  const manualDecisionRequired = presentation?.policySnapshot?.mode === "direct"
    && (presentation.policyDecisionState === "failed" || projectPolicyPending);
  return { plan, shots, ...(manualDecisionRequired ? { manualDecisionRequired: true as const } : {}) };
}

function shotsOf(plan: ProductionGenerationPlan, shots: readonly OfferShot[]): PendingSpendShot[] {
  const order = planShotIds(plan);
  return shots.map((shot) => {
    const planShot = plan.shots?.find((entry) => entry.shotId === shot.shotId);
    const candidate = planShot?.candidate ?? plan.candidate;
    const nodeId = productionNodeIdForShot({ generationPlan: plan }, shot.shotId);
    return {
      shotId: shot.shotId,
      ...(nodeId ? { nodeId } : {}),
      index: order.indexOf(shot.shotId) + 1,
      // 图还是视频：和画布节点、派发读的是同一个函数（第 9 条），从这一镜本身读出来。
      kind: generationShotKind(planShot ?? { candidate }),
      draftedModel: { providerId: candidate.providerId, modelId: candidate.modelId },
      offer: shot.state === "approved" ? "sent" as const : shot.state,
      ...(shot.state === "not_sent" && shot.handOver?.settled?.failure ? { failure: { ...shot.handOver.settled.failure } } : {}),
    };
  });
}

/**
 * 这个 Run 里有没有一笔「等人点头」的生成？没有 → `undefined`（那时面板上一张卡都不该出现）。
 *
 * 档位那一档（2026-09-18）：用户在「直接生成」档下拍过板：付费生成直接跑、不再逐笔看报价。所以一份**正在被档位代答**的草稿
 * 不是「在等你点头」——它在等的是策略（`decideByPolicyAfterDraft` 把它交给画布）。策略答不了（刹车 / 代答失败 / 期限过了）
 * 时卡照旧出现在原处等用户。
 */
export function projectPendingSpendConfirm(
  run: ProductionRun,
  /** 读交给画布的那几镜的画布单镜 Run（刹车要数它们的失败）。缺席 = 只看制作 Run 本身。 */
  readCanvasRun: (runId: string) => ProductionRun | null | undefined = () => undefined,
): PendingSpendConfirm | undefined {
  const awaiting = awaitingSpendDecision(run);
  if (!awaiting) return undefined;
  const { plan, manualDecisionRequired } = awaiting;
  // 刹车是 Run 的派生事实：只在「直接生成」档的出价因为人工决定而摆出来时才可能有（其它档恒不报计划 / 重试刹车）。
  const presentation = currentPresentation(plan);
  const snapshot = presentation?.policySnapshot;
  const brake = manualDecisionRequired && snapshot?.mode === "direct"
    ? directGenerationBrakeForRun(snapshot, withHandedOverAttempts(run, readCanvasRun)) : undefined;
  const shots = shotsOf(plan, awaiting.shots);
  if (shots.length === 0) {
    throw Object.assign(
      new Error(`pending_spend_projection_empty: run ${run.runId} operation ${plan.operationId} is awaiting a decision but projects no shot`),
      { code: "pending_spend_projection_empty" },
    );
  }
  return Object.freeze({
    projectId: run.projectId,
    runId: run.runId,
    operationId: plan.operationId,
    planVersion: run.planVersion,
    ...(presentation?.presentationId ? { presentationId: presentation.presentationId } : {}),
    ...(presentation?.presentationEpoch !== undefined ? { presentationEpoch: presentation.presentationEpoch } : {}),
    ...(snapshot ? { policySnapshot: structuredClone(snapshot) } : {}),
    ...(manualDecisionRequired ? { manualDecisionRequired: true as const } : {}),
    ...(brake ? { brake: Object.freeze({ ...brake }) } : {}),
    // 卡的身份 = 这一次出价 + 摆着哪几镜 + 每镜候选的版本（Agent 改稿就换）。交接走到哪一步不进身份：
    // 卡上的「取消」在交的半路上照样认得出它（× 不排队，要的就是能打断），而「生成」的资格另由出价账逐镜判。
    quoteId: createHash("sha256").update(JSON.stringify({
      projectId: run.projectId, operationId: plan.operationId, planVersion: run.planVersion,
      presentationId: presentation?.presentationId, presentationEpoch: presentation?.presentationEpoch,
      candidateRevision: plan.candidate.revision,
      shots: shots.map((shot) => [shot.shotId, shot.nodeId ?? null, plan.shots?.find((entry) => entry.shotId === shot.shotId)?.candidate.revision ?? plan.candidate.revision]),
    })).digest("hex"),
    handOverRevision: presentation?.handOvers?.length ?? 0,
    currency: run.budget.currency,
    shots: Object.freeze(shots),
  });
}

/**
 * 一个项目里所有等人点头的那些。**只出一张卡**是产品裁决（定稿 ⑤：介入槽同时只显示一张），
 * 所以这里按 `updatedAt` 升序返回，调用方取第一条、把 `length` 当「还有 N 条」。
 * `readRun` 读交给画布的那几镜的画布单镜 Run：项目的 Run 列表不列它们（`canvasShotRunIndex`），只能按号读。
 */
export function listPendingSpendConfirms(
  runs: readonly ProductionRun[],
  readRun: (runId: string) => ProductionRun | null | undefined,
): readonly PendingSpendConfirm[] {
  return Object.freeze(
    runs
      .slice()
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((run) => {
        try { return projectPendingSpendConfirm(run, readRun); }
        catch (error) { return projectionErrorCard(run, error); }
      })
      .filter((value): value is PendingSpendConfirm => Boolean(value)),
  );
}
