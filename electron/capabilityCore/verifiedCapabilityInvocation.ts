import crypto from "node:crypto";

import {
  ASSET_READ_CAPABILITY,
  assetReadSemanticInputSchema,
  type AssetReadInput,
} from "../shared/agentCapabilities/assetRead";
import { CANVAS_READ_CAPABILITY, type CanvasReadInput } from "../shared/agentCapabilities/canvasRead";
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
import type { ProjectBinding } from "../shared/projectBinding";
import {
  WorkspaceProjectIdentityUnavailableError,
  type WorkspaceProjectIdentity,
} from "../workspace/workspaceProjectIdentity";
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
import { CANVAS_READ_MCP_ADAPTER } from "./mcpCapabilityProjection";
import { ProjectBindingStaleError, type ProjectLeaseV2 } from "./projectLease";
import { ProjectSessionRequestError } from "./projectSessionAuthority";
import { resolveProjectSessionLeaseVerification, type VerifiedProjectSessionBinding } from "./projectSessionRuntime";

export const CANVAS_READ_INVOCATION_POLICY_REVISION = 1 as const;
export const DOCUMENT_WRITE_INVOCATION_POLICY_REVISION = 1 as const;
export const CANVAS_DELETE_INVOCATION_POLICY_REVISION = 1 as const;
export const CANVAS_WRITE_INVOCATION_POLICY_REVISION = 1 as const;
export const TIMELINE_READ_INVOCATION_POLICY_REVISION = 1 as const;
export const TIMELINE_WRITE_INVOCATION_POLICY_REVISION = 1 as const;
export const ASSET_READ_INVOCATION_POLICY_REVISION = 1 as const;
export const EXPORT_READ_INVOCATION_POLICY_REVISION = 1 as const;
export const EXPORT_WRITE_INVOCATION_POLICY_REVISION = 1 as const;

export type { PreconditionSet } from "../shared/capabilityTargeting";
export type { ProjectBinding } from "../shared/projectBinding";

export type VerifiedCaller =
  | Readonly<{ kind: "embedded-agent"; requestId: string; toolCallId: string }>
  | Readonly<{
      kind: "mcp";
      principal: string;
      sessionId: string;
      connectionNonce: string;
      leaseId: string;
    }>
  | Readonly<{ kind: "internal"; principal: string; operationId?: string }>;

export type ProjectCapabilityTarget = Readonly<{ kind: "project" }>;

declare const verifiedCapabilityInvocationBrand: unique symbol;

export type VerifiedCapabilityInvocation<Input, Target> = Readonly<{
  invocationId: string;
  capability: Readonly<{ id: string; version: number }>;
  binding: ProjectBinding;
  target: Target;
  preconditions: PreconditionSet;
  input: Input;
  caller: VerifiedCaller;
  authorityRef: string;
  policyRevision: number;
  inputHash: string;
  actionHash: string;
  readonly [verifiedCapabilityInvocationBrand]: never;
}>;

export type CapabilityInvocationErrorCode =
  | "capability_invocation_unverified"
  | "capability_authority_invalid"
  | "capability_input_invalid"
  | "capability_policy_stale";

export class CapabilityInvocationError extends Error {
  constructor(readonly code: CapabilityInvocationErrorCode) {
    super(code);
    this.name = "CapabilityInvocationError";
  }
}

type McpCanvasReadInvocation = VerifiedCapabilityInvocation<CanvasReadInput, ProjectCapabilityTarget>;

type McpAuthorityEvidence = Readonly<{
  binding: ProjectBinding;
  caller: Extract<VerifiedCaller, { kind: "mcp" }>;
  authorityRef: string;
  canonicalRootDigest: string;
  scopeHash: string;
}>;

type RendererAuthorityEvidence = Readonly<{
  binding: ProjectBinding;
  caller: Extract<VerifiedCaller, { kind: "embedded-agent" }>;
  authorityRef: string;
  bindingId: string;
  portRevision: number;
  surfaceInstanceId: string;
}>;

type CapturedRendererAuthorityEvidence = Readonly<{
  binding: ProjectBinding;
  caller: Extract<VerifiedCaller, { kind: "embedded-agent" }>;
  authorityRef: string;
  canonicalRootDigest: string;
  snapshotHash: string;
}>;

type InternalAuthorityEvidence = Readonly<{
  binding: ProjectBinding;
  caller: Extract<VerifiedCaller, { kind: "internal" }>;
  authorityRef: string;
  canonicalRootDigest: string;
}>;

