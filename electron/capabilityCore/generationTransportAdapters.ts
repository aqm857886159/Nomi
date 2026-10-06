import type { GeneratePresentationOutcome } from "../shared/productionGenerationPresentation";
import { resolveGenerationShotScope } from '../shared/agentCapabilities/generationShotScope';
import { productionTaskAbsenceCode } from '../productionRun/productionRunErrors';
import { GenerationProviderCapabilityError, GenerationProviderObservationError, GenerationRuntimeBindingError } from './generationRuntimeAdapter';
import { ProductionGenerationAuthorizationError } from '../productionRun/productionGenerationAuthorization';
import { z } from "zod";
import { logWarn } from "../logging/logger";
import { GENERATION_ARGUMENT_REFUSAL, refuseToModel, safeTransportFailure } from "./transportFailure";
import { ContractCompilationError } from "./executionContract";
import type { RuntimeToolCall, RuntimeToolDecision } from "../shared/agentCapabilities/transportContracts";
import { GENERATION_METHODS, GENERATION_METHOD_NAMES, isGenerationMethodName, type GenerationMethodName } from "../shared/agentCapabilities/generation";
import { generationPlanInputSchema, generationStatusInputSchema } from "../shared/agentCapabilities/generationPlanSchemas";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectLeaseV2 } from "./projectLease";
import type { DispatchContext } from "./dispatcher";
import type { ApprovalReceiptAuthority, HumanApprovalReceiptV1 } from "./approvalReceipt";
import { decideGenerationSpend, generationChallengeTokenOf } from "./generationSpendDecision";
import { spendDecidedByPolicy, type ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";
import { beginPolicySpendDecision } from "./policySpendDecision";
import { cardActionsSettled } from "./spendCardActionQueue";
import type { GenerationInvocationContext } from "../shared/agentCapabilities/generationInvocationContext";
import { shotDurationSeconds } from "./mcpGenerationVideoResolve";

/**
 * Main-process transport for the semantic generation vocabulary.
 *
 * The resident Host owns the call boundary; this adapter owns only the
 * translation from the model-facing, project-less tool schema to the one
 * run-owned planning/authorization seam. It deliberately never talks to a
 * provider directly and never exposes a lease or receipt in a tool result.
 */
export type PiGenerationTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal, context?: GenerationInvocationContext): Promise<RuntimeToolDecision | null>;
  /**
   * 宿主内部：收回对 `operationId` 的**这一次出价**（回 draft / 未 present，计划留着）。模型够不着——
   * 它不是一个工具。等用户的那个回合没了（按停止 / 关窗）或用户改了主意（待决时打字）时由 lane 端口调。
   */
  withdrawPresentation(operationId: string, reason: "user_wrote" | "stopped"): Promise<void>;
  /**
   * 宿主内部：这一次出价（付费卡）的结局——每一镜是在生成、被用户去掉，还是没决定（为什么）。`generate` 的回执只读它。
   * 读不到（没有出价 / 读失败）→ `undefined`，回执照实说「不知道」，不替宿主编。
   */
  readPresentationOutcome(operationId: string): Promise<GeneratePresentationOutcome | undefined>;
  /**
   * 宿主内部、只读：这份草稿每一镜的**候选**带了哪些参考素材（shotId → assetId[]）、要生成多长（shotId → 秒，
   * 按候选参数的唯一 owner shotDurationSeconds 读；没声明就不出现）。同一次 read 读出，两样事实不会来自两版草稿。
   * 3D-BOX 出卡前预检用它核对「就绪的预演进没进真正付费的那份载荷、和它是不是一样长」。读不到 → 抛，调用方 fail-closed（不出卡）。
   */
  readShotCandidateFacts?(operationId: string): Promise<ShotCandidateFacts>;
  dispose(): void;
}>;

type ReadCandidate = { references?: ReadonlyArray<{ assetId?: unknown }>; parameters?: Record<string, unknown> };

/** 出卡前预检读的每一镜候选事实（键 "" = 单镜草稿那一镜）。 */
export type ShotCandidateFacts = Readonly<{
  references: Readonly<Record<string, readonly string[]>>;
  durationSeconds: Readonly<Record<string, number>>;
}>;

export type GenerationLeaseFactory = (binding: ProjectBinding) => ProjectLeaseV2 | Promise<ProjectLeaseV2>;

