import crypto from "node:crypto";

import {
  CANVAS_READ_CAPABILITY,
  type CanvasReadInput,
} from "../shared/agentCapabilities/canvasRead";
import {
  DOCUMENT_READ_CAPABILITY,
  documentReadSemanticInputSchema,
  type DocumentReadInput,
} from "../shared/agentCapabilities/documentRead";
import {
  CapabilityInvocationError,
  CANVAS_READ_INVOCATION_POLICY_REVISION,
  FORBIDDEN_AUTHORITY_FIELDS,
  deepFreeze,
  mintCapabilityInvocation,
  mintCanvasReadInvocation,
  nonEmptyString,
  parseCanonicalInput,
  projectBinding,
  type InternalAuthorityEvidence,
  type McpAuthorityEvidence,
  type McpCanvasReadInvocation,
  type VerifiedCaller,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocationRuntime";
import { CANVAS_READ_MCP_ADAPTER } from "./mcpCapabilityProjection";
import { type ProjectLeaseV2 } from "./projectLease";
import { ProjectSessionRequestError } from "./projectSessionAuthority";
import { resolveProjectSessionLeaseVerification, type VerifiedProjectSessionBinding } from "./projectSessionRuntime";
import {
  WorkspaceProjectIdentityUnavailableError,
  type WorkspaceProjectIdentity,
} from "../workspace/workspaceProjectIdentity";

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
