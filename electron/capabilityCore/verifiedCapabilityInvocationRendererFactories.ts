import {
  ASSET_READ_CAPABILITY,
  assetReadSemanticInputSchema,
  type AssetReadInput,
} from "../shared/agentCapabilities/assetRead";
import {
  CANVAS_DELETE_CAPABILITY,
  canvasDeleteSemanticInputSchema,
  type CanvasDeleteInput,
} from "../shared/agentCapabilities/canvasDelete";
import { buildCanvasDeleteAdmission } from "../shared/agentCapabilities/canvasDeleteEvidence";
import {
  CANVAS_WRITE_CAPABILITY,
  canvasWriteSemanticInputSchema,
  type CanvasWriteInput,
} from "../shared/agentCapabilities/canvasWrite";
import { buildCanvasWriteAdmissionForOperation } from "../shared/agentCapabilities/canvasWriteEvidence";
import {
  DOCUMENT_READ_CAPABILITY,
  documentReadSemanticInputSchema,
  type DocumentReadInput,
} from "../shared/agentCapabilities/documentRead";
import {
  DOCUMENT_WRITE_CAPABILITY,
  documentWriteSemanticInputSchema,
  type DocumentWriteInput,
} from "../shared/agentCapabilities/documentWrite";
import {
  EXPORT_READ_CAPABILITY,
  EXPORT_WRITE_CAPABILITY,
  exportReadSemanticInputSchema,
  exportWriteSemanticInputSchema,
  type ExportReadInput,
  type ExportWriteInput,
} from "../shared/agentCapabilities/exportCapabilities";
import {
  TIMELINE_READ_CAPABILITY,
  timelineReadSemanticInputSchema,
  type TimelineReadInput,
} from "../shared/agentCapabilities/timelineRead";
import {
  TIMELINE_WRITE_CAPABILITY,
  timelineWriteSemanticInputSchema,
  type TimelineWriteInput,
} from "../shared/agentCapabilities/timelineWrite";
import type { DocumentAnchorRef, PreconditionSet, TargetRef } from "../shared/capabilityTargeting";
import {
  assertCanvasReadSurfaceRegistry,
  type CanvasReadSurfaceRegistry,
  type CapturedCanvasReadPort,
  type SurfacePortBinding,
} from "./canvasReadSurfaceRegistry";
import {
  assertCapturedCanvasReadSnapshotRegistry,
  type CapturedCanvasReadSnapshotPort,
  type CapturedCanvasReadSnapshotRegistry,
  type CapturedCanvasReadSnapshotDispatch,
} from "./canvasReadCapturedSnapshotRegistry";
import {
  ASSET_READ_INVOCATION_POLICY_REVISION,
  CANVAS_DELETE_INVOCATION_POLICY_REVISION,
  CANVAS_READ_INVOCATION_POLICY_REVISION,
  CANVAS_WRITE_INVOCATION_POLICY_REVISION,
  DOCUMENT_WRITE_INVOCATION_POLICY_REVISION,
  EXPORT_READ_INVOCATION_POLICY_REVISION,
  EXPORT_WRITE_INVOCATION_POLICY_REVISION,
  TIMELINE_READ_INVOCATION_POLICY_REVISION,
  TIMELINE_WRITE_INVOCATION_POLICY_REVISION,
  CapabilityInvocationError,
  EMPTY_PRECONDITIONS,
  deepFreeze,
  mintCapabilityInvocation,
  mintCanvasReadInvocation,
  nonEmptyString,
  parseCanonicalInput,
  type CapturedRendererAuthorityEvidence,
  type McpCanvasReadInvocation,
  type RendererAuthorityEvidence,
  type VerifiedCaller,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocationRuntime";

function rendererEvidence(
  binding: SurfacePortBinding,
  caller: Extract<VerifiedCaller, { kind: "embedded-agent" }>,
): RendererAuthorityEvidence {
  return Object.freeze({
    binding: binding.binding,
    caller,
    authorityRef: `surface-port-v1:${nonEmptyString(binding.bindingId)}`,
    bindingId: nonEmptyString(binding.bindingId),
    portRevision: binding.portRevision,
    surfaceInstanceId: nonEmptyString(binding.surfaceInstanceId),
  });
}

export type RendererCanvasReadVerifiedInvocationFactory = Readonly<{
  mint(input: Readonly<{ toolCallId: string; input: unknown }>): Promise<McpCanvasReadInvocation>;
}>;

export function createRendererCanvasReadVerifiedInvocationFactory(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    capturedPort: CapturedCanvasReadPort;
    requestId: string;
  }>,
): RendererCanvasReadVerifiedInvocationFactory {
  try {
    assertCanvasReadSurfaceRegistry(input.registry);
    input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  } catch {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  const requestId = nonEmptyString(input.requestId);
  const registry = input.registry;
  const capturedPort = input.capturedPort;

  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      const semanticInput = parseCanonicalInput(semanticValue);
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = registry.resolveCapturedCanvasReadPort(capturedPort);
        const binding = await registry.assertCanvasReadPortReply(capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCanvasReadInvocation({
        semanticInput,
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({ kind: "surface", capturedPort }),
      });
    },
  });
}

