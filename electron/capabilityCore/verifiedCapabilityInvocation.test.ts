import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { CANVAS_READ_CAPABILITY } from "../shared/agentCapabilities/canvasRead";
import type { WorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { createMcpConnectionContext, type McpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import {
  ProjectBindingStaleError,
  ProjectLeaseExpiredError,
  ProjectLeaseRevokedError,
  type FreshProjectIdentity,
} from "./projectLease";
import {
  ProjectSessionBindingError,
  createProjectSessionRuntime,
  createVerifiedProjectSessionBinding,
  createVerifiedProjectSessionBindingFromAuthority,
  type VerifiedProjectSessionBinding,
} from "./projectSessionRuntime";
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from "./security";
import {
  CapabilityInvocationError,
  assertVerifiedCapabilityInvocation,
  CANVAS_READ_INVOCATION_POLICY_REVISION,
  createMcpCanvasReadVerifiedInvocationFactory,
  createInternalCanvasReadVerifiedInvocationFactory,
  createRendererCanvasReadVerifiedInvocationFactory,
  revalidateVerifiedCapabilityInvocation,
  resolveVerifiedCanvasReadExecutionTarget,
  type VerifiedCapabilityInvocation,
} from "./verifiedCapabilityInvocation";

type PublicInvocationShape = Pick<
  VerifiedCapabilityInvocation<unknown, unknown>,
  | "invocationId"
  | "capability"
  | "binding"
  | "target"
  | "preconditions"
  | "input"
  | "caller"
  | "authorityRef"
  | "policyRevision"
  | "inputHash"
  | "actionHash"
>;

function compileTimeForgeryMustFail(value: PublicInvocationShape) {
  // @ts-expect-error VerifiedCapabilityInvocation carries a module-private compile-time brand.
  const forged: VerifiedCapabilityInvocation<unknown, unknown> = value;
  return forged;
}
void compileTimeForgeryMustFail;

const tempDirs: string[] = [];
const previousCapabilityDir = process.env[CAPABILITY_DIR_ENV];

const BASE_IDENTITY = Object.freeze({
  projectId: "project-1",
  immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
  projectGeneration: 3,
  canonicalRootPath: "/real/project-1",
  canonicalRootDigest: "root-digest-1",
  manifestDigest: "manifest-selection-audit-only",
});

type SessionHarness = ReturnType<typeof makeSessionHarness>;

function makeSessionHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-verified-invocation-"));
  tempDirs.push(dir);
  process.env[CAPABILITY_DIR_ENV] = path.join(dir, "capability");
  ensureToken();
  const proof = signMcpClient("codex")!;
  const makeConnection = (secret = "A".repeat(43)): McpConnectionContext =>
    createMcpConnectionContext({
      client: "codex",
      proof,
      randomSecret: () => secret,
    });
  const connection = makeConnection();
  let tick = 0;
  let identity: WorkspaceProjectIdentity = {
    projectId: BASE_IDENTITY.projectId,
    immutableProjectUuid: BASE_IDENTITY.immutableProjectUuid,
    projectGeneration: BASE_IDENTITY.projectGeneration,
    canonicalRootPath: BASE_IDENTITY.canonicalRootPath,
    canonicalRootDigest: BASE_IDENTITY.canonicalRootDigest,
  };
  let nextIdentityGate: Promise<void> | undefined;
  const now = () => `2026-08-28T00:${String(tick).padStart(2, "0")}:00.000Z`;
  const verifyProjectIdentity = vi.fn(async () => {
    const gate = nextIdentityGate;
    nextIdentityGate = undefined;
    if (gate) await gate;
    return { ...identity };
  });
  const committedSelection = Object.freeze({
    projectId: identity.projectId,
    immutableProjectUuid: identity.immutableProjectUuid,
    projectGeneration: identity.projectGeneration,
    canonicalRootDigest: identity.canonicalRootDigest,
  });
  const runtime = createProjectSessionRuntime({
    generationPolicy: createMcpGenerationPolicy({ env: {} }),
    leaseFilePath: path.join(dir, "project-leases-v2"),
    leaseMacKey: "verified-invocation-lease-key",
    leaseStoreMacKey: "verified-invocation-store-key",
    leaseNow: now,
    getOpenProjectSelection: () => committedSelection,
    resolveProjectRoot: (projectId) => (projectId === identity.projectId ? identity.canonicalRootPath : null),
    ensureProjectIdentity: verifyProjectIdentity,
    readProject: (projectId) =>
      projectId === identity.projectId
        ? {
            id: identity.projectId,
            name: "Project 1",
            version: 2,
            createdAt: 1,
            updatedAt: 1,
            savedAt: 1,
            revision: 0,
            immutableProjectUuid: identity.immutableProjectUuid,
            projectGeneration: identity.projectGeneration,
            payload: {},
          }
        : null,
    isServerAllowlisted: () => false,
  });
  const projectSession = createVerifiedProjectSessionBinding(runtime, connection);
  return {
    runtime,
    authority: runtime.authority,
    connection,
    projectSession,
    makeConnection,
    verifyProjectIdentity,
    advanceMinutes: (minutes: number) => {
      tick += minutes;
    },
    delayNextIdentityVerification: (gate: Promise<void>) => {
      nextIdentityGate = gate;
    },
    replaceIdentity: (patch: Partial<FreshProjectIdentity>) => {
      identity = { ...identity, ...patch };
    },
    open: () => runtime.authority.open({ bootstrap: { mode: "current_project" } }, connection),
  };
}

function makeFactory(
  harness: SessionHarness,
  options: {
    projectSession?: VerifiedProjectSessionBinding;
  } = {},
) {
  return createMcpCanvasReadVerifiedInvocationFactory({
    projectSession: options.projectSession ?? harness.projectSession,
  });
}

async function mint(harness: SessionHarness, factory = makeFactory(harness)) {
  const opened = await harness.open();
  const requestBody = {
    leaseHandle: opened.leaseHandle,
    projectId: opened.projectId,
  };
  const invocation = await factory.mint({ requestBody });
  return { factory, invocation, opened, requestBody };
}

function expectInvocationError(code: CapabilityInvocationError["code"]) {
  return expect.objectContaining({ code, name: "CapabilityInvocationError" });
}

afterEach(() => {
  if (previousCapabilityDir === undefined) delete process.env[CAPABILITY_DIR_ENV];
  else process.env[CAPABILITY_DIR_ENV] = previousCapabilityDir;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("VerifiedCapabilityInvocation MCP construction boundary", () => {
  it("preserves exact runtime authority proof when loopback wiring only receives the registered authority", async () => {
    const harness = makeSessionHarness();
    const projectSession = createVerifiedProjectSessionBindingFromAuthority(harness.authority, harness.connection);

    await expect(mint(harness, makeFactory(harness, { projectSession }))).resolves.toMatchObject({
      invocation: {
        binding: {
          projectId: BASE_IDENTITY.projectId,
          immutableProjectUuid: BASE_IDENTITY.immutableProjectUuid,
          projectGeneration: BASE_IDENTITY.projectGeneration,
        },
        caller: { kind: "mcp", principal: harness.connection.principal },
      },
    });
    expect(() =>
      createVerifiedProjectSessionBindingFromAuthority({ ...harness.authority }, harness.connection),
    ).toThrow(ProjectSessionBindingError);
  });

  it("rejects a structural project-session whose fake verifier fabricates lease claims", async () => {
    const attackerConnection = Object.freeze({
      authenticatedClient: "codex" as const,
      principal: "mcp:codex" as const,
      sessionId: "mcp-session:attacker",
      connectionNonce: "attacker-connection",
    });
    const fakeVerifyLease = vi.fn(async () => ({
      projectId: BASE_IDENTITY.projectId,
      immutableProjectUuid: BASE_IDENTITY.immutableProjectUuid,
      projectGeneration: BASE_IDENTITY.projectGeneration,
      canonicalRootDigest: BASE_IDENTITY.canonicalRootDigest,
      leasePrincipal: attackerConnection.principal,
      sessionId: attackerConnection.sessionId,
      connectionNonce: attackerConnection.connectionNonce,
      nonce: "attacker-picked-lease",
      scopeHash: "attacker-picked-scope",
    }));
    expect(() =>
      createMcpCanvasReadVerifiedInvocationFactory({
        projectSession: {
          authority: { verifyLease: fakeVerifyLease },
          connection: attackerConnection,
        } as unknown as VerifiedProjectSessionBinding,
      }),
    ).toThrow(expectInvocationError("capability_authority_invalid"));
    expect(fakeVerifyLease).not.toHaveBeenCalled();
  });

  it("rejects a structurally copied connection before a real authority can verify a lease", () => {
    const harness = makeSessionHarness();
    const copiedConnection = Object.freeze({ ...harness.connection });

    expect(() => createVerifiedProjectSessionBinding(harness.runtime, copiedConnection)).toThrow(
      ProjectSessionBindingError,
    );
    expect(() => createVerifiedProjectSessionBinding({ ...harness.runtime }, harness.connection)).toThrow(
      ProjectSessionBindingError,
    );

    expect(() =>
      createMcpCanvasReadVerifiedInvocationFactory({
        projectSession: {
          authority: harness.authority,
          connection: harness.connection,
        } as unknown as VerifiedProjectSessionBinding,
      }),
    ).toThrow(expectInvocationError("capability_authority_invalid"));
    expect(() =>
      createMcpCanvasReadVerifiedInvocationFactory({
        projectSession: {
          authority: { ...harness.authority },
          connection: harness.connection,
        } as unknown as VerifiedProjectSessionBinding,
      }),
    ).toThrow(expectInvocationError("capability_authority_invalid"));
  });

  it("rejects every request-body authority claim before consulting the project-session authority", async () => {
    const harness = makeSessionHarness();
    const opened = await harness.open();
    const callsBeforeClaims = harness.verifyProjectIdentity.mock.calls.length;
    const factory = makeFactory(harness);
    const base = { leaseHandle: opened.leaseHandle, projectId: opened.projectId };
    const forgedClaims = [
      { immutableProjectUuid: "request-picked-uuid" },
      { projectGeneration: 999 },
      { caller: { kind: "mcp", principal: "mcp:attacker" } },
      { policyRevision: 999 },
      { binding: { projectId: opened.projectId } },
      { invocationId: "request-picked-invocation" },
      { authorityRef: "request-picked-authority" },
      { actionHash: "request-picked-action" },
      { inputHash: "request-picked-input" },
      { connectionNonce: "request-picked-connection" },
      { scopeSet: ["generation:submit"] },
    ];

    for (const claim of forgedClaims) {
      await expect(factory.mint({ requestBody: { ...base, ...claim } })).rejects.toEqual(
        expectInvocationError("capability_authority_invalid"),
      );
    }
    await expect(
      factory.mint({
        requestBody: { ...base, leaseHandle: { copiedLease: true } },
      }),
    ).rejects.toEqual(expectInvocationError("capability_input_invalid"));
    expect(harness.verifyProjectIdentity).toHaveBeenCalledTimes(callsBeforeClaims);
  });

  it("reuses lease_required for a missing lease and reserves input_invalid for malformed wire input", async () => {
    const harness = makeSessionHarness();
    const factory = makeFactory(harness);

    await expect(factory.mint({ requestBody: {} })).rejects.toMatchObject({ code: "lease_required" });
    await expect(factory.mint({ requestBody: { leaseHandle: "  " } })).rejects.toMatchObject({
      code: "lease_required",
    });
    await expect(factory.mint({ requestBody: { leaseHandle: 123 } })).rejects.toEqual(
      expectInvocationError("capability_input_invalid"),
    );
  });

  it("mints only from a verified lease and derives immutable binding, caller, policy, target, and hashes in main", async () => {
    const harness = makeSessionHarness();
    const { invocation, opened } = await mint(harness);

    expect(invocation).toMatchObject({
      invocationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      capability: { id: CANVAS_READ_CAPABILITY.id, version: CANVAS_READ_CAPABILITY.version },
      binding: {
        projectId: BASE_IDENTITY.projectId,
        immutableProjectUuid: BASE_IDENTITY.immutableProjectUuid,
        projectGeneration: BASE_IDENTITY.projectGeneration,
      },
      target: { kind: "project" },
      preconditions: {},
      input: {},
      caller: {
        kind: "mcp",
        principal: harness.connection.principal,
        sessionId: harness.connection.sessionId,
        connectionNonce: harness.connection.connectionNonce,
      },
      policyRevision: CANVAS_READ_INVOCATION_POLICY_REVISION,
    });
    expect(invocation.authorityRef).toMatch(/^project-lease-v2:[A-Za-z0-9_-]+$/);
    expect(invocation.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(invocation.actionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(invocation.caller.kind === "mcp" && invocation.caller.leaseId).toBeTruthy();
    expect(JSON.stringify(invocation)).not.toContain(opened.leaseHandle);
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(Object.isFrozen(invocation.binding)).toBe(true);
    expect(Object.isFrozen(invocation.caller)).toBe(true);
    expect(Object.isFrozen(invocation.capability)).toBe(true);
    expect(Object.isFrozen(invocation.target)).toBe(true);
    expect(Object.isFrozen(invocation.preconditions)).toBe(true);
    expect(Object.isFrozen(invocation.input)).toBe(true);
    expect(() => assertVerifiedCapabilityInvocation(invocation)).not.toThrow();
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).resolves.toBe(invocation);
  });

  it("freezes the real authority and keeps the factory on its captured verifier", async () => {
    const harness = makeSessionHarness();
    const factory = makeFactory(harness);
    const replacementVerifyLease = vi.fn(async () => {
      throw new Error("replacement verifier must never run");
    });

    expect(Object.isFrozen(harness.authority)).toBe(true);
    expect(Reflect.set(harness.authority, "verifyLease", replacementVerifyLease)).toBe(false);
    const { invocation } = await mint(harness, factory);
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).resolves.toBe(invocation);
    expect(replacementVerifyLease).not.toHaveBeenCalled();
  });

  it("does not treat structural, spread, JSON, structuredClone, or Reflect copies as proof", async () => {
    const harness = makeSessionHarness();
    const { invocation } = await mint(harness);
    const copies: unknown[] = [
      { ...invocation },
      JSON.parse(JSON.stringify(invocation)),
      structuredClone(invocation),
      new Proxy(invocation, {}),
      Object.create(invocation),
      Object.fromEntries(Reflect.ownKeys(invocation).map((key) => [key, Reflect.get(invocation, key)])),
      {
        invocationId: "forged-renderer",
        capability: invocation.capability,
        binding: invocation.binding,
        target: invocation.target,
        input: invocation.input,
        caller: { kind: "embedded-agent", requestId: "request", toolCallId: "tool" },
        authorityRef: "surface:0000000000000000000000000000000000000000000000000000000000000000",
        policyRevision: invocation.policyRevision,
        inputHash: invocation.inputHash,
        actionHash: invocation.actionHash,
      },
      {
        ...invocation,
        invocationId: "forged-internal",
        caller: { kind: "internal", principal: "request-picked-principal" },
      },
    ];

    for (const copy of copies) {
      expect(() => assertVerifiedCapabilityInvocation(copy)).toThrow(
        expectInvocationError("capability_invocation_unverified"),
      );
      await expect(
        revalidateVerifiedCapabilityInvocation(copy as VerifiedCapabilityInvocation<unknown, unknown>),
      ).rejects.toEqual(expectInvocationError("capability_invocation_unverified"));
    }
  });

  it("captures strict canonical input and request hints before the first authority await", async () => {
    const harness = makeSessionHarness();
    const opened = await harness.open();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.delayNextIdentityVerification(gate);
    const factory = createMcpCanvasReadVerifiedInvocationFactory({
      projectSession: harness.projectSession,
    });
    const requestBody: Record<string, unknown> = {
      leaseHandle: opened.leaseHandle,
      projectId: opened.projectId,
    };
    const pending = factory.mint({ requestBody });
    requestBody.caller = { kind: "mcp", principal: "mcp:attacker" };
    requestBody.projectId = "later-project";
    release();
    const invocation = await pending;

    expect(invocation.input).toEqual({});
    expect(invocation.binding.projectId).toBe(BASE_IDENTITY.projectId);
    expect(Object.isFrozen(invocation.input)).toBe(true);
  });

  it("keeps actionHash semantic across distinct leases while authorityRef and caller lease identity remain separate", async () => {
    const harness = makeSessionHarness();
    const factory = makeFactory(harness);
    const first = await mint(harness, factory);
    const second = await mint(harness, factory);

    expect(first.invocation.actionHash).toBe(second.invocation.actionHash);
    expect(first.invocation.inputHash).toBe(second.invocation.inputHash);
    expect(first.invocation.authorityRef).not.toBe(second.invocation.authorityRef);
    expect(first.invocation.caller.kind).toBe("mcp");
    expect(second.invocation.caller.kind).toBe("mcp");
    if (first.invocation.caller.kind === "mcp" && second.invocation.caller.kind === "mcp") {
      expect(first.invocation.caller.leaseId).not.toBe(second.invocation.caller.leaseId);
    }
  });

  it("rejects a valid lease on a different closed-over connection or with a wrong project hint", async () => {
    const harness = makeSessionHarness();
    const opened = await harness.open();
    const foreignConnection = harness.makeConnection("B".repeat(43));
    const foreignProjectSession = createVerifiedProjectSessionBinding(harness.runtime, foreignConnection);
    const foreignFactory = makeFactory(harness, {
      projectSession: foreignProjectSession,
    });

    await expect(
      foreignFactory.mint({
        requestBody: { leaseHandle: opened.leaseHandle, projectId: opened.projectId },
      }),
    ).rejects.toMatchObject({ code: "project_scope_changed" });
    await expect(
      makeFactory(harness).mint({
        requestBody: { leaseHandle: opened.leaseHandle, projectId: "project-foreign" },
      }),
    ).rejects.toMatchObject({ code: "project_scope_changed" });
  });
});

describe("VerifiedCapabilityInvocation execution-time revalidation", () => {
  it.each([
    ["project copy", { immutableProjectUuid: "00000000-0000-4000-8000-000000000099" }],
    ["generation bump", { projectGeneration: BASE_IDENTITY.projectGeneration + 1 }],
    ["canonical root replacement", { canonicalRootDigest: "root-digest-replaced" }],
  ] as const)("rejects a same-ID %s after mint", async (_label, patch) => {
    const harness = makeSessionHarness();
    const { invocation } = await mint(harness);
    harness.replaceIdentity(patch);

    await expect(revalidateVerifiedCapabilityInvocation(invocation)).rejects.toBeInstanceOf(ProjectBindingStaleError);
  });

  it("allows the same project identity to reopen and ignores revision-only churn", async () => {
    const harness = makeSessionHarness();
    const { invocation } = await mint(harness);
    const callsAtMint = harness.verifyProjectIdentity.mock.calls.length;

    await expect(revalidateVerifiedCapabilityInvocation(invocation)).resolves.toBe(invocation);
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).resolves.toBe(invocation);
    expect(harness.verifyProjectIdentity.mock.calls.length).toBe(callsAtMint + 2);
  });

  it("rejects revocation and expiry after mint with the existing typed lease errors", async () => {
    const revokedHarness = makeSessionHarness();
    const revoked = await mint(revokedHarness);
    revokedHarness.authority.revoke(revoked.opened.leaseHandle);
    await expect(revalidateVerifiedCapabilityInvocation(revoked.invocation)).rejects.toBeInstanceOf(
      ProjectLeaseRevokedError,
    );

    const expiredHarness = makeSessionHarness();
    const expired = await mint(expiredHarness);
    expiredHarness.advanceMinutes(6);
    await expect(revalidateVerifiedCapabilityInvocation(expired.invocation)).rejects.toBeInstanceOf(
      ProjectLeaseExpiredError,
    );
  });
});

describe("VerifiedCapabilityInvocation renderer and internal construction boundaries", () => {
  it("mints a renderer invocation only from an exact captured Surface port and transitional request/tool ids", async () => {
    const ownerAuthority = createSurfaceOwnerAuthority();
    const owner = ownerAuthority.capture({
      contents: {},
      frame: {},
      webContentsId: 1,
      processId: 2,
      frameRoutingId: 3,
      origin: "file://",
      isLive: () => true,
    });
    const resolveProjectIdentity = vi.fn(async () => ({ ...BASE_IDENTITY }));
    let id = 0;
    const registry = createCanvasReadSurfaceRegistry({
      ownerAuthority,
      resolveProjectIdentity,
      randomId: () => `surface-${++id}`,
    });
    const suspension = registry.suspend(owner, { surfaceInstanceId: "surface-1" });
    const binding = await registry.commitCanvasRead(owner, {
      projectId: BASE_IDENTITY.projectId,
      suspension,
    });
    const capturedPort = registry.captureCanvasReadPort(owner, binding);
    const factory = createRendererCanvasReadVerifiedInvocationFactory({
      registry,
      capturedPort,
      requestId: "request-1",
    });

    const invocation = await factory.mint({ toolCallId: "tool-1", input: {} });

    expect(invocation.caller).toEqual({
      kind: "embedded-agent",
      requestId: "request-1",
      toolCallId: "tool-1",
    });
    expect(invocation.binding).toEqual(binding.binding);
    expect(resolveVerifiedCanvasReadExecutionTarget(invocation)).toEqual({
      kind: "surface",
      capturedPort,
    });
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).resolves.toBe(invocation);
    expect(() =>
      createRendererCanvasReadVerifiedInvocationFactory({
        registry: { ...registry },
        capturedPort,
        requestId: "request-2",
      }),
    ).toThrow(expect.objectContaining({ code: "capability_authority_invalid" }));

    registry.suspend(owner, { surfaceInstanceId: "surface-1" });
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).rejects.toMatchObject({
      code: "surface_port_stale",
    });
  });

  it("verifies the raw local bearer inside its factory and resolves the full binding in main", async () => {
    let identity: WorkspaceProjectIdentity = { ...BASE_IDENTITY };
    const verifyBearer = vi.fn((bearer: string) => bearer === "server-secret");
    const resolveProjectIdentity = vi.fn(async (projectId: string) => {
      if (projectId !== identity.projectId) throw new Error("missing");
      return { ...identity };
    });
    const factory = createInternalCanvasReadVerifiedInvocationFactory({
      verifyBearer,
      resolveProjectIdentity,
      randomId: () => "internal-operation-1",
    });

    await expect(
      factory.mint({
        bearer: "wrong",
        requestBody: { projectId: BASE_IDENTITY.projectId },
      }),
    ).rejects.toEqual(expectInvocationError("capability_authority_invalid"));
    await expect(
      factory.mint({
        bearer: "server-secret",
        requestBody: {
          projectId: BASE_IDENTITY.projectId,
          caller: { kind: "internal", principal: "request-picked" },
        },
      }),
    ).rejects.toEqual(expectInvocationError("capability_authority_invalid"));

    const invocation = await factory.mint({
      bearer: "server-secret",
      requestBody: { projectId: BASE_IDENTITY.projectId },
    });
    expect(invocation).toMatchObject({
      binding: {
        projectId: BASE_IDENTITY.projectId,
        immutableProjectUuid: BASE_IDENTITY.immutableProjectUuid,
        projectGeneration: BASE_IDENTITY.projectGeneration,
      },
      caller: {
        kind: "internal",
        principal: "internal:local-capability",
        operationId: "internal-operation-1",
      },
    });
    expect(resolveVerifiedCanvasReadExecutionTarget(invocation)).toEqual({
      kind: "project",
      binding: invocation.binding,
      canonicalRootDigest: BASE_IDENTITY.canonicalRootDigest,
    });
    expect(verifyBearer).toHaveBeenCalledWith("server-secret");

    identity = { ...identity, projectGeneration: identity.projectGeneration + 1 };
    await expect(revalidateVerifiedCapabilityInvocation(invocation)).rejects.toBeInstanceOf(ProjectBindingStaleError);
  });
});
