import type { MediaImportRejection } from "./contracts/mediaImportPolicy";
import type { ProjectBinding } from "./projectBinding";
import type { CanvasWriteOperation } from "./agentCapabilities/canvasWrite";
import type { CanvasDeleteInput } from "./agentCapabilities/canvasDelete";
import type { AssetReadInput } from "./agentCapabilities/assetRead";
import type { ExportReadInput, ExportWriteInput } from "./agentCapabilities/exportCapabilities";
import type { TimelineReadInput } from "./agentCapabilities/timelineRead";
import type { TimelineWriteInput } from "./agentCapabilities/timelineWrite";

export const SURFACE_PORT_BINDING_VERSION = 1 as const;
export const CAPTURED_CANVAS_READ_SNAPSHOT_VERSION = 1 as const;
export const SURFACE_CANVAS_READ_REQUEST_CHANNEL = "nomi:surface:canvasRead:request" as const;
export const SURFACE_CANVAS_READ_REPLY_CHANNEL = "nomi:surface:canvasRead:reply" as const;
export const SURFACE_DOCUMENT_READ_REQUEST_CHANNEL = "nomi:surface:documentRead:request" as const;
export const SURFACE_DOCUMENT_READ_REPLY_CHANNEL = "nomi:surface:documentRead:reply" as const;
export const SURFACE_DOCUMENT_WRITE_REQUEST_CHANNEL = "nomi:surface:documentWrite:request" as const;
export const SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL = "nomi:surface:documentWrite:reply" as const;
export const SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL = "nomi:surface:canvasWrite:capture:request" as const;
export const SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL = "nomi:surface:canvasWrite:capture:reply" as const;
export const SURFACE_CANVAS_WRITE_EXECUTE_REQUEST_CHANNEL = "nomi:surface:canvasWrite:execute:request" as const;
export const SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL = "nomi:surface:canvasWrite:execute:reply" as const;
export const SURFACE_TIMELINE_READ_REQUEST_CHANNEL = "nomi:surface:timelineRead:request" as const;
export const SURFACE_TIMELINE_READ_REPLY_CHANNEL = "nomi:surface:timelineRead:reply" as const;
export const SURFACE_TIMELINE_WRITE_REQUEST_CHANNEL = "nomi:surface:timelineWrite:request" as const;
export const SURFACE_TIMELINE_WRITE_REPLY_CHANNEL = "nomi:surface:timelineWrite:reply" as const;
export const SURFACE_ASSET_READ_REQUEST_CHANNEL = "nomi:surface:assetRead:request" as const;
export const SURFACE_ASSET_READ_REPLY_CHANNEL = "nomi:surface:assetRead:reply" as const;
export const SURFACE_EXPORT_READ_REQUEST_CHANNEL = "nomi:surface:exportRead:request" as const;
export const SURFACE_EXPORT_READ_REPLY_CHANNEL = "nomi:surface:exportRead:reply" as const;
export const SURFACE_EXPORT_WRITE_REQUEST_CHANNEL = "nomi:surface:exportWrite:request" as const;
export const SURFACE_EXPORT_WRITE_REPLY_CHANNEL = "nomi:surface:exportWrite:reply" as const;
export const SURFACE_PORT_CANCEL_REQUEST_CHANNEL = "nomi:surface:request:cancel" as const;

export type ProjectBindingWire = ProjectBinding;

export type SurfaceSuspensionWire = Readonly<{
  version: typeof SURFACE_PORT_BINDING_VERSION;
  suspensionId: string;
  surfaceInstanceId: string;
  portRevision: number;
  nonce: string;
}>;

export type SurfacePortBindingWire = Readonly<{
  version: typeof SURFACE_PORT_BINDING_VERSION;
  bindingId: string;
  binding: ProjectBindingWire;
  webContentsId: number;
  processId: number;
  frameRoutingId: number;
  origin: string;
  surfaceInstanceId: string;
  portRevision: number;
  nonce: string;
}>;

export type CanvasReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
}>;

export type CanvasReadSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type DocumentReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  documentId: string;
  scope: "full" | "selection";
}>;

export type DocumentReadSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type DocumentWriteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  documentId: string;
  operation: "insert" | "replace" | "append";
  content: string;
  target: unknown;
  preconditions: unknown;
}>;

export type DocumentWriteSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type CanvasWriteCaptureSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  operation: CanvasWriteOperation | CanvasDeleteInput["operation"];
  input?: unknown;
  nodeId?: string;
}>;

