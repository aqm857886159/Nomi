import crypto from "node:crypto";

import { ipcMain, type IpcMainEvent } from "electron";

import { assertTrustedFireAndForget, assertTrustedSender } from "../ipcSenderGuard";
import {
  SURFACE_CANVAS_READ_REPLY_CHANNEL,
  SURFACE_CANVAS_READ_REQUEST_CHANNEL,
  SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL,
  SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL,
  SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL,
  SURFACE_CANVAS_WRITE_EXECUTE_REQUEST_CHANNEL,
  SURFACE_DOCUMENT_READ_REPLY_CHANNEL,
  SURFACE_DOCUMENT_READ_REQUEST_CHANNEL,
  SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL,
  SURFACE_DOCUMENT_WRITE_REQUEST_CHANNEL,
  SURFACE_TIMELINE_READ_REPLY_CHANNEL,
  SURFACE_TIMELINE_READ_REQUEST_CHANNEL,
  SURFACE_TIMELINE_WRITE_REPLY_CHANNEL,
  SURFACE_TIMELINE_WRITE_REQUEST_CHANNEL,
  SURFACE_ASSET_READ_REPLY_CHANNEL,
  SURFACE_ASSET_READ_REQUEST_CHANNEL,
  SURFACE_EXPORT_READ_REPLY_CHANNEL,
  SURFACE_EXPORT_READ_REQUEST_CHANNEL,
  SURFACE_EXPORT_WRITE_REPLY_CHANNEL,
  SURFACE_EXPORT_WRITE_REQUEST_CHANNEL,
  SURFACE_PORT_CANCEL_REQUEST_CHANNEL,
  parseSurfacePortFailure,
} from "../shared/surfacePortBinding";
import {
  CapabilityExecutionError,
  type CanvasReadPort,
  type CanvasWritePort,
  type DocumentReadPort,
  type DocumentWritePort,
  type TimelineReadPort,
  type TimelineWritePort,
  type AssetReadPort,
  type ExportReadPort,
  type ExportWritePort,
} from "./capabilityExecutorRegistry";
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
  replyChannel: string;
  mutating: boolean;
  abort(): void;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type CanvasReadSurfacePortRuntime = Readonly<{
  createPort(captured: CapturedCanvasReadPort): CanvasReadPort;
  createDocumentReadPort(captured: CapturedCanvasReadPort, documentId: string): DocumentReadPort;
  createDocumentWritePort(captured: CapturedCanvasReadPort, documentId: string): DocumentWritePort;
  createCanvasWritePort(captured: CapturedCanvasReadPort): CanvasWritePort;
  createTimelineReadPort(captured: CapturedCanvasReadPort): TimelineReadPort;
  createTimelineWritePort(captured: CapturedCanvasReadPort): TimelineWritePort;
  createAssetReadPort(captured: CapturedCanvasReadPort): AssetReadPort;
  createExportReadPort(captured: CapturedCanvasReadPort): ExportReadPort;
  createExportWritePort(captured: CapturedCanvasReadPort): ExportWritePort;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function rendererReplyError(value: unknown): SurfacePortError | null {
  const failure = parseSurfacePortFailure(value);
  return failure ? new SurfacePortError(failure.code, failure.reason) : null;
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

  const handleReply = (replyChannel: string, event: IpcMainEvent, value: unknown): void => {
    const reply = record(value);
    const requestId = typeof reply?.requestId === "string" ? reply.requestId : "";
    const request = pending.get(requestId);
    if (!request || request.replyChannel !== replyChannel || request.replying || !request.active) return;
    if (event.sender !== request.dispatch.owner.contents || event.senderFrame !== request.dispatch.owner.frame) {
      return;
    }
    request.replying = true;
    void input.registry.assertCanvasReadPortReply(request.captured, reply?.binding).then(
      () => {
        if (!request.active || request.signal.aborted) return;
        const rendererError = rendererReplyError(reply?.error);
        if (reply?.error !== undefined && !rendererError) {
          settle(requestId, request, { error: new SurfacePortError(request.mutating ? "capability_receipt_unresolved" : "surface_port_unavailable") });
          return;
        }
        // 渲染层**回了**一个明确的拒绝，写入的结局本来是已知的：`surface_port_stale` 是它在碰文稿之前验目标
        //（锚点 / 内容哈希 / 项目绑定）发现对不上而拒绝的——什么都没执行（真机 pb04 实测：第五次写入收到的就是它）。
        // 把它当「结果不确定」只会让回执永远停在 `preparing`、挡住之后每一次写入。
        // 另外几个码（被取消 / 端口不可用 / 被挂起 / 绑定过期）可能发生在派发**之后**，结局真不知道，仍按不确定处理。
        const uncertain = request.mutating && rendererError && ["capability_cancelled", "surface_port_unavailable", "surface_port_suspended", "project_binding_stale"].includes(rendererError.code);
        settle(requestId, request, rendererError ? { error: uncertain ? new SurfacePortError("capability_receipt_unresolved") : rendererError } : { value: reply?.result });
      },
      (error) =>
        settle(requestId, request, {
          error: request.mutating ? new SurfacePortError("capability_receipt_unresolved")
            : error instanceof SurfacePortError ? error : new SurfacePortError("surface_port_unavailable"),
        }),
    );
  };
  ipcMain.on(SURFACE_CANVAS_READ_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_CANVAS_READ_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_CANVAS_READ_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_DOCUMENT_READ_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_DOCUMENT_READ_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_DOCUMENT_READ_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_TIMELINE_READ_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_TIMELINE_READ_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_TIMELINE_READ_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_TIMELINE_WRITE_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_TIMELINE_WRITE_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_TIMELINE_WRITE_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_ASSET_READ_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_ASSET_READ_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_ASSET_READ_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_EXPORT_READ_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_EXPORT_READ_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_EXPORT_READ_REPLY_CHANNEL, event, value);
  });
  ipcMain.on(SURFACE_EXPORT_WRITE_REPLY_CHANNEL, (event, value) => {
    if (!assertTrustedFireAndForget(event, SURFACE_EXPORT_WRITE_REPLY_CHANNEL, assertTrustedSender)) return;
    handleReply(SURFACE_EXPORT_WRITE_REPLY_CHANNEL, event, value);
  });

  const requestRead = (
    captured: CapturedCanvasReadPort,
    signal: AbortSignal,
    requestChannel: string,
    replyChannel: string,
    fields: Readonly<Record<string, unknown>>,
    mutating = false,
  ): Promise<unknown> => {
    if (signal.aborted) return Promise.reject(new CapabilityExecutionError("capability_cancelled"));
    let dispatch: CapturedCanvasReadPortDispatch;
    try {
      dispatch = input.registry.resolveCapturedCanvasReadPort(captured);
    } catch (error) {
      return Promise.reject(
        error instanceof SurfacePortError ? error : new SurfacePortError("surface_port_unavailable"),
      );
    }
    if (dispatch.sessionSignal) signal = AbortSignal.any([signal, dispatch.sessionSignal]);
    const requestId = randomId().trim();
    if (!requestId || pending.has(requestId)) return Promise.reject(new SurfacePortError("surface_port_unavailable"));
    return new Promise((resolve, reject) => {
      const request: PendingRead = {
        captured,
        dispatch,
        signal,
        replying: false,
        active: true,
        replyChannel,
        mutating,
        abort: () => {
          try {
            sendableFrame(request.dispatch.owner.frame).send(SURFACE_PORT_CANCEL_REQUEST_CHANNEL, {
              requestId,
              binding: request.dispatch.binding,
            });
          } catch {
            // The local rejection remains authoritative when the renderer is already gone.
          }
          settle(requestId, request, { error: mutating ? new SurfacePortError("capability_receipt_unresolved")
            : new CapabilityExecutionError("capability_cancelled") });
        },
        resolve,
        reject,
      };
      pending.set(requestId, request);
      signal.addEventListener("abort", request.abort, { once: true });
      try {
        sendableFrame(dispatch.owner.frame).send(requestChannel, {
          requestId,
          binding: dispatch.binding,
          ...fields,
        });
      } catch {
        settle(requestId, request, { error: new SurfacePortError(mutating ? "capability_receipt_unresolved" : "surface_port_unavailable") });
      }
    });
  };

  return Object.freeze({
    createPort(captured): CanvasReadPort {
      return Object.freeze({
        read({ signal }): Promise<unknown> {
          return requestRead(
            captured,
            signal,
            SURFACE_CANVAS_READ_REQUEST_CHANNEL,
            SURFACE_CANVAS_READ_REPLY_CHANNEL,
            {},
          );
        },
      });
    },
    createDocumentReadPort(captured, documentId) {
      return Object.freeze({
        read({ scope, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_DOCUMENT_READ_REQUEST_CHANNEL,
            SURFACE_DOCUMENT_READ_REPLY_CHANNEL,
            { documentId, scope },
          );
        },
      });
    },
    createDocumentWritePort(captured, documentId) {
      return Object.freeze({
        write({ operation, content, target, preconditions, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_DOCUMENT_WRITE_REQUEST_CHANNEL,
            SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL,
            { documentId, operation, content, target, preconditions },
            true,
          );
        },
      });
    },
    createCanvasWritePort(captured) {
      return Object.freeze({
        capture({ operation, input, nodeId, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL,
            SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL,
            {
              operation,
              ...(nodeId !== undefined ? { nodeId } : {}),
              ...(input !== undefined ? { input } : {}),
            },
          );
        },
        write({ input: semanticInput, target, preconditions, receiptProposalId, approvalId, actionHash, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_CANVAS_WRITE_EXECUTE_REQUEST_CHANNEL,
            SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL,
            { input: semanticInput, target, preconditions, receiptProposalId, approvalId, actionHash },
            true,
          );
        },
      });
    },
    createTimelineReadPort(captured) {
      return Object.freeze({
        read({ input: semanticInput, target, preconditions, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_TIMELINE_READ_REQUEST_CHANNEL,
            SURFACE_TIMELINE_READ_REPLY_CHANNEL,
            { input: semanticInput, target, preconditions },
          );
        },
      });
    },
    createTimelineWritePort(captured) {
      return Object.freeze({
        write({ input: semanticInput, target, preconditions, receiptProposalId, approvalId, actionHash, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_TIMELINE_WRITE_REQUEST_CHANNEL,
            SURFACE_TIMELINE_WRITE_REPLY_CHANNEL,
            { input: semanticInput, target, preconditions, receiptProposalId, approvalId, actionHash },
            true,
          );
        },
      });
    },
    createAssetReadPort(captured) {
      return Object.freeze({
        read({ input: semanticInput, target, preconditions, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_ASSET_READ_REQUEST_CHANNEL,
            SURFACE_ASSET_READ_REPLY_CHANNEL,
            { input: semanticInput, target, preconditions },
          );
        },
      });
    },
    createExportReadPort(captured) {
      return Object.freeze({
        read({ input: semanticInput, target, preconditions, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_EXPORT_READ_REQUEST_CHANNEL,
            SURFACE_EXPORT_READ_REPLY_CHANNEL,
            { input: semanticInput, target, preconditions },
          );
        },
      });
    },
    createExportWritePort(captured) {
      return Object.freeze({
        write({ input: semanticInput, target, preconditions, receiptProposalId, approvalId, actionHash, signal }) {
          return requestRead(
            captured,
            signal,
            SURFACE_EXPORT_WRITE_REQUEST_CHANNEL,
            SURFACE_EXPORT_WRITE_REPLY_CHANNEL,
            { input: semanticInput, target, preconditions, receiptProposalId, approvalId, actionHash },
            true,
          );
        },
      });
    },
  });
}
