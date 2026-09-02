import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import type { IpcMainInvokeEvent } from "electron";
import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import type { CapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import {
  SurfacePortError,
  type CanvasReadSurfaceRegistry,
  type CapturedCanvasReadPort,
} from "./canvasReadSurfaceRegistry";
import type {
  CapturedCanvasReadSnapshotPort,
  CapturedCanvasReadSnapshotRegistry,
} from "./canvasReadCapturedSnapshotRegistry";
import type { CanvasReadSurfaceIpcCapture } from "./canvasReadSurfaceIpc";
import type { VerifiedProjectSessionBinding } from "./projectSessionRuntime";
import {
  createMcpCanvasReadVerifiedInvocationFactory,
  createCapturedRendererCanvasReadVerifiedInvocationFactory,
  createRendererCanvasReadVerifiedInvocationFactory,
  type InternalCanvasReadVerifiedInvocationFactory,
} from "./verifiedCapabilityInvocation";

type ExecuteOptions = Readonly<{ signal?: AbortSignal }>;
export type CanvasReadTransportMatch<T> = Readonly<{ handled: false } | { handled: true; result: T }>;
const NOT_HANDLED = Object.freeze({ handled: false as const });

export function isCanvasReadTransportMethod(method: string): boolean {
  if (method !== CANVAS_READ_CAPABILITY.id) return false;
  return true;
}

const PUBLIC_FAILURE_CODES = new Set([
  "capability_invocation_unverified",
  "capability_authority_invalid",
  "capability_input_invalid",
  "capability_policy_stale",
  "capability_output_invalid",
  "capability_timeout",
  "capability_cancelled",
  "capability_execution_failed",
  "project_identity_unavailable",
  "project_binding_stale",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
]);

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  const candidate =
    error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  const code =
    typeof candidate === "string" && PUBLIC_FAILURE_CODES.has(candidate) ? candidate : "capability_execution_failed";
  return { ok: false, code, message: code };
}

export function createMcpCanvasReadTransportAdapter(
  input: Readonly<{
    projectSession: VerifiedProjectSessionBinding;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
  }>,
) {
  const factory = createMcpCanvasReadVerifiedInvocationFactory({ projectSession: input.projectSession });
  const execute = async (requestBody: unknown, options: ExecuteOptions = {}) => {
    const invocation = await factory.mint({ requestBody });
    return input.executor.execute(invocation, options);
  };
  return Object.freeze({
    execute,
    async tryExecute(method: string, requestBody: unknown, options: ExecuteOptions = {}) {
      if (!isCanvasReadTransportMethod(method)) return NOT_HANDLED;
      return Object.freeze({ handled: true as const, result: await execute(requestBody, options) });
    },
  });
}

export function createInternalCanvasReadTransportAdapter(
  input: Readonly<{
    factory: InternalCanvasReadVerifiedInvocationFactory;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
  }>,
) {
  const execute = async (request: Readonly<{ bearer: string; requestBody: unknown }>, options: ExecuteOptions = {}) => {
    const invocation = await input.factory.mint(request);
    return input.executor.execute(invocation, options);
  };
  return Object.freeze({
    execute,
    async tryExecute(
      method: string,
      request: Readonly<{ bearer: string; requestBody: unknown }>,
      options: ExecuteOptions = {},
    ) {
      if (!isCanvasReadTransportMethod(method)) return NOT_HANDLED;
      return Object.freeze({ handled: true as const, result: await execute(request, options) });
    },
  });
}

export type PiCanvasReadTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision | null>;
  dispose(): void;
}>;

/**
 * Narrow main-only submission capture. It closes over B3's exact owner service
 * and never exposes an authority capable of minting replacement evidence.
 */
export type PiCanvasReadIpcCapture = Readonly<{
  capture(
    event: IpcMainInvokeEvent,
    admission: Readonly<{
      surfaceBinding?: unknown;
      capturedCanvasReadSnapshot?: unknown;
      projectId: string;
    }>,
    requestId: string,
  ): PiCanvasReadTransportAdapter;
}>;

function createUnavailablePiCanvasReadTransportAdapter(): PiCanvasReadTransportAdapter {
  return Object.freeze({
    async tryExecute(call) {
      if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi && call.toolName !== "nomi_canvas_read") return null;
      return { ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" };
    },
    dispose() {},
  });
}

export function createPiCanvasReadIpcCapture(
  input: Readonly<{
    surfaceCapture: CanvasReadSurfaceIpcCapture;
    registry: CanvasReadSurfaceRegistry;
    capturedSnapshots: CapturedCanvasReadSnapshotRegistry;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
  }>,
): PiCanvasReadIpcCapture {
  return Object.freeze({
    capture(event, admission, requestId) {
      if (admission.surfaceBinding !== undefined && admission.capturedCanvasReadSnapshot !== undefined) {
        throw new SurfacePortError("surface_port_stale");
      }
      if (admission.capturedCanvasReadSnapshot !== undefined) {
        const capturedPort = input.surfaceCapture.consumeCapturedCanvasReadSnapshot(
          event,
          admission.capturedCanvasReadSnapshot,
          admission.projectId,
        );
        return createCapturedPiCanvasReadTransportAdapter({
          registry: input.capturedSnapshots,
          capturedPort,
          requestId,
          executor: input.executor,
          dispose: () => input.surfaceCapture.releaseCapturedCanvasReadSnapshot(capturedPort),
        });
      }
      if (admission.surfaceBinding === undefined) return createUnavailablePiCanvasReadTransportAdapter();
      const capturedPort = input.surfaceCapture.captureCanvasReadPort(event, admission.surfaceBinding);
      return createPiCanvasReadTransportAdapter({
        registry: input.registry,
        capturedPort,
        requestId,
        executor: input.executor,
      });
    },
  });
}

export function createPiCanvasReadTransportAdapter(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    capturedPort: CapturedCanvasReadPort;
    requestId: string;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
  }>,
): PiCanvasReadTransportAdapter {
  const factory = createRendererCanvasReadVerifiedInvocationFactory({
    registry: input.registry,
    capturedPort: input.capturedPort,
    requestId: input.requestId,
  });
  return Object.freeze({
    async tryExecute(call, signal) {
      if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi && call.toolName !== "nomi_canvas_read") return null;
      try {
        const invocation = await factory.mint({ toolCallId: call.toolCallId, input: call.args });
        const result = await input.executor.execute(invocation, { signal });
        return { ok: true, result: formatCanvasForAgent(result), silent: true };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() {},
  });
}

export function createCapturedPiCanvasReadTransportAdapter(
  input: Readonly<{
    registry: CapturedCanvasReadSnapshotRegistry;
    capturedPort: CapturedCanvasReadSnapshotPort;
    requestId: string;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
    dispose?: () => void;
  }>,
): PiCanvasReadTransportAdapter {
  const factory = createCapturedRendererCanvasReadVerifiedInvocationFactory({
    registry: input.registry,
    capturedPort: input.capturedPort,
    requestId: input.requestId,
  });
  let disposed = false;
  return Object.freeze({
    async tryExecute(call, signal) {
      if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi && call.toolName !== "nomi_canvas_read") return null;
      try {
        const invocation = await factory.mint({ toolCallId: call.toolCallId, input: call.args });
        const result = await input.executor.execute(invocation, { signal });
        return { ok: true, result: formatCanvasForAgent(result), silent: true };
      } catch (error) {
        return safeFailure(error);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      input.dispose?.();
    },
  });
}
