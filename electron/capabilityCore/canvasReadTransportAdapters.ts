import { safeTransportFailure } from "./transportFailure";
import { CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES } from "../shared/surfacePortBinding";
import { CANVAS_READ_CAPABILITY, type CanvasReadResult } from "../shared/agentCapabilities/canvasRead";
import type { IpcMainInvokeEvent } from "electron";
import type { RuntimeToolCall, RuntimeToolDecision } from "../shared/agentCapabilities/transportContracts";
import type { CapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import {
  SurfacePortError,
  type CanvasReadSurfaceRegistry,
  type ProjectSurfaceSession,
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
const NOT_HANDLED = Object.freeze({ handled: false as const });

export function isCanvasReadTransportMethod(method: string): boolean {
  if (method !== CANVAS_READ_CAPABILITY.id) return false;
  return true;
}

// C4：放行清单从 owner 派生。这一份以前少了 `capability_receipt_unresolved` 与
// `capability_target_stale`——两者都会被静默换成 `capability_execution_failed`。
const PUBLIC_FAILURE_CODES = CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES;

function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  return safeTransportFailure(error, { allowedCodes: PUBLIC_FAILURE_CODES, fallbackCode: "capability_execution_failed" });
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

type PiCanvasReadDecision = Extract<RuntimeToolDecision, { ok: false }>
  | { ok: true; result: CanvasReadResult; silent: true };

type PiCanvasReadTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal): Promise<PiCanvasReadDecision | null>;
  dispose(): void;
}>;

/**
 * Narrow main-only submission capture. It closes over B3's exact owner service
 * and never exposes an authority capable of minting replacement evidence.
 */
type PiCanvasReadIpcCapture = Readonly<{
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
      if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null;
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
      const session = input.surfaceCapture.openBoundProjectSession(event, admission.surfaceBinding);
      return createPiCanvasReadTransportAdapter({
        registry: input.registry,
        session,
        requestId,
        executor: input.executor,
      });
    },
  });
}

export function createPiCanvasReadTransportAdapter(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    session: ProjectSurfaceSession;
    requestId: string;
    executor: Pick<CapabilityExecutorRegistry, "execute">;
  }>,
): PiCanvasReadTransportAdapter {
  const factory = createRendererCanvasReadVerifiedInvocationFactory({
    registry: input.registry,
    session: input.session,
    requestId: input.requestId,
  });
  return Object.freeze({
    async tryExecute(call, signal) {
      if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null;
      try {
        const invocation = await factory.mint({ toolCallId: call.toolCallId, input: call.args });
        const result = await input.executor.execute(invocation, { signal });
        return { ok: true, result, silent: true };
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
      if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null;
      try {
        const invocation = await factory.mint({ toolCallId: call.toolCallId, input: call.args });
        const result = await input.executor.execute(invocation, { signal });
        return { ok: true, result, silent: true };
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
