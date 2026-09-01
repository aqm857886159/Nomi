import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_READ_ALIASES } from "../shared/agentCapabilities/documentRead";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createPiDocumentReadTransportAdapter } from "./documentReadTransportAdapters";

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
  const read = vi.fn(async ({ scope }: { scope: "full" | "selection" }) => ({
    text: scope === "full" ? "full draft" : "selected text",
    path: "/private/editor-state",
  }));
  const executor = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
    resolveDocumentReadPort: async () => ({ read }),
  });
  return {
    adapter: createPiDocumentReadTransportAdapter({ registry, capturedPort, requestId: "request-a", executor }),
    read,
  };
}

describe("document.read Pi transport", () => {
  it.each([
    [DOCUMENT_READ_ALIASES.full, "full", "full draft"],
    [DOCUMENT_READ_ALIASES.selection, "selection", "selected text"],
  ] as const)("projects %s through one canonical executor", async (toolName, scope, text) => {
    const test = await setup();
    await expect(test.adapter.tryExecute(
      { toolCallId: `tool-${scope}`, toolName, args: {} },
      "document-a",
      new AbortController().signal,
    )).resolves.toEqual({ ok: true, result: { text }, silent: true });
    expect(test.read).toHaveBeenCalledWith(expect.objectContaining({ scope, signal: expect.any(AbortSignal) }));
  });

  it("does not claim unrelated aliases and fails closed after disposal", async () => {
    const test = await setup();
    await expect(test.adapter.tryExecute(
      { toolCallId: "tool-write", toolName: "append_to_end", args: {} },
      "document-a",
      new AbortController().signal,
    )).resolves.toBeNull();
    test.adapter.dispose();
    await expect(test.adapter.tryExecute(
      { toolCallId: "tool-read", toolName: DOCUMENT_READ_ALIASES.full, args: {} },
      "document-a",
      new AbortController().signal,
    )).resolves.toEqual({ ok: false, code: "surface_port_unavailable", message: "surface_port_unavailable" });
  });
});
