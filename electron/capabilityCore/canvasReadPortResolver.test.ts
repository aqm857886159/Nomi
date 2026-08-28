import { describe, expect, it, vi } from "vitest";

import { createMainCapabilityExecutorRegistry, type CanvasReadPort } from "./capabilityExecutorRegistry";
import { createCanvasReadPortResolver } from "./canvasReadPortResolver";
import {
  createCanvasReadSurfaceRegistry,
  createSurfaceOwnerAuthority,
} from "./canvasReadSurfaceRegistry";
import {
  createInternalCanvasReadVerifiedInvocationFactory,
  createRendererCanvasReadVerifiedInvocationFactory,
} from "./verifiedCapabilityInvocation";

const BASE_IDENTITY = {
  projectId: "project-a",
  immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
  projectGeneration: 1,
  canonicalRootPath: "/real/project-a",
  canonicalRootDigest: "root-a",
};

function surfaceHarness() {
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
    resolveProjectIdentity: async () => ({ ...BASE_IDENTITY }),
    randomId: () => `surface-${++id}`,
  });
  return {
    registry,
    owner,
    async commit() {
      const suspension = registry.suspend(owner, { surfaceInstanceId: "surface-1" });
      const binding = await registry.commitCanvasRead(owner, {
        projectId: BASE_IDENTITY.projectId,
        suspension,
      });
      return { binding, captured: registry.captureCanvasReadPort(owner, binding) };
    },
  };
}

async function internalInvocation(input: {
  resolveIdentity?: () => Promise<typeof BASE_IDENTITY>;
} = {}) {
  return createInternalCanvasReadVerifiedInvocationFactory({
    verifyBearer: () => true,
    resolveProjectIdentity: input.resolveIdentity ?? (async () => ({ ...BASE_IDENTITY })),
    randomId: () => "operation-1",
  }).mint({ bearer: "bearer", requestBody: { projectId: BASE_IDENTITY.projectId } });
}

describe("canvas.read port resolver", () => {
  it("chooses the exact committed renderer before execution and never touches disk", async () => {
    const surface = surfaceHarness();
    await surface.commit();
    const invocation = await internalInvocation();
    const rendererPort: CanvasReadPort = { read: async () => ({ nodes: [] }) };
    const createPort = vi.fn(() => rendererPort);
    const readDiskCanvas = vi.fn();
    const resolver = createCanvasReadPortResolver({
      surfaceRegistry: surface.registry,
      surfacePortRuntime: { createPort },
      disk: {
        resolveProjectIdentity: async () => ({ ...BASE_IDENTITY }),
        readCanvas: readDiskCanvas,
      },
    });

    await expect(resolver(invocation)).resolves.toBe(rendererPort);
    expect(createPort).toHaveBeenCalledOnce();
    expect(readDiskCanvas).not.toHaveBeenCalled();
  });

  it("uses a headless disk port only when no exact live Surface was selected", async () => {
    const invocation = await internalInvocation();
    const resolveProjectIdentity = vi.fn(async () => ({ ...BASE_IDENTITY }));
    const readCanvas = vi.fn(async () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }));
    const resolver = createCanvasReadPortResolver({ disk: { resolveProjectIdentity, readCanvas } });
    const port = await resolver(invocation);

    await expect(port.read({ signal: new AbortController().signal })).resolves.toEqual({
      nodes: [], edges: [], groups: [], selectedNodeIds: [],
    });
    expect(resolveProjectIdentity).toHaveBeenCalledTimes(2);
    expect(readCanvas).toHaveBeenCalledWith(BASE_IDENTITY.projectId);
  });

  it("does not fall back to disk after a selected renderer becomes unavailable", async () => {
    const surface = surfaceHarness();
    await surface.commit();
    const invocation = await internalInvocation();
    const readDiskCanvas = vi.fn();
    const resolver = createCanvasReadPortResolver({
      surfaceRegistry: surface.registry,
      surfacePortRuntime: {
        createPort: () => ({
          read: async () => {
            throw Object.assign(new Error("private renderer failure"), { code: "surface_port_unavailable" });
          },
        }),
      },
      disk: {
        resolveProjectIdentity: async () => ({ ...BASE_IDENTITY }),
        readCanvas: readDiskCanvas,
      },
    });
    const registry = createMainCapabilityExecutorRegistry({ resolveCanvasReadPort: resolver });

    await expect(registry.execute(invocation)).rejects.toMatchObject({ code: "surface_port_unavailable" });
    expect(readDiskCanvas).not.toHaveBeenCalled();
  });

  it("revalidates disk identity after reading and rejects a same-id generation replacement", async () => {
    let identity = { ...BASE_IDENTITY };
    const invocation = await internalInvocation({ resolveIdentity: async () => ({ ...identity }) });
    const resolver = createCanvasReadPortResolver({
      disk: {
        resolveProjectIdentity: async () => ({ ...identity }),
        readCanvas: async () => {
          identity = { ...identity, projectGeneration: identity.projectGeneration + 1 };
          return { nodes: [] };
        },
      },
    });
    const port = await resolver(invocation);

    await expect(port.read({ signal: new AbortController().signal })).rejects.toMatchObject({
      code: "project_binding_stale",
    });
  });

  it("never retargets a renderer invocation to disk when its captured port is unavailable", async () => {
    const surface = surfaceHarness();
    const { captured } = await surface.commit();
    const invocation = await createRendererCanvasReadVerifiedInvocationFactory({
      registry: surface.registry,
      capturedPort: captured,
      requestId: "request-1",
    }).mint({ toolCallId: "tool-1", input: {} });
    const readCanvas = vi.fn();
    const resolver = createCanvasReadPortResolver({
      disk: {
        resolveProjectIdentity: async () => ({ ...BASE_IDENTITY }),
        readCanvas,
      },
    });

    await expect(resolver(invocation)).rejects.toMatchObject({ code: "surface_port_unavailable" });
    expect(readCanvas).not.toHaveBeenCalled();
  });
});
