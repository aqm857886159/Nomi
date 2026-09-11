import { z } from "zod";
import type { RuntimeToolCall, RuntimeToolDecision } from "../shared/agentCapabilities/transportContracts";
import { modelFacingToolSpecs } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { generationPlanInputSchema, generationStatusInputSchema, GENERATION_RECONCILE_OUTCOMES } from "../shared/agentCapabilities/generationPlanSchemas";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectLeaseV2 } from "./projectLease";
import type { DispatchContext } from "./dispatcher";
import type { ApprovalReceiptAuthority, HumanApprovalReceiptV1 } from "./approvalReceipt";
import { decideGenerationSpend, generationChallengeTokenOf } from "./generationSpendDecision";
import { spendDecidedByPolicy, type ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";

/**
 * Main-process transport for the semantic generation vocabulary.
 *
 * The resident Host owns the call boundary; this adapter owns only the
 * translation from the model-facing, project-less tool schema to the one
 * run-owned planning/authorization seam. It deliberately never talks to a
 * provider directly and never exposes a lease or receipt in a tool result.
 */
export type PiGenerationTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision | null>;
  dispose(): void;
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

const MODEL_GENERATION_TOOL_NAMES = new Set(modelFacingToolSpecs("internal").filter(spec => spec.internalGroup === "generation").map(spec => spec.name));
const INTERNAL_GENERATION_TOOL_NAMES = new Set([
  "nomi_get_generation_context",
  "nomi_operation_create",
  "nomi_submit_generation_plan",
  "nomi_preview_execution",
  "nomi_request_generation_gate",
  "nomi_start_generation",
  "nomi_operation_read",
  "nomi_cancel_generation",
  "nomi_reconcile_generation",
]);
const GENERATION_TOOL_NAMES = new Set([...MODEL_GENERATION_TOOL_NAMES, ...INTERNAL_GENERATION_TOOL_NAMES]);
const GATE_TOOL = "nomi_request_generation_gate";
const START_TOOL = "nomi_start_generation";

/** Stable routing predicate shared by the Host and the transport adapter. */
export function isPiGenerationToolName(toolName: string): boolean {
  return GENERATION_TOOL_NAMES.has(toolName);
}

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  const rawCode = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "generation_execution_failed";
  const message = error instanceof Error && error.message ? error.message : rawCode;
  // Keep provider/credential internals out of the transcript while retaining
  // actionable semantic codes for the resident failure item.
  const code = /provider|catalog|credential|model/i.test(rawCode) ? "generation_provider_unavailable" : rawCode;
  return { ok: false, code, message };
}

function parsedArgs(call: RuntimeToolCall): Record<string, unknown> {
  const semanticSchema = call.toolName === "nomi_generation_plan"
    ? generationPlanInputSchema
    : call.toolName === "nomi_generation_status"
      ? generationStatusInputSchema
      : undefined;
  const schema = semanticSchema
    ?? (call.toolName === "nomi_reconcile_generation"
      ? z.object({ operationId: z.string().trim().min(1), outcome: z.enum(GENERATION_RECONCILE_OUTCOMES) }).strict()
      : call.toolName === "nomi_operation_create"
        ? z.object({ prompt: z.string().trim().min(1).optional(), candidate: z.record(z.unknown()).optional(), shots: z.array(z.unknown()).optional(), scriptText: z.string().trim().min(1).optional() }).strict()
        : call.toolName === "nomi_submit_generation_plan"
          ? z.object({ operationId: z.string().trim().min(1), patch: z.record(z.unknown()) }).strict()
          : z.object({ operationId: z.string().trim().min(1) }).strict());
  const parsed = schema.safeParse(call.args);
  if (!parsed.success) throw Object.assign(new Error("generation_input_invalid"), { code: "generation_input_invalid" });
  return parsed.data as Record<string, unknown>;
}

