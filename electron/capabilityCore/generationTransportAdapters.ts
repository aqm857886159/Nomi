import { z } from "zod";
import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import {
  generationPlanInputSchema,
  generationStatusInputSchema,
  modelToolSurfaceManifest,
} from "../harness/tools/modelToolSurfaceManifest";
import { GENERATION_RECONCILE_OUTCOMES } from "./mcpGenerationTools";
import type { ProjectBinding } from "../shared/projectBinding";
import type { ProjectLeaseV2 } from "./projectLease";
import type { DispatchContext } from "./dispatcher";
import type { ApprovalReceiptAuthority, HumanApprovalReceiptV1 } from "./approvalReceipt";

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
}>;

const MODEL_GENERATION_TOOL_NAMES = new Set(modelToolSurfaceManifest.generation.map(({ name }) => name));
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

function challengeToken(value: unknown): string {
  const token = value && typeof value === "object" && !Array.isArray(value)
    && (value as { handoff?: { challengeToken?: unknown } }).handoff?.challengeToken;
  if (typeof token !== "string" || !token.trim()) {
    throw Object.assign(new Error("generation_challenge_unavailable"), { code: "generation_challenge_unavailable" });
  }
  return token.trim();
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
  ): Promise<unknown> => abortable(
    Promise.resolve(deps.planning({
      capability,
      params: { ...args },
      lease: currentLease,
      origin: { host: "nomi", actorId: "project-agent-host" },
    })),
    signal,
  );

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
      const token = challengeToken(gate);
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
        return { ok: true, result, silent: capability === "context" || capability === "read" };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() { disposed = true; },
  });
}