export type GenerationTransportAdapterDependencies = Readonly<{
  planning: NonNullable<DispatchContext["generationPlanning"]>;
  requestGenerationGate?: NonNullable<DispatchContext["requestGenerationGate"]>;
  authorizeGeneration?: NonNullable<DispatchContext["authorizeGeneration"]>;
  rejectGeneration?: (input: { params: Record<string, unknown>; lease: ProjectLeaseV2 }) => unknown | Promise<unknown>;
  confirmGenerationInNomi?: (input: { challengeToken: string }) => Promise<unknown>;
  approvalReceiptAuthority?: ApprovalReceiptAuthority;
  leaseFor: GenerationLeaseFactory;
  /**
   * 用户此刻选的审批档位（宿主自己持有的那一份快照，`laneDesktopRuntime` 的 `composer.approvalPolicy`）。
   *
   * 只有一件事读它：草稿预检完之后，「全自动」档要不要在这里就把付费门决掉（2026-09-12 用户拍板）。
   * 判据不在这个文件里，在 `capabilityApprovalPolicy.spendDecidedByPolicy`——同一个问题只有一个答案。
   * 缺席按默认档（`safe-auto`）走，也就是照旧弹卡：不知道档位时**不许**替用户花钱。
   */
  approvalPolicy?: () => ProjectAgentApprovalPolicy | undefined;
}>;

// 路由白名单**只有一个来源**：契约层的方法词表（`GENERATION_METHODS`）。模型可见的动词名
// （`draft_shots` / `generate` / `check_job` / `cancel_job`）不在这里——lane 先经 `laneVerbTransport` 翻成
// 方法名再进来；适配器认的是方法，不是动词（根因合同 2026-09-11-agent-generation-second-door）。
const GENERATION_TOOL_NAMES: ReadonlySet<string> = GENERATION_METHOD_NAMES;
const GATE_TOOL = GENERATION_METHODS.gateRequest;

/** Stable routing predicate shared by the Host and the transport adapter. */
export function isPiGenerationToolName(toolName: string): toolName is GenerationMethodName {
  return isGenerationMethodName(toolName);
}

/**
 * 我们自己 schema 产生的逐字段拒收理由。**不是**供应商文本：`issue.path` 是我们契约里的字段名。
 */
export type GenerationSchemaIssue = Readonly<{ path: string; message: string }>;

function schemaIssuesOf(error: unknown): readonly GenerationSchemaIssue[] {
  const raw = error && typeof error === "object" ? (error as { issues?: unknown }).issues : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((issue) => (issue && typeof issue === "object"
    && typeof (issue as { message?: unknown }).message === "string"
    ? [{ path: String((issue as { path?: unknown }).path ?? ""), message: (issue as { message: string }).message }]
    : []));
}

export function describeSchemaIssues(issues: readonly GenerationSchemaIssue[]): string {
  return issues.map((issue) => `${issue.path || "(root)"}: ${issue.message}`).join("; ");
}

/**
 * 这条路放行的码。除了传输那一族共有的，生成域自己还有五个。
 * `generation_input_invalid` 是「模型写的入参我们收不了」那一档——2026-09-22 起它也承载
 * 域里**有意**抛出的拒绝（`ModelFacingRefusal`），正文原样到模型。
 */
const GENERATION_PUBLIC_FAILURE_CODES: ReadonlySet<string> = new Set([
  'generation_input_invalid', 'generation_cancelled', 'project_binding_stale',
  'generation_approval_unavailable', 'generation_approval_required',
]);
// `generation_operation_not_found` / `generation_provider_unavailable` **刻意不在**上面那张表里：
// 它们只能由 `classify` 从我们自己的错误类认出来，不能由异常上挂的一个 `code` 字符串自称
// （C18「provider forged absence」）。

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  return safeTransportFailure(error, {
    allowedCodes: GENERATION_PUBLIC_FAILURE_CODES,
    fallbackCode: 'generation_execution_failed',
    classify: (value) => productionTaskAbsenceCode(value)
      ? 'generation_operation_not_found'
      : value instanceof GenerationProviderCapabilityError || value instanceof GenerationProviderObservationError
        ? 'generation_provider_unavailable'
        : value instanceof ProductionGenerationAuthorizationError || value instanceof GenerationRuntimeBindingError
          ? value.code
          // 参数 / 合同准入的拒绝（参数不在档里、模式不收时长、比例翻不了……）是**我们自己写的**、带合法值的话，
          // 和 `refuseToModel` 是同一档。以前它不在这里，落进兜底码：Agent 只收到一个裸的 generation_not_started，
          // 说不出拒了什么，于是同一份参数原样重试（铁律 ⑩ 宿主矩阵首跑抓到）。
          : value instanceof ContractCompilationError ? GENERATION_ARGUMENT_REFUSAL : undefined,
    ownMessage: (value) => (value instanceof ContractCompilationError ? value.message : undefined),
    // 收敛成码挡住的应当只有**供应商 / 凭据的原始文本**。连我们自己 schema 的字段级理由一起抹掉，
    // 模型拿到的就是一个说不出拒了什么的裸码，于是同一份载荷原样重试到回合超时——那正是
    // 2026-09-18 那份根因合同修掉的失效方式（`generation_input_invalid — shots.0.prompt: Required`）。
    detail: (value) => { const issues = schemaIssuesOf(value); return issues.length ? describeSchemaIssues(issues) : undefined },
    // 兜底码盖住的也可能是我们自己的缺陷（TypeError 这类）。不留痕 = 把 bug 洗成产品结论。
    onFallback: (rawCode, value) => logWarn("capability", "generation-transport-failed", { rawCode }, value),
  });
}