function canonicalGenerationCall(call: RuntimeToolCall, args: Record<string, unknown>): RuntimeToolCall {
  if (call.toolName === "nomi_generation_plan") {
    const operation = args.operation;
    if (operation === "context") return { ...call, toolName: "nomi_get_generation_context", args: {} };
    if (operation === "create") {
      const { operation: _operation, ...createArgs } = args;
      return { ...call, toolName: "nomi_operation_create", args: createArgs };
    }
    if (operation === "patch") {
      const { operation: _operation, ...patchArgs } = args;
      return { ...call, toolName: "nomi_submit_generation_plan", args: patchArgs };
    }
    const { operation: _operation, ...previewArgs } = args;
    return { ...call, toolName: "nomi_preview_execution", args: previewArgs };
  }
  if (call.toolName === "nomi_generation_status") {
    const operation = args.operation;
    const { operation: _operation, ...statusArgs } = args;
    return {
      ...call,
      toolName: operation === "read" ? "nomi_operation_read" : operation === "cancel" ? "nomi_cancel_generation" : "nomi_reconcile_generation",
      args: statusArgs,
    };
  }
  return call;
}

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
  ): Promise<unknown> => abortable(
    Promise.resolve(deps.planning({
      capability,
      params: { ...args },
      lease: currentLease,
      origin: { host: "nomi", actorId: "project-agent-host" },
    })),
    signal,
  );

  /**
   * 「全自动」档里那次**没有报价卡**的放行（2026-09-12 用户拍板）。
   *
   * ── 为什么闸在 `preview` 之后 ──
   *
   * `preview` 是模型能走到的**最后一步**：它回的 `nextAction` 是 `request_gate`，而付费门
   * 根本不在模型的工具表里（`paidBoundary.ts`「内部面不投影」）。换句话说，模型交完这一步就
   * 把球传给了宿主——另外两档里宿主的回应是在介入槽里摆一张报价卡等用户点，
   * 「全自动」档里宿主的回应就是**在同一个边界上自己决**。不是绕过闸，是同一道闸换了个决定者：
   * 封印照做、收据照铸照签、一次性消费照旧（`generationSpendDecision.ts` 那一条链）。
   *
   * ── 三个「不」──
   *
   *   · **不新增预算**：这里没有任何金额判断。用户拍板的是「全自动 = 不再逐次问」，
   *     不是「¥X 以内不问」——设置里那条硬预算上限 2026-09-10 已经删掉，不许在这里长回来。
   *   · **不吞错**：决门失败就把错抛回去（`safeFailure` 会把它变成模型看得见的失败），
   *     报价卡也还在原处等用户——**这不是兜底**，是「没决成，所以它仍然待决」的真实状态。
   *   · **不猜档位**：`approvalPolicy` 缺席按默认档走，也就是照旧弹卡。
   *
   * `provider_configure` 那一档不决：供应商都没配好，封印只会立刻失败。
   */
  const decideByPolicyAfterPreview = async (
    args: Record<string, unknown>,
    preview: unknown,
    currentLease: ProjectLeaseV2,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (!spendDecidedByPolicy(deps.approvalPolicy?.())) return undefined;
    if (!deps.requestGenerationGate || !deps.authorizeGeneration || !deps.approvalReceiptAuthority) {
      throw Object.assign(new Error("generation_approval_unavailable"), { code: "generation_approval_unavailable" });
    }
    const nextAction = preview && typeof preview === "object" && !Array.isArray(preview)
      ? (preview as { nextAction?: unknown }).nextAction
      : undefined;
    if (nextAction !== "request_gate") return undefined;
    const outcome = await abortable(decideGenerationSpend({
      requestGenerationGate: deps.requestGenerationGate,
      authorizeGeneration: deps.authorizeGeneration,
      planning: deps.planning,
      receipts: deps.approvalReceiptAuthority,
    }, {
      operationId: operationId(args),
      lease: currentLease,
      decision: { kind: "policy-full-auto", surface: FULL_AUTO_POLICY_SURFACE },
      actorId: FULL_AUTO_POLICY_SURFACE,
    }), signal);
    return { preview, spendDecision: { decidedBy: outcome.decidedBy, receiptId: outcome.receiptId }, started: outcome.started };
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

  return Object.freeze({
    async tryExecute(call, signal) {
      if (!GENERATION_TOOL_NAMES.has(call.toolName)) return null;
      if (disposed) return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
      if (signal.aborted) return { ok: false, code: "generation_cancelled", message: "generation_cancelled", denied: true };
      try {
        const parsed = parsedArgs(call);
        const canonicalCall = canonicalGenerationCall(call, parsed);
        const args = canonicalCall.args as Record<string, unknown>;
        const currentLease = await lease(signal);
        if (canonicalCall.toolName === GATE_TOOL) {
          const result = await requestGate(args, currentLease, signal);
          const denied = result && typeof result === "object" && (result as { nextAction?: unknown }).nextAction === "revise";
          return denied
            ? { ok: false, code: "generation_declined", message: "Generation was not started", denied: true }
            : { ok: true, result, silent: true };
        }
        const capability = canonicalCall.toolName === START_TOOL
          ? "start"
          : canonicalCall.toolName === "nomi_get_generation_context"
            ? "context"
            : canonicalCall.toolName === "nomi_operation_create"
              ? "create"
              : canonicalCall.toolName === "nomi_submit_generation_plan"
                ? "plan"
                : canonicalCall.toolName === "nomi_preview_execution"
                  ? "preview"
                  : canonicalCall.toolName === "nomi_operation_read"
                    ? "read"
                    : canonicalCall.toolName === "nomi_cancel_generation"
                      ? "cancel"
                      : "reconcile";
        // operationId is required by every non-create descriptor. Parsing it
        // here keeps malformed model calls out of the durable operation store.
        if (capability !== "context" && capability !== "create") operationId(args);
        const result = await plan(capability, args, currentLease, signal);
        if (capability === "preview") {
          const decided = await decideByPolicyAfterPreview(args, result, currentLease, signal);
          if (decided) return { ok: true, result: decided };
        }
        return { ok: true, result, silent: capability === "context" || capability === "read" };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() { disposed = true; },
  });
}