export type CanvasWriteCaptureSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type CanvasWriteExecuteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: unknown;
  target: unknown;
  preconditions: unknown;
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type CanvasWriteExecuteSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type TimelineReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: TimelineReadInput;
  target: unknown;
  preconditions: unknown;
}>;

export type TimelineReadSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type TimelineWriteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: TimelineWriteInput;
  target: unknown;
  preconditions: unknown;
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type TimelineWriteSurfaceReplyWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  result?: unknown;
  error?: SurfacePortFailure;
}>;

export type AssetReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: AssetReadInput;
  target: unknown;
  preconditions: unknown;
}>;

export type ExportReadSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: ExportReadInput;
  target: unknown;
  preconditions: unknown;
}>;

export type ExportWriteSurfaceRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
  input: ExportWriteInput;
  target: unknown;
  preconditions: unknown;
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type SurfacePortCancelRequestWire = Readonly<{
  requestId: string;
  binding: SurfacePortBindingWire;
}>;

/** Opaque main-issued, owner-bound, one-shot admission for a captured turn. */
export type CapturedCanvasReadSnapshotHandleWire = Readonly<{
  version: typeof CAPTURED_CANVAS_READ_SNAPSHOT_VERSION;
  handleId: string;
  nonce: string;
}>;

export type CanvasReadSurfaceBridge = Readonly<{
  suspend(input: Readonly<{ surfaceInstanceId: string }>): Promise<Readonly<{ suspension: SurfaceSuspensionWire }>>;
  commitCanvasRead(
    input: Readonly<{
      projectId: string;
      suspension: SurfaceSuspensionWire;
    }>,
  ): Promise<Readonly<{ binding: SurfacePortBindingWire }>>;
  captureCanvasReadSnapshot(
    input: Readonly<{
      binding: SurfacePortBindingWire;
      snapshot: unknown;
    }>,
  ): Promise<Readonly<{ handle: CapturedCanvasReadSnapshotHandleWire }>>;
  release(
    input: Readonly<{
      authority: SurfaceSuspensionWire | SurfacePortBindingWire;
    }>,
  ): Promise<Readonly<{ released: true }>>;
  onCanvasRead(
    handler: (request: Readonly<{ binding: SurfacePortBindingWire }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ): () => void;
  onDocumentRead: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        documentId: string;
        scope: "full" | "selection";
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onDocumentWrite: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        documentId: string;
        operation: "insert" | "replace" | "append";
        content: string;
        target: unknown;
        preconditions: unknown;
        signal: AbortSignal;
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onCanvasWriteCapture: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        operation: CanvasWriteOperation | CanvasDeleteInput["operation"];
        input?: unknown;
        nodeId?: string;
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onCanvasWriteExecute: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        input: unknown;
        target: unknown;
        preconditions: unknown;
        receiptProposalId: string;
        approvalId: string;
        actionHash: string;
        signal: AbortSignal;
      }>,
    ) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onTimelineRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: TimelineReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onTimelineWrite: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: TimelineWriteInput;
      target: unknown;
      preconditions: unknown;
      receiptProposalId: string;
      approvalId: string;
      actionHash: string;
      signal: AbortSignal;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onAssetRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: AssetReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onExportRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: ExportReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
  onExportWrite: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: ExportWriteInput;
      target: unknown;
      preconditions: unknown;
      receiptProposalId: string;
      approvalId: string;
      actionHash: string;
      signal: AbortSignal;
    }>) => SurfacePortHandlerResult | Promise<SurfacePortHandlerResult>,
  ) => () => void;
}>;

export type SurfacePortWireErrorCode =
  | "capability_execution_failed"
  | "capability_cancelled"
  | "capability_input_invalid"
  | "capability_receipt_unresolved"
  | "capability_target_stale"
  | "capability_unsupported"
  | "project_identity_unavailable"
  | "project_binding_stale"
  | "surface_port_suspended"
  | "surface_port_unavailable"
  | "surface_port_stale"
  | "surface_owner_mismatch";

export const SURFACE_PORT_WIRE_ERROR_CODES: ReadonlySet<SurfacePortWireErrorCode> = new Set([
  "capability_execution_failed",
  "capability_cancelled",
  "capability_input_invalid",
  "capability_receipt_unresolved",
  "capability_target_stale",
  "capability_unsupported",
  "project_identity_unavailable",
  "project_binding_stale",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
]);

