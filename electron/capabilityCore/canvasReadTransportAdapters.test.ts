import { describe, expect, it, vi } from "vitest";

import { CANVAS_READ_CAPABILITY, canvasReadResultSchema } from "../shared/agentCapabilities/canvasRead";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import {
  createCapturedPiCanvasReadTransportAdapter,
  createInternalCanvasReadTransportAdapter,
  createPiCanvasReadTransportAdapter,
} from "./canvasReadTransportAdapters";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createCapturedCanvasReadSnapshotRegistry } from "./canvasReadCapturedSnapshotRegistry";
import { createCanvasReadPortResolver } from "./canvasReadPortResolver";
import { createInternalCanvasReadVerifiedInvocationFactory } from "./verifiedCapabilityInvocation";

const IDENTITY = {
  projectId: "project-a",
  immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
  projectGeneration: 1,
  canonicalRootPath: "/real/project-a",
  canonicalRootDigest: "root-a",
};

const SOURCE = {
  nodes: [
    {
      id: "node-a",
      kind: "image",
      title: "A",
      prompt: "draw A",
      status: "success",
      position: { x: 1, y: 2 },
      result: { id: "result-a", url: "https://provider.invalid/private.png" },
    },
  ],
  edges: [],
  groups: [],
  selectedNodeIds: ["node-a"],
};

const CAPTURED_SOURCE = Object.freeze({
  nodes: [
    Object.freeze({
      id: "node-a",
      kind: "image",
      title: "A",
      prompt: "draw A",
      status: "success" as const,
      position: Object.freeze({ x: 1, y: 2 }),
      locked: false,
      hasResult: true,
      currentResultId: "result-a",
      resultIds: Object.freeze(["result-a"]),
    }),
  ],
  edges: Object.freeze([]),
  groups: Object.freeze([]),
  selectedNodeIds: Object.freeze(["node-a"]),
});

async function piHarness() {
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
  let id = 0;
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity: async () => ({ ...IDENTITY }),
    randomId: () => `id-${++id}`,
  });
  const suspension = registry.suspend(owner, { surfaceInstanceId: "surface-1" });
  const binding = await registry.commitCanvasRead(owner, { projectId: IDENTITY.projectId, suspension });
  const capturedPort = registry.captureCanvasReadPort(owner, binding);
  const executor = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: async () => ({ read: async () => structuredClone(SOURCE) }),
  });
  return { registry, owner, capturedPort, executor };
}

describe("canvas.read transport adapters", () => {
  it("reads a main-sealed production snapshot after Surface rotation with no renderer or disk fallback", async () => {
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
    let id = 0;
    const registry = createCanvasReadSurfaceRegistry({
      ownerAuthority,
      resolveProjectIdentity: async () => ({ ...IDENTITY }),
      randomId: () => `surface-${++id}`,
    });
    const suspension = registry.suspend(owner, { surfaceInstanceId: "surface-a" });
    const binding = await registry.commitCanvasRead(owner, { projectId: IDENTITY.projectId, suspension });
    const capturedSnapshots = createCapturedCanvasReadSnapshotRegistry({
      ownerAuthority,
      randomId: () => `captured-${++id}`,
    });
    const handle = capturedSnapshots.seal({
      owner,
      binding,
      selection: registry.getCommittedProjectSelection()!,
      snapshot: CAPTURED_SOURCE,
    });
    const capturedPort = capturedSnapshots.consume({ owner, handle, projectId: IDENTITY.projectId });
    const readDisk = vi.fn();
    const executor = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: createCanvasReadPortResolver({
        capturedSnapshots,
        disk: { resolveProjectIdentity: async () => ({ ...IDENTITY }), readCanvas: readDisk },
      }),
    });
    const dispose = vi.fn(() => capturedSnapshots.release(capturedPort));
    const adapter = createCapturedPiCanvasReadTransportAdapter({
      registry: capturedSnapshots,
      capturedPort,
      requestId: "request-captured",
      executor,
      dispose,
    });
    registry.suspend(owner, { surfaceInstanceId: "surface-b" });

    await expect(
      adapter.tryExecute(
        {
          toolCallId: "tool-captured",
          toolName: CANVAS_READ_CAPABILITY.aliases.pi,
          args: {},
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      ok: true,
      result: formatCanvasForAgent(canvasReadResultSchema.parse(CAPTURED_SOURCE)),
      silent: true,
    });
    expect(readDisk).not.toHaveBeenCalled();
    adapter.dispose();
    adapter.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    await expect(
      adapter.tryExecute(
        {
          toolCallId: "tool-after-cleanup",
          toolName: CANVAS_READ_CAPABILITY.aliases.pi,
          args: {},
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      ok: false,
      code: "surface_port_stale",
      message: "surface_port_stale",
    });
  });

  it("routes only the Pi canvas alias through the exact invocation and compact shared formatter", async () => {
    const test = await piHarness();
    const adapter = createPiCanvasReadTransportAdapter({
      registry: test.registry,
      capturedPort: test.capturedPort,
      requestId: "request-1",
      executor: test.executor,
    });

    await expect(
      adapter.tryExecute(
        {
          toolCallId: "tool-1",
          toolName: CANVAS_READ_CAPABILITY.aliases.pi,
          args: {},
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      ok: true,
      result: formatCanvasForAgent({
        nodes: [
          {
            id: "node-a",
            kind: "image",
            title: "A",
            prompt: "draw A",
            status: "success",
            position: { x: 1, y: 2 },
            locked: false,
            hasResult: true,
            currentResultId: "result-a",
            resultIds: ["result-a"],
          },
        ],
        edges: [],
        groups: [],
        selectedNodeIds: ["node-a"],
      }),
      silent: true,
    });
    await expect(
      adapter.tryExecute(
        {
          toolCallId: "tool-2",
          toolName: "set_node_prompt",
          args: {},
        },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });

  it("returns a stable Pi failure code after Surface rotation without raw causes or disk fallback", async () => {
    const test = await piHarness();
    const adapter = createPiCanvasReadTransportAdapter({
      registry: test.registry,
      capturedPort: test.capturedPort,
      requestId: "request-1",
      executor: test.executor,
    });
    test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });

    await expect(
      adapter.tryExecute(
        {
          toolCallId: "tool-1",
          toolName: CANVAS_READ_CAPABILITY.aliases.pi,
          args: {},
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      ok: false,
      code: "surface_port_stale",
      message: "surface_port_stale",
    });
  });

  it("keeps the internal adapter thin over bearer mint and the same executor", async () => {
    const factory = createInternalCanvasReadVerifiedInvocationFactory({
      verifyBearer: (bearer) => bearer === "secret",
      resolveProjectIdentity: async () => ({ ...IDENTITY }),
      randomId: () => "operation-1",
    });
    const executor = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: async () => ({ read: async () => structuredClone(SOURCE) }),
    });
    const adapter = createInternalCanvasReadTransportAdapter({ factory, executor });

    await expect(
      adapter.execute({
        bearer: "secret",
        requestBody: { projectId: IDENTITY.projectId },
      }),
    ).resolves.toMatchObject({ nodes: [{ id: "node-a" }] });
    await expect(
      adapter.execute({
        bearer: "wrong",
        requestBody: { projectId: IDENTITY.projectId },
      }),
    ).rejects.toMatchObject({ code: "capability_authority_invalid" });
  });
});
