// Agent 面板付费确认卡的**编排**（P1 · 2026-09-11）。
//
// ── 它在解决哪个真实摩擦 ──
//
// Agent 在面板里建好一份生成草稿之后，「要不要花这笔钱」这个问题此前在面板上一个字都没有：
// 模型面看不见付费能力（`paidBoundary.ts`：`effect:"paid"` 不投影到内部 profile，所以模型
// 自己发不起一次付费调用），而宿主这一侧也从没长出一个入口。用户只能自己去画布上一个个点。
//
// 这个模块就是那个入口，而且**它就是那道闸本身**：卡上那一下点击是一次真人手势，
// 主进程据此签一张收据，收据再去开 Run 自己的付费门。三件事的顺序不能换：
//
//   requestGenerationGate（封印 + 开门，钱的额度在这里被冻住）
//     → 主进程手势证明 + 铸收据（这一步才把「真人点过了」变成可验证的事实）
//     → authorizeGeneration（用收据决门）→ 一次性消费收据 → start
//
// ── 为什么不是「渲染层自己发 gate.decide」──
//
// 那条路今天存在（`productionRunIpc` 的 `humanGesture` 章），但它只证「来自受信窗口」。
// 付费卡是**钱**的闸，值得走完整的挑战-收据链：收据里冻着 gateId / digest / 报价，
// 任何一处对不上就批不动。这样「收据 = 实际执行」是被机器验的，不是被注释保证的。
//
// ── 「改参数」为什么必须撤授权 ──
//
// 见 `productionRunReducer.ts` 的 `generation.revise`：改了载荷还沿用旧授权，
// 面板收据上写的和真正跑的就分叉了，而用户是照着收据点的头。
import type { ApprovalReceiptAuthority } from "./approvalReceipt";
import type { DispatchContext } from "./dispatcher";
import type { GenerationOperationStore, GenerationReviseInput } from "./mcpGenerationTools";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectLeaseV2 } from "./projectLease";
import type { ModelPricing } from "../productionRun/shotPricing";
import type { ProductionActionResult, ProductionRun } from "../productionRun/productionRunTypes";
import { listPendingSpendConfirms, projectPendingSpendConfirm } from "../productionRun/productionPendingSpend";
import type { PendingSpendConfirm } from "../shared/contracts/pendingSpendConfirm";

type RunReader = Readonly<{
  read(projectId: string, runId: string): ProductionRun | null;
  list(projectId: string): readonly { runId: string }[];
}>;

export type RendererGestureTarget = Readonly<{ webContentsId: number; frameId: number; origin: string }>;

export type PendingSpendActionDeps = Readonly<{
  isProjectOpen: (projectId: string) => boolean;
  runs: RunReader;
  operations: GenerationOperationStore;
  planning: NonNullable<DispatchContext["generationPlanning"]>;
  requestGenerationGate: NonNullable<DispatchContext["requestGenerationGate"]>;
  authorizeGeneration: NonNullable<DispatchContext["authorizeGeneration"]>;
  receipts: ApprovalReceiptAuthority;
  /** 当前提交面（渲染窗口）的身份。缺席 = 没有窗口可以代表真人，付费一律 fail-closed。 */
  rendererTarget: () => RendererGestureTarget | null;
  /** 当前被提交的项目绑定（`canvasReadSurfaceRuntime.getCommittedProjectSelection`）。 */
  committedBinding: () => ProjectBinding | null;
  leaseFor: (binding: ProjectBinding) => Promise<ProjectLeaseV2>;
  resolvePricing: (providerId: string, modelId: string) => ModelPricing | undefined;
  now?: () => string;
}>;

function failed(error: unknown): ProductionActionResult {
  return { ok: false, code: "failed", message: error instanceof Error ? error.message : String(error) };
}

function challengeTokenOf(value: unknown): string {
  const token = value && typeof value === "object" && !Array.isArray(value)
    && (value as { handoff?: { challengeToken?: unknown } }).handoff?.challengeToken;
  if (typeof token !== "string" || !token.trim()) throw new Error("generation_challenge_unavailable");
  return token.trim();
}

