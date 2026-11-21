import { currentPresentation, generationPresentationOutcome } from "../shared/productionGenerationPresentation";
// Agent 面板付费卡的**宿主动作**（D2 第③步：卡 = 指向元素 + 一行只读摘要 + 主按钮；一台发动机）。
//
// ── 卡上能做的只有四件事 ──
//
//   · 生成 / 全部生成（N）/ 生成剩下 N 段 / 再试一次 —— 把这几镜交给画布（`canvasHandOver`）：逐镜走画布单节点提交那一条路，
//     每一镜派发时主进程按发起它的窗口铸同款手势收据（和节点上点 ↑ 是同一张）。这一下点击就是决定，不再开制作流程的付费门；
//   · 不生成 × / 恢复 —— 这一次出价里记下 / 拿掉（可撤回）；
//   · 取消 —— 收回这一次出价：还没交出去的不再交（没绑上画布的当场记成收回，绑上了还没轮到的由账本的变更订阅当场收回同意），
//     已经在交的照常交完，照实说交出去几段。
//
// 卡上没有参数：一镜要发什么只住在画布节点上，想改就点指向元素去节点里改。所以这里没有「改参数」（`generation.revise` 那条卡来源
// 随旧卡一起删了），也不再有卡上动作的排队与取消令牌：每一个决定都是 Run 账本里的一条命令，资格由 reducer 当场判（这一镜还在等
// 卡上的决定吗、出价还开着吗），两下点击撞在一起只会成一下，另一下照实回「卡上的内容刚变了」。
//
// ── 身份核对 ──
//
// 卡带着它看到的那一份身份来（`quoteId` = 这一次出价 + 每镜候选版本 + 指向哪个节点；不含交接走到哪一步）：Agent 改了稿、
// 节点换了、重新出价，动作都拒；交接一镜一镜落定不改身份，所以「取消」在交的半路上照样认得出这张卡（× 不排队，要的就是能打断）。
import { logWarn } from "../logging/logger";
import type { GenerationOperationStore } from "./mcpGenerationTools";
import type { ProductionActionResult, ProductionRun } from "../productionRun/productionRunTypes";
import { assertPendingSpendIdentity, listPendingSpendConfirms, projectPendingSpendConfirm } from "../productionRun/productionPendingSpend";
import type { PendingSpendConfirm, PendingSpendRead } from "../shared/contracts/pendingSpendConfirm";
import type { CanvasHandOver } from "./canvasHandOver";

type RunReader = Readonly<{
  read(projectId: string, runId: string): ProductionRun | null;
  list(projectId: string): readonly { runId: string }[];
}>;

export type PendingSpendActionDeps = Readonly<{
  isProjectOpen: (projectId: string) => boolean;
  runs: RunReader;
  operations: Pick<GenerationOperationStore, "withdraw" | "removeShot" | "restoreShot">;
  /** 把这几镜交给画布（`canvasHandOver.handOver`）：卡上点了「生成」那一下 = `by: "gesture"`。 */
  handOver: CanvasHandOver["handOver"];
  now?: () => string;
}>;

/**
 * Nomi 自己的语义码前缀。只有这些才允许出现在 `reason` 里——供应商与凭据文本照旧只进日志。
 */
const NOMI_FAILURE_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const NOMI_FAILURE_PREFIXES = ['generation_', 'run_', 'storyboard_', 'capability_', 'project_', 'canvas_'];

/** 这次失败的**语义码**（哪一步不成）。认不出来的一律不带出去。 */
export function spendFailureReason(error: unknown): string | undefined {
  const raw = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : error instanceof Error ? error.message : undefined;
  if (!raw || !NOMI_FAILURE_CODE.test(raw)) return undefined;
  return NOMI_FAILURE_PREFIXES.some((prefix) => raw.startsWith(prefix)) ? raw : undefined;
}

/**
 * 卡上的动作没做成。卡上四个动作没有一个会提交（交给画布的那一下只记决定、开同意，真正的派发在画布那一侧逐镜落账），
 * 所以这里失败一定是「没发起、没花钱」：`generation_quote_changed`（卡上的内容刚变了，看一眼再按）是可预期的，其余进日志。
 */
function failed(error: unknown): ProductionActionResult {
  const reason = spendFailureReason(error);
  const changed = reason === "generation_quote_changed" || reason === "generation_presentation_stale";
  if (!changed) logWarn("capability", "spend-card-action-failed", { code: reason ?? "unknown" }, error);
  return { ok: false, code: "failed", message: changed ? "generation_quote_changed" : "generation_not_started", ...(reason && !changed ? { reason } : {}) };
}

const quoteChanged = (): ProductionActionResult => failed(Object.assign(new Error("generation_quote_changed"), { code: "generation_quote_changed" }));

type SpendCardActionInput = Readonly<{
  projectId: string;
  operationId: string;
  quoteId: string;
  presentationId?: string;
  presentationEpoch?: number;
  planVersion?: number;
}>;

