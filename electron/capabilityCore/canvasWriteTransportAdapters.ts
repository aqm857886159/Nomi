import { safeTransportFailure } from "./transportFailure";
import { CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES, parseSurfacePortFailure, surfacePortFailureAdvice } from "../shared/surfacePortBinding";
import type { RuntimeToolCall, RuntimeToolDecision, CanvasWriteApprovalAuthority } from "../shared/agentCapabilities/transportContracts";
import {
  CANVAS_DELETE_CAPABILITY,
  CANVAS_DELETE_ALIAS,
  canvasDeleteSemanticInputSchema,
  canvasDeleteInputForAlias,
  type CanvasDeleteInput,
} from "../shared/agentCapabilities/canvasDelete";
import {
  canvasWriteOperationForAlias,
  canvasWritePiInputSchemaForAlias,
  canvasWriteSemanticInputSchema,
  isNodeTargetedWriteOperation,
  type CanvasWriteInput,
  type NodeTargetedWriteOperation,
} from "../shared/agentCapabilities/canvasWrite";
import { DIRECTOR_WRITE_CAPABILITY, directorWriteSemanticInputSchema, type DirectorWriteInput } from "../shared/agentCapabilities/directorWrite";
import type { TargetRef } from "../shared/capabilityTargeting";
import type { CapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import type { CanvasReadSurfacePortRuntime } from "./canvasReadSurfacePort";
import type { CanvasReadSurfaceRegistry, ProjectSurfaceSession } from "./canvasReadSurfaceRegistry";
import {
  createRendererCanvasDeleteVerifiedInvocationFactory,
  createRendererCanvasWriteVerifiedInvocationFactory,
  createRendererDirectorWriteVerifiedInvocationFactory,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

type CanvasMutationInput = CanvasWriteInput | CanvasDeleteInput | DirectorWriteInput;

export type PreparedCanvasWrite = Readonly<{
  call: RuntimeToolCall;
  invocation: VerifiedCapabilityInvocation<CanvasMutationInput, Extract<TargetRef, { kind: "canvas" }>>;
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

// C4：这一份本来就是全仓唯一从 owner 派生的（其余 6 份是手抄）。现在底座也归位到
// CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES，只留画布写自己独有的那一个。
const PUBLIC_FAILURE_CODES = new Set([
  ...CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES,
  "capability_surface_unavailable",
]);

const CANVAS_DELETE_TOOL_ALIAS = CANVAS_DELETE_CAPABILITY.aliases.mcp;

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  return safeTransportFailure(error, {
    allowedCodes: PUBLIC_FAILURE_CODES, fallbackCode: "capability_execution_failed",
    // 端口自己给的那句人话也是**我们写的**（`surfacePortFailureAdvice`），所以走「原样交给模型」那一档。
    ownMessage: (value) => { const failure = parseSurfacePortFailure(value); return failure ? surfacePortFailureAdvice(failure).message : undefined },
    reason: (value) => parseSurfacePortFailure(value)?.reason,
  });
}

export function createPiCanvasWriteTransportAdapter(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    session: ProjectSurfaceSession;
    requestId: string;
    surfacePortRuntime: Pick<CanvasReadSurfacePortRuntime, "createCanvasWritePort">;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
  }>,
): PiCanvasWriteTransportAdapter {
  const factory = createRendererCanvasWriteVerifiedInvocationFactory({
    registry: input.registry,
    session: input.session,
    requestId: input.requestId,
  });
  const deleteFactory = createRendererCanvasDeleteVerifiedInvocationFactory({
    registry: input.registry,
    session: input.session,
    requestId: input.requestId,
  });
  const directorFactory = createRendererDirectorWriteVerifiedInvocationFactory({
    registry: input.registry,
    session: input.session,
    requestId: input.requestId,
  });
  let disposed = false;
  return Object.freeze({
    async prepare(call, signal) {
      // 3D-BOX：`director.write` 是独立契约（仅内部），但写口、证据、审批与画布写同一条 surface port。
      if (call.toolName === DIRECTOR_WRITE_CAPABILITY.id) {
        if (disposed) throw Object.assign(new Error("surface_port_unavailable"), { code: "surface_port_unavailable" });
        if (signal.aborted) throw Object.assign(new Error("capability_cancelled"), { code: "capability_cancelled" });
        let directorInput: DirectorWriteInput;
        try {
          directorInput = directorWriteSemanticInputSchema.parse(call.args);
        } catch {
          throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
        }
        const port = input.surfacePortRuntime.createCanvasWritePort(input.registry.captureProjectSessionPort(input.session));
        const rawEvidence = await port.capture({ operation: directorInput.operation, input: directorInput, signal });
        const invocation = await directorFactory.mint({ toolCallId: call.toolCallId, input: directorInput, rawEvidence });
        return Object.freeze({ call, invocation: invocation as unknown as PreparedCanvasWrite["invocation"] });
      }
      const args =
        call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? (call.args as Record<string, unknown>)
          : {};
      const semanticTool = call.toolName === "nomi_canvas_plan" || call.toolName === "nomi_canvas_edit";
      const operation = canvasWriteOperationForAlias(call.toolName)
        ?? (semanticTool && typeof args.operation === "string" ? args.operation as ReturnType<typeof canvasWriteOperationForAlias> : undefined);
      const isDelete = call.toolName === CANVAS_DELETE_ALIAS || call.toolName === CANVAS_DELETE_TOOL_ALIAS;
      if (!operation && !isDelete) return null;
      if (disposed) throw Object.assign(new Error("surface_port_unavailable"), { code: "surface_port_unavailable" });
      if (signal.aborted) throw Object.assign(new Error("capability_cancelled"), { code: "capability_cancelled" });
      let semanticInput: CanvasMutationInput;
      try {
        if (isDelete) {
          semanticInput = call.toolName === CANVAS_DELETE_ALIAS
            ? canvasDeleteInputForAlias(call.toolName, args)!
            : canvasDeleteSemanticInputSchema.parse({ operation: "delete_canvas_nodes", ...args });
        } else {
          // MCP transport metadata is carried beside the semantic operation.
          // Do not feed project/lease routing fields into the strict semantic
          // schema: they are verified by the session boundary, not part of
          // the canvas mutation itself.
          const { projectId: _projectId, leaseHandle: _leaseHandle, ...semanticArgs } = args;
          const parsed = semanticTool ? semanticArgs : canvasWritePiInputSchemaForAlias(call.toolName)?.parse(args);
          semanticInput = canvasWriteSemanticInputSchema.parse({ operation, ...parsed });
        }
      } catch {
        throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
      }
      const port = input.surfacePortRuntime.createCanvasWritePort(input.registry.captureProjectSessionPort(input.session));
      const rawEvidence = await port.capture(
        isNodeTargetedWriteOperation(operation)
          ? {
              operation,
              nodeId: (semanticInput as Extract<CanvasWriteInput, { operation: NodeTargetedWriteOperation }>).nodeId,
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