function capturedRendererEvidence(
  dispatch: CapturedCanvasReadSnapshotDispatch,
  caller: Extract<VerifiedCaller, { kind: "embedded-agent" }>,
): CapturedRendererAuthorityEvidence {
  return Object.freeze({
    binding: dispatch.binding.binding,
    caller,
    authorityRef: nonEmptyString(dispatch.authorityRef),
    canonicalRootDigest: nonEmptyString(dispatch.canonicalRootDigest),
    snapshotHash: nonEmptyString(dispatch.snapshotHash),
  });
}

export type CapturedRendererCanvasReadVerifiedInvocationFactory = Readonly<{
  mint(input: Readonly<{ toolCallId: string; input: unknown }>): Promise<McpCanvasReadInvocation>;
}>;

/** Main-only factory over a consumed one-shot production snapshot port. */
export function createCapturedRendererCanvasReadVerifiedInvocationFactory(
  input: Readonly<{
    registry: CapturedCanvasReadSnapshotRegistry;
    capturedPort: CapturedCanvasReadSnapshotPort;
    requestId: string;
  }>,
): CapturedRendererCanvasReadVerifiedInvocationFactory {
  try {
    assertCapturedCanvasReadSnapshotRegistry(input.registry);
    input.registry.resolve(input.capturedPort);
  } catch {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  const requestId = nonEmptyString(input.requestId);
  const registry = input.registry;
  const capturedPort = input.capturedPort;

  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      const semanticInput = parseCanonicalInput(semanticValue);
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<CapturedRendererAuthorityEvidence> =>
        capturedRendererEvidence(registry.resolve(capturedPort), caller);
      const evidence = await verify();
      return mintCanvasReadInvocation({
        semanticInput,
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({ kind: "captured-snapshot", capturedPort }),
      });
    },
  });
}


export type RendererDocumentReadVerifiedInvocationFactory = Readonly<{
  mint(
    input: Readonly<{ toolCallId: string; documentId: string; input: unknown }>,
  ): Promise<VerifiedCapabilityInvocation<DocumentReadInput, Readonly<{ kind: "document"; documentId: string }>>>;
}>;

/** Main-issued document read invocation over the same captured renderer owner as canvas.read. */
export function createRendererDocumentReadVerifiedInvocationFactory(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    capturedPort: CapturedCanvasReadPort;
    requestId: string;
  }>,
): RendererDocumentReadVerifiedInvocationFactory {
  try {
    assertCanvasReadSurfaceRegistry(input.registry);
    input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  } catch {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  const requestId = nonEmptyString(input.requestId);
  const registry = input.registry;
  const capturedPort = input.capturedPort;
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, documentId: documentIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      const documentId = nonEmptyString(documentIdValue);
      const semanticInput = documentReadSemanticInputSchema.parse(semanticValue);
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = registry.resolveCapturedCanvasReadPort(capturedPort);
        const binding = await registry.assertCanvasReadPortReply(capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: DOCUMENT_READ_CAPABILITY,
        policyRevision: CANVAS_READ_INVOCATION_POLICY_REVISION,
        semanticInput,
        evidence,
        revalidate: verify,
        target: Object.freeze({ kind: "document" as const, documentId }),
        executionTarget: Object.freeze({ kind: "document-surface" as const, capturedPort, documentId }),
      });
    },
  });
}

/** Main-only document.read mint boundary; document identity is captured in the target. */

export type RendererDocumentWriteVerifiedInvocationFactory = Readonly<{
  mint(
    input: Readonly<{
      toolCallId: string;
      documentId: string;
      anchor: DocumentAnchorRef;
      preconditions: PreconditionSet;
      input: unknown;
    }>,
  ): Promise<
    VerifiedCapabilityInvocation<
      DocumentWriteInput,
      Readonly<{ kind: "document"; documentId: string; anchor: DocumentAnchorRef }>
    >
  >;
}>;

