import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import { documentReadScopeForAlias } from "../shared/agentCapabilities/documentRead";
import type { CapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import type { CanvasReadSurfaceRegistry, CapturedCanvasReadPort } from "./canvasReadSurfaceRegistry";
import { createRendererDocumentReadVerifiedInvocationFactory } from "./verifiedCapabilityInvocation";

export type PiDocumentReadTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, documentId: string, signal: AbortSignal): Promise<RuntimeToolDecision | null>;
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
    "surface_port_unavailable", "surface_port_stale", "surface_owner_mismatch",
  ]);
  const published = publicCodes.has(code) ? code : "capability_execution_failed";
  return { ok: false, code: published, message: published };
}

export function createPiDocumentReadTransportAdapter(input: Readonly<{
  registry: CanvasReadSurfaceRegistry;
  capturedPort: CapturedCanvasReadPort;
  requestId: string;
  executor: Pick<CapabilityExecutorRegistry, "execute">;
}>): PiDocumentReadTransportAdapter {
  const factory = createRendererDocumentReadVerifiedInvocationFactory({
    registry: input.registry,
    capturedPort: input.capturedPort,
    requestId: input.requestId,
  });
  let disposed = false;
  return Object.freeze({
    async tryExecute(call, documentId, signal) {
      const scope = documentReadScopeForAlias(call.toolName)
        ?? (call.toolName === "nomi_document_read" && call.args && typeof call.args === "object"
          && (call.args as Record<string, unknown>).scope === "selection" ? "selection" : undefined)
        ?? (call.toolName === "nomi_document_read" ? "full" : undefined);
      if (!scope) return null;
      if (disposed) return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
      try {
        const invocation = await factory.mint({ toolCallId: call.toolCallId, documentId, input: { scope } });
        const result = await input.executor.execute(invocation, { signal });
        return { ok: true, result, silent: true };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() { disposed = true; },
  });
}
