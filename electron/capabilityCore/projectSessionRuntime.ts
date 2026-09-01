import path from "node:path";

import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { readWorkspaceProject, resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import {
  ensureWorkspaceProjectIdentity,
  WorkspaceProjectIdentityUnavailableError,
  type WorkspaceProjectIdentity,
} from "../workspace/workspaceProjectIdentity";
import type { WorkspaceProjectRecordV2 } from "../workspace/workspaceTypes";
import { createProjectSelectionResolver, type CurrentProjectSelection } from "./currentProjectResolver";
import { assertVerifiedMcpConnectionContext, type McpConnectionContext } from "./mcpConnectionContext";
import type { McpGenerationPolicy } from "./mcpGenerationPolicy";
import { createProjectLeaseAuthority } from "./projectLease";
import { createProjectLeaseStore } from "./projectLeaseStore";
import { createProjectSessionAuthority, type ProjectSessionAuthority } from "./projectSessionAuthority";
import { capabilityCoreDir, ensureCapabilitySigningKey } from "./security";

declare const verifiedProjectSessionBindingBrand: unique symbol;

export type VerifiedProjectSessionBinding = Readonly<{
  authority: ProjectSessionAuthority;
  connection: McpConnectionContext;
  readonly [verifiedProjectSessionBindingBrand]: never;
}>;

export type ProjectSessionLeaseVerification = Readonly<{
  connection: McpConnectionContext;
  verifyLease: ProjectSessionAuthority["verifyLease"];
}>;

export class ProjectSessionBindingError extends Error {
  readonly code = "project_session_binding_invalid";

  constructor() {
    super("project_session_binding_invalid");
    this.name = "ProjectSessionBindingError";
  }
}

type ProjectSessionRuntimeState = Readonly<{
  authority: ProjectSessionAuthority;
  verifyLease: ProjectSessionAuthority["verifyLease"];
}>;

const projectSessionRuntimeStates = new WeakMap<object, ProjectSessionRuntimeState>();
const projectSessionAuthorityStates = new WeakMap<object, ProjectSessionRuntimeState>();
const verifiedProjectSessionBindingStates = new WeakMap<object, ProjectSessionLeaseVerification>();

export type ProjectSessionRuntimeDeps = Readonly<{
  generationPolicy: McpGenerationPolicy;
  leaseFilePath: string;
  leaseMacKey: string | NodeJS.TypedArray;
  leaseStoreMacKey: string | NodeJS.TypedArray;
  /** Testable clock owned by the runtime factory; production always omits it. */
  leaseNow?: () => string;
  /** Optional one-time V1 central ledger retirement; it is never read by V2. */
  legacyLeaseFilePath?: string;
  getOpenProjectSelection: () => CurrentProjectSelection | null;
  resolveProjectRoot: (projectId: string) => string | null;
  ensureProjectIdentity: (actualRootPath: string) => Promise<WorkspaceProjectIdentity>;
  readProject: (projectId: string) => WorkspaceProjectRecordV2 | null;
  isServerAllowlisted: (projectId: string, connection: McpConnectionContext) => boolean;
}>;

export type ProductionProjectSessionRuntimeOptions = Readonly<{
  generationPolicy: McpGenerationPolicy;
  getOpenProjectSelection: () => CurrentProjectSelection | null;
  isServerAllowlisted: (projectId: string, connection: McpConnectionContext) => boolean;
}>;

/**
 * The single project-session authority factory shared by GUI RPC and headless
 * stdio. Per-token immutable records remove shared read-modify-write state.
 */
export function createProjectSessionRuntime(deps: ProjectSessionRuntimeDeps) {
  const store = createProjectLeaseStore({
    filePath: deps.leaseFilePath,
    macKey: deps.leaseStoreMacKey,
    keyId: "project-lease-store-v2",
    legacyFilePath: deps.legacyLeaseFilePath,
    now: deps.leaseNow,
  });
  const freshIdentity = async (projectId: string) => {
    const actualRootPath = deps.resolveProjectRoot(projectId);
    if (!actualRootPath) {
      throw new WorkspaceProjectIdentityUnavailableError("Workspace project root is unavailable");
    }
    const identity = await deps.ensureProjectIdentity(actualRootPath);
    if (identity.projectId !== projectId) {
      throw new WorkspaceProjectIdentityUnavailableError("Workspace project root belongs to another project");
    }
    return {
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    };
  };
  const leaseAuthority = createProjectLeaseAuthority({
    macKey: deps.leaseMacKey,
    keyId: "project-lease-v2",
    store,
    verifyProjectIdentity: freshIdentity,
    now: deps.leaseNow,
  });
  const resolveProjectSelection = createProjectSelectionResolver({
    getOpenProjectSelection: deps.getOpenProjectSelection,
    resolveProjectRoot: deps.resolveProjectRoot,
    ensureProjectIdentity: deps.ensureProjectIdentity,
    readProject: deps.readProject,
    isServerAllowlisted: deps.isServerAllowlisted,
  });
  const authority = Object.freeze(
    createProjectSessionAuthority({
      leaseAuthority,
      resolveProjectSelection,
      generationPolicy: deps.generationPolicy,
    }),
  );
  const runtime = Object.freeze({
    authority,
    generationPolicy: deps.generationPolicy,
  });
  const runtimeState = Object.freeze({
    authority,
    verifyLease: authority.verifyLease.bind(authority),
  });
  projectSessionRuntimeStates.set(runtime, runtimeState);
  projectSessionAuthorityStates.set(authority, runtimeState);
  return runtime;
}

/** Production wiring: real workspace identity, shared files, and durable lock. */
export function createProductionProjectSessionRuntime(options: ProductionProjectSessionRuntimeOptions) {
  const authorityDir = capabilityCoreDir();
  return createProjectSessionRuntime({
    generationPolicy: options.generationPolicy,
    leaseFilePath: path.join(authorityDir, "project-leases-v2"),
    legacyLeaseFilePath: path.join(authorityDir, "project-leases.json"),
    leaseMacKey: ensureCapabilitySigningKey("project-lease"),
    leaseStoreMacKey: ensureCapabilitySigningKey("project-lease-store"),
    getOpenProjectSelection: options.getOpenProjectSelection,
    resolveProjectRoot: (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()),
    ensureProjectIdentity: (actualRootPath) => ensureWorkspaceProjectIdentity(actualRootPath),
    readProject: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps()),
    isServerAllowlisted: options.isServerAllowlisted,
  });
}