/** Main-issued reversible document write invocation over one captured Surface owner. */
export function createRendererDocumentWriteVerifiedInvocationFactory(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    capturedPort: CapturedCanvasReadPort;
    requestId: string;
  }>,
): RendererDocumentWriteVerifiedInvocationFactory {
  try {
    assertCanvasReadSurfaceRegistry(input.registry);
    input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  } catch {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  const requestId = nonEmptyString(input.requestId);
  const registry = input.registry;
  const capturedPort = input.capturedPort;
  return Object.freeze({
    async mint({
      toolCallId: toolCallIdValue,
      documentId: documentIdValue,
      anchor,
      preconditions,
      input: semanticValue,
    }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      const documentId = nonEmptyString(documentIdValue);
      const semanticInput = documentWriteSemanticInputSchema.parse(semanticValue);
      if (!anchor || typeof anchor !== "object" || typeof (anchor as { kind?: unknown }).kind !== "string") {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = registry.resolveCapturedCanvasReadPort(capturedPort);
        const binding = await registry.assertCanvasReadPortReply(capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: DOCUMENT_WRITE_CAPABILITY,
        policyRevision: DOCUMENT_WRITE_INVOCATION_POLICY_REVISION,
        semanticInput,
        evidence,
        revalidate: verify,
        preconditions,
        target: Object.freeze({ kind: "document" as const, documentId, anchor: deepFreeze(structuredClone(anchor)) }),
        executionTarget: Object.freeze({ kind: "document-write-surface" as const, capturedPort, documentId }),
      });
    },
  });
}

export type RendererCanvasWriteVerifiedInvocationFactory = Readonly<{
  mint(
    input: Readonly<{
      toolCallId: string;
      input: unknown;
      rawEvidence: unknown;
    }>,
  ): Promise<VerifiedCapabilityInvocation<CanvasWriteInput, Extract<TargetRef, { kind: "canvas" }>>>;
}>;

/** Main-only mint boundary: the Surface supplies raw evidence, while main derives every authority field. */
export function createRendererCanvasWriteVerifiedInvocationFactory(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    capturedPort: CapturedCanvasReadPort;
    requestId: string;
  }>,
): RendererCanvasWriteVerifiedInvocationFactory {
  try {
    assertCanvasReadSurfaceRegistry(input.registry);
    input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  } catch {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  const requestId = nonEmptyString(input.requestId);
  const registry = input.registry;
  const capturedPort = input.capturedPort;
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue, rawEvidence }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      let semanticInput: CanvasWriteInput;
      try {
        semanticInput = deepFreeze(canvasWriteSemanticInputSchema.parse(semanticValue));
      } catch {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const admission = buildCanvasWriteAdmissionForOperation(rawEvidence, semanticInput);
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = registry.resolveCapturedCanvasReadPort(capturedPort);
        const binding = await registry.assertCanvasReadPortReply(capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: CANVAS_WRITE_CAPABILITY,
        policyRevision: CANVAS_WRITE_INVOCATION_POLICY_REVISION,
        semanticInput,
        evidence,
        revalidate: verify,
        target: admission.target,
        preconditions: admission.preconditions,
        executionTarget: Object.freeze({ kind: "canvas-write-surface" as const, capturedPort }),
      });
    },
  });
}

export type RendererCanvasDeleteVerifiedInvocationFactory = Readonly<{
  mint(
    input: Readonly<{ toolCallId: string; input: unknown; rawEvidence: unknown }>,
  ): Promise<VerifiedCapabilityInvocation<CanvasDeleteInput, Extract<TargetRef, { kind: "canvas" }>>>;
}>;

export function createRendererCanvasDeleteVerifiedInvocationFactory(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    capturedPort: CapturedCanvasReadPort;
    requestId: string;
  }>,
): RendererCanvasDeleteVerifiedInvocationFactory {
  assertCanvasReadSurfaceRegistry(input.registry);
  input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  const requestId = nonEmptyString(input.requestId);
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue, rawEvidence }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      let semanticInput: CanvasDeleteInput;
      try {
        semanticInput = deepFreeze(canvasDeleteSemanticInputSchema.parse(semanticValue));
      } catch {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const admission = buildCanvasDeleteAdmission(rawEvidence, semanticInput);
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
        const binding = await input.registry.assertCanvasReadPortReply(input.capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: CANVAS_DELETE_CAPABILITY,
        policyRevision: CANVAS_DELETE_INVOCATION_POLICY_REVISION,
        semanticInput,
        evidence,
        revalidate: verify,
        target: admission.target,
        preconditions: admission.preconditions,
        executionTarget: Object.freeze({ kind: "canvas-write-surface" as const, capturedPort: input.capturedPort }),
      });
    },
  });
}