/**
 * 每个方法别名（`nomi_operation_create` 等）的入参形状，**从语义联合里现取那一支**，不手抄。
 *
 * 2026-09-18 根因：这里原本手写了一份 create/patch/present/reconcile 的形状，而且**比真契约窄**——
 * create 那支只列了 prompt/candidate/shots/scriptText/cardHidden，真契约的 `createFields` 还有
 * taskKind、providerId、modelId、mode、modeId、variantId、parameters、references。
 * 手抄的那份是 `.strict()`，所以模型写对了真契约里的字段，走到这条别名路上反而被拒——
 * 而且拒得没有道理可讲。今天没爆只是因为常驻 lane 只路由 `plan`/`status` 两个方法，
 * 走不到这几支；**它是一颗埋着的同类地雷，不是一处无害的重复**。
 *
 * 按 `operation` 字面量取分支而不是按下标（`options[1]`）：下标会因为联合重排而**静默指到别的分支**，
 * 那正是这条 fix 要消灭的失效方式。取不到就抛——宁可装配期炸，也不要悄悄退回一个更窄的形状。
 */
const PLAN_BRANCH_FOR_METHOD: Readonly<Record<string, string>> = {
  [GENERATION_METHODS.create]: "create",
  [GENERATION_METHODS.patch]: "patch",
  [GENERATION_METHODS.present]: "present",
  [GENERATION_METHODS.preview]: "preview",
  [GENERATION_METHODS.context]: "context",
  [GENERATION_METHODS.extend]: "extend",
};

function branchByOperation(
  union: typeof generationPlanInputSchema | typeof generationStatusInputSchema,
  operation: string,
): z.ZodObject<z.ZodRawShape> {
  const found = (union.options as ReadonlyArray<z.ZodObject<z.ZodRawShape>>).find((option) => {
    const literal = option.shape.operation as unknown as { _def?: { value?: unknown } } | undefined;
    return literal?._def?.value === operation;
  });
  if (!found) throw new Error(`generation schema has no "${operation}" branch`);
  return found;
}

export function legacyMethodSchemaForTest(toolName: string): z.ZodTypeAny {
  return legacyMethodSchema(toolName);
}

function legacyMethodSchema(toolName: string): z.ZodTypeAny {
  const planOperation = PLAN_BRANCH_FOR_METHOD[toolName];
  if (planOperation) return branchByOperation(generationPlanInputSchema, planOperation).omit({ operation: true });
  if (toolName === GENERATION_METHODS.reconcile) {
    return branchByOperation(generationStatusInputSchema, "reconcile").omit({ operation: true });
  }
  return z.object({ operationId: z.string().trim().min(1) }).strict();
}

function parsedArgs(call: RuntimeToolCall): Record<string, unknown> {
  const semanticSchema = call.toolName === GENERATION_METHODS.plan
    ? generationPlanInputSchema
    : call.toolName === GENERATION_METHODS.status
      ? generationStatusInputSchema
      : undefined;
  const schema = semanticSchema ?? legacyMethodSchema(call.toolName);
  const parsed = schema.safeParse(call.args);
  if (!parsed.success) {
    // 说清**哪个字段为什么被拒**。2026-09-18 根因：这里原本只抛一个裸码，模型（和人）都看不到
    // 是哪一项不合法，于是同一份载荷被原样重试三次、回合挂到超时。校验拒收必须自带理由——
    // 一个说不出自己拒了什么的边界，等于把契约漂移变成静默故障。这些 path 是我们契约里的
    // 字段名，不是供应商文本，所以 redaction 不该碰它们。
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    throw Object.assign(new Error(`generation_input_invalid — ${describeSchemaIssues(issues)}`), {
      code: "generation_input_invalid",
      issues,
    });
  }
  return parsed.data as Record<string, unknown>;
}

/** 语义入口的 `operation` → 方法名。两张小表都只引用 `GENERATION_METHODS`，不再出现字符串字面量。 */
const PLAN_OPERATION_METHOD: Readonly<Record<string, GenerationMethodName>> = Object.freeze({
  context: GENERATION_METHODS.context, create: GENERATION_METHODS.create, patch: GENERATION_METHODS.patch,
  present: GENERATION_METHODS.present, preview: GENERATION_METHODS.preview, extend: GENERATION_METHODS.extend,
});
const STATUS_OPERATION_METHOD: Readonly<Record<string, GenerationMethodName>> = Object.freeze({
  read: GENERATION_METHODS.read, cancel: GENERATION_METHODS.cancel, reconcile: GENERATION_METHODS.reconcile,
});

