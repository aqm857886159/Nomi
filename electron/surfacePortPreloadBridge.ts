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
  type AssetReadSurfaceRequestWire,
  type CapturedCanvasReadSnapshotHandleWire,
  type CanvasReadSurfaceBridge,
  type CanvasReadSurfaceRequestWire,
  type CanvasWriteCaptureSurfaceRequestWire,
  type CanvasWriteExecuteSurfaceRequestWire,
  type DocumentReadSurfaceRequestWire,
  type DocumentWriteSurfaceRequestWire,
  type ExportReadSurfaceRequestWire,
  type ExportWriteSurfaceRequestWire,
  type SurfacePortBindingWire,
  type SurfacePortCancelRequestWire,
  SurfacePortWireError,
  sameSurfacePortBindingWire,
  surfacePortFailure,
  surfacePortReplyPayload,
  type SurfaceSuspensionWire,
  type TimelineReadSurfaceRequestWire,
  type TimelineWriteSurfaceRequestWire,
  unwrapSurfacePortIpcResponse,
} from "./shared/surfacePortBinding";
import { assetReadSemanticInputSchema } from "./shared/agentCapabilities/assetRead";
import { exportReadSemanticInputSchema, exportWriteSemanticInputSchema } from "./shared/agentCapabilities/exportCapabilities";
import { timelineReadSemanticInputSchema } from "./shared/agentCapabilities/timelineRead";
import { timelineWriteSemanticInputSchema } from "./shared/agentCapabilities/timelineWrite";
import { DIRECTOR_WRITE_OPERATIONS } from "./shared/agentCapabilities/directorWrite";

type Invoke = (channel: string, payload: unknown) => Promise<unknown>;
type SurfaceReadEvents = Readonly<{
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
  send(channel: string, payload: unknown): void;
}>;

function freezeSuspensionReply(reply: { suspension: SurfaceSuspensionWire }) {
  Object.freeze(reply.suspension);
  return Object.freeze(reply);
}

function freezeBindingReply(reply: { binding: SurfacePortBindingWire }) {
  Object.freeze(reply.binding.binding);
  Object.freeze(reply.binding);
  return Object.freeze(reply);
}

function freezeCapturedSnapshotReply(reply: { handle: CapturedCanvasReadSnapshotHandleWire }) {
  Object.freeze(reply.handle);
  return Object.freeze(reply);
}

function readRequest(value: unknown): CanvasReadSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  return request as unknown as CanvasReadSurfaceRequestWire;
}

function documentReadRequest(value: unknown): DocumentReadSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (typeof request.documentId !== "string" || !request.documentId.trim()) return null;
  if (request.scope !== "full" && request.scope !== "selection") return null;
  return request as unknown as DocumentReadSurfaceRequestWire;
}

function documentWriteRequest(value: unknown): DocumentWriteSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (typeof request.documentId !== "string" || !request.documentId.trim()) return null;
  if (request.operation !== "insert" && request.operation !== "replace" && request.operation !== "append") return null;
  if (typeof request.content !== "string" || !request.content.trim()) return null;
  if (
    !Object.prototype.hasOwnProperty.call(request, "target") ||
    !Object.prototype.hasOwnProperty.call(request, "preconditions")
  )
    return null;
  return request as unknown as DocumentWriteSurfaceRequestWire;
}

/** 画布写取证的操作白名单（手写，preload 是信任边界）。开关关时就是这 11 个，一个不多。 */
export const CANVAS_WRITE_CAPTURE_OPERATIONS = Object.freeze([
  "set_node_prompt",
  "set_node_text",
  "create_canvas_nodes",
  "connect_canvas_edges",
  "tidy_canvas",
  "propose_storyboard_plan",
  "patch_shots",
  "arrange_storyboard_to_timeline",
  "create_staging_reference",
  "create_camera_move",
  "delete_canvas_nodes",
] as const);

/** 3D-BOX 开关开时**追加**的两个（`director.write`，仅内部）；值来自 preload 核对过指纹的那份开关证明。 */
export function canvasWriteCaptureOperations(director3dbox: boolean): readonly string[] {
  return director3dbox ? [...CANVAS_WRITE_CAPTURE_OPERATIONS, ...DIRECTOR_WRITE_OPERATIONS] : CANVAS_WRITE_CAPTURE_OPERATIONS;
}

/** 取证只带 nodeId（不带 input）的两个单节点 operation。preload 是信任边界，名单手写在这里。 */
const NODE_TARGETED_CAPTURE_OPERATIONS: ReadonlySet<string> = new Set(["set_node_prompt", "set_node_text"]);

