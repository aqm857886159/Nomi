import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { projectCanvasRead } from "../shared/agentCapabilities/canvasRead";
import { createInternalDocumentReadVerifiedInvocationFactory } from "./verifiedCapabilityInvocation";
import type { WorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { createMcpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createProjectSessionRuntime, createVerifiedProjectSessionBinding } from "./projectSessionRuntime";
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from "./security";
import {
  CapabilityExecutionError,
  createMainCapabilityExecutorRegistry,
  type CanvasReadPort,
} from "./capabilityExecutorRegistry";
import { createMcpCanvasReadVerifiedInvocationFactory } from "./verifiedCapabilityInvocation";

const tempDirs: string[] = [];
const previousCapabilityDir = process.env[CAPABILITY_DIR_ENV];

const BASE_IDENTITY: WorkspaceProjectIdentity = Object.freeze({
  projectId: "project-executor",
  immutableProjectUuid: "00000000-0000-4000-8000-000000000041",
  projectGeneration: 4,
  canonicalRootPath: "/real/project-executor",
  canonicalRootDigest: "root-executor",
});

const RAW_CANVAS = Object.freeze({
  nodes: [
    {
      id: "node-a",
      kind: "image",
      title: "A",
      prompt: "draw A",
      status: "success",
      position: { x: 1, y: 2 },
      result: { id: "result-a", url: "https://provider.invalid/private.png", raw: { task: "secret" } },
    },
  ],
  edges: [],
  groups: [],
  selectedNodeIds: ["node-a"],
});

function expectExecutionError(code: CapabilityExecutionError["code"]) {
  return expect.objectContaining({ code, name: "CapabilityExecutionError", message: code });
}

function makeHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-capability-executor-"));
  tempDirs.push(dir);
  process.env[CAPABILITY_DIR_ENV] = path.join(dir, "capability");
  ensureToken();
  const proof = signMcpClient("codex")!;
  const connection = createMcpConnectionContext({
    client: "codex",
    proof,
    randomSecret: () => "E".repeat(43),
  });
  let identity = BASE_IDENTITY;
  const committedSelection = Object.freeze({
    projectId: identity.projectId,
    immutableProjectUuid: identity.immutableProjectUuid,
    projectGeneration: identity.projectGeneration,
    canonicalRootDigest: identity.canonicalRootDigest,
  });
  const ensureProjectIdentity = vi.fn(async () => ({ ...identity }));
  const runtime = createProjectSessionRuntime({
    generationPolicy: createMcpGenerationPolicy({ env: {} }),
    leaseFilePath: path.join(dir, "project-leases-v2"),
    leaseMacKey: "executor-lease-key",
    leaseStoreMacKey: "executor-store-key",
    getOpenProjectSelection: () => committedSelection,
    resolveProjectRoot: (projectId) => (projectId === identity.projectId ? identity.canonicalRootPath : null),
    ensureProjectIdentity,
    readProject: (projectId) =>
      projectId === identity.projectId
        ? {
            id: identity.projectId,
            name: "Executor project",
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
  const factory = createMcpCanvasReadVerifiedInvocationFactory({
    projectSession: createVerifiedProjectSessionBinding(runtime, connection),
  });
  return {
    ensureProjectIdentity,
    replaceIdentity(patch: Partial<WorkspaceProjectIdentity>) {
      identity = Object.freeze({ ...identity, ...patch });
    },
    async mint() {
      const opened = await runtime.authority.open({ bootstrap: { mode: "current_project" } }, connection);
      return factory.mint({ requestBody: { leaseHandle: opened.leaseHandle, projectId: opened.projectId } });
    },
  };
}

afterEach(() => {
  if (previousCapabilityDir === undefined) delete process.env[CAPABILITY_DIR_ENV];
  else process.env[CAPABILITY_DIR_ENV] = previousCapabilityDir;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("main-only CapabilityExecutorRegistry", () => {
  it("dispatches document.read through its scoped document port and returns a safe result", async () => {
    const identity = BASE_IDENTITY;
    const invocation = await createInternalDocumentReadVerifiedInvocationFactory({
      verifyBearer: async (bearer) => bearer === "bearer",
      resolveProjectIdentity: async () => identity,
      randomId: () => "document-operation",
    }).mint({
      bearer: "bearer",
      requestBody: { projectId: identity.projectId, documentId: "document-1", scope: "selection" },
    });
    const read = vi.fn(async ({ scope }: { scope: "full" | "selection" }) => ({
      text: scope === "selection" ? "selected" : "full",
      path: "/private/editor-state",
    }));
    const registry = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
      resolveDocumentReadPort: async () => ({ read }),
    });

    await expect(registry.execute(invocation)).resolves.toEqual({ text: "selected" });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ scope: "selection", signal: expect.any(AbortSignal) }));
  });

  it("rejects a structural invocation before resolving any environment port", async () => {
    const resolveCanvasReadPort = vi.fn();
    const registry = createMainCapabilityExecutorRegistry({ resolveCanvasReadPort });

    await expect(
      registry.execute({
        invocationId: "forged",
        capability: { id: "canvas.read", version: 1 },
        binding: BASE_IDENTITY,
        target: { kind: "project" },
        preconditions: {},
        input: {},
        caller: { kind: "internal", principal: "request-picked" },
        authorityRef: "request-picked",
        policyRevision: 1,
        inputHash: "request-picked",
        actionHash: "request-picked",
      } as never),
    ).rejects.toMatchObject({ code: "capability_invocation_unverified" });
    expect(resolveCanvasReadPort).not.toHaveBeenCalled();
  });

  it("runs canonical canvas.read through a read-only port and strips provider/private fields", async () => {
    const harness = makeHarness();
    const invocation = await harness.mint();
    const port: CanvasReadPort = Object.freeze({
      read: vi.fn(async () => structuredClone(RAW_CANVAS)),
    });
    const resolveCanvasReadPort = vi.fn(async () => port);
    const registry = createMainCapabilityExecutorRegistry({ resolveCanvasReadPort });

    const result = await registry.execute(invocation);

    expect(result).toEqual(projectCanvasRead(RAW_CANVAS));
    expect(JSON.stringify(result)).not.toContain("provider.invalid");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(resolveCanvasReadPort).toHaveBeenCalledWith(invocation);
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(harness.ensureProjectIdentity.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("revalidates after the async port reply and refuses to project a replaced project", async () => {
    const harness = makeHarness();
    const invocation = await harness.mint();
    const registry = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({
        async read() {
          harness.replaceIdentity({
            immutableProjectUuid: "00000000-0000-4000-8000-000000000099",
          });
          return structuredClone(RAW_CANVAS);
        },
      }),
    });

    await expect(registry.execute(invocation)).rejects.toMatchObject({ code: "project_binding_stale" });
  });

  it("maps timeout, cancellation, and unknown port failures to stable codes without raw causes", async () => {
    const harness = makeHarness();
    const invocation = await harness.mint();
    const timeoutRegistry = createMainCapabilityExecutorRegistry({
      timeoutMs: 1,
      resolveCanvasReadPort: async () => ({ read: () => new Promise(() => undefined) }),
    });
    await expect(timeoutRegistry.execute(invocation)).rejects.toEqual(expectExecutionError("capability_timeout"));

    const abortAwareTimeoutRegistry = createMainCapabilityExecutorRegistry({
      timeoutMs: 1,
      resolveCanvasReadPort: async () => ({
        read: ({ signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('/private/late-renderer')), { once: true });
        }),
      }),
    });
    await expect(abortAwareTimeoutRegistry.execute(invocation)).rejects.toEqual(
      expectExecutionError("capability_timeout"),
    );

    const controller = new AbortController();
    controller.abort(new Error("private cancellation reason"));
    const cancelledRegistry = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({ read: async () => RAW_CANVAS }),
    });
    await expect(cancelledRegistry.execute(invocation, { signal: controller.signal })).rejects.toEqual(
      expectExecutionError("capability_cancelled"),
    );

    const failingRegistry = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({
        read: async () => {
          throw new Error("/private/workspace/provider-token");
        },
      }),
    });
    await expect(failingRegistry.execute(invocation)).rejects.toEqual(
      expectExecutionError("capability_execution_failed"),
    );
  });

  it("does not expose write or paid capability methods through CanvasReadPort", () => {
    const readPort: CanvasReadPort = {
      read: async () => RAW_CANVAS,
      // @ts-expect-error CanvasReadPort is deliberately effect-constrained.
      write: async () => undefined,
    };
    expect(readPort.read).toBeTypeOf("function");
  });
});