export type ProjectSessionRuntime = ReturnType<typeof createProjectSessionRuntime>;

/**
 * Join one exact B1 runtime with one exact transport-minted connection. Neither
 * a structural runtime, a copied connection, nor a copied binding is authority.
 */
export function createVerifiedProjectSessionBinding(
  runtime: ProjectSessionRuntime,
  connection: McpConnectionContext,
): VerifiedProjectSessionBinding {
  const runtimeState = projectSessionRuntimeStates.get(runtime);
  if (!runtimeState) throw new ProjectSessionBindingError();
  return createBinding(runtimeState, connection);
}

/**
 * Loopback wiring is allowed to retain the exact authority object exposed by a
 * registered runtime. The private WeakMap makes that object an opaque proof;
 * structural copies and independently constructed authorities remain invalid.
 */
export function createVerifiedProjectSessionBindingFromAuthority(
  authority: ProjectSessionAuthority,
  connection: McpConnectionContext,
): VerifiedProjectSessionBinding {
  const runtimeState = projectSessionAuthorityStates.get(authority);
  if (!runtimeState || runtimeState.authority !== authority) throw new ProjectSessionBindingError();
  return createBinding(runtimeState, connection);
}

function createBinding(
  runtimeState: ProjectSessionRuntimeState,
  connection: McpConnectionContext,
): VerifiedProjectSessionBinding {
  try {
    assertVerifiedMcpConnectionContext(connection);
  } catch {
    throw new ProjectSessionBindingError();
  }
  const binding = Object.freeze({
    authority: runtimeState.authority,
    connection,
  }) as unknown as VerifiedProjectSessionBinding;
  verifiedProjectSessionBindingStates.set(
    binding,
    Object.freeze({
      connection,
      verifyLease: runtimeState.verifyLease,
    }),
  );
  return binding;
}

/** Narrow B2 handoff: exact binding identity resolves to the captured verifier. */
export function resolveProjectSessionLeaseVerification(binding: unknown): ProjectSessionLeaseVerification {
  if (!binding || typeof binding !== "object") throw new ProjectSessionBindingError();
  const verification = verifiedProjectSessionBindingStates.get(binding);
  if (!verification) throw new ProjectSessionBindingError();
  return verification;
}
