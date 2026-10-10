import { currentPresentation, generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { anySubmissionMayHaveReachedProvider, jobsForShot } from "../shared/productionShotJobs";
import { withSpendReferencePreviews, resolveSpendReferenceInputs, projectSpendReferenceAssets, type SpendReferenceAssets } from './pendingSpendReferences';
import { generationPlanInputSchema } from '../shared/agentCapabilities/generationPlanSchemas';
import { sameProjectAgentBinding } from '../shared/projectBinding';
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
import { logInfo, logWarn } from "../logging/logger";
import { awaitShotHandover } from "../productionRun/shotProviderHandover";
import type { ApprovalReceiptAuthority } from "./approvalReceipt";
import type { DispatchContext } from "./dispatcher";
import type { GenerationOperationStore, GenerationReviseInput } from "./mcpGenerationTools";
import type { PlanCandidate } from "./executionContract";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectLeaseV2 } from "./projectLease";
import type { ModelPricing } from "../productionRun/shotPricing";
import type { ProductionActionResult, ProductionRun } from "../productionRun/productionRunTypes";
import { assertPendingSpendIdentity, listPendingSpendConfirms, projectPendingSpendConfirm } from "../productionRun/productionPendingSpend";
import { decideGenerationSpend } from "./generationSpendDecision";
import { productionShotActionFailureOf } from "./appIntegrationProductionActions";
import type { PendingSpendConfirm, PendingSpendRead, PendingSpendRevised } from "../shared/contracts/pendingSpendConfirm";
import { spendCancelRequested, registerCancel, sealedOutcome, serializeCardAction } from "./spendOperationArbiter";

import { admitShotsForDispatch, type LandShotsOnCanvas } from "../productionRun/shotLandingAdmission";

/** 让出一拍事件循环：排在这之前到达的 IPC（比如 ×）先处理完。 */
const yieldToIncomingActions = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

type RunReader = Readonly<{
  read(projectId: string, runId: string): ProductionRun | null;
  list(projectId: string): readonly { runId: string }[];
}>;

export type RendererGestureTarget = Readonly<{ webContentsId: number; frameId: number; origin: string }>;

export type PendingSpendActionDeps = Readonly<{
  referenceAssets?: SpendReferenceAssets;
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
  /**
   * 候选补丁并进这一镜的那条规则（`generationPlanPatch.resolvePlanPatch`：换模型 / 换生成方式时种类跟过去、
   * 这一对在目录里真有、点名的参数当场判）。Agent 改草稿走的就是它；卡上改一下也只能走它——以前卡这一条直接把
   * 补丁并进候选，于是卡上切到「图生图」只改了模式 id、种类还是文生图，派发时按文生图挑供应商 mapping，
   * 带参考图的那一下在出站前被拒（2026-10-02 pb02）。必填：少接一根线编译期就红。
   */
  normalizePatch: (base: PlanCandidate, patch: Partial<Omit<PlanCandidate, "candidateId" | "revision">>) => Partial<Omit<PlanCandidate, "candidateId" | "revision">>;
  /**
   * 先落节点、再发请求（架构③）：确认那一下先把这一镜落到画布上（唯一准入点的落地器），落下了才批、才派。
   * 落不下来卡就留在原地（这一镜没决定、什么都没批），再按一次「生成」就是重试。必填：少接编译期就红。
   */
  landShots: LandShotsOnCanvas;
  now?: () => string;
}>;

/**
 * 失败那一句要说的是**事实**，不是一句放之四海的安慰话。
 *
 * 「暂时无法确认这一步的结果」在「根本没发起」的情况下是误导——它暗示可能已经提交、可能已经
 * 扣了钱，于是用户不敢再按，转而去找一个并不存在的任务。所以这一层按账本分两种话：
 * 只要**没有任何一份提交意图落过盘**（`submit_intent_persisted` 是那条线），就是
 * `generation_not_started`（没发起、没花钱，改一下再按）；一旦落过，才是
 * `generation_execution_failed`（结果未知，先去核对，别再付一次）。
 *
 * `started` 由调用方从 Run 的作业状态里读出来——是可验证的事实，不是猜。
 */
/**
 * Nomi 自己的语义码前缀。只有这些才允许出现在 `reason` 里——供应商与凭据文本照旧只进日志
 * （收敛本身没有放松：`message` 这一格仍然只有那两个账本事实）。
 */