function canonicalGenerationCall(call: RuntimeToolCall, args: Record<string, unknown>): RuntimeToolCall {
  const table = call.toolName === GENERATION_METHODS.plan ? PLAN_OPERATION_METHOD
    : call.toolName === GENERATION_METHODS.status ? STATUS_OPERATION_METHOD : undefined;
  if (!table) return call;
  const { operation, ...rest } = args;
  const method = typeof operation === "string" ? table[operation] : undefined;
  if (!method) throw Object.assign(new Error("generation_input_invalid"), { code: "generation_input_invalid" });
  return { ...call, toolName: method, args: method === GENERATION_METHODS.context ? {} : rest };
}

/** 方法名 → planning 的 capability 名（`mcpGenerationTools.ts` 那张 if 链认的词）。 */
const CAPABILITY_BY_METHOD: Readonly<Partial<Record<GenerationMethodName, string>>> = Object.freeze({
  [GENERATION_METHODS.start]: "start",
  [GENERATION_METHODS.context]: "context",
  [GENERATION_METHODS.create]: "create",
  [GENERATION_METHODS.patch]: "plan",
  [GENERATION_METHODS.present]: "present",
  [GENERATION_METHODS.preview]: "preview",
  [GENERATION_METHODS.extend]: "extend",
  [GENERATION_METHODS.read]: "read",
  [GENERATION_METHODS.cancel]: "cancel",
  [GENERATION_METHODS.reconcile]: "reconcile",
});

function operationId(args: Record<string, unknown>): string {
  const value = typeof args.operationId === "string" ? args.operationId.trim() : "";
  if (!value) throw Object.assign(new Error("generation_input_invalid"), { code: "generation_input_invalid" });
  return value;
}

function abortError(): Error {
  return Object.assign(new Error("generation_cancelled"), { code: "generation_cancelled" });
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function receiptFromConfirmation(
  value: unknown,
  authority: ApprovalReceiptAuthority | undefined,
): HumanApprovalReceiptV1 {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const token = typeof record.receiptToken === "string" ? record.receiptToken.trim() : "";
  const receiptId = typeof record.receiptId === "string" ? record.receiptId.trim() : "";
  if (!authority) throw Object.assign(new Error("generation_approval_unavailable"), { code: "generation_approval_unavailable" });
  if (token) return authority.verifyReceipt(token);
  if (receiptId) {
    const resolved = authority.resolveReceiptToken(receiptId);
    if (resolved) return authority.verifyReceipt(resolved);
  }
  throw Object.assign(new Error("generation_approval_required"), { code: "generation_approval_required" });
}

/** planning 返回的 `operation.cardHidden`：草稿建好但卡还没摆出来（`draft_shots` 建的那种）。 */
function planCardHidden(result: unknown): boolean {
  const operation = result && typeof result === "object" && !Array.isArray(result)
    ? (result as { operation?: { cardHidden?: unknown } }).operation
    : undefined;
  return operation?.cardHidden === true;
}

function confirmed(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { confirmed?: unknown }).confirmed === true);
}

function trialFirst(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { trialFirst?: unknown }).trialFirst === true);
}

/** 「全自动」代答时写进收据的宿主面名字。 */
const FULL_AUTO_POLICY_SURFACE = "agent-lane";

/**
 * 刚建好的这份草稿是哪一笔。`create` 的 id 由宿主生成、只在结果里（模型没法先知道它），
 * `patch` 的在入参里。两处都读不到就抛——**不许拿一个猜出来的 id 去开付费门**。
 */
function draftedOperationId(drafted: unknown, args: Record<string, unknown>): string {
  const operation = drafted && typeof drafted === "object" && !Array.isArray(drafted)
    ? (drafted as { operation?: { operationId?: unknown } }).operation
    : undefined;
  const fromResult = operation && typeof operation.operationId === "string" ? operation.operationId.trim() : "";
  if (fromResult) return fromResult;
  return operationId(args);
}

/**
 * 同 `draftedOperationId`，但读不出来就回 `undefined`。
 *
 * 它只用在一个地方：占「这一笔由档位代答」那个位（T-AG-04）。那里读不出 id **不能抛**——
 * 抛了就会把一次本来能成的建草稿变成失败。读不出的后果只是这一笔少了一层占位，
 * 决门那一步照旧用会抛的那一份（`draftedOperationId`），不许拿猜的 id 去开付费门。
 */
