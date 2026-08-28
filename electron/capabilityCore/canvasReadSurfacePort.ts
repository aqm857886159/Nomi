import crypto from "node:crypto";

import { ipcMain, type IpcMainEvent } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import {
  SURFACE_CANVAS_READ_REPLY_CHANNEL,
  SURFACE_CANVAS_READ_REQUEST_CHANNEL,
  type SurfacePortWireErrorCode,
} from "../shared/surfacePortBinding";
import { CapabilityExecutionError, type CanvasReadPort } from "./capabilityExecutorRegistry";
import {
  type CanvasReadSurfaceRegistry,
  type CapturedCanvasReadPort,
  type CapturedCanvasReadPortDispatch,
  SurfacePortError,
} from "./canvasReadSurfaceRegistry";

type SendableFrame = Readonly<{
  send(channel: string, payload: unknown): void;
}>;

type PendingRead = {
  captured: CapturedCanvasReadPort;
  dispatch: CapturedCanvasReadPortDispatch;
  signal: AbortSignal;
  replying: boolean;
  active: boolean;
  abort(): void;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type CanvasReadSurfacePortRuntime = Readonly<{
  createPort(captured: CapturedCanvasReadPort): CanvasReadPort;
}>;

const REPLY_ERROR_CODES = new Set<SurfacePortWireErrorCode>([
  "project_identity_unavailable",
  "project_binding_stale",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function rendererReplyError(value: unknown): SurfacePortError | null {
  const code = record(value)?.code;
  return typeof code === "string" && REPLY_ERROR_CODES.has(code as SurfacePortWireErrorCode)
    ? new SurfacePortError(code as SurfacePortWireErrorCode)
    : null;
}

function sendableFrame(value: object): SendableFrame {
  if (typeof (value as { send?: unknown }).send !== "function") {
    throw new SurfacePortError("surface_port_unavailable");
  }
  return value as SendableFrame;
}

export function createCanvasReadSurfacePortRuntime(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    randomId?: () => string;
  }>,
): CanvasReadSurfacePortRuntime {
  const randomId = input.randomId ?? (() => crypto.randomUUID());
  const pending = new Map<string, PendingRead>();

  const settle = (
    requestId: string,
    request: PendingRead,
    outcome: Readonly<{
      value?: unknown;
      error?: Error;
    }>,
  ): void => {
    if (!request.active || pending.get(requestId) !== request) return;
    request.active = false;
    pending.delete(requestId);
    request.signal.removeEventListener("abort", request.abort);
    if (outcome.error) request.reject(outcome.error);
    else request.resolve(outcome.value);
  };

  ipcMain.on(SURFACE_CANVAS_READ_REPLY_CHANNEL, (event: IpcMainEvent, value: unknown) => {
    try {
      assertTrustedSender(event);
    } catch {
      return;
    }
    const reply = record(value);
    const requestId = typeof reply?.requestId === "string" ? reply.requestId : "";
    const request = pending.get(requestId);
    if (!request || request.replying || !request.active) return;
    if (event.sender !== request.dispatch.owner.contents || event.senderFrame !== request.dispatch.owner.frame) {
      return;
    }
    request.replying = true;
    void input.registry.assertCanvasReadPortReply(request.captured, reply?.binding).then(
      () => {
        if (!request.active || request.signal.aborted) return;
        const rendererError = rendererReplyError(reply?.error);
        if (reply?.error !== undefined && !rendererError) {
          settle(requestId, request, { error: new SurfacePortError("surface_port_unavailable") });
          return;
        }
        settle(requestId, request, rendererError ? { error: rendererError } : { value: reply?.result });
      },
      (error) =>
        settle(requestId, request, {
          error: error instanceof SurfacePortError ? error : new SurfacePortError("surface_port_unavailable"),
        }),
    );
  });

  return Object.freeze({
    createPort(captured): CanvasReadPort {
      return Object.freeze({
        read({ signal }): Promise<unknown> {
          if (signal.aborted) {
            return Promise.reject(new CapabilityExecutionError("capability_cancelled"));
          }
          let dispatch: CapturedCanvasReadPortDispatch;
          try {
            dispatch = input.registry.resolveCapturedCanvasReadPort(captured);
          } catch (error) {
            return Promise.reject(
              error instanceof SurfacePortError ? error : new SurfacePortError("surface_port_unavailable"),
            );
          }
          const requestId = randomId().trim();
          if (!requestId || pending.has(requestId)) {
            return Promise.reject(new SurfacePortError("surface_port_unavailable"));
          }
          return new Promise((resolve, reject) => {
            const request: PendingRead = {
              captured,
              dispatch,
              signal,
              replying: false,
              active: true,
              abort: () =>
                settle(requestId, request, {
                  error: new CapabilityExecutionError("capability_cancelled"),
                }),
              resolve,
              reject,
            };
            pending.set(requestId, request);
            signal.addEventListener("abort", request.abort, { once: true });
            try {
              sendableFrame(dispatch.owner.frame).send(SURFACE_CANVAS_READ_REQUEST_CHANNEL, {
                requestId,
                binding: dispatch.binding,
              });
            } catch {
              settle(requestId, request, { error: new SurfacePortError("surface_port_unavailable") });
            }
          });
        },
      });
    },
  });
}
