import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import {
  CANVAS_DELETE_ALIAS,
  canvasDeleteInputForAlias,
  type CanvasDeleteInput,
} from "../shared/agentCapabilities/canvasDelete";
import {
  canvasWriteOperationForAlias,
  canvasWritePiInputSchemaForAlias,
  canvasWriteSemanticInputSchema,
  type CanvasWriteInput,
} from "../shared/agentCapabilities/canvasWrite";
import type { TargetRef } from "../shared/capabilityTargeting";
import type { CapabilityExecutorRegistry, CanvasWritePort } from "./capabilityExecutorRegistry";
import type { CanvasReadSurfaceRegistry, CapturedCanvasReadPort } from "./canvasReadSurfaceRegistry";
import {
  createRendererCanvasDeleteVerifiedInvocationFactory,
  createRendererCanvasWriteVerifiedInvocationFactory,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

type CanvasMutationInput = CanvasWriteInput | CanvasDeleteInput;

export type PreparedCanvasWrite = Readonly<{
  call: RuntimeToolCall;
  invocation: VerifiedCapabilityInvocation<CanvasMutationInput, Extract<TargetRef, { kind: "canvas" }>>;
}>;

export type CanvasWriteApprovalAuthority = Readonly<{
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type PiCanvasWriteTransportAdapter = Readonly<{
  prepare(call: RuntimeToolCall, signal: AbortSignal): Promise<PreparedCanvasWrite | null>;
  execute(
    prepared: PreparedCanvasWrite,
    approval: CanvasWriteApprovalAuthority,
    signal: AbortSignal,
  ): Promise<RuntimeToolDecision>;
  dispose(): void;
}>;

const PUBLIC_FAILURE_CODES = new Set([
  "capability_invocation_unverified",
  "capability_authority_invalid",
  "capability_input_invalid",
  "capability_policy_stale",
  "capability_output_invalid",
  "capability_timeout",
  "capability_cancelled",
  "capability_execution_failed",
  "capability_receipt_unresolved",
  "capability_surface_unavailable",
  "capability_unsupported",
  "capability_target_stale",
  "project_binding_stale",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
]);

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  const candidate =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  const code = candidate && PUBLIC_FAILURE_CODES.has(candidate) ? candidate : "capability_execution_failed";
  return { ok: false, code, message: code };
}

export function createPiCanvasWriteTransportAdapter(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    capturedPort: CapturedCanvasReadPort;
    requestId: string;
    port: CanvasWritePort;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
  }>,
): PiCanvasWriteTransportAdapter {
  const factory = createRendererCanvasWriteVerifiedInvocationFactory({
    registry: input.registry,
    capturedPort: input.capturedPort,
    requestId: input.requestId,
  });
  const deleteFactory = createRendererCanvasDeleteVerifiedInvocationFactory({
    registry: input.registry,
    capturedPort: input.capturedPort,
    requestId: input.requestId,
  });
  let disposed = false;
  return Object.freeze({
    async prepare(call, signal) {
      const args =
        call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? (call.args as Record<string, unknown>)
          : {};
      const semanticTool = call.toolName === "nomi_canvas_plan" || call.toolName === "nomi_canvas_edit";
      const operation = canvasWriteOperationForAlias(call.toolName)
        ?? (semanticTool && typeof args.operation === "string" ? args.operation as ReturnType<typeof canvasWriteOperationForAlias> : undefined);
      const isDelete = call.toolName === CANVAS_DELETE_ALIAS;
      if (!operation && !isDelete) return null;
      if (disposed) throw Object.assign(new Error("surface_port_unavailable"), { code: "surface_port_unavailable" });
      if (signal.aborted) throw Object.assign(new Error("capability_cancelled"), { code: "capability_cancelled" });
      let semanticInput: CanvasMutationInput;
      try {
        if (isDelete) {
          semanticInput = canvasDeleteInputForAlias(call.toolName, args)!;
        } else {
          const parsed = semanticTool ? args : canvasWritePiInputSchemaForAlias(call.toolName)?.parse(args);
          semanticInput = canvasWriteSemanticInputSchema.parse({ operation, ...parsed });
        }
      } catch {
        throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
      }
      const rawEvidence = await input.port.capture(
        operation === "set_node_prompt"
          ? {
              operation,
              nodeId: (semanticInput as Extract<CanvasWriteInput, { operation: "set_node_prompt" }>).nodeId,
              signal,
            }
          : { operation: semanticInput.operation, input: semanticInput, signal },
      );
      const invocation = isDelete
        ? await deleteFactory.mint({ toolCallId: call.toolCallId, input: semanticInput, rawEvidence })
        : await factory.mint({ toolCallId: call.toolCallId, input: semanticInput, rawEvidence });
      return Object.freeze({ call, invocation: invocation as PreparedCanvasWrite["invocation"] });
    },
    async execute(prepared, approval, signal) {
      if (disposed) return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
      try {
        const result = await input.executor.execute(prepared.invocation, { signal, approval });
        return { ok: true, result, silent: true };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() {
      disposed = true;
    },
  });
}
