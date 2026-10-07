import { safeTransportFailure } from "./transportFailure";
import { CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES } from "../shared/surfacePortBinding";
import type { RuntimeToolCall, RuntimeToolDecision } from "../shared/agentCapabilities/transportContracts";
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
import type { CanvasReadSurfaceRegistry, ProjectSurfaceSession } from "./canvasReadSurfaceRegistry";
import {
  createRendererTimelineReadVerifiedInvocationFactory,
  createRendererTimelineWriteVerifiedInvocationFactory,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

// C4：共同底座从 owner 派生，只保留时间轴自己独有的四个码。
// 这一份以前少了 `project_identity_unavailable`。
const PUBLIC_FAILURE_CODES = new Set([
  ...CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES,
  "project_scope_required",
  "plan_id_conflict",
  "undo_token_invalid",
  "undo_stale_revision",
  "undo_conflict",
]);

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  return safeTransportFailure(error, { allowedCodes: PUBLIC_FAILURE_CODES, fallbackCode: "capability_execution_failed" });
}

export type PiTimelineReadTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision | null>;
  dispose(): void;
}>;

export function createPiTimelineReadTransportAdapter(input: Readonly<{
  registry: CanvasReadSurfaceRegistry;
  session: ProjectSurfaceSession;
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
  session: ProjectSurfaceSession;
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