const NOMI_FAILURE_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const NOMI_FAILURE_PREFIXES = ['generation_', 'run_', 'storyboard_', 'capability_', 'project_'];

/** 这次失败的**语义码**（哪一步不成），与账本事实分开。认不出来的一律不带出去。 */
export function spendFailureReason(error: unknown): string | undefined {
  const raw = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : error instanceof Error ? error.message : undefined;
  if (!raw || !NOMI_FAILURE_CODE.test(raw)) return undefined;
  return NOMI_FAILURE_PREFIXES.some((prefix) => raw.startsWith(prefix)) ? raw : undefined;
}

function failed(error: unknown, started = true): ProductionActionResult {
  // Provider text is private diagnostics, never renderer or model copy.
  const safe = error instanceof Error && ['generation_quote_changed', 'generation_presentation_stale', 'run_not_open', 'generation_scope_invalid'].includes(error.message)
    ? error.message
    : started ? 'generation_execution_failed' : 'generation_not_started';
  const reason = spendFailureReason(error);
  // 「私有诊断」此前**谁都拿不到**：原话在这一行被换成兜底码就消失了，主进程日志里一个字都没有。
  // 于是付费卡按下去失败时，能排查的人手上只有一句兜底话（2026-09-21 Pass 3b：一条真机走查红在
  // 这里，查不出为什么，只能靠猜）。原话进日志，不进用户面。
  if (safe === 'generation_execution_failed' || safe === 'generation_not_started') {
    logWarn("capability", "spend-confirm-failed", { code: safe }, error);
  }
  // 没发起的那一档还要说清是哪一种（第 11 条：卡上只给存在的出路）。按错误类型认，与重做 / 续拍同一个闭集；
  // 发起过的那一档只说「结果未知、先去核对」，种类不改变那句话，所以不带。
  const failure = safe === 'generation_not_started' ? productionShotActionFailureOf(error) : undefined;
  return { ok: false, code: "failed", message: safe, ...(reason && reason !== safe ? { reason } : {}), ...(failure ? { failure } : {}) };
}

type SpendCardActionInput = Readonly<{
  projectId: string;
  operationId: string;
  quoteId: string;
  presentationId?: string;
  presentationEpoch?: number;
  planVersion?: number;
}>;

function assertCardIdentity(pending: PendingSpendConfirm, input: SpendCardActionInput): void {
  if (input.presentationId === undefined && input.presentationEpoch === undefined && input.planVersion === undefined) return;
  assertPendingSpendIdentity(pending, {
    presentationId: input.presentationId ?? pending.presentationId,
    presentationEpoch: input.presentationEpoch ?? pending.presentationEpoch,
    planVersion: input.planVersion ?? pending.planVersion,
    quoteId: input.quoteId,
  });
}

function staleCardResult(pending: PendingSpendConfirm, input: SpendCardActionInput): ProductionActionResult | undefined {
  try { assertCardIdentity(pending, input); return undefined; }
  catch (error) { return failed(error, false); }
}

/**
 * 装配这一层要的那几件，从能力核已经建好的实例里取。
 *
 * 为什么它住在这里而不是 `appIntegration` 的那段 try：`appIntegration` 是启动编排的家，
 * 每加一条能力就往那段里塞十几行，它就会长成一个谁都不敢碰的巨壳（R9/R12 的 800 行门岗
 * 2026-09-11 就是被这一段顶破的）。**「这条能力要什么」属于这条能力自己**。
 */
/**
 * 进程内那一份编排。能力核没起来（或已经停了）时它是 `null`——三个**写**动作一律 fail-closed：
 * 回 `unavailable`。绝不「先跑起来再说」，那是钱这条轴上最不该有的默认。
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

export async function revisePendingSpendConfirmation(input: { projectId: string; operationId: string; quoteId: string; shotId?: string; patch: Record<string, unknown>; presentationId?: string; presentationEpoch?: number; planVersion?: number }): Promise<ProductionActionResult & PendingSpendRevised> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.revisePendingSpend(input);
}

export async function discardPendingSpendConfirmation(input: SpendCardActionInput): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.discardPendingSpend(input);
}

/** 付费卡上「生成这张 / 这段」：只批这一镜（`shotId`）。卡上只剩一镜时可以不点名。 */
export async function confirmPendingSpendConfirmation(input: SpendCardActionInput & { shotId?: string }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.confirmPendingSpend(input);
}