type CapabilityAuthorityEvidence =
  | McpAuthorityEvidence
  | RendererAuthorityEvidence
  | CapturedRendererAuthorityEvidence
  | InternalAuthorityEvidence;

export type VerifiedCanvasReadExecutionTarget =
  | Readonly<{ kind: "surface"; capturedPort: CapturedCanvasReadPort }>
  | Readonly<{ kind: "captured-snapshot"; capturedPort: CapturedCanvasReadSnapshotPort }>
  | Readonly<{ kind: "project"; binding: ProjectBinding; canonicalRootDigest: string }>;

export type VerifiedCapabilityExecutionTarget =
  | VerifiedCanvasReadExecutionTarget
  | Readonly<{ kind: "document-surface"; capturedPort: CapturedCanvasReadPort; documentId: string }>
  | Readonly<{ kind: "document-write-surface"; capturedPort: CapturedCanvasReadPort; documentId: string }>
  | Readonly<{ kind: "canvas-write-surface"; capturedPort: CapturedCanvasReadPort }>
  | Readonly<{ kind: "timeline-read-surface"; capturedPort: CapturedCanvasReadPort }>
  | Readonly<{ kind: "timeline-write-surface"; capturedPort: CapturedCanvasReadPort }>
  | Readonly<{ kind: "asset-read-surface"; capturedPort: CapturedCanvasReadPort }>
  | Readonly<{ kind: "export-read-surface"; capturedPort: CapturedCanvasReadPort }>
  | Readonly<{ kind: "export-write-surface"; capturedPort: CapturedCanvasReadPort }>;

type InvocationState = Readonly<{
  evidence: CapabilityAuthorityEvidence;
  revalidate: () => Promise<CapabilityAuthorityEvidence>;
  executionTarget: VerifiedCapabilityExecutionTarget;
  policyRevision: number;
}>;

const invocationStates = new WeakMap<object, InvocationState>();
const PROJECT_TARGET: ProjectCapabilityTarget = Object.freeze({ kind: "project" });
const EMPTY_PRECONDITIONS: PreconditionSet = Object.freeze({});
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  "actionHash",
  "authorityRef",
  "binding",
  "caller",
  "canonicalRootDigest",
  "connectionNonce",
  "immutableProjectUuid",
  "inputHash",
  "invocationId",
  "leasePrincipal",
  "policyRevision",
  "projectGeneration",
  "revocationEpoch",
  "scopeSet",
  "sessionId",
]);

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  throw new CapabilityInvocationError("capability_input_invalid");
}

function digest(domain: "action" | "input", value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(`nomi-capability-invocation:${domain}:v1\0`)
    .update(stableJson(value))
    .digest("hex");
}