/**
 * 装配这一层要的那几件，从能力核已经建好的实例里取。
 *
 * 为什么它住在这里而不是 `appIntegration` 的那段 try：`appIntegration` 是启动编排的家，
 * 每加一条能力就往那段里塞十几行，它就会长成一个谁都不敢碰的巨壳（R9/R12 的 800 行门岗
 * 2026-09-11 就是被这一段顶破的）。**「这条能力要什么」属于这条能力自己**。
 */
/**
 * 进程内那一份编排。能力核没起来（或已经停了）时它是 `null`——四个动作一律 fail-closed：
 * 读回空、写回 `unavailable`。绝不「先跑起来再说」，那是钱这条轴上最不该有的默认。
 */
let actions: ReturnType<typeof createPendingSpendActions> | null = null;

export function installPendingSpendActions(deps: PendingSpendActionDeps | null): void {
  actions = deps ? createPendingSpendActions(deps) : null;
}

/** Agent 面板付费确认卡（2026-09-11 P1）。四个动作走同一个编排：读、改参数、丢弃、确认并开跑。 */
export function listPendingSpendConfirmations(projectId: string): readonly PendingSpendConfirm[] {
  return actions?.listPendingSpend(projectId) ?? [];
}

export async function revisePendingSpendConfirmation(input: { projectId: string; operationId: string; shotId?: string; patch: Record<string, unknown> }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.revisePendingSpend(input);
}

export async function discardPendingSpendConfirmation(input: { projectId: string; operationId: string }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.discardPendingSpend(input);
}

export async function confirmPendingSpendConfirmation(input: { projectId: string; operationId: string; shotIds?: readonly string[] }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.confirmPendingSpend(input);
}

export function pendingSpendDependencies(input: Readonly<{
  isProjectOpen: (projectId: string) => boolean;
  repository: Readonly<{
    read(projectId: string, runId: string): ProductionRun | null;
    list?(projectId: string): readonly { runId: string }[];
  }>;
  operations: GenerationOperationStore;
  planning: NonNullable<DispatchContext["generationPlanning"]>;
  requestGenerationGate: NonNullable<DispatchContext["requestGenerationGate"]>;
  authorizeGeneration: NonNullable<DispatchContext["authorizeGeneration"]>;
  receipts: ApprovalReceiptAuthority;
  rendererTarget: () => RendererGestureTarget | null;
  committedSelection: () => (ProjectBinding & { canonicalRootDigest?: string }) | null;
  leaseFor: (binding: ProjectBinding) => Promise<ProjectLeaseV2>;
  resolvePricing: (providerId: string, modelId: string) => ModelPricing | undefined;
}>): PendingSpendActionDeps {
  return {
    isProjectOpen: input.isProjectOpen,
    runs: {
      read: (projectId, runId) => input.repository.read(projectId, runId),
      list: (projectId) => (typeof input.repository.list === "function" ? input.repository.list(projectId) : []),
    },
    operations: input.operations,
    planning: input.planning,
    requestGenerationGate: input.requestGenerationGate,
    authorizeGeneration: input.authorizeGeneration,
    receipts: input.receipts,
    rendererTarget: input.rendererTarget,
    // 只取绑定那三件，`canonicalRootDigest` 不进来：这一层要回答的是「哪个项目」，
    // 不是「它的根目录长什么样」。
    committedBinding: () => {
      const selection = input.committedSelection();
      return selection
        ? { projectId: selection.projectId, immutableProjectUuid: selection.immutableProjectUuid, projectGeneration: selection.projectGeneration }
        : null;
    },
    leaseFor: input.leaseFor,
    resolvePricing: input.resolvePricing,
  };
}