export type SurfacePortFailure = Readonly<{ code: SurfacePortWireErrorCode; reason?: MediaImportRejection["reason"] }>;
export type SurfacePortHandlerResult<T = unknown> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: SurfacePortFailure }>;

/** Error normalization happens in the originating realm, before contextBridge. */
export function surfacePortFailure(error: unknown): SurfacePortFailure {
  const failure = parseSurfacePortFailure(error);
  if (failure) return failure;
  if (error instanceof DOMException && error.name === "AbortError") return { code: "capability_cancelled" };
  return { code: "capability_execution_failed" };
}

/** Invoke immediately: deferring run would capture a different project's store. */
export function settleSurfacePortHandler(
  run: () => unknown | Promise<unknown>,
): SurfacePortHandlerResult | Promise<SurfacePortHandlerResult> {
  try {
    const value = run();
    if (value && typeof (value as PromiseLike<unknown>).then === "function") {
      return Promise.resolve(value).then(
        (resolved) => ({ ok: true as const, value: resolved }),
        (error) => ({ ok: false as const, error: surfacePortFailure(error) }),
      );
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: surfacePortFailure(error) };
  }
}

export function parseSurfacePortFailure(value: unknown): SurfacePortFailure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as { code?: unknown }).code;
  if (typeof code !== "string" || !SURFACE_PORT_WIRE_ERROR_CODES.has(code as SurfacePortWireErrorCode)) return null;
  const reason = (value as { reason?: unknown }).reason;
  return { code: code as SurfacePortWireErrorCode,
    ...(code === "capability_execution_failed" && (reason === "unsupported-kind" || reason === "no-disk-space" || reason === "over-hard-cap")
      ? { reason } : {}),
  };
}

/** Strict callback protocol: arbitrary legacy handler results are not success. */
export function surfacePortReplyPayload(value: unknown): { result: unknown } | { error: SurfacePortFailure } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const envelope = value as Record<string, unknown>;
    if (envelope.ok === true && Object.prototype.hasOwnProperty.call(envelope, "value")) {
      return { result: envelope.value };
    }
    if (envelope.ok === false) {
      const error = parseSurfacePortFailure(envelope.error);
      if (error) return { error };
    }
  }
  return { error: { code: "surface_port_unavailable" } };
}

/** Model-facing recovery advice is derived only from the safe failure contract. */
export function surfacePortFailureAdvice(failure: SurfacePortFailure): { message: string; nextAction: string } {
  switch (failure.reason) {
    case "no-disk-space": return { message: "The artifact could not be saved because the project disk has insufficient free space.",
      nextAction: "Free space on the project disk before trying this action again." };
    case "unsupported-kind": return { message: "The artifact format is not accepted by this destination.",
      nextAction: "Choose a format supported by the destination before trying again." };
    case "over-hard-cap": return { message: "The artifact exceeds the destination's supported size limit.",
      nextAction: "Reduce the artifact size to the destination's limit before trying again." };
  }
  if (failure.code === "capability_receipt_unresolved") return {
    message: "The action's durable receipt could not be confirmed (capability_receipt_unresolved).",
    nextAction: "Check the action receipt and existing result before attempting another write.",
  };
  if (failure.code === "capability_cancelled") return {
    message: "The action was cancelled.", nextAction: "Wait for a new user instruction before starting another action.",
  };
  // 「这个面现在做不了这件事」和「目标过期」是两句不同的建议：前者重读多少次都不会变。
  if (failure.code === "capability_unsupported") return {
    message: "The current surface cannot do that scope or position right now (capability_unsupported).",
    nextAction: "Use what this surface supports: for the document, read the full text, or write with append/replace on the whole document instead of a selection or cursor position.",
  };
  if (failure.code === "capability_execution_failed") return {
    message: "The action could not be completed.", nextAction: "Review the failure and the current result before deciding whether to retry.",
  };
  return { message: `The current target could not accept this action (${failure.code}).`,
    nextAction: "Read the current surface again and use its current identifiers and revision before retrying." };
}

export class SurfacePortWireError extends Error {
  constructor(readonly code: SurfacePortWireErrorCode, readonly reason?: SurfacePortFailure["reason"]) {
    super(code);
    this.name = "SurfacePortWireError";
  }
}

export function unwrapSurfacePortIpcResponse<T>(response: unknown): T {
  const reply = surfacePortReplyPayload(response);
  if ("error" in reply) throw new SurfacePortWireError(reply.error.code, reply.error.reason);
  return reply.result as T;
}