type TimelineTarget = Extract<TargetRef, { kind: "timeline" }>;

function timelineClipIds(input: TimelineReadInput | TimelineWriteInput): readonly string[] {
  if (input.operation !== "propose_edit_plan" && input.operation !== "apply_edit_plan") return Object.freeze([]);
  const ids = new Set<string>();
  for (const operation of input.operations) {
    if ("clipId" in operation && operation.clipId) ids.add(operation.clipId);
    if ("clipIds" in operation) operation.clipIds?.forEach((clipId) => ids.add(clipId));
  }
  return Object.freeze([...ids]);
}

function timelinePreconditions(input: TimelineReadInput | TimelineWriteInput): PreconditionSet {
  if (input.operation === "propose_edit_plan" || input.operation === "apply_edit_plan") {
    return Object.freeze({ timeline: Object.freeze({ revision: input.baseRevision }) });
  }
  if (input.operation === "undo_timeline_edit") {
    return Object.freeze({ timeline: Object.freeze({ revision: input.expectedRevision }) });
  }
  return EMPTY_PRECONDITIONS;
}

function timelineTarget(input: TimelineReadInput | TimelineWriteInput): TimelineTarget {
  return Object.freeze({ kind: "timeline", clipIds: timelineClipIds(input) });
}

export type RendererTimelineReadVerifiedInvocationFactory = Readonly<{
  mint(input: Readonly<{ toolCallId: string; input: unknown }>): Promise<VerifiedCapabilityInvocation<TimelineReadInput, TimelineTarget>>;
}>;

export function createRendererTimelineReadVerifiedInvocationFactory(
  input: Readonly<{ registry: CanvasReadSurfaceRegistry; capturedPort: CapturedCanvasReadPort; requestId: string }>,
): RendererTimelineReadVerifiedInvocationFactory {
  assertCanvasReadSurfaceRegistry(input.registry);
  input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  const requestId = nonEmptyString(input.requestId);
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      let semanticInput: TimelineReadInput;
      try {
        semanticInput = deepFreeze(timelineReadSemanticInputSchema.parse(semanticValue));
      } catch {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
        const binding = await input.registry.assertCanvasReadPortReply(input.capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: TIMELINE_READ_CAPABILITY,
        policyRevision: TIMELINE_READ_INVOCATION_POLICY_REVISION,
        semanticInput,
        target: timelineTarget(semanticInput),
        preconditions: timelinePreconditions(semanticInput),
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({ kind: "timeline-read-surface" as const, capturedPort: input.capturedPort }),
      });
    },
  });
}

export type RendererTimelineWriteVerifiedInvocationFactory = Readonly<{
  mint(input: Readonly<{ toolCallId: string; input: unknown }>): Promise<VerifiedCapabilityInvocation<TimelineWriteInput, TimelineTarget>>;
}>;

export function createRendererTimelineWriteVerifiedInvocationFactory(
  input: Readonly<{ registry: CanvasReadSurfaceRegistry; capturedPort: CapturedCanvasReadPort; requestId: string }>,
): RendererTimelineWriteVerifiedInvocationFactory {
  assertCanvasReadSurfaceRegistry(input.registry);
  input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  const requestId = nonEmptyString(input.requestId);
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      let semanticInput: TimelineWriteInput;
      try {
        semanticInput = deepFreeze(timelineWriteSemanticInputSchema.parse(semanticValue));
      } catch {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
        const binding = await input.registry.assertCanvasReadPortReply(input.capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: TIMELINE_WRITE_CAPABILITY,
        policyRevision: TIMELINE_WRITE_INVOCATION_POLICY_REVISION,
        semanticInput,
        target: timelineTarget(semanticInput),
        preconditions: timelinePreconditions(semanticInput),
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({ kind: "timeline-write-surface" as const, capturedPort: input.capturedPort }),
      });
    },
  });
}

type AssetTarget = Extract<TargetRef, { kind: "asset" }>;
type ExportTarget = Extract<TargetRef, { kind: "export" }>;

function assetTarget(input: AssetReadInput): AssetTarget {
  return Object.freeze({
    kind: "asset" as const,
    assetIds: Object.freeze("assetId" in input ? [input.assetId] : []),
  });
}