export function createPendingSpendActions(deps: PendingSpendActionDeps) {
  const now = deps.now ?? (() => new Date().toISOString());

  const readRuns = (projectId: string): ProductionRun[] => {
    const summaries = deps.runs.list(projectId);
    const runs: ProductionRun[] = [];
    for (const summary of summaries) {
      const run = deps.runs.read(projectId, summary.runId);
      if (run) runs.push(run);
    }
    return runs;
  };

  /** 面板要显示的那些。空数组 = 面板上一张付费卡都不该出现。 */
  const listPendingSpend = (projectId: string): readonly PendingSpendConfirm[] => {
    if (!deps.isProjectOpen(projectId)) return Object.freeze([]);
    return listPendingSpendConfirms(readRuns(projectId), deps.resolvePricing);
  };

  const pendingFor = (projectId: string, operationId: string): PendingSpendConfirm | undefined => {
    const run = deps.runs.read(projectId, operationId);
    return run ? projectPendingSpendConfirm(run, deps.resolvePricing) : undefined;
  };

  const leased = async (projectId: string): Promise<ProjectLeaseV2> => {
    const binding = deps.committedBinding();
    if (!binding || binding.projectId !== projectId) throw new Error("run_not_open");
    return deps.leaseFor(binding);
  };

  /**
   * 卡上改了提示词/参数/模型。撤掉还没被点头的授权、把改动落到候选、回 draft 等重新封印。
   * 价格由下一次投影现算——数只有一个产地。
   */
  const revisePendingSpend = async (input: Readonly<{
    projectId: string;
    operationId: string;
    shotId?: string;
    patch: Readonly<Record<string, unknown>>;
  }>): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    if (!deps.operations.revise) return { ok: false, code: "unavailable" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to revise" };
    const revision: GenerationReviseInput = {
      ...(input.shotId ? { shotId: input.shotId } : {}),
      patch: input.patch,
    };
    try {
      await deps.operations.revise(input.projectId, input.operationId, revision, now());
      return { ok: true, code: "revised" };
    } catch (error) {
      return failed(error);
    }
  };

  /** × = 丢弃这份草稿。取消计划（画布上的占位节点由既有落地链按 detached 收尾）。 */
  const discardPendingSpend = async (input: Readonly<{ projectId: string; operationId: string }>): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to discard" };
    try {
      await deps.operations.cancel(input.projectId, input.operationId, now());
      return { ok: true, code: "discarded" };
    } catch (error) {
      return failed(error);
    }
  };

  /**
   * 「生成 ¥X」。**这一下点击就是那次真人手势**，收据在这里签出来。
   *
   * 顺序里没有一步可以省：`requestGenerationGate` 先封印并冻住额度（此刻价格才成为合同的一部分），
   * 收据把手势绑到那个 gateId + digest 上，`authorizeGeneration` 只认对得上的收据，
   * 消费一次之后同一张收据再也批不动第二次。
   */
  const confirmPendingSpend = async (input: Readonly<{ projectId: string; operationId: string; shotIds?: readonly string[] }>): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    let pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to confirm" };
    // 「逐镜」= 只生成这一镜。它不是一个显示选项，是一次**真的把计划收窄**（同 trial_narrow 的家族）：
    // 没被选中的镜取消勾选，封印时它们就不进合同，用户付的钱和他看到的那个数一致。
    if (input.shotIds && input.shotIds.length > 0 && input.shotIds.length < pending.shots.length) {
      if (!deps.operations.revise) return { ok: false, code: "unavailable" };
      const keep = new Set(input.shotIds);
      try {
        for (const shot of pending.shots) {
          if (keep.has(shot.shotId)) continue;
          await deps.operations.revise(input.projectId, input.operationId, { shotId: shot.shotId, patch: {}, included: false }, now());
        }
      } catch (error) {
        return failed(error);
      }
      pending = pendingFor(input.projectId, input.operationId);
      if (!pending) return { ok: false, code: "failed", message: "no pending generation to confirm" };
    }
    const target = deps.rendererTarget();
    if (!target) return { ok: false, code: "unavailable" };
    try {
      const lease = await leased(input.projectId);
      const params = { operationId: input.operationId };
      const gate = await deps.requestGenerationGate({ params, lease });
      const token = challengeTokenOf(gate);
      const attestation = deps.receipts.createMainProcessGestureAttestation(token, { ...target, decision: "accept" });
      const minted = deps.receipts.mintReceipt(token, attestation);
      await deps.authorizeGeneration({ params, lease, receipt: minted.receipt });
      deps.receipts.consumeReceipt(minted.token);
      await deps.planning({ capability: "start", params, lease, origin: { host: "nomi", actorId: "agent-panel" } });
      return { ok: true, code: "spend_confirmed" };
    } catch (error) {
      return failed(error);
    }
  };

  return { listPendingSpend, revisePendingSpend, discardPendingSpend, confirmPendingSpend };
}
