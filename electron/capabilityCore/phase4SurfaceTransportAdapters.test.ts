import { describe, expect, it, vi } from "vitest";

import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createPiPhase4SurfaceTransportAdapter } from "./phase4SurfaceTransportAdapters";

async function setup() {
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
  const execute = vi.fn(async (invocation: { capability: { id: string }; input: unknown }, options: unknown) => ({
    capabilityId: invocation.capability.id,
    input: invocation.input,
    options,
  }));
  return {
    execute,
    adapter: createPiPhase4SurfaceTransportAdapter({
      registry,
      capturedPort,
      requestId: "request-a",
      executor: { execute } as never,
    }),
  };
}

describe("Phase 4 Surface Pi transports", () => {
  it("translates media and export reads into strict project-bound canonical invocations", async () => {
    const test = await setup();
    const signal = new AbortController().signal;

    await expect(test.adapter.tryExecuteRead({
      toolCallId: "media-a",
      toolName: "search_media",
      args: { query: "shot", kinds: ["video"], limit: 4 },
    }, signal)).resolves.toMatchObject({
      ok: true,
      result: {
        capabilityId: "asset.read",
        input: { operation: "search_media", query: "shot", kinds: ["video"], limit: 4 },
      },
    });
    expect(test.execute.mock.calls[0]?.[0]).toMatchObject({
      target: { kind: "asset", assetIds: [] },
      preconditions: {},
    });

    await expect(test.adapter.tryExecuteRead({
      toolCallId: "export-read-a",
      toolName: "inspect_export_job",
      args: { jobId: "job-a" },
    }, signal)).resolves.toMatchObject({
      ok: true,
      result: {
        capabilityId: "export.read",
        input: { operation: "inspect_export_job", jobId: "job-a" },
      },
    });
    expect(test.execute.mock.calls[1]?.[0]).toMatchObject({
      target: { kind: "export", jobId: "job-a" },
      preconditions: {},
    });

    await expect(test.adapter.tryExecuteRead({
      toolCallId: "invalid-a",
      toolName: "inspect_export_job",
      args: { jobId: "job-a", hidden: true },
    }, signal)).resolves.toMatchObject({ ok: false, code: "capability_input_invalid" });
    await expect(test.adapter.tryExecuteRead({
      toolCallId: "unknown-a",
      toolName: "unknown_tool",
      args: {},
    }, signal)).resolves.toBeNull();
  });

  it("freezes one export target before approval and forwards only exact Host approval authority", async () => {
    const test = await setup();
    const signal = new AbortController().signal;
    const prepared = await test.adapter.prepareWrite({
      toolCallId: "export-write-a",
      toolName: "export_timeline",
      args: { expectedRevision: "revision-a", resolution: "1080p", quality: "standard" },
    }, signal);
    expect(prepared?.invocation).toMatchObject({
      input: {
        operation: "export_timeline",
        expectedRevision: "revision-a",
        resolution: "1080p",
        quality: "standard",
      },
      target: { kind: "export", timelineRevision: "revision-a" },
      preconditions: { timeline: { revision: "revision-a" } },
    });
    const approval = {
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: prepared!.invocation.actionHash,
    };
    await expect(test.adapter.executeWrite(prepared!, approval, signal)).resolves.toMatchObject({
      ok: true,
      result: { capabilityId: "export.write" },
    });
    expect(test.execute).toHaveBeenLastCalledWith(prepared!.invocation, { signal, approval });
  });

  it("fails closed after disposal and on pre-cancelled preparation", async () => {
    const test = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(test.adapter.prepareWrite({
      toolCallId: "cancelled-a",
      toolName: "cancel_export_job",
      args: { jobId: "job-a" },
    }, controller.signal)).rejects.toMatchObject({ code: "capability_cancelled" });

    test.adapter.dispose();
    await expect(test.adapter.tryExecuteRead({
      toolCallId: "read-after-dispose",
      toolName: "inspect_export_job",
      args: { jobId: "job-a" },
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      code: "surface_port_unavailable",
    });
  });
});