function exportTarget(input: ExportReadInput | ExportWriteInput): ExportTarget {
  return input.operation === "export_timeline"
    ? Object.freeze({ kind: "export" as const, timelineRevision: input.expectedRevision })
    : Object.freeze({ kind: "export" as const, jobId: input.jobId });
}

function exportPreconditions(input: ExportReadInput | ExportWriteInput): PreconditionSet {
  return input.operation === "export_timeline"
    ? Object.freeze({ timeline: Object.freeze({ revision: input.expectedRevision }) })
    : EMPTY_PRECONDITIONS;
}

export function createRendererAssetReadVerifiedInvocationFactory(
  input: Readonly<{ registry: CanvasReadSurfaceRegistry; capturedPort: CapturedCanvasReadPort; requestId: string }>,
): Readonly<{
  mint(value: Readonly<{ toolCallId: string; input: unknown }>): Promise<VerifiedCapabilityInvocation<AssetReadInput, AssetTarget>>;
}> {
  assertCanvasReadSurfaceRegistry(input.registry);
  input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  const requestId = nonEmptyString(input.requestId);
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      let semanticInput: AssetReadInput;
      try {
        semanticInput = deepFreeze(assetReadSemanticInputSchema.parse(semanticValue));
      } catch {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
        const binding = await input.registry.assertCanvasReadPortReply(input.capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: ASSET_READ_CAPABILITY,
        policyRevision: ASSET_READ_INVOCATION_POLICY_REVISION,
        semanticInput,
        target: assetTarget(semanticInput),
        preconditions: EMPTY_PRECONDITIONS,
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({ kind: "asset-read-surface" as const, capturedPort: input.capturedPort }),
      });
    },
  });
}

export function createRendererExportReadVerifiedInvocationFactory(
  input: Readonly<{ registry: CanvasReadSurfaceRegistry; capturedPort: CapturedCanvasReadPort; requestId: string }>,
): Readonly<{
  mint(value: Readonly<{ toolCallId: string; input: unknown }>): Promise<VerifiedCapabilityInvocation<ExportReadInput, ExportTarget>>;
}> {
  assertCanvasReadSurfaceRegistry(input.registry);
  input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  const requestId = nonEmptyString(input.requestId);
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      let semanticInput: ExportReadInput;
      try {
        semanticInput = deepFreeze(exportReadSemanticInputSchema.parse(semanticValue));
      } catch {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
        const binding = await input.registry.assertCanvasReadPortReply(input.capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: EXPORT_READ_CAPABILITY,
        policyRevision: EXPORT_READ_INVOCATION_POLICY_REVISION,
        semanticInput,
        target: exportTarget(semanticInput),
        preconditions: EMPTY_PRECONDITIONS,
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({ kind: "export-read-surface" as const, capturedPort: input.capturedPort }),
      });
    },
  });
}

export function createRendererExportWriteVerifiedInvocationFactory(
  input: Readonly<{ registry: CanvasReadSurfaceRegistry; capturedPort: CapturedCanvasReadPort; requestId: string }>,
): Readonly<{
  mint(value: Readonly<{ toolCallId: string; input: unknown }>): Promise<VerifiedCapabilityInvocation<ExportWriteInput, ExportTarget>>;
}> {
  assertCanvasReadSurfaceRegistry(input.registry);
  input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
  const requestId = nonEmptyString(input.requestId);
  return Object.freeze({
    async mint({ toolCallId: toolCallIdValue, input: semanticValue }) {
      const toolCallId = nonEmptyString(toolCallIdValue);
      let semanticInput: ExportWriteInput;
      try {
        semanticInput = deepFreeze(exportWriteSemanticInputSchema.parse(semanticValue));
      } catch {
        throw new CapabilityInvocationError("capability_input_invalid");
      }
      const caller = Object.freeze({ kind: "embedded-agent" as const, requestId, toolCallId });
      const verify = async (): Promise<RendererAuthorityEvidence> => {
        const dispatch = input.registry.resolveCapturedCanvasReadPort(input.capturedPort);
        const binding = await input.registry.assertCanvasReadPortReply(input.capturedPort, dispatch.binding);
        return rendererEvidence(binding, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: EXPORT_WRITE_CAPABILITY,
        policyRevision: EXPORT_WRITE_INVOCATION_POLICY_REVISION,
        semanticInput,
        target: exportTarget(semanticInput),
        preconditions: exportPreconditions(semanticInput),
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({ kind: "export-write-surface" as const, capturedPort: input.capturedPort }),
      });
    },
  });
}
