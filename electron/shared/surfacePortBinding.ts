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
  error?: Readonly<{ code: SurfacePortWireErrorCode }>;
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
  error?: Readonly<{ code: SurfacePortWireErrorCode }>;
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
  error?: Readonly<{ code: SurfacePortWireErrorCode }>;
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
  error?: Readonly<{ code: SurfacePortWireErrorCode }>;
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
  error?: Readonly<{ code: SurfacePortWireErrorCode }>;
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
  error?: Readonly<{ code: SurfacePortWireErrorCode }>;
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
  error?: Readonly<{ code: SurfacePortWireErrorCode }>;
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
    handler: (request: Readonly<{ binding: SurfacePortBindingWire }>) => unknown | Promise<unknown>,
  ): () => void;
  onDocumentRead: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        documentId: string;
        scope: "full" | "selection";
      }>,
    ) => unknown | Promise<unknown>,
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
    ) => unknown | Promise<unknown>,
  ) => () => void;
  onCanvasWriteCapture: (
    handler: (
      request: Readonly<{
        binding: SurfacePortBindingWire;
        operation: CanvasWriteOperation | CanvasDeleteInput["operation"];
        input?: unknown;
        nodeId?: string;
      }>,
    ) => unknown | Promise<unknown>,
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
    ) => unknown | Promise<unknown>,
  ) => () => void;
  onTimelineRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: TimelineReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => unknown | Promise<unknown>,
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
    }>) => unknown | Promise<unknown>,
  ) => () => void;
  onAssetRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: AssetReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => unknown | Promise<unknown>,
  ) => () => void;
  onExportRead: (
    handler: (request: Readonly<{
      binding: SurfacePortBindingWire;
      input: ExportReadInput;
      target: unknown;
      preconditions: unknown;
    }>) => unknown | Promise<unknown>,
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
    }>) => unknown | Promise<unknown>,
  ) => () => void;
}>;

export type SurfacePortWireErrorCode =
  | "capability_cancelled"
  | "capability_input_invalid"
  | "capability_receipt_unresolved"
  | "capability_target_stale"
  | "project_identity_unavailable"
  | "project_binding_stale"
  | "surface_port_suspended"
  | "surface_port_unavailable"
  | "surface_port_stale"
  | "surface_owner_mismatch";

const SURFACE_PORT_WIRE_ERROR_CODES = new Set<SurfacePortWireErrorCode>([
  "capability_cancelled",
  "capability_input_invalid",
  "capability_receipt_unresolved",
  "capability_target_stale",
  "project_identity_unavailable",
  "project_binding_stale",
  "surface_port_suspended",
  "surface_port_unavailable",
  "surface_port_stale",
  "surface_owner_mismatch",
]);

export class SurfacePortWireError extends Error {
  constructor(readonly code: SurfacePortWireErrorCode) {
    super(code);
    this.name = "SurfacePortWireError";
  }
}

export function unwrapSurfacePortIpcResponse<T>(response: unknown): T {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new SurfacePortWireError("surface_port_unavailable");
  }
  const envelope = response as Record<string, unknown>;
  if (envelope.ok === true && Object.prototype.hasOwnProperty.call(envelope, "value")) {
    return envelope.value as T;
  }
  if (envelope.ok === false && envelope.error && typeof envelope.error === "object") {
    const code = (envelope.error as Record<string, unknown>).code;
    if (typeof code === "string" && SURFACE_PORT_WIRE_ERROR_CODES.has(code as SurfacePortWireErrorCode)) {
      throw new SurfacePortWireError(code as SurfacePortWireErrorCode);
    }
  }
  throw new SurfacePortWireError("surface_port_unavailable");
}