function capabilityIdentity(id: string, version: number): Readonly<{ id: string; version: number }> {
  return Object.freeze({ id, version });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function nonEmptyString(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new CapabilityInvocationError("capability_authority_invalid");
  return normalized;
}

function requestRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => FORBIDDEN_AUTHORITY_FIELDS.has(key))) {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  if (record.leaseHandle === undefined || (typeof record.leaseHandle === "string" && !record.leaseHandle.trim())) {
    throw new ProjectSessionRequestError("A verified project session lease is required");
  }
  if (typeof record.leaseHandle !== "string") {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
  if (record.projectId !== undefined && (typeof record.projectId !== "string" || !record.projectId.trim())) {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
  return record;
}

function parseRequest(value: unknown): Readonly<{
  leaseHandle: string;
  projectHint: string | undefined;
  input: CanvasReadInput;
}> {
  const record = requestRecord(value);
  try {
    const call = CANVAS_READ_MCP_ADAPTER.parseCall(record);
    const transport = call.transport;
    return Object.freeze({
      leaseHandle: nonEmptyString(transport.leaseHandle),
      projectHint: transport.projectId === undefined ? undefined : nonEmptyString(transport.projectId),
      input: deepFreeze(CANVAS_READ_CAPABILITY.inputSchema.parse(call.semanticInput)),
    });
  } catch (error) {
    if (error instanceof CapabilityInvocationError) throw error;
    throw new CapabilityInvocationError("capability_input_invalid");
  }
}

function projectBinding(
  value: Pick<ProjectLeaseV2, "projectId" | "immutableProjectUuid" | "projectGeneration">,
): ProjectBinding {
  if (!Number.isSafeInteger(value.projectGeneration) || value.projectGeneration < 1) {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  return Object.freeze({
    projectId: nonEmptyString(value.projectId),
    immutableProjectUuid: nonEmptyString(value.immutableProjectUuid),
    projectGeneration: value.projectGeneration,
  });
}

function mcpCaller(lease: ProjectLeaseV2): Extract<VerifiedCaller, { kind: "mcp" }> {
  return Object.freeze({
    kind: "mcp",
    principal: nonEmptyString(lease.leasePrincipal),
    sessionId: nonEmptyString(lease.sessionId),
    connectionNonce: nonEmptyString(lease.connectionNonce),
    leaseId: nonEmptyString(lease.nonce),
  });
}

function authorityEvidence(lease: ProjectLeaseV2): McpAuthorityEvidence {
  const caller = mcpCaller(lease);
  return Object.freeze({
    binding: projectBinding(lease),
    caller,
    authorityRef: `project-lease-v2:${caller.leaseId}`,
    canonicalRootDigest: nonEmptyString(lease.canonicalRootDigest),
    scopeHash: nonEmptyString(lease.scopeHash),
  });
}

function sameEvidence(left: CapabilityAuthorityEvidence, right: CapabilityAuthorityEvidence): boolean {
  return stableJson(left) === stableJson(right);
}

function invocationId(): string {
  return crypto.randomUUID();
}

function parseCanonicalInput(value: unknown): CanvasReadInput {
  try {
    return deepFreeze(CANVAS_READ_CAPABILITY.inputSchema.parse(value));
  } catch {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
}

function mintCapabilityInvocation<Input, Target>(
  input: Readonly<{
    capability: Readonly<{ id: string; version: number }>;
    policyRevision: number;
    semanticInput: Input;
    target: Target;
    preconditions?: PreconditionSet;
    evidence: CapabilityAuthorityEvidence;
    revalidate: () => Promise<CapabilityAuthorityEvidence>;
    executionTarget: VerifiedCapabilityExecutionTarget;
  }>,
): VerifiedCapabilityInvocation<Input, Target> {
  const capability = capabilityIdentity(input.capability.id, input.capability.version);
  const policyRevision = input.policyRevision;
  const inputHash = digest("input", input.semanticInput);
  const preconditions = deepFreeze(input.preconditions ?? EMPTY_PRECONDITIONS);
  const actionHash = digest("action", {
    capability,
    binding: input.evidence.binding,
    input: input.semanticInput,
    target: input.target,
    preconditions,
    policyRevision,
  });
  const invocation = deepFreeze({
    invocationId: invocationId(),
    capability,
    binding: input.evidence.binding,
    target: input.target,
    preconditions,
    input: input.semanticInput,
    caller: input.evidence.caller,
    authorityRef: input.evidence.authorityRef,
    policyRevision,
    inputHash,
    actionHash,
  }) as unknown as VerifiedCapabilityInvocation<Input, Target>;
  invocationStates.set(
    invocation,
    Object.freeze({
      evidence: input.evidence,
      revalidate: input.revalidate,
      executionTarget: input.executionTarget,
      policyRevision,
    }),
  );
  return invocation;
}

function mintCanvasReadInvocation(
  input: Readonly<{
    semanticInput: CanvasReadInput;
    evidence: CapabilityAuthorityEvidence;
    revalidate: () => Promise<CapabilityAuthorityEvidence>;
    executionTarget: VerifiedCapabilityExecutionTarget;
  }>,
): McpCanvasReadInvocation {
  return mintCapabilityInvocation({
    ...input,
    capability: CANVAS_READ_CAPABILITY,
    policyRevision: CANVAS_READ_INVOCATION_POLICY_REVISION,
    target: PROJECT_TARGET,
  });
}

export type McpCanvasReadVerifiedInvocationFactory = Readonly<{
  mint(input: Readonly<{ requestBody: unknown }>): Promise<McpCanvasReadInvocation>;
}>;

/**
 * The sole B2 mint boundary. Capability, scope, semantic input, target, policy,
 * binding, caller, and hashes are all main-owned; the request contributes only
 * the raw lease handle and optional project hint consumed by B1 verification.
 */
export function createMcpCanvasReadVerifiedInvocationFactory(
  input: Readonly<{
    projectSession: VerifiedProjectSessionBinding;
  }>,
): McpCanvasReadVerifiedInvocationFactory {
  let verification;
  try {
    verification = resolveProjectSessionLeaseVerification(input.projectSession);
  } catch {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  const verifyLease = verification.verifyLease;
  const connection = verification.connection;

  return Object.freeze({
    async mint({ requestBody }): Promise<McpCanvasReadInvocation> {
      // Everything used after the first await is detached here. Mutating the
      // transport object while lease verification runs cannot retarget a call.
      const request = parseRequest(requestBody);
      const verify = async (): Promise<McpAuthorityEvidence> =>
        authorityEvidence(
          await verifyLease(request.leaseHandle, {
            connection,
            projectHint: request.projectHint,
            scope: CANVAS_READ_CAPABILITY.requiredScope,
          }),
        );
      const evidence = await verify();
      return mintCanvasReadInvocation({
        semanticInput: request.input,
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({
          kind: "project",
          binding: evidence.binding,
          canonicalRootDigest: evidence.canonicalRootDigest,
        }),
      });
    },
  });
}

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

function internalRequest(value: unknown): Readonly<{ projectId: string; input: CanvasReadInput }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => FORBIDDEN_AUTHORITY_FIELDS.has(key) || key === "leaseHandle")) {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  if (Object.keys(request).some((key) => key !== "projectId")) {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
  return Object.freeze({
    projectId: nonEmptyString(request.projectId),
    input: parseCanonicalInput({}),
  });
}

function internalDocumentRequest(value: unknown): Readonly<{
  projectId: string;
  documentId: string;
  input: DocumentReadInput;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => FORBIDDEN_AUTHORITY_FIELDS.has(key) || key === "leaseHandle")) {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  if (Object.keys(request).some((key) => !["projectId", "documentId", "scope"].includes(key))) {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
  try {
    return Object.freeze({
      projectId: nonEmptyString(request.projectId),
      documentId: nonEmptyString(request.documentId),
      input: documentReadSemanticInputSchema.parse({ scope: request.scope }),
    });
  } catch {
    throw new CapabilityInvocationError("capability_input_invalid");
  }
}

function internalEvidence(
  identity: WorkspaceProjectIdentity,
  caller: Extract<VerifiedCaller, { kind: "internal" }>,
): InternalAuthorityEvidence {
  return Object.freeze({
    binding: projectBinding(identity),
    caller,
    authorityRef: `internal-bearer-v1:${caller.operationId}`,
    canonicalRootDigest: nonEmptyString(identity.canonicalRootDigest),
  });
}

export type InternalCanvasReadVerifiedInvocationFactory = Readonly<{
  mint(input: Readonly<{ bearer: string; requestBody: unknown }>): Promise<McpCanvasReadInvocation>;
}>;

export function createInternalCanvasReadVerifiedInvocationFactory(
  input: Readonly<{
    verifyBearer(bearer: string): boolean | Promise<boolean>;
    resolveProjectIdentity(projectId: string): Promise<WorkspaceProjectIdentity>;
    randomId?: () => string;
  }>,
): InternalCanvasReadVerifiedInvocationFactory {
  const randomId = input.randomId ?? (() => crypto.randomUUID());
  const verifyBearer = input.verifyBearer;
  const resolveProjectIdentity = input.resolveProjectIdentity;

  return Object.freeze({
    async mint({ bearer: bearerValue, requestBody }) {
      const request = internalRequest(requestBody);
      const bearer = nonEmptyString(bearerValue);
      const operationId = nonEmptyString(randomId());
      const caller = Object.freeze({
        kind: "internal" as const,
        principal: "internal:local-capability",
        operationId,
      });
      const verify = async (): Promise<InternalAuthorityEvidence> => {
        let authorized: boolean;
        try {
          authorized = await verifyBearer(bearer);
        } catch {
          throw new CapabilityInvocationError("capability_authority_invalid");
        }
        if (!authorized) throw new CapabilityInvocationError("capability_authority_invalid");
        let identity: WorkspaceProjectIdentity;
        try {
          identity = await resolveProjectIdentity(request.projectId);
        } catch {
          throw new WorkspaceProjectIdentityUnavailableError();
        }
        if (identity.projectId !== request.projectId) throw new WorkspaceProjectIdentityUnavailableError();
        return internalEvidence(identity, caller);
      };
      const evidence = await verify();
      return mintCanvasReadInvocation({
        semanticInput: request.input,
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({
          kind: "project",
          binding: evidence.binding,
          canonicalRootDigest: evidence.canonicalRootDigest,
        }),
      });
    },
  });
}

export type InternalDocumentReadVerifiedInvocationFactory = Readonly<{
  mint(
    input: Readonly<{ bearer: string; requestBody: unknown }>,
  ): Promise<VerifiedCapabilityInvocation<DocumentReadInput, Readonly<{ kind: "document"; documentId: string }>>>;
}>;

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
export function createInternalDocumentReadVerifiedInvocationFactory(
  input: Readonly<{
    verifyBearer(bearer: string): boolean | Promise<boolean>;
    resolveProjectIdentity(projectId: string): Promise<WorkspaceProjectIdentity>;
    randomId?: () => string;
  }>,
): InternalDocumentReadVerifiedInvocationFactory {
  const randomId = input.randomId ?? (() => crypto.randomUUID());
  return Object.freeze({
    async mint({ bearer: bearerValue, requestBody }) {
      const request = internalDocumentRequest(requestBody);
      const bearer = nonEmptyString(bearerValue);
      const operationId = nonEmptyString(randomId());
      const caller = Object.freeze({
        kind: "internal" as const,
        principal: "internal:local-capability",
        operationId,
      });
      const verify = async (): Promise<InternalAuthorityEvidence> => {
        let authorized: boolean;
        try {
          authorized = await input.verifyBearer(bearer);
        } catch {
          throw new CapabilityInvocationError("capability_authority_invalid");
        }
        if (!authorized) throw new CapabilityInvocationError("capability_authority_invalid");
        let identity: WorkspaceProjectIdentity;
        try {
          identity = await input.resolveProjectIdentity(request.projectId);
        } catch {
          throw new WorkspaceProjectIdentityUnavailableError();
        }
        if (identity.projectId !== request.projectId) throw new WorkspaceProjectIdentityUnavailableError();
        return internalEvidence(identity, caller);
      };
      const evidence = await verify();
      return mintCapabilityInvocation({
        capability: DOCUMENT_READ_CAPABILITY,
        policyRevision: CANVAS_READ_INVOCATION_POLICY_REVISION,
        semanticInput: request.input,
        target: Object.freeze({ kind: "document" as const, documentId: request.documentId }),
        evidence,
        revalidate: verify,
        executionTarget: Object.freeze({
          kind: "project",
          binding: evidence.binding,
          canonicalRootDigest: evidence.canonicalRootDigest,
        }),
      });
    },
  });
}

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

export function assertVerifiedCapabilityInvocation(
  value: unknown,
): asserts value is VerifiedCapabilityInvocation<unknown, unknown> {
  if (!value || typeof value !== "object" || !invocationStates.has(value)) {
    throw new CapabilityInvocationError("capability_invocation_unverified");
  }
}

export function resolveVerifiedCanvasReadExecutionTarget(
  invocation: VerifiedCapabilityInvocation<unknown, unknown>,
): VerifiedCanvasReadExecutionTarget {
  assertVerifiedCapabilityInvocation(invocation);
  const state = invocationStates.get(invocation);
  if (!state) throw new CapabilityInvocationError("capability_invocation_unverified");
  if (
    state.executionTarget.kind === "document-surface" ||
    state.executionTarget.kind === "document-write-surface" ||
    state.executionTarget.kind === "canvas-write-surface" ||
    state.executionTarget.kind === "timeline-read-surface" ||
    state.executionTarget.kind === "timeline-write-surface" ||
    state.executionTarget.kind === "asset-read-surface" ||
    state.executionTarget.kind === "export-read-surface" ||
    state.executionTarget.kind === "export-write-surface"
  ) {
    throw new CapabilityInvocationError("capability_authority_invalid");
  }
  return state.executionTarget;
}

export function resolveVerifiedCapabilityExecutionTarget(
  invocation: VerifiedCapabilityInvocation<unknown, unknown>,
): VerifiedCapabilityExecutionTarget {
  assertVerifiedCapabilityInvocation(invocation);
  const state = invocationStates.get(invocation);
  if (!state) throw new CapabilityInvocationError("capability_invocation_unverified");
  return state.executionTarget;
}

/**
 * B4 must call this immediately before executor dispatch. The private closure
 * rechecks signature, expiry, revocation, registration, exact connection,
 * scope, UUID/generation/root, and the original authority evidence.
 */
export async function revalidateVerifiedCapabilityInvocation<Input, Target>(
  invocation: VerifiedCapabilityInvocation<Input, Target>,
): Promise<VerifiedCapabilityInvocation<Input, Target>> {
  assertVerifiedCapabilityInvocation(invocation);
  const state = invocationStates.get(invocation);
  if (!state) throw new CapabilityInvocationError("capability_invocation_unverified");
  const fresh = await state.revalidate();
  if (!sameEvidence(state.evidence, fresh)) throw new ProjectBindingStaleError();
  if (invocation.policyRevision !== state.policyRevision) {
    throw new CapabilityInvocationError("capability_policy_stale");
  }
  return invocation;
}
