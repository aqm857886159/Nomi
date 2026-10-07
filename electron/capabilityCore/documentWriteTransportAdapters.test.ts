import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_WRITE_ALIASES } from "../shared/agentCapabilities/documentWrite";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createPiDocumentWriteTransportAdapter } from "./documentWriteTransportAdapters";
import { MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE } from "../shared/agentCapabilities/verbDeclaration";

async function setup(write = vi.fn(async (_input: unknown) => ({ applied: true, revision: 2, contentHash: "fnv1a-next" }))) {
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
  const session = registry.openProjectSession(owner, binding.binding);
  const executor = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
    resolveDocumentWritePort: async () => ({ write }),
  });
  return {
    adapter: createPiDocumentWriteTransportAdapter({ registry, session, requestId: "request-a", executor }),
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

  // 用户站在画布上（回合 target 是 canvas）：文稿写落到整篇，不再当成「目标陈旧」拒掉。
  it("addresses the whole document when the turn's target is another surface", async () => {
    const test = await setup();
    const prepared = await test.adapter.prepare(
      { toolCallId: "tool", toolName: DOCUMENT_WRITE_ALIASES.append, args: { content: "x" } },
      { documentId: "document-a", target: { kind: "canvas", nodeIds: [] }, preconditions: { document: { revision: 1 } } },
      new AbortController().signal,
    );
    expect(prepared?.invocation.target).toEqual({ kind: "document", documentId: "document-a", anchor: { kind: "whole-document" } });
  });

  it("fails closed for a document target of another document and after disposal", async () => {
    const test = await setup();
    await expect(test.adapter.prepare(
      { toolCallId: "tool", toolName: DOCUMENT_WRITE_ALIASES.append, args: { content: "x" } },
      { documentId: "document-a", target: { kind: "document", documentId: "document-b", anchor: { kind: "whole-document" } }, preconditions: {} },
      new AbortController().signal,
    )).rejects.toMatchObject({ message: "capability_input_invalid" });
    test.adapter.dispose();
    await expect(test.adapter.execute({} as never, new AbortController().signal)).resolves.toEqual({
      ok: false,
      code: "surface_port_unavailable",
      message: "surface_port_unavailable",
    });
  });

  // NF-1001-0002（应用内反馈 NF-1001-0002）：渲染端落一份大稿子比 15 秒慢，但在写工具自己 60 秒的预算内。
  // 过去执行器另有 15 秒缺省，写已经开始就掐，报「结果没对上账」而稿子其实写进去了。改回 15 秒这条就红。
  describe("one owner for how long a write may take", () => {
    const prepare = async (test: Awaited<ReturnType<typeof setup>>) => test.adapter.prepare(
      { toolCallId: "tool-slow", toolName: DOCUMENT_WRITE_ALIASES.replace, args: { content: "a long script" } },
      { documentId: "document-a", target: { kind: "document", documentId: "document-a", anchor: { kind: "whole-document" } },
        preconditions: { document: { revision: 1, contentHash: "fnv1a-old" } } },
      new AbortController().signal,
    );
    const slowWrite = (ms: number) => vi.fn((_input: unknown) => new Promise<{ applied: true; revision: number; contentHash: string }>((resolve) => {
      setTimeout(() => resolve({ applied: true, revision: 2, contentHash: "fnv1a-next" }), ms);
    }));

    it("a write that lands after 20s but inside the declared write budget is a success, not unresolved", async () => {
      const test = await setup(slowWrite(20_000));
      const prepared = await prepare(test);
      vi.useFakeTimers();
      try {
        const decision = test.adapter.execute(prepared!, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(20_000);
        await expect(decision).resolves.toMatchObject({ ok: true, result: { applied: true, revision: 2 } });
      } finally { vi.useRealTimers(); }
    });

    it("a write that outlives the declared write budget is reported unresolved (it may have landed)", async () => {
      const test = await setup(slowWrite(MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE + 5_000));
      const prepared = await prepare(test);
      vi.useFakeTimers();
      try {
        const decision = test.adapter.execute(prepared!, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE + 1);
        await expect(decision).resolves.toMatchObject({ ok: false, code: "capability_receipt_unresolved" });
      } finally { vi.useRealTimers(); }
    });
  });
});
