import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_WRITE_ALIASES } from "../shared/agentCapabilities/documentWrite";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createPiDocumentWriteTransportAdapter } from "./documentWriteTransportAdapters";

async function setup() {
  const ownerAuthority = createSurfaceOwnerAuthority();
  const owner = ownerAuthority.capture({
    contents: {}, frame: {}, webContentsId: 1, processId: 2, frameRoutingId: 3, origin: "file://", isLive: () => true,
  });
  let sequence = 0;
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity: async () => ({
      projectId: "project-a",
      immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
      projectGeneration: 1,
      canonicalRootPath: "/private/project-a",
      canonicalRootDigest: "root-a",
    }),
    randomId: () => `id-${++sequence}`,
  });
  const suspension = registry.suspend(owner, { surfaceInstanceId: "surface-a" });
  const binding = await registry.commitCanvasRead(owner, { projectId: "project-a", suspension });
  const capturedPort = registry.captureCanvasReadPort(owner, binding);
  const write = vi.fn(async () => ({ applied: true, revision: 2, contentHash: "fnv1a-next" }));
  const executor = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
    resolveDocumentWritePort: async () => ({ write }),
  });
  return {
    adapter: createPiDocumentWriteTransportAdapter({ registry, capturedPort, requestId: "request-a", executor }),
    write,
  };
}

describe("document.write Pi transport", () => {
  it.each([
    [DOCUMENT_WRITE_ALIASES.insert, "insert"],
    [DOCUMENT_WRITE_ALIASES.replace, "replace"],
    [DOCUMENT_WRITE_ALIASES.append, "append"],
  ] as const)("prepares and executes %s through one canonical capability", async (toolName, operation) => {
    const test = await setup();
    const prepared = await test.adapter.prepare(
      { toolCallId: `tool-${operation}`, toolName, args: { content: "new text" } },
      {
        documentId: "document-a",
        target: { kind: "document", documentId: "document-a", anchor: { kind: "whole-document" } },
        preconditions: { document: { revision: 1, contentHash: "fnv1a-old" } },
      },
      new AbortController().signal,
    );
    expect(prepared?.invocation.input).toEqual({ operation, content: "new text" });
    await expect(test.adapter.execute(prepared!, new AbortController().signal)).resolves.toEqual({
      ok: true,
      result: { applied: true, revision: 2, contentHash: "fnv1a-next" },
      silent: true,
    });
    expect(test.write).toHaveBeenCalledWith(expect.objectContaining({ operation, content: "new text" }));
  });

  it("fails closed for a non-document target and after disposal", async () => {
    const test = await setup();
    await expect(test.adapter.prepare(
      { toolCallId: "tool", toolName: DOCUMENT_WRITE_ALIASES.append, args: { content: "x" } },
      { documentId: "document-a", target: { kind: "canvas", nodeIds: [] }, preconditions: {} },
      new AbortController().signal,
    )).rejects.toMatchObject({ message: "document_target_stale" });
    test.adapter.dispose();
    await expect(test.adapter.execute({} as never, new AbortController().signal)).resolves.toEqual({
      ok: false,
      code: "surface_port_unavailable",
      message: "surface_port_unavailable",
    });
  });
});