/** 卡带来的身份对不上此刻这一张（Agent 改了稿 / 节点换了 / 重新出价）→ 拒。 */
function cardIsCurrent(pending: PendingSpendConfirm, input: SpendCardActionInput): boolean {
  if (!input.quoteId || input.quoteId !== pending.quoteId) return false;
  try {
    assertPendingSpendIdentity(pending, {
      presentationId: input.presentationId ?? pending.presentationId,
      presentationEpoch: input.presentationEpoch ?? pending.presentationEpoch,
      planVersion: input.planVersion ?? pending.planVersion,
      quoteId: input.quoteId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 进程内那一份编排。能力核没起来（或已经停了）时它是 `null`——写动作一律 fail-closed：回 `unavailable`。
 */
let actions: ReturnType<typeof createPendingSpendActions> | null = null;

export function installPendingSpendActions(deps: PendingSpendActionDeps | null): void {
  actions = deps ? createPendingSpendActions(deps) : null;
}

/**
 * 能力核装好之后那条读口（交给 `residentSurfaceLifecycle` 的 ready 相，再由它喂对话投影）。
 * 只在 `installPendingSpendActions(deps)` 之后才会被交出去，所以这里不再判「没装」——那是 ready 相的类型保证。
 */
export function readInstalledPendingSpend(projectId: string): Extract<PendingSpendRead, { surface: "ready" }> {
  if (!actions) throw new Error("pending spend actions are not installed");
  return { surface: "ready", rows: actions.listPendingSpend(projectId) };
}

/** 卡上「生成」/「全部生成（N）」/「生成剩下 N 段」/「再试一次」：把这几镜交给画布。 */
export async function handOverPendingSpendShots(input: SpendCardActionInput & { shotIds: readonly string[] }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.handOverShots(input);
}

/** 卡上「取消」：收回这一次出价（没交出去的不再交，已经在交的照常交完）。 */
export async function discardPendingSpendConfirmation(input: SpendCardActionInput): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.discardPendingSpend(input);
}

/** 卡上「不生成 ×」：这一镜不生成，再点一次恢复。 */
export async function removePendingSpendShot(input: SpendCardActionInput & { shotId: string }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.removeShot(input);
}

/** 卡上「不生成 ×」再点一次：这一镜回到卡上等人决定。 */
export async function restorePendingSpendShot(input: SpendCardActionInput & { shotId: string }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.restoreShot(input);
}

export function pendingSpendDependencies(input: Readonly<{
  isProjectOpen: (projectId: string) => boolean;
  repository: Readonly<{
    read(projectId: string, runId: string): ProductionRun | null;
    list?(projectId: string): readonly { runId: string }[];
  }>;
  operations: PendingSpendActionDeps["operations"];
  handOver: PendingSpendActionDeps["handOver"];
}>): PendingSpendActionDeps {
  return {
    isProjectOpen: input.isProjectOpen,
    runs: {
      read: (projectId, runId) => input.repository.read(projectId, runId),
      list: (projectId) => (typeof input.repository.list === "function" ? input.repository.list(projectId) : []),
    },
    operations: input.operations,
    handOver: input.handOver,
  };
}

export function createPendingSpendActions(deps: PendingSpendActionDeps) {
  const now = deps.now ?? (() => new Date().toISOString());

  const readRuns = (projectId: string): ProductionRun[] => {
    const runs: ProductionRun[] = [];
    for (const summary of deps.runs.list(projectId)) {
      const run = deps.runs.read(projectId, summary.runId);
      if (run) runs.push(run);
    }
    return runs;
  };

  /** 面板要显示的那些。空数组 = 面板上一张付费卡都不该出现。画布单镜 Run 不在列表里，刹车要读的那几个按号现读。 */
  const listPendingSpend = (projectId: string): readonly PendingSpendConfirm[] => {
    if (!deps.isProjectOpen(projectId)) return Object.freeze([]);
    return listPendingSpendConfirms(readRuns(projectId), (runId) => deps.runs.read(projectId, runId));
  };

  /** 写动作共用的读：和面板上那张卡同一个投影（一笔正由档位代答的生成，面板上没有卡，这里也读不到）。 */
  const pendingFor = (projectId: string, operationId: string): PendingSpendConfirm | undefined => {
    const run = deps.runs.read(projectId, operationId);
    return run ? projectPendingSpendConfirm(run, (runId) => deps.runs.read(projectId, runId)) : undefined;
  };

  const handOverShots = async (input: SpendCardActionInput & { shotIds: readonly string[] }): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to hand over" };
    if (!cardIsCurrent(pending, input)) return quoteChanged();
    const requested = [...new Set(input.shotIds)];
    const onCard = new Map(pending.shots.map((shot) => [shot.shotId, shot]));
    if (requested.length === 0 || requested.some((shotId) => !onCard.has(shotId))) return failed(Object.assign(new Error("generation_scope_invalid"), { code: "generation_scope_invalid" }));
    // 连点两下 / 连按回车：前一下已经把这几镜交出去了 → 原样回成功，不再记第二笔。
    if (requested.every((shotId) => onCard.get(shotId)!.offer === "handing_over")) return { ok: true, code: "handed_over" };
    // 只交还在等卡上决定的镜（还没决定 / 确定没发出去）；结果未知的不许再交一次（钱可能已经花了）。
    if (requested.some((shotId) => onCard.get(shotId)!.offer !== "undecided" && onCard.get(shotId)!.offer !== "not_sent")) return quoteChanged();
    try {
      await deps.handOver({ projectId: input.projectId, runId: input.operationId, shotIds: requested, by: "gesture" });
      return { ok: true, code: "handed_over" };
    } catch (error) {
      return failed(error);
    }
  };

  /**
   * 「取消」= **收回这一次出价**，不是对这份计划说「不」（2026-09-22 用户拍板「× 只关这次请求，节点和草稿都留着」）。
   * 镜头、参数、画布上的节点一个不动；对同一份草稿再 `generate` 就是重新出价。
   *
   * 卡已经没有了（都交到了画布手里、出价自己关了，或另一个取消已经收回）：如实说那一次出价的结局，不报「没有可撤的」。
   * 回给卡的 `batchStopped` 只在这一次出价里真有镜交给过画布时才带：交出去几段（交到了 / 结果未知 / 还在交）、没发几段。
   */
  const discardPendingSpend = async (input: SpendCardActionInput): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) {
      const run = deps.runs.read(input.projectId, input.operationId);
      const presentation = currentPresentation(run?.generationPlan);
      if (!run || !presentation) return { ok: false, code: "failed", message: "no pending generation to discard" };
      // 卡带的是被顶掉的那一次出价（Agent 重新出过价）：那张卡早已不是这一次，不替它报这一次的结局。
      if (input.presentationId && presentation.presentationId && input.presentationId !== presentation.presentationId) return quoteChanged();
      return discarded(run);
    }
    // 改了内容的不认（Agent 改稿 / 重新出价）：改过之后卡上摆的是他点取消那一刻没看到的东西，晚到的取消不替他关。
    if (!cardIsCurrent(pending, input)) return quoteChanged();
    try {
      // 没决定的镜不生成（关的原因记成 user_closed）；还没绑上画布的那几笔在同一条命令里记成收回，
      // 绑上了、还没轮到的由账本的变更订阅当场收回同意（`withdrawQueuedHandOvers`）；已经在交的照常交完，算「交出去了」。
      await deps.operations.withdraw(input.projectId, input.operationId, now(), "user_closed");
      const final = deps.runs.read(input.projectId, input.operationId);
      return final ? discarded(final) : { ok: true, code: "discarded" };
    } catch (error) {
      return failed(error);
    }
  };

  const discarded = (run: ProductionRun): ProductionActionResult => {
    const outcome = generationPresentationOutcome(run);
    const handedOver = Boolean(currentPresentation(run.generationPlan)?.handOvers?.length);
    return {
      ok: true, code: "discarded",
      ...(outcome && handedOver ? { batchStopped: { sent: outcome.generating.length, notSent: outcome.undecided.length + outcome.failedBeforeSending.length } } : {}),
    };
  };

  /** 「不生成 ×」：这一镜不生成，节点留在画布上。连点两下 → 第二下原样回成功。 */
  const removeShot = async (input: SpendCardActionInput & { shotId: string }): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    if (!deps.operations.removeShot) return { ok: false, code: "unavailable" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to change" };
    if (!cardIsCurrent(pending, input)) return quoteChanged();
    const shot = pending.shots.find((entry) => entry.shotId === input.shotId);
    if (!shot) return failed(Object.assign(new Error("generation_scope_invalid"), { code: "generation_scope_invalid" }));
    if (shot.offer === "removed") return { ok: true, code: "shot_removed" };
    if (shot.offer !== "undecided" && shot.offer !== "not_sent") return quoteChanged();
    try {
      await deps.operations.removeShot(input.projectId, input.operationId, input.shotId, now());
      return { ok: true, code: "shot_removed" };
    } catch (error) {
      return failed(error);
    }
  };

  /** 「不生成 ×」再点一次：这一镜回到卡上等人决定。连点两下 → 第二下原样回成功。 */
  const restoreShot = async (input: SpendCardActionInput & { shotId: string }): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    if (!deps.operations.restoreShot) return { ok: false, code: "unavailable" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to change" };
    if (!cardIsCurrent(pending, input)) return quoteChanged();
    const shot = pending.shots.find((entry) => entry.shotId === input.shotId);
    if (!shot) return failed(Object.assign(new Error("generation_scope_invalid"), { code: "generation_scope_invalid" }));
    if (shot.offer === "undecided") return { ok: true, code: "shot_restored" };
    try {
      await deps.operations.restoreShot(input.projectId, input.operationId, input.shotId, now());
      return { ok: true, code: "shot_restored" };
    } catch (error) {
      return failed(error);
    }
  };

  return { listPendingSpend, handOverShots, discardPendingSpend, removeShot, restoreShot };
}
