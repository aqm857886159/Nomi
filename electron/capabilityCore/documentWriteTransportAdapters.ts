import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import {
  documentWriteOperationForAlias,
  type DocumentWriteInput,
} from "../shared/agentCapabilities/documentWrite";
import type { DocumentAnchorRef, PreconditionSet, TargetRef } from "../shared/capabilityTargeting";
import type { CapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import type { CanvasReadSurfaceRegistry, CapturedCanvasReadPort } from "./canvasReadSurfaceRegistry";
import {
  createRendererDocumentWriteVerifiedInvocationFactory,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

export type PreparedDocumentWrite = Readonly<{
  call: RuntimeToolCall;
  invocation: VerifiedCapabilityInvocation<
    DocumentWriteInput,
    Readonly<{ kind: "document"; documentId: string; anchor: DocumentAnchorRef }>
  >;
}>;

export type PiDocumentWriteTransportAdapter = Readonly<{
  prepare(
    call: RuntimeToolCall,
    input: Readonly<{ documentId: string; target: TargetRef; preconditions: PreconditionSet }>,
    signal: AbortSignal,
  ): Promise<PreparedDocumentWrite | null>;
  execute(prepared: PreparedDocumentWrite, signal: AbortSignal): Promise<RuntimeToolDecision>;
  dispose(): void;
}>;

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "capability_execution_failed";
  const publicCodes = new Set([
    "capability_invocation_unverified", "capability_authority_invalid", "capability_input_invalid",
    "capability_policy_stale", "capability_output_invalid", "capability_timeout", "capability_cancelled",
    "capability_execution_failed", "capability_unsupported", "project_binding_stale", "surface_port_suspended",
    "surface_port_unavailable", "surface_port_stale", "surface_owner_mismatch", "document_target_stale",
  ]);
  const published = publicCodes.has(code) ? code : "capability_execution_failed";
  return { ok: false, code: published, message: published };
}

function documentTarget(target: TargetRef): Extract<TargetRef, { kind: "document" }> | null {
  return target.kind === "document" ? target : null;
}

export function createPiDocumentWriteTransportAdapter(input: Readonly<{
  registry: CanvasReadSurfaceRegistry;
  capturedPort: CapturedCanvasReadPort;
  requestId: string;
  executor: Pick<CapabilityExecutorRegistry, "execute">;
}>): PiDocumentWriteTransportAdapter {
  const factory = createRendererDocumentWriteVerifiedInvocationFactory({
    registry: input.registry,
    capturedPort: input.capturedPort,
    requestId: input.requestId,
  });
  let disposed = false;
  return Object.freeze({
    async prepare(call, context, signal) {
      const args = call.args && typeof call.args === "object" ? call.args as Record<string, unknown> : {};
      const operation = documentWriteOperationForAlias(call.toolName)
        ?? (call.toolName === "nomi_document_edit" && typeof args.operation === "string"
          && ["insert", "replace", "append"].includes(args.operation) ? args.operation as "insert" | "replace" | "append" : undefined);
      if (!operation) return null;
      if (disposed) throw new Error("surface_port_unavailable");
      signal.throwIfAborted();
      const target = documentTarget(context.target);
      if (!target || target.documentId !== context.documentId) throw new Error("document_target_stale");
      const content = typeof args.content === "string" ? args.content : "";
      const invocation = await factory.mint({
        toolCallId: call.toolCallId,
        documentId: target.documentId,
        anchor: target.anchor,
        preconditions: context.preconditions,
        input: { operation, content },
      });
      return Object.freeze({ call, invocation });
    },
    async execute(prepared, signal) {
      if (disposed) return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
      try {
        const result = await input.executor.execute(prepared.invocation, { signal });
        return { ok: true, result, silent: true };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() { disposed = true; },
  });
}