function canvasWriteCaptureRequest(value: unknown, allowed: readonly string[]): CanvasWriteCaptureSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (typeof request.operation !== "string" || !allowed.includes(request.operation)) return null;
  if (NODE_TARGETED_CAPTURE_OPERATIONS.has(request.operation) && (typeof request.nodeId !== "string" || !request.nodeId.trim()))
    return null;
  if (!NODE_TARGETED_CAPTURE_OPERATIONS.has(request.operation) && !Object.prototype.hasOwnProperty.call(request, "input")) return null;
  return request as unknown as CanvasWriteCaptureSurfaceRequestWire;
}

function canvasWriteExecuteRequest(value: unknown): CanvasWriteExecuteSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (
    !Object.prototype.hasOwnProperty.call(request, "input") ||
    !Object.prototype.hasOwnProperty.call(request, "target") ||
    !Object.prototype.hasOwnProperty.call(request, "preconditions")
  )
    return null;
  if (typeof request.receiptProposalId !== "string" || !request.receiptProposalId.trim()) return null;
  if (typeof request.approvalId !== "string" || !request.approvalId.trim()) return null;
  if (typeof request.actionHash !== "string" || !request.actionHash.trim()) return null;
  return request as unknown as CanvasWriteExecuteSurfaceRequestWire;
}

function timelineReadRequest(value: unknown): TimelineReadSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (!timelineReadSemanticInputSchema.safeParse(request.input).success) return null;
  if (!Object.prototype.hasOwnProperty.call(request, "target") || !Object.prototype.hasOwnProperty.call(request, "preconditions")) return null;
  return request as unknown as TimelineReadSurfaceRequestWire;
}

function timelineWriteRequest(value: unknown): TimelineWriteSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (!timelineWriteSemanticInputSchema.safeParse(request.input).success) return null;
  if (!Object.prototype.hasOwnProperty.call(request, "target") || !Object.prototype.hasOwnProperty.call(request, "preconditions")) return null;
  if (typeof request.receiptProposalId !== "string" || !request.receiptProposalId.trim()) return null;
  if (typeof request.approvalId !== "string" || !request.approvalId.trim()) return null;
  if (typeof request.actionHash !== "string" || !request.actionHash.trim()) return null;
  return request as unknown as TimelineWriteSurfaceRequestWire;
}

function readCapabilityRequest<T>(value: unknown, schema: { safeParse(input: unknown): { success: boolean } }): T | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (!schema.safeParse(request.input).success) return null;
  if (!Object.prototype.hasOwnProperty.call(request, "target") || !Object.prototype.hasOwnProperty.call(request, "preconditions")) return null;
  return request as T;
}

function assetReadRequest(value: unknown): AssetReadSurfaceRequestWire | null {
  return readCapabilityRequest<AssetReadSurfaceRequestWire>(value, assetReadSemanticInputSchema);
}

function exportReadRequest(value: unknown): ExportReadSurfaceRequestWire | null {
  return readCapabilityRequest<ExportReadSurfaceRequestWire>(value, exportReadSemanticInputSchema);
}

function exportWriteRequest(value: unknown): ExportWriteSurfaceRequestWire | null {
  const request = readCapabilityRequest<ExportWriteSurfaceRequestWire>(value, exportWriteSemanticInputSchema);
  if (!request) return null;
  if (typeof request.receiptProposalId !== "string" || !request.receiptProposalId.trim()) return null;
  if (typeof request.approvalId !== "string" || !request.approvalId.trim()) return null;
  if (typeof request.actionHash !== "string" || !request.actionHash.trim()) return null;
  return request;
}

function cancelRequest(value: unknown): SurfacePortCancelRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  return request as unknown as SurfacePortCancelRequestWire;
}

// C2：这里原来自己列了 7 维，漏掉 version / webContentsId / processId / frameRoutingId / origin。
// preload 正是主进程与渲染层之间那道信任边界，「这条回复是不是发给我的」靠它答——
// 两份绑定只在 webContentsId 上不同（同一个项目、另一个窗口）时，旧版会说「是同一个」。
// 现在用 owner 那一份（13 维），本层不再列字段。
const sameSurfaceAuthority = sameSurfacePortBindingWire;

