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
  type SurfaceSuspensionWire,
  type TimelineReadSurfaceRequestWire,
  type TimelineWriteSurfaceRequestWire,
  unwrapSurfacePortIpcResponse,
} from "./shared/surfacePortBinding";
import { assetReadSemanticInputSchema } from "./shared/agentCapabilities/assetRead";
import { exportReadSemanticInputSchema, exportWriteSemanticInputSchema } from "./shared/agentCapabilities/exportCapabilities";
import { timelineReadSemanticInputSchema } from "./shared/agentCapabilities/timelineRead";
import { timelineWriteSemanticInputSchema } from "./shared/agentCapabilities/timelineWrite";

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

function canvasWriteCaptureRequest(value: unknown): CanvasWriteCaptureSurfaceRequestWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !request.requestId.trim()) return null;
  if (!request.binding || typeof request.binding !== "object" || Array.isArray(request.binding)) return null;
  if (
    request.operation !== "set_node_prompt" &&
    request.operation !== "create_canvas_nodes" &&
    request.operation !== "connect_canvas_edges" &&
    request.operation !== "tidy_canvas" &&
    request.operation !== "propose_storyboard_plan" &&
    request.operation !== "patch_shots" &&
    request.operation !== "arrange_storyboard_to_timeline" &&
    request.operation !== "create_staging_reference" &&
    request.operation !== "create_camera_move" &&
    request.operation !== "delete_canvas_nodes"
  )
    return null;
  if (request.operation === "set_node_prompt" && (typeof request.nodeId !== "string" || !request.nodeId.trim()))
    return null;
  if (request.operation !== "set_node_prompt" && !Object.prototype.hasOwnProperty.call(request, "input")) return null;
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

function sameSurfaceAuthority(left: SurfacePortBindingWire, right: SurfacePortBindingWire): boolean {
  const leftProject = left?.binding
  const rightProject = right?.binding
  return Boolean(leftProject && rightProject)
    && left.bindingId === right.bindingId
    && left.nonce === right.nonce
    && left.surfaceInstanceId === right.surfaceInstanceId
    && left.portRevision === right.portRevision
    && leftProject.projectId === rightProject.projectId
    && leftProject.immutableProjectUuid === rightProject.immutableProjectUuid
    && leftProject.projectGeneration === rightProject.projectGeneration;
}

export function createCanvasReadSurfacePreloadBridge(
  invoke: Invoke,
  events?: SurfaceReadEvents,
): CanvasReadSurfaceBridge {
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
              result: value,
            }),
          (error) =>
            events.send(SURFACE_CANVAS_READ_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: {
                code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable",
              },
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
              result: value,
            }),
          (error) =>
            events.send(SURFACE_DOCUMENT_READ_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: {
                code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable",
              },
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
              result: value,
            }),
          (error) =>
            events.send(SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: {
                code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable",
              },
            }),
        );
      });
    },
    onCanvasWriteCapture(handler) {
      if (!events) throw new SurfacePortWireError("surface_port_unavailable");
      return events.subscribe(SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL, (payload) => {
        const request = canvasWriteCaptureRequest(payload);
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
              result: value,
            }),
          (error) =>
            events.send(SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: { code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable" },
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
              result: value,
            }),
          (error) =>
            events.send(SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL, {
              requestId: request.requestId,
              binding: request.binding,
              error: { code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable" },
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
            result: value,
          }),
          (error) => events.send(SURFACE_TIMELINE_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: { code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable" },
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
            result: value,
          }),
          (error) => events.send(SURFACE_TIMELINE_WRITE_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: { code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable" },
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
            result: value,
          }),
          (error) => events.send(SURFACE_ASSET_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: { code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable" },
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
            result: value,
          }),
          (error) => events.send(SURFACE_EXPORT_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: { code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable" },
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
            result: value,
          }),
          (error) => events.send(SURFACE_EXPORT_WRITE_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: { code: error instanceof SurfacePortWireError ? error.code : "surface_port_unavailable" },
          }),
        );
      });
    },
  });
}