function draftedOperationIdOrNone(drafted: unknown, args: Record<string, unknown>): string | undefined {
  try { return draftedOperationId(drafted, args); } catch { return undefined; }
}

/**
 * Build the adapter used by one Host partition. `leaseFor` is an internal
 * main-process identity bridge; the resulting lease never crosses the model
 * or renderer boundary.
 */
export function createPiGenerationTransportAdapter(
  binding: ProjectBinding,
  deps: GenerationTransportAdapterDependencies,
): PiGenerationTransportAdapter {
  let disposed = false;

  const lease = async (signal: AbortSignal): Promise<ProjectLeaseV2> => {
    if (disposed || signal.aborted) throw abortError();
    const value = await abortable(Promise.resolve(deps.leaseFor(binding)), signal);
    if (value.projectId !== binding.projectId
      || value.immutableProjectUuid !== binding.immutableProjectUuid
      || value.projectGeneration !== binding.projectGeneration) {
      throw Object.assign(new Error("project_binding_stale"), { code: "project_binding_stale" });
    }
    return value;
  };

  const plan = async (
    capability: string,
    args: Record<string, unknown>,
    currentLease: ProjectLeaseV2,
    signal: AbortSignal,
    context?: GenerationInvocationContext,
  ): Promise<unknown> => abortable(
    Promise.resolve(deps.planning({
      capability,
      params: { ...args },
      lease: currentLease,
      origin: { host: "nomi", actorId: "project-agent-host", ...(context?.sourceDocument ? { sourceDocument: context.sourceDocument } : {}) },
      ...(context?.storyboardTarget ? { storyboardTarget: context.storyboardTarget } : {}),
      ...(context?.modelNames ? { modelNames: context.modelNames } : {}),
    })),
    signal,
  );

  /**
   * 「全自动」档里那次**没有报价卡**的放行（2026-09-12 用户拍板）。
   *
   * ── 为什么闸在草稿刚建好之后 ──
   *
   * 桌面 lane 上模型能走到的最后一步就是**建草稿**（`create`）或往草稿里塞几镜（`patch`）——
   * 付费门根本不在它的工具表里（`paidBoundary.ts`「内部面不投影」），连 `preview` 都不在
   * 这个宿主的 schema 里（`generationPlanSchemaForHost({ preview: false })`）。
   * 草稿一建好，`projectPendingSpendConfirm` 就会把它投影成面板上那张报价卡——
   * **那一刻就是用户点下去的那一刻**。另外两档里宿主的回应是在介入槽里摆一张卡等人点，
   * 「全自动」档里宿主的回应就是在同一个边界上自己决。不是绕过闸，是同一道闸换了个决定者：
   * 封印照做、收据照铸照签、一次性消费照旧（`generationSpendDecision.ts` 那一条链）。
   *
   * ── 三个「不」──
   *
   *   · **不新增预算**：这里没有任何金额判断。用户拍板的是「全自动 = 不再逐次问」，
   *     不是「¥X 以内不问」——设置里那条硬预算上限 2026-09-10 已经删掉，不许在这里长回来。
   *   · **不吞错**：决门失败就把错抛回去（`safeFailure` 会把它变成模型看得见的失败），
   *     而草稿仍是草稿，报价卡照旧在原处等用户——**这不是兜底**，是「没决成，所以它仍然待决」
   *     的真实状态。
   *   · **不猜档位**：`approvalPolicy` 缺席按默认档走，也就是照旧弹卡。外部 MCP 宿主那条路
   *     从来不传它，所以它们的确认语义一个字没变（那条路自己有 elicitation 与收据门）。
   */
  const decideByPolicyAfterDraft = async (
    args: Record<string, unknown>,
    drafted: unknown,
    currentLease: ProjectLeaseV2,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (!spendDecidedByPolicy(deps.approvalPolicy?.())) return undefined;
    if (!deps.requestGenerationGate || !deps.authorizeGeneration || !deps.approvalReceiptAuthority) {
      throw Object.assign(new Error("generation_approval_unavailable"), { code: "generation_approval_unavailable" });
    }
    const outcome = await abortable(decideGenerationSpend({
      requestGenerationGate: deps.requestGenerationGate,
      authorizeGeneration: deps.authorizeGeneration,
      planning: deps.planning,
      receipts: deps.approvalReceiptAuthority,
    }, {
      operationId: draftedOperationId(drafted, args),
      lease: currentLease,
      decision: { kind: "policy-full-auto", surface: FULL_AUTO_POLICY_SURFACE },
      actorId: FULL_AUTO_POLICY_SURFACE,
    }), signal);
    return { drafted, spendDecision: { decidedBy: outcome.decidedBy, receiptId: outcome.receiptId }, started: outcome.started };
  };

  const reject = async (args: Record<string, unknown>, currentLease: ProjectLeaseV2, signal: AbortSignal): Promise<void> => {
    if (!deps.rejectGeneration) return;
    await abortable(Promise.resolve(deps.rejectGeneration({ params: { ...args }, lease: currentLease })), signal);
  };

  const requestGate = async (
    args: Record<string, unknown>,
    currentLease: ProjectLeaseV2,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (!deps.requestGenerationGate || !deps.confirmGenerationInNomi || !deps.authorizeGeneration || !deps.approvalReceiptAuthority) {
      throw Object.assign(new Error("generation_approval_unavailable"), { code: "generation_approval_unavailable" });
    }
    let gate = await abortable(Promise.resolve(deps.requestGenerationGate({ params: { ...args }, lease: currentLease })), signal);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = generationChallengeTokenOf(gate);
      const confirmation = await abortable(deps.confirmGenerationInNomi({ challengeToken: token }), signal);
      if (confirmed(confirmation)) {
        const receipt = receiptFromConfirmation(confirmation, deps.approvalReceiptAuthority);
        const approved = await abortable(Promise.resolve(deps.authorizeGeneration({
          params: { ...args },
          lease: currentLease,
          receipt,
        })), signal);
        // The resident Host calls the authorization seam directly (it does not
        // pass through the MCP dispatcher, whose normal post-authorize hook
        // consumes the receipt). Consume the one-shot receipt here after the
        // Run-owned gate has been durably approved so a replay cannot reuse it.
        const confirmationRecord = confirmation && typeof confirmation === "object" && !Array.isArray(confirmation)
          ? confirmation as Record<string, unknown>
          : {};
        const receiptToken = typeof confirmationRecord.receiptToken === "string" && confirmationRecord.receiptToken.trim()
          ? confirmationRecord.receiptToken.trim()
          : deps.approvalReceiptAuthority.resolveReceiptToken(receipt.receiptId);
        deps.approvalReceiptAuthority.consumeReceipt(receiptToken);
        // The gate is the only paid boundary. Start immediately after its
        // receipt is committed so a model cannot accidentally stop at a
        // confirmation-only transcript; a later explicit start is idempotent.
        const started = await plan( "start", args, currentLease, signal);
        return { gate, confirmation, approved, started };
      }
      if (trialFirst(confirmation) && attempt === 0) {
        gate = await abortable(Promise.resolve(deps.requestGenerationGate({ params: { ...args }, lease: currentLease })), signal);
        continue;
      }
      await reject(args, currentLease, signal);
      return { gate, confirmation, nextAction: "revise" };
    }
    throw Object.assign(new Error("generation_approval_required"), { code: "generation_approval_required" });
  };

  /**
   * 这条 lane **自己**从某份文稿起草出来的方案：operationId → sourceDocumentId。
   * 它不是缓存也不是第二份真相——它记的是一件只有这里知道的事实（「这一笔 create 是我发的、
   * 带着哪份文稿的 target」），用来补上请求清单在**同一轮里**必然缺的那一格。随 adapter 活，随 lane 死。
   */
  const draftedFromDocument = new Map<string, string>();

  /** 这次调用落到的那份计划有没有任何一笔可能到过供应商（账本事实，宿主现算）。没落到任何计划上 = 没有。 */
  const submissionStarted = async (operationId: string | undefined): Promise<boolean> => {
    if (!operationId) return false;
    try {
      const signal = new AbortController().signal;
      const read = await plan("read", { operationId }, await lease(signal), signal) as { operation?: { submissionStarted?: boolean } };
      return read?.operation?.submissionStarted !== false;
    } catch {
      // 读不到就不下结论：宁可让模型多核对一次，也不要哄它说钱没花。
      return true;
    }
  };

  return Object.freeze({
    async tryExecute(call, signal, context) {
      if (!GENERATION_TOOL_NAMES.has(call.toolName)) return null;
      if (disposed) return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
      if (signal.aborted) return { ok: false, code: "generation_cancelled", message: "generation_cancelled", denied: true };
      // 这次调用落到了哪份计划上（入参点名的，或这一次刚起草的）。失败时拿它去问账本「有没有东西发出去过」。
      let addressed: string | undefined;
      try {
        const parsed = parsedArgs(call);
        const canonicalCall = canonicalGenerationCall(call, parsed);
        const args = canonicalCall.args as Record<string, unknown>;
        addressed = typeof args.operationId === "string" && args.operationId.trim() ? args.operationId.trim() : undefined;
        const currentLease = await lease(signal);
        const storyboardTarget = context?.storyboardTarget;
        // A document-admitted storyboard call may only address a plan that already belongs to
        // this document. The plan the model names is its own choice (see
        // `formatStoryboardRequestTarget`); the host only refuses a plan that is not on the list.
        // 「这份方案属于这份文稿」有两种证法：它在这条消息发出时那张清单上；或者**就是这条 lane
        // 刚刚从这份文稿起草出来的**（`draftedFromDocument`）。2026-09-22 之前只认前一种——
        // 而清单是用户按发送那一刻拍下来的，**本轮新起草的方案不可能在上面**。后果（run2 的 A10）：
        // `draft_shots` 成功返回 `op-9b2c…`，用户在反问卡上答了「现在生成」，紧接着对**同一个 id**
        // 调 `generate`，被我们回「That plan is not one of the storyboard plans this request covers」。
        // 从文稿面起草再生成，是这条 lane 上最常走的一步，它在结构上走不通。
        if (storyboardTarget && (storyboardTarget.projectId !== binding.projectId
          || (typeof args.operationId === 'string'
            && !storyboardTarget.plans.some((plan) => plan.id === args.operationId)
            && draftedFromDocument.get(args.operationId) !== storyboardTarget.sourceDocumentId))) {
          refuseToModel(GENERATION_ARGUMENT_REFUSAL, 'That plan is not one of the storyboard plans this request covers. Use an operationId the request names, or omit it to start a new draft.');
        }
        if (canonicalCall.toolName === GATE_TOOL) {
          if (storyboardTarget?.shotIds) refuseToModel(GENERATION_ARGUMENT_REFUSAL, "This storyboard selection is confirmed through its own card; do not request a separate generation gate for it.");
          const result = await requestGate(args, currentLease, signal);
          const denied = result && typeof result === "object" && (result as { nextAction?: unknown }).nextAction === "revise";
          return denied
            ? { ok: false, code: "generation_declined", message: "Generation was not started", denied: true }
            : { ok: true, result, silent: true };
        }
        const capability = isGenerationMethodName(canonicalCall.toolName) ? CAPABILITY_BY_METHOD[canonicalCall.toolName] : undefined;
        if (!capability) throw Object.assign(new Error("generation_input_invalid"), { code: "generation_input_invalid" });
        if (storyboardTarget?.shotIds) {
          if (capability === 'plan' && (typeof args.shotId !== 'string' || !storyboardTarget.shotIds.includes(args.shotId))) refuseToModel(GENERATION_ARGUMENT_REFUSAL, `This request covers only these shots: ${storyboardTarget.shotIds.join(', ')}. Name one of them in shotId.`);
          if (capability === 'present') args.shotIds = resolveGenerationShotScope(storyboardTarget.shotIds,args.shotIds);
          // The selection names its plan, so a call that addresses a different one is refused
          // rather than silently retargeted.
          if ((capability === 'plan' || capability === 'present') && args.operationId !== storyboardTarget.designId) refuseToModel(GENERATION_ARGUMENT_REFUSAL, `This request is about plan ${storyboardTarget.designId}. Use that operationId.`);
        }
        // operationId is required by every non-create descriptor. Parsing it
        // here keeps malformed model calls out of the durable operation store.
        if (capability !== "context" && capability !== "create") operationId(args);
        // ── 「这一笔由档位代答，别把它投影成卡」（T-AG-04）──
        //
        // Run 一变就把待决出价推给面板，而 `plan()` 一落盘，报价卡就可见了——代答跑在它之后。
        // 所以占位必须**早于草稿落盘**，晚一步用户就会看见那张他刚授权过「不用再问」的卡闪出来。
        //
        // `present`（`generate` 动词，真机上唯一会让卡露面的那条）入参里带着 operationId，直接占。
        // `create` 的 id 由宿主生成、这一刻还不存在：它在**紧接着 `plan()` 的同步语句里**补占
        // （中间没有 await，IPC 读进不来）。桌面 lane 的 `create` 本来就带 `cardHidden`、不出卡，
        // 那一支是给外部宿主与夹具留的。
        const policyAnswers = spendDecidedByPolicy(deps.approvalPolicy?.());
        const claimPolicyDecision = (operation: string | undefined): (() => void) | undefined =>
          policyAnswers && operation ? beginPolicySpendDecision(currentLease.projectId, operation) : undefined;
        const claimed = typeof args.operationId === "string" && args.operationId.trim() ? args.operationId.trim() : undefined;
        // 释放放在 `finally`：代答**失败**时卡要回到原处等用户（「策略答不了才问人」）。
        let releasePolicyClaim = claimPolicyDecision(claimed);
        try {
        const result = await plan(capability, args, currentLease, signal, context);
          addressed = draftedOperationIdOrNone(result, args) ?? addressed;
          // 记下「这份方案是这条 lane 从哪份文稿起草的」。只记 create 成功的那一刻，键是宿主发的 id。
          if (capability === "create" && storyboardTarget) {
            const drafted = draftedOperationIdOrNone(result, args);
            if (drafted) draftedFromDocument.set(drafted, storyboardTarget.sourceDocumentId);
          }
          // 报价卡该出现的那一刻 = 草稿被摆到用户面前的那一刻：`present`（`generate` 动词），或者建/改草稿时
          // 卡本来就没藏着（`cardHidden` 不为 true：外部 MCP 宿主与面板自己的路径）。「全自动」档在这里替用户决门（见上）。
          const cardShown = capability === "present"
            || ((capability === "create" || capability === "plan") && !planCardHidden(result));
          if (cardShown) {
            if (!releasePolicyClaim) releasePolicyClaim = claimPolicyDecision(draftedOperationIdOrNone(result, args));
            const decided = await decideByPolicyAfterDraft(args, result, currentLease, signal);
            if (decided) return { ok: true, result: decided };
          }
          return { ok: true, result, silent: capability === "context" || capability === "read" };
        } finally {
          releasePolicyClaim?.();
        }
      } catch (error) {
        const failure = safeFailure(error);
        // 「结果可能未知」只有在真的有提交意图落过盘时才是真的。认不出的异常先落到兜底码，这里问账本一句：
        // 这份计划（没有计划就更没有）有没有任何一笔走到过提交意图——没有就是「没发出去、没扣费」，
        // 模型和面板据此都说真话，不让用户去核对一笔根本不存在的扣费（23:30 第 3 点）。
        if (failure.code === "generation_execution_failed" && !(await submissionStarted(addressed))) {
          return { ...failure, code: "generation_not_started", message: (failure.message ?? "generation_execution_failed").replace("generation_execution_failed", "generation_not_started") };
        }
        return failure;
      }
    },
    async withdrawPresentation(operationIdToWithdraw, reason) {
      if (disposed) return;
      // 不挂调用方的 signal：这一步多半正是在 abort 之后跑的，而它要做的恰恰是把那次 abort 留下的卡收走。
      const signal = new AbortController().signal;
      await plan("withdraw", { operationId: operationIdToWithdraw, reason }, await lease(signal), signal);
    },
    async readPresentationOutcome(operationIdToRead) {
      if (disposed) return undefined;
      // 卡可能在一镜批到一半时关掉（×、在卡开着时打字）：那一镜照样批下、花钱。等卡上的动作落定再读，
      // 回执说的才是宿主最终批下的那一份（`spendCardActionQueue`；10-02 搞破坏线 X2 / X4）。
      await cardActionsSettled(binding.projectId, operationIdToRead);
      const signal = new AbortController().signal;
      try {
        const read = await plan("read", { operationId: operationIdToRead }, await lease(signal), signal) as { operation?: { presentationOutcome?: GeneratePresentationOutcome } };
        return read?.operation?.presentationOutcome;
      } catch {
        return undefined;
      }
    },
    async readShotCandidateFacts(operationIdToRead) {
      if (disposed) throw new Error("surface_port_unavailable");
      const signal = new AbortController().signal;
      const read = await plan("read", { operationId: operationIdToRead }, await lease(signal), signal) as {
        operation?: {
          candidate?: ReadCandidate;
          shots?: ReadonlyArray<{ shotId?: unknown; candidate?: ReadCandidate }>;
        };
      };
      const operation = read?.operation;
      if (!operation) throw new Error("generation_operation_not_found");
      const assetIdsOf = (references: ReadonlyArray<{ assetId?: unknown } | undefined> | undefined) =>
        (references ?? []).flatMap((reference) => typeof reference?.assetId === "string" ? [reference.assetId] : []);
      // 单镜草稿没有 shots 数组，参考在 operation.candidate 上：按「一镜」处理，键 "" = 没有镜头 id 的那一镜。
      const entries: Array<[string, ReadCandidate | undefined]> = Array.isArray(operation.shots)
        ? operation.shots.flatMap((shot) => typeof shot.shotId === "string" ? [[shot.shotId, shot.candidate] as [string, ReadCandidate | undefined]] : [])
        : [["", operation.candidate]];
      const durationSeconds: Record<string, number> = {};
      for (const [shotId, shotCandidate] of entries) {
        const seconds = shotCandidate ? shotDurationSeconds({ parameters: shotCandidate.parameters ?? {} } as never) : undefined;
        if (typeof seconds === "number" && seconds > 0) durationSeconds[shotId] = seconds;
      }
      return { references: Object.fromEntries(entries.map(([shotId, shotCandidate]) => [shotId, assetIdsOf(shotCandidate?.references)])), durationSeconds };
    },
    dispose() { disposed = true; },
  });
}
