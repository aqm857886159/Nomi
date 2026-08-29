import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import {
  timelineReadInputForAlias,
  type TimelineReadInput,
} from "../shared/agentCapabilities/timelineRead";
import {
  timelineWriteInputForAlias,
  type TimelineWriteInput,
} from "../shared/agentCapabilities/timelineWrite";
import type { TargetRef } from "../shared/capabilityTargeting";
import type { CapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import type { CanvasReadSurfaceRegistry, CapturedCanvasReadPort } from "./canvasReadSurfaceRegistry";
import {
  createRendererTimelineReadVerifiedInvocationFactory,
  createRendererTimelineWriteVerifiedInvocationFactory,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

const PUBLIC_FAILURE_CODES = new Set([
  "capability_invocation_unverified",
  "capability_authority_invalid",
  "capability_input_invalid",
  "capability_policy_stale",
  "capability_output_invalid",
  "capability_timeout",
  "capability_cancelled",
  "capability_execution_failed",
  "capability_unsupported",
  "capability_target_stale",
  "project_binding_stale",
  "project_scope_required",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
  "plan_id_conflict",
  "undo_token_invalid",
  "undo_stale_revision",
]);

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  const candidate = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
  const code = candidate && PUBLIC_FAILURE_CODES.has(candidate) ? candidate : "capability_execution_failed";
  return { ok: false, code, message: code };
}

export type PiTimelineReadTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision | null>;
  dispose(): void;
}>;

export function createPiTimelineReadTransportAdapter(input: Readonly<{
  registry: CanvasReadSurfaceRegistry;
  capturedPort: CapturedCanvasReadPort;
  requestId: string;
  executor: Pick<CapabilityExecutorRegistry, "execute">;
}>): PiTimelineReadTransportAdapter {
  const factory = createRendererTimelineReadVerifiedInvocationFactory(input);
  let disposed = false;
  return Object.freeze({
    async tryExecute(call, signal) {
      let semanticInput: TimelineReadInput | undefined;
      try {
        semanticInput = timelineReadInputForAlias(call.toolName, call.args);
      } catch {
        return { ok: false, code: "capability_input_invalid", message: "capability_input_invalid" };
      }
      if (!semanticInput) return null;
      if (disposed) return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
      try {
        const invocation = await factory.mint({ toolCallId: call.toolCallId, input: semanticInput });
        const result = await input.executor.execute(invocation, { signal });
        return { ok: true, result, silent: true };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() { disposed = true; },
  });
}

type TimelineTarget = Extract<TargetRef, { kind: "timeline" }>;

export type PreparedTimelineWrite = Readonly<{
  call: RuntimeToolCall;
  invocation: VerifiedCapabilityInvocation<TimelineWriteInput, TimelineTarget>;
}>;

export type TimelineWriteApprovalAuthority = Readonly<{
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type PiTimelineWriteTransportAdapter = Readonly<{
  prepare(call: RuntimeToolCall, signal: AbortSignal): Promise<PreparedTimelineWrite | null>;
  execute(
    prepared: PreparedTimelineWrite,
    approval: TimelineWriteApprovalAuthority,
    signal: AbortSignal,
  ): Promise<RuntimeToolDecision>;
  dispose(): void;
}>;

export function createPiTimelineWriteTransportAdapter(input: Readonly<{
  registry: CanvasReadSurfaceRegistry;
  capturedPort: CapturedCanvasReadPort;
  requestId: string;
  executor: Pick<CapabilityExecutorRegistry, "execute">;
}>): PiTimelineWriteTransportAdapter {
  const factory = createRendererTimelineWriteVerifiedInvocationFactory(input);
  let disposed = false;
  return Object.freeze({
    async prepare(call, signal) {
      let semanticInput: TimelineWriteInput | undefined;
      try {
        semanticInput = timelineWriteInputForAlias(call.toolName, call.args);
      } catch {
        throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
      }
      if (!semanticInput) return null;
      if (disposed) throw Object.assign(new Error("surface_port_unavailable"), { code: "surface_port_unavailable" });
      if (signal.aborted) throw Object.assign(new Error("capability_cancelled"), { code: "capability_cancelled" });
      const invocation = await factory.mint({ toolCallId: call.toolCallId, input: semanticInput });
      return Object.freeze({ call, invocation });
    },
    async execute(prepared, approval, signal) {
      if (disposed) return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
      try {
        const result = await input.executor.execute(prepared.invocation, { signal, approval });
        if (!result.ok) {
          const code = typeof result.code === "string" && PUBLIC_FAILURE_CODES.has(result.code)
            ? result.code
            : "capability_execution_failed";
          return { ok: false, code, message: code };
        }
        return { ok: true, result, silent: true };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() { disposed = true; },
  });
}