export function createCanvasReadSurfacePreloadBridge(
  invoke: Invoke,
  events?: SurfaceReadEvents,
  options: Readonly<{ director3dbox?: boolean }> = {},
): CanvasReadSurfaceBridge {
  const captureOperations = canvasWriteCaptureOperations(options.director3dbox === true);
  const runCancellable = (
    request: Readonly<{ requestId: string; binding: SurfacePortBindingWire }>,
    run: (signal: AbortSignal) => unknown | Promise<unknown>,
  ): Promise<unknown> => {
    if (!events) return Promise.reject(new SurfacePortWireError("surface_port_unavailable"));
    const controller = new AbortController();
    const unsubscribe = events.subscribe(SURFACE_PORT_CANCEL_REQUEST_CHANNEL, (payload) => {
      const cancellation = cancelRequest(payload);
      if (
        cancellation
        && cancellation.requestId === request.requestId
        && sameSurfaceAuthority(cancellation.binding, request.binding)
      ) {
        controller.abort();
      }
    });
    let result: unknown | Promise<unknown>;
    try {
      result = run(controller.signal);
    } catch (error) {
      result = Promise.reject(error);
    }
    return Promise.resolve(result)
      .then((value) => {
        if (controller.signal.aborted) throw new SurfacePortWireError("capability_cancelled");
        return value;
      })
      .finally(unsubscribe);
  };
  return Object.freeze({
    async suspend(input) {
      return freezeSuspensionReply(
        unwrapSurfacePortIpcResponse<{ suspension: SurfaceSuspensionWire }>(
          await invoke("nomi:surface:suspend", input),
        ),
      );
    },
    async commitCanvasRead(input) {
      return freezeBindingReply(
        unwrapSurfacePortIpcResponse<{ binding: SurfacePortBindingWire }>(
          await invoke("nomi:surface:commitCanvasRead", input),
        ),
      );
    },
    async captureCanvasReadSnapshot(input) {
      return freezeCapturedSnapshotReply(
        unwrapSurfacePortIpcResponse<{ handle: CapturedCanvasReadSnapshotHandleWire }>(
          await invoke("nomi:surface:captureCanvasReadSnapshot", input),
        ),
      );
    },
    async release(input) {
      return Object.freeze(
        unwrapSurfacePortIpcResponse<{ released: true }>(await invoke("nomi:surface:release", input)),
      );
    },
    onCanvasRead(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_CANVAS_READ_REQUEST_CHANNEL, (payload) => {
        const request = readRequest(payload);
        if (!request) return;
        let result: unknown | Promise<unknown>;
        try {
          // Invoke synchronously so the renderer captures the live bound store
          // before any handler await can observe a later project.
          result = handler({ binding: request.binding });
        } catch (error) {
          result = Promise.reject(error);
        }
        void Promise.resolve(result).then(
          (value) =>
            events.send(SURFACE_CANVAS_READ_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              ...surfacePortReplyPayload(value),
            }),
          (error) =>
            events.send(SURFACE_CANVAS_READ_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: surfacePortFailure(error),
            }),
        );
      });
    },
    onDocumentRead(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_DOCUMENT_READ_REQUEST_CHANNEL, (payload) => {
        const request = documentReadRequest(payload);
        if (!request) return;
        let result: unknown | Promise<unknown>;
        try {
          result = handler({ binding: request.binding, documentId: request.documentId, scope: request.scope });
        } catch (error) {
          result = Promise.reject(error);
        }
        void Promise.resolve(result).then(
          (value) =>
            events.send(SURFACE_DOCUMENT_READ_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              ...surfacePortReplyPayload(value),
            }),
          (error) =>
            events.send(SURFACE_DOCUMENT_READ_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: surfacePortFailure(error),
            }),
        );
      });
    },
    onDocumentWrite(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_DOCUMENT_WRITE_REQUEST_CHANNEL, (payload) => {
        const request = documentWriteRequest(payload);
        if (!request) return;
        const result = runCancellable(request, (signal) => handler({
            binding: request.binding,
            documentId: request.documentId,
            operation: request.operation,
            content: request.content,
            target: request.target,
            preconditions: request.preconditions,
            signal,
          }));
        void Promise.resolve(result).then(
          (value) =>
            events.send(SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              ...surfacePortReplyPayload(value),
            }),
          (error) =>
            events.send(SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: surfacePortFailure(error),
            }),
        );
      });
    },
    onCanvasWriteCapture(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL, (payload) => {
        const request = canvasWriteCaptureRequest(payload, captureOperations);
        if (!request) return;
        let result: unknown | Promise<unknown>;
        try {
          result = handler({
            binding: request.binding,
            operation: request.operation,
            ...(request.input !== undefined ? { input: request.input } : {}),
            ...(request.nodeId !== undefined ? { nodeId: request.nodeId } : {}),
          });
        } catch (error) {
          result = Promise.reject(error);
        }
        void Promise.resolve(result).then(
          (value) =>
            events.send(SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              ...surfacePortReplyPayload(value),
            }),
          (error) =>
            events.send(SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: surfacePortFailure(error),
            }),
        );
      });
    },
    onCanvasWriteExecute(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_CANVAS_WRITE_EXECUTE_REQUEST_CHANNEL, (payload) => {
        const request = canvasWriteExecuteRequest(payload);
        if (!request) return;
        const result = runCancellable(request, (signal) => handler({
            binding: request.binding,
            input: request.input,
            target: request.target,
            preconditions: request.preconditions,
            receiptProposalId: request.receiptProposalId,
            approvalId: request.approvalId,
            actionHash: request.actionHash,
            signal,
          }));
        void Promise.resolve(result).then(
          (value) =>
            events.send(SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              ...surfacePortReplyPayload(value),
            }),
          (error) =>
            events.send(SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: surfacePortFailure(error),
            }),
        );
      });
    },
    onTimelineRead(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_TIMELINE_READ_REQUEST_CHANNEL, (payload) => {
        const request = timelineReadRequest(payload);
        if (!request) return;
        let result: unknown | Promise<unknown>;
        try {
          result = handler({
            binding: request.binding,
            input: request.input,
            target: request.target,
            preconditions: request.preconditions,
          });
        } catch (error) {
          result = Promise.reject(error);
        }
        void Promise.resolve(result).then(
          (value) => events.send(SURFACE_TIMELINE_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            ...surfacePortReplyPayload(value),
          }),
          (error) => events.send(SURFACE_TIMELINE_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: surfacePortFailure(error),
          }),
        );
      });
    },
    onTimelineWrite(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_TIMELINE_WRITE_REQUEST_CHANNEL, (payload) => {
        const request = timelineWriteRequest(payload);
        if (!request) return;
        const result = runCancellable(request, (signal) => handler({
            binding: request.binding,
            input: request.input,
            target: request.target,
            preconditions: request.preconditions,
            receiptProposalId: request.receiptProposalId,
            approvalId: request.approvalId,
            actionHash: request.actionHash,
            signal,
          }));
        void Promise.resolve(result).then(
          (value) => events.send(SURFACE_TIMELINE_WRITE_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            ...surfacePortReplyPayload(value),
          }),
          (error) => events.send(SURFACE_TIMELINE_WRITE_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: surfacePortFailure(error),
          }),
        );
      });
    },
    onAssetRead(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_ASSET_READ_REQUEST_CHANNEL, (payload) => {
        const request = assetReadRequest(payload);
        if (!request) return;
        let result: unknown | Promise<unknown>;
        try {
          result = handler({
            binding: request.binding,
            input: request.input,
            target: request.target,
            preconditions: request.preconditions,
          });
        } catch (error) {
          result = Promise.reject(error);
        }
        void Promise.resolve(result).then(
          (value) => events.send(SURFACE_ASSET_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            ...surfacePortReplyPayload(value),
          }),
          (error) => events.send(SURFACE_ASSET_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: surfacePortFailure(error),
          }),
        );
      });
    },
    onExportRead(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_EXPORT_READ_REQUEST_CHANNEL, (payload) => {
        const request = exportReadRequest(payload);
        if (!request) return;
        let result: unknown | Promise<unknown>;
        try {
          result = handler({
            binding: request.binding,
            input: request.input,
            target: request.target,
            preconditions: request.preconditions,
          });
        } catch (error) {
          result = Promise.reject(error);
        }
        void Promise.resolve(result).then(
          (value) => events.send(SURFACE_EXPORT_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            ...surfacePortReplyPayload(value),
          }),
          (error) => events.send(SURFACE_EXPORT_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: surfacePortFailure(error),
          }),
        );
      });
    },
    onExportWrite(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_EXPORT_WRITE_REQUEST_CHANNEL, (payload) => {
        const request = exportWriteRequest(payload);
        if (!request) return;
        const result = runCancellable(request, (signal) => handler({
            binding: request.binding,
            input: request.input,
            target: request.target,
            preconditions: request.preconditions,
            receiptProposalId: request.receiptProposalId,
            approvalId: request.approvalId,
            actionHash: request.actionHash,
            signal,
          }));
        void Promise.resolve(result).then(
          (value) => events.send(SURFACE_EXPORT_WRITE_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            ...surfacePortReplyPayload(value),
          }),
          (error) => events.send(SURFACE_EXPORT_WRITE_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: surfacePortFailure(error),
          }),
        );
      });
    },
  });
}