/**
 * 付费卡上「生成剩下 N 张 / 段」（2026-10-01 用户拍板）：卡上还没决定的每一张各点一次「生成这张」。
 * `shotIds` 必须就是此刻卡上那一叠（去掉过的不在里面）；每张各封一份只盖它自己的授权，没有总价授权。
 */
export async function confirmRemainingSpendShots(input: SpendCardActionInput & { shotIds: readonly string[] }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.confirmRemainingShots(input);
}

/** 付费卡上「去掉这张 / 这段」：这一镜不生成，卡上剩下的镜照旧等人决定。 */
export async function removePendingSpendShot(input: SpendCardActionInput & { shotId: string }): Promise<ProductionActionResult> {
  if (!actions) return { ok: false, code: "unavailable" };
  return actions.removePendingSpendShot(input);
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
  normalizePatch: PendingSpendActionDeps["normalizePatch"];
  landShots: LandShotsOnCanvas;
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
    normalizePatch: input.normalizePatch,
    landShots: input.landShots,
  };
}

export function createPendingSpendActions(deps: PendingSpendActionDeps) {
  const referenceAssets = deps.referenceAssets ?? projectSpendReferenceAssets;
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

  /**
   * 面板要显示的那些。空数组 = 面板上一张付费卡都不该出现。
   *
   * 待决卡的身份来自持久化的生成展示快照；策略切换不会改写已经展示的卡。
   * 它**只减不增**：任何一笔它说 `false` 的，行为与此前逐字相同。
   */
  const listPendingSpend = (projectId: string): readonly PendingSpendConfirm[] => {
    if (!deps.isProjectOpen(projectId)) return Object.freeze([]);
    return listPendingSpendConfirms(readRuns(projectId), deps.resolvePricing)
      .map(pending => withSpendReferencePreviews(pending, referenceAssets));
  };

  /**
   * 三个写动作共用的读。用同一个谓词是硬要求：一笔正由档位代答的生成，面板上没有卡，
   * 用户也就没有点过什么——此刻再让「改参数 / 丢弃 / 确认」落到它身上，就是在一笔已经
   * 在飞的授权旁边开第二个决定者。
   */
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
  /**
   * 这一下点到的那一镜到底有没有可能离开过这台机器。判据是账本里的作业状态，不是异常的长相，
   * 而且只有一个 owner（`productionShotJobs.anySubmissionMayHaveReachedProvider`）。
   * 一个作业都读不到 = 连 Run 都没有 = 更没发起。
   *
   * **只看这一镜自己的作业**（`jobsForShot`）：多镜卡上前面几张早就发出去了，第 3 张在发出前失败时，
   * 不许借它们的状态说「可能已提交」（2026-10-01「生成剩下 N 张」写测试时抓到的：整个 Run 一起看，
   * 第 2 张只要第 1 张发过就永远是「结果未知」）。
   */
  const anySubmissionStarted = (projectId: string, operationId: string, shotId: string): boolean => {
    const run = deps.runs.read(projectId, operationId);
    return run ? anySubmissionMayHaveReachedProvider(jobsForShot(run, shotId)) : false;
  };

  /**
   * 这一次出价里，卡上的「决定」（生成这张 / 去掉这张 / 生成剩下的每一张）换掉过的每一版报价（付费卡①，2026-10-02）。
   *
   * 卡上每决定一张，报价就换一版；用户点 ×，那一下带着的是他卡上那一版——卡上那一下还在路上（或主进程忙、
   * × 晚到几秒）时，往往已经被那一下换掉了。× 不排队，要的就是能打断；拿「报价对不上」把它挡回去，等于让用户追着
   * 一张一直在变的卡点 ×（真 App 实测：「生成剩下 6 张」6 张一直发完、× 一下都没进去；「生成这张」紧接着点 ×，× 被挡回去、
   * 卡还开着）。所以 × 认这一次出价里被卡上的决定换掉过的任何一版：决定只会让卡上少几镜，剩下的正是他点 × 时看着的那些。
   * 改了内容的不认（卡上改参数、Agent 改草稿）：改过之后卡上摆的是他点 × 那一刻没看到的东西，晚到的 × 不替他关
   * （C09「a delayed close cannot dismiss a newer displayed quote」）。Agent 重新出价是新的一次出价（`openedAt` / `fromGate`
   * 不同），旧卡上的 × 也照旧挡回去。
   */
  const replacedQuotes = new Map<string, Readonly<{ presentation: string; quotes: Set<string> }>>();
  const openPresentationOf = (projectId: string, operationId: string): string | undefined => {
    const presentation = currentPresentation(deps.runs.read(projectId, operationId)?.generationPlan);
    return presentation && !presentation.closed ? `${presentation.openedAt}#${presentation.fromGate}` : undefined;
  };
  /** 卡上这一下要从这一版报价出发（它成了就会换掉这一版）：记下来，× 带着它来也认。 */
  const noteReplacing = (projectId: string, operationId: string, quoteId: string): void => {
    const presentation = openPresentationOf(projectId, operationId);
    if (!presentation) return;
    const key = `${projectId}:${operationId}`;
    const entry = replacedQuotes.get(key);
    if (entry?.presentation === presentation) entry.quotes.add(quoteId);
    else replacedQuotes.set(key, { presentation, quotes: new Set([quoteId]) });
  };
  const replacedInOpenPresentation = (projectId: string, operationId: string, quoteId: string): boolean => {
    const entry = replacedQuotes.get(`${projectId}:${operationId}`);
    return Boolean(entry && entry.presentation === openPresentationOf(projectId, operationId) && entry.quotes.has(quoteId));
  };

  /** 这一镜在这一次出价里已经决定了（点过「生成这张」或「去掉这张」），宿主现算。 */
  const shotAlreadyDecided = (projectId: string, operationId: string, shotId: string): boolean => {
    const run = deps.runs.read(projectId, operationId);
    const outcome = run ? generationPresentationOutcome(run) : undefined;
    return Boolean(outcome && (outcome.generating.includes(shotId) || outcome.failedBeforeSending.includes(shotId) || outcome.removed.includes(shotId)));
  };


  const revisePendingSpend = async (input: Readonly<{
    projectId: string;
    operationId: string;
    quoteId: string;
    shotId?: string;
    patch: Readonly<Record<string, unknown>>;
    presentationId?: string;
    presentationEpoch?: number;
    planVersion?: number;
  }>): Promise<ProductionActionResult & PendingSpendRevised> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    if (!deps.operations.revise) return { ok: false, code: "unavailable" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to revise" };
    const stale = staleCardResult(pending, input); if (stale) return stale;
    if (!input.quoteId || input.quoteId !== pending.quoteId) return failed(new Error("generation_quote_changed"));
    const capturedRun = deps.runs.read(input.projectId, input.operationId);
    const plan = capturedRun?.generationPlan;
    const shotId = input.shotId ?? (!plan?.shots?.length ? plan?.candidate.candidateId : undefined);
    if (!shotId || !pending.shots.some(shot => shot.shotId === shotId)) {
      return { ok: false, code: "failed", message: "generation_shot_not_found" };
    }
    // The displayed scope can contain one row of a many-shot plan. Only the
    // persisted structure determines whether this address is a shot or candidate.
    const revision: GenerationReviseInput = {
      ...(plan?.shots?.length ? { shotId } : {}),
      patch: input.patch,
      expectedRevision: capturedRun?.revision,
    };
    try {
      const binding = deps.committedBinding();
      if (!binding || binding.projectId !== input.projectId) throw new Error('run_not_open');
      const assertCurrent = (): void => {
        const currentBinding = deps.committedBinding();
        if (!deps.isProjectOpen(input.projectId) || !currentBinding || !sameProjectAgentBinding(binding, currentBinding)
          || pendingFor(input.projectId, input.operationId)?.quoteId !== pending.quoteId) throw new Error('generation_quote_changed');
      };
      const { referenceInputs, ...remainingPatch } = input.patch;
      const patch: Record<string, unknown> = { ...remainingPatch };
      if (referenceInputs !== undefined && patch.references !== undefined) throw new Error('generation_reference_invalid');
      if (referenceInputs !== undefined || patch.references !== undefined) {
        const shot = pending.shots.find(shot => shot.shotId === shotId);
        if (!shot) throw new Error('generation_reference_scope_required');
        patch.references = await resolveSpendReferenceInputs({ projectId: input.projectId, binding,
          values: referenceInputs ?? (Array.isArray(patch.references) ? patch.references.map(reference => ({ reference })) : patch.references), existing: shot.references ?? [], assets: referenceAssets, assertCurrent });
      }
      assertCurrent();
      // 并进这一镜的规则只有一条（Agent 改草稿同一条）：种类跟着模型 / 生成方式走，这一对在目录里真有。
      // 按解封后的样子判：`generation.revise` 本来就先撤掉还在等人的那份授权、解封这一镜，再并补丁。
      const sealed = (plan?.shots?.length ? plan.shots.find(shot => shot.shotId === shotId)?.candidate : plan?.candidate) as PlanCandidate | undefined;
      if (!sealed) throw new Error('generation_shot_not_found');
      const merged = deps.normalizePatch({ ...sealed, sealedContractHash: undefined }, patch as Partial<Omit<PlanCandidate, "candidateId" | "revision">>);
      generationPlanInputSchema.parse({ operation: 'patch', operationId: input.operationId, patch: merged,
        ...(input.shotId ? { shotId: input.shotId } : {}) });
      const revised = await deps.operations.revise(input.projectId, input.operationId, { ...revision, patch: merged as Record<string, unknown> }, now());
      const successor = pendingFor(input.projectId, input.operationId);
      if (!successor || successor.planVersion !== revised.planVersion || successor.candidateRevision !== revised.candidate.revision) throw new Error('generation_quote_changed');
      // 回包带着宿主现算的那张卡（正式报价，参考图预览同读口那一份）：卡点下去那一刻拿它对账、封印，不另读一次。
      return { ok: true, code: "revised", quoteId: successor.quoteId, pending: withSpendReferencePreviews(successor, referenceAssets) };
    } catch (error) {
      // 改参数这一步**只动候选**，永远不提交：这里失败一定是「没发起」。
      return failed(error, false);
    }
  };

  /**
   * × = **收回这一次出价**，不是对这份计划说「不」（2026-09-22 下午用户拍板，改窄裁决 D）。
   *
   * 用户原话：「× 只关这次请求，节点和草稿都留着」。所以这里走的是裁决 C 那条边
   * （`operations.withdraw` → `withdrawGenerationPresentation`）：计划**退回 draft / 未 present**，
   * 镜头、参数、锚点、用户手改一个字不丢，画布占位节点一个不删；封印了的先把那道还在等的门撤掉。
   * 对同一份草稿再 `generate` = 重新出价，同一个 `operationId` 还能再出卡。
   *
   * 「计划级终态」只剩用户自己在左侧栏删草稿那一条路（`operations.cancel`）。
   * 2026-09-22 上午那一版在这里调的是 `cancel("declined")`——它让 × 变成计划级终态，于是多镜计划上
   * × 掉三镜的卡会终结整份 33 镜的计划，另外 30 个占位挂在一份已终结的计划上成了孤儿。
   * 再往前那一版调的是 `operations.dismiss`（只置 `cardHidden`、不收门），已随裁决删净。
   * **IPC 名（`discardSpend`）不变**。
   */
  const discardPendingSpend = async (input: SpendCardActionInput): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    const pending = pendingFor(input.projectId, input.operationId);
    // 卡已经没有了：确认抢先落了账（最后一镜授权批下、出价随之 resolved），或另一个 × 已经收回。× 来晚了——如实说封存下来的终态，
    // 不报「没有可撤的」（已交给供应商的不能撤；界面、回执、账本说的是同一件事）。真的什么出价都没有才是失败。
    if (!pending) {
      const outcome = await sealedOutcome(input.projectId, input.operationId, readSealedOutcome(input));
      return outcome ? discarded(outcome) : { ok: false, code: "failed", message: "no pending generation to discard" };
    }
    const stale = staleCardResult(pending, input); if (stale) return stale;
    const replacedByCard = Boolean(input.quoteId && replacedInOpenPresentation(input.projectId, input.operationId, input.quoteId));
    if (!input.quoteId || (input.quoteId !== pending.quoteId && !replacedByCard)) return failed(new Error("generation_quote_changed"));
    // × 不排队（要的就是能打断），但它**同步**登记取消令牌（先于下面任何一个 await）：队里的动作在落画布、拿租约、开门、决门
    // 之前都问这一枚，令牌之后没批下来的镜一律不批；授权已落账的那一镜已经交了，照样在生成（仲裁器注释：「交」的分界）。
    // 「生成剩下 N 张」跑到一半时，批到哪一张就停在哪一张。
    const release = registerCancel(input.projectId, input.operationId);
    try {
      // 没决定的镜不生成（关的原因记成 user_closed）。
      await deps.operations.withdraw(input.projectId, input.operationId, now(), "user_closed");
      // 说结局前先等队里的动作落定，读到的就是宿主最终批下的那一份（封存终态，回执、lane 读同一个口）。
      const outcome = await sealedOutcome(input.projectId, input.operationId, readSealedOutcome(input));
      return discarded(outcome);
    } catch (error) {
      return failed(error, false);
    } finally {
      release();
    }
  };

  const readSealedOutcome = (input: Readonly<{ projectId: string; operationId: string }>) => () => {
    const run = deps.runs.read(input.projectId, input.operationId);
    return run ? generationPresentationOutcome(run) : undefined;
  };
  const discarded = (outcome: ReturnType<typeof generationPresentationOutcome>): ProductionActionResult => ({
    ok: true, code: "discarded",
    ...(outcome ? { batchStopped: { sent: outcome.generating.length, notSent: outcome.undecided.length } } : {}),
  });

  /**
   * 「生成 ¥X」。**这一下点击就是那次真人手势**，收据在这里签出来。
   *
   * 顺序里没有一步可以省：`requestGenerationGate` 先封印并冻住额度（此刻价格才成为合同的一部分），
   * 收据把手势绑到那个 gateId + digest 上，`authorizeGeneration` 只认对得上的收据，
   * 消费一次之后同一张收据再也批不动第二次。
   */
  const confirmPendingSpend = (input: SpendCardActionInput & { shotId?: string }): Promise<ProductionActionResult> =>
    serializeCardAction(input.projectId, input.operationId, () => confirmOneShot(input));

  const confirmOneShot = async (input: SpendCardActionInput & { shotId?: string }): Promise<ProductionActionResult> => {
    if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
    const binding = deps.committedBinding();
    if (!binding || binding.projectId !== input.projectId) return { ok: false, code: 'run_not_open' };
    const assertBindingCurrent = (): void => {
      const current = deps.committedBinding();
      if (!deps.isProjectOpen(input.projectId) || !current || !sameProjectAgentBinding(binding, current)) throw new Error('run_not_open');
    };
    // × 的取消令牌：每个有副作用的步骤之前都问同一枚（仲裁器）。已登记 = 这一镜还没交出去，不再往下。
    const assertNotCancelled = (): void => {
      if (spendCancelRequested(input.projectId, input.operationId)) throw Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' });
    };
    if (spendCancelRequested(input.projectId, input.operationId)) return failed(Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' }), false);
    // 连点两下 / 连按回车（第 8 条）：前一下已经把这一镜批了（排在同一条队里，这里读到的是它之后的 Run）→ 原样回成功，不再批第二次。
    if (input.shotId && shotAlreadyDecided(input.projectId, input.operationId, input.shotId)) return { ok: true, code: "spend_confirmed" };
    const pending = pendingFor(input.projectId, input.operationId);
    if (!pending) return { ok: false, code: "failed", message: "no pending generation to confirm" };
    const stale = staleCardResult(pending, input); if (stale) return stale;
    if (!input.quoteId || input.quoteId !== pending.quoteId) return failed(new Error("generation_quote_changed"));
    // 这一下点的是哪一镜：卡上只剩一镜时可以不点名；点名的必须就在卡上（还没决定）。
    const shotId = input.shotId ?? (pending.shots.length === 1 ? pending.shots[0].shotId : undefined);
    if (!shotId || !pending.shots.some((shot) => shot.shotId === shotId)) return failed(new Error("generation_scope_invalid"), false);
    const multiShot = Boolean(deps.runs.read(input.projectId, input.operationId)?.generationPlan?.shots?.length);
    // 确认 = 放到画布（10-08 拍板）：先经唯一准入点把这一镜落上画布，落下了才批、才派。落不下来什么都不批，
    // 卡留在原地、这一镜还没决定——再按一次就是重试。卡上说的只是事实：没放到画布上、这次没有发出生成请求。
    const landing = await admitShotsForDispatch({ repository: deps.runs, land: deps.landShots, projectId: input.projectId, runId: input.operationId, shotIds: [multiShot ? shotId : undefined] });
    if (spendCancelRequested(input.projectId, input.operationId)) return failed(Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' }), false);
    if (landing.unlanded.length > 0) return { ok: false, code: "failed", message: "generation_not_started", reason: landing.landingFailure?.code ?? "canvas_landing_failed", failure: "canvas_landing_failed" };
    noteReplacing(input.projectId, input.operationId, pending.quoteId);
    const target = deps.rendererTarget();
    if (!target) return { ok: false, code: "unavailable" };
    try {
      const lease = await leased(input.projectId);
      assertBindingCurrent();
      assertNotCancelled();
      if (pendingFor(input.projectId, input.operationId)?.quoteId !== pending.quoteId) throw new Error("generation_quote_changed");
      // 封印 → 铸收据 → 决门 → 消费 → 开跑：这条链只有一份（`generationSpendDecision.ts`）。这一份授权只盖这一镜：
      // 信封、收据、派发都只认它（`mcpGenerationMultiShot.resolveGateScope`），卡上别的镜照旧等人。
      await decideGenerationSpend(
        { requestGenerationGate: async (request) => {
          assertNotCancelled();
          const gate = await deps.requestGenerationGate(request);
          assertBindingCurrent();
          // 开门的中途 × 到了（× 的收回先落账，这道门是在收回之后才封上的）：门不能留着等一个已经关掉的出价。
          if (spendCancelRequested(input.projectId, input.operationId)) {
            await deps.operations.abandonWaitingAuthorization?.(input.projectId, input.operationId, now());
            assertNotCancelled();
          }
          return gate;
        }, authorizeGeneration: async request => {
          assertBindingCurrent();
          assertNotCancelled();
          return deps.authorizeGeneration(request);
        }, planning: deps.planning, receipts: deps.receipts },
        { operationId: input.operationId, lease, decision: { kind: "human-gesture", target }, actorId: "agent-panel", ...(multiShot ? { shotIds: [shotId] } : {}) },
      );
      return { ok: true, code: "spend_confirmed" };
    } catch (error) {
      return failed(error, anySubmissionStarted(input.projectId, input.operationId, shotId));
    }
  };

  /** 这一镜此刻在卡上的样子（不含页码与节点：那两样随别的镜决定而变，和「这一镜要发什么」无关）。 */
  const shownShot = (pending: PendingSpendConfirm | undefined, shotId: string): string | undefined => {
    const shot = pending?.shots.find((entry) => entry.shotId === shotId);
    if (!shot) return undefined;
    const { index: _index, nodeId: _nodeId, ...content } = shot;
    return JSON.stringify(content);
  };

  /**
   * 「生成剩下 N 张 / 段」（2026-10-01 用户拍板）= 把卡上还没决定的每一张各点一次「生成这张」。
   *
   * 不是另一条花钱的路：每一张走的就是 `confirmOneShot`——各封一份只盖它自己的授权、各铸一张收据、各派一次，
   * 没有总价授权；去掉过的不在里面。所以点完之后卡、画布小标、回执和逐张点完一模一样（同一份逐镜结局驱动）。
   *
   * 用户按下去的那一刻看到的就是要发的：`quoteId` 必须是此刻这张卡、点名的必须恰好是卡上那一叠；
   * 每张开拍前再核一次它在卡上的样子没被别人改过（前面几张批下去会换报价，但不该换这一张要发的内容）。
   * 哪一张没成就停在那一张——它和它后面的镜照旧留在卡上，和逐张点到那里停下一模一样。用户中途点 × 收回出价，
   * 剩下的不再生成（× 不排队，正是为了能打断它）。一张一张交：上一张供应商受理了才批下一张（`awaitShotHandover`）。
   */
  const confirmRemainingShots = (input: SpendCardActionInput & { shotIds: readonly string[] }): Promise<ProductionActionResult> =>
    serializeCardAction(input.projectId, input.operationId, async () => {
      if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
      const pending = pendingFor(input.projectId, input.operationId);
      if (!pending) return { ok: false, code: "failed", message: "no pending generation to confirm" };
      const stale = staleCardResult(pending, input); if (stale) return stale;
      if (!input.quoteId || input.quoteId !== pending.quoteId) return failed(new Error("generation_quote_changed"), false);
      const onCard = pending.shots.map((shot) => shot.shotId);
      if (onCard.length < 2 || input.shotIds.length !== onCard.length || input.shotIds.some((shotId, index) => shotId !== onCard[index])) {
        return failed(new Error("generation_scope_invalid"), false);
      }
      const seen = new Map(onCard.map((shotId) => [shotId, shownShot(pending, shotId)]));
      let sent = 0;
      for (const [index, shotId] of input.shotIds.entries()) {
        // 两张之间先让出一拍事件循环（#1139 CI eval:journey）：× 是另一条 IPC，主进程空出一拍才处理得到。以前每批一张都要
        // 等一次渲染层落地（真 I/O），这一拍是碰巧有的；节点先落之后这一叠全是微任务，× 要等整叠批完才轮得到——停不下来。
        // 让一拍之后再看卡还在不在：× 到了就停在这里，之后没批的一张都不再生成。
        if (index > 0) await yieldToIncomingActions();
        const current = pendingFor(input.projectId, input.operationId);
        // 卡已经关了（用户点了 ×，或宿主把这一次出价收回了）：剩下的没决定，不再生成。照实说批下去几张、没发几张。
        if (spendCancelRequested(input.projectId, input.operationId) || !current || !current.shots.some((shot) => shot.shotId === shotId)) {
          return { ok: true, code: "spend_confirmed", batchStopped: { sent, notSent: input.shotIds.length - sent } };
        }
        if (shownShot(current, shotId) !== seen.get(shotId)) return failed(new Error("generation_quote_changed"), false);
        // 每一张从此刻那一版报价出发；它批下去换掉的那一版，× 带着来照样认（`noteReplacing`，在 confirmOneShot 里记）。
        const result = await confirmOneShot({ projectId: input.projectId, operationId: input.operationId, quoteId: current.quoteId, shotId,
          presentationId: current.presentationId, presentationEpoch: current.presentationEpoch, planVersion: current.planVersion });
        if (!result.ok) {
          // × 恰好落在这一张批下来之前（它的核对读到卡已经关了）：这一张也没发，和停在两张之间是同一件事。
          // 账本说这一张可能已经出去了（`generation_execution_failed`）就不能算进「没发」，原样交给卡去说「先去核对」。
          const closedUnderIt = !pendingFor(input.projectId, input.operationId) && result.message !== "generation_execution_failed";
          return closedUnderIt ? { ok: true, code: "spend_confirmed", batchStopped: { sent, notSent: input.shotIds.length - sent } } : result;
        }
        sent += 1;
        // 一张一张交（10-09 拍板 B）：这一张真的交到供应商手里了才批下一张——× 停得住还没交的，「正在发出 k/N」是真话。
        // 只等受理、不等生成完；等的这段 × 照样进得来（真 I/O 的等待），这一张已经在交就让它交完，后面的不再批。
        const approvedAt = Date.now();
        const handover = await awaitShotHandover({ readRun: () => deps.runs.read(input.projectId, input.operationId), shotId });
        logInfo("production-run", "spend-batch-shot-handover", { shotId, handover, approvedToHandoverMs: Date.now() - approvedAt });
        // 批了却不会再派了（Run 停了）：这一张没发出，照实说，剩下的不再批。
        if (handover === "not_dispatched") return { ok: true, code: "spend_confirmed", batchStopped: { sent: sent - 1, notSent: input.shotIds.length - sent + 1 } };
        if (handover === "timed_out") return { ok: true, code: "spend_confirmed", batchStopped: { sent, notSent: input.shotIds.length - sent } };
      }
      return { ok: true, code: "spend_confirmed" };
    });

  /** 「去掉这张 / 这段」（第 2 条）：这一镜不生成，占位留在画布上。连点两下 → 第二下原样回成功。 */
  const removePendingSpendShot = (input: SpendCardActionInput & { shotId: string }): Promise<ProductionActionResult> =>
    serializeCardAction(input.projectId, input.operationId, async () => {
      if (!deps.isProjectOpen(input.projectId)) return { ok: false, code: "run_not_open" };
      if (!deps.operations.removeShot) return { ok: false, code: "unavailable" };
      if (shotAlreadyDecided(input.projectId, input.operationId, input.shotId)) return { ok: true, code: "shot_removed" };
      const pending = pendingFor(input.projectId, input.operationId);
      if (!pending) return { ok: false, code: "failed", message: "no pending generation to change" };
      const stale = staleCardResult(pending, input); if (stale) return stale;
      if (!input.quoteId || input.quoteId !== pending.quoteId) return failed(new Error("generation_quote_changed"), false);
      if (!pending.shots.some((shot) => shot.shotId === input.shotId)) return failed(new Error("generation_scope_invalid"), false);
      noteReplacing(input.projectId, input.operationId, pending.quoteId);
      try {
        await deps.operations.removeShot(input.projectId, input.operationId, input.shotId, now());
        return { ok: true, code: "shot_removed" };
      } catch (error) {
        // 去掉一镜只动这一次出价的记录，永远不提交：这里失败一定是「没发起」。
        return failed(error, false);
      }
    });

  return { listPendingSpend, revisePendingSpend, discardPendingSpend, confirmPendingSpend, removePendingSpendShot, confirmRemainingShots };
}
