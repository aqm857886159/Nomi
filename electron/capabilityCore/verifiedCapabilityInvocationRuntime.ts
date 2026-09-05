import crypto from "node:crypto";

import { CANVAS_READ_CAPABILITY, type CanvasReadInput } from "../shared/agentCapabilities/canvasRead";
import type { PreconditionSet } from "../shared/capabilityTargeting";
import type { ProjectBinding } from "../shared/projectBinding";
import type { CapturedCanvasReadPort } from "./canvasReadSurfaceRegistry";
import type { CapturedCanvasReadSnapshotPort } from "./canvasReadCapturedSnapshotRegistry";
import { ProjectBindingStaleError, type ProjectLeaseV2 } from "./projectLease";

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

export {
  EMPTY_PRECONDITIONS,
  FORBIDDEN_AUTHORITY_FIELDS,
  deepFreeze,
  mintCapabilityInvocation,
  mintCanvasReadInvocation,
  nonEmptyString,
  parseCanonicalInput,
  projectBinding,
};
export type {
  CapabilityAuthorityEvidence,
  CapturedRendererAuthorityEvidence,
  InternalAuthorityEvidence,
  McpAuthorityEvidence,
  McpCanvasReadInvocation,
  RendererAuthorityEvidence,
};
