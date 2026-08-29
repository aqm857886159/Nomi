import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
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
  createRendererCanvasWriteVerifiedInvocationFactory,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

export type PreparedCanvasWrite = Readonly<{
  call: RuntimeToolCall;
  invocation: VerifiedCapabilityInvocation<CanvasWriteInput, Extract<TargetRef, { kind: "canvas" }>>;
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
  let disposed = false;
  return Object.freeze({
    async prepare(call, signal) {
      const operation = canvasWriteOperationForAlias(call.toolName);
      if (!operation) return null;
      if (disposed) throw Object.assign(new Error("surface_port_unavailable"), { code: "surface_port_unavailable" });
      if (signal.aborted) throw Object.assign(new Error("capability_cancelled"), { code: "capability_cancelled" });
      const args =
        call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? (call.args as Record<string, unknown>)
          : {};
      const piSchema = canvasWritePiInputSchemaForAlias(call.toolName);
      const parsed = piSchema?.safeParse(args);
      if (!parsed || !parsed.success)
        throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
      const semanticInput = canvasWriteSemanticInputSchema.safeParse({ operation, ...parsed.data });
      if (!semanticInput.success)
        throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
      const rawEvidence = await input.port.capture(
        operation === "set_node_prompt"
          ? {
              operation,
              nodeId: (semanticInput.data as Extract<CanvasWriteInput, { operation: "set_node_prompt" }>).nodeId,
              signal,
            }
          : { operation, input: semanticInput.data, signal },
      );
      const invocation = await factory.mint({
        toolCallId: call.toolCallId,
        input: semanticInput.data,
        rawEvidence,
      });
      return Object.freeze({ call, invocation });
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
