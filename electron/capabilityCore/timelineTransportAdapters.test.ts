import { describe, expect, it, vi } from "vitest";

import type { TimelineReadPort, TimelineWritePort } from "./capabilityExecutorRegistry";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import {
  createPiTimelineReadTransportAdapter,
  createPiTimelineWriteTransportAdapter,
} from "./timelineTransportAdapters";

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
  const read = vi.fn<TimelineReadPort["read"]>(async ({ input }) => {
    const semanticInput = input as { operation: string; startFrame?: number; endFrame?: number };
    if (semanticInput.operation === "inspect_timeline_range") {
      return {
        operation: semanticInput.operation,
        revision: "deadbeef",
        startFrame: semanticInput.startFrame,
        endFrame: semanticInput.endFrame,
        tracks: [],
        textClips: [],
      };
    }
    return {
      operation: "read_timeline",
      revision: "deadbeef",
      fps: 30,
      scale: 1,
      playheadFrame: 0,
      durationFrames: 0,
      valid: true,
      tracks: [],
      textClips: [],
      transitions: [],
    };
  });
  const write = vi.fn<TimelineWritePort["write"]>(async ({ input }) => ({
    operation: (input as { operation: "apply_edit_plan" | "undo_timeline_edit" }).operation,
    ok: true,
    revision: "cafebabe",
    applied: true,
    replayed: false,
    undoToken: "timeline-undo:v1:receipt-a",
  }));
  const executor = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
    resolveTimelineReadPort: async () => ({ read }),
    resolveTimelineWritePort: async () => ({ write }),
  });
  return {
    read,
    write,
    readAdapter: createPiTimelineReadTransportAdapter({ registry, capturedPort, requestId: "request-a", executor }),
    writeAdapter: createPiTimelineWriteTransportAdapter({ registry, capturedPort, requestId: "request-a", executor }),
  };
}

describe("timeline capability Pi transports", () => {
  it("auto-executes a strict read alias through one verified Timeline port", async () => {
    const test = await setup();
    const signal = new AbortController().signal;
    await expect(test.readAdapter.tryExecute({
      toolCallId: "tool-read",
      toolName: "inspect_timeline_range",
      args: { startFrame: 12, endFrame: 24 },
    }, signal)).resolves.toMatchObject({
      ok: true,
      result: { operation: "inspect_timeline_range", revision: "deadbeef" },
      silent: true,
    });
    expect(test.read).toHaveBeenCalledWith({
      input: { operation: "inspect_timeline_range", startFrame: 12, endFrame: 24 },
      target: { kind: "timeline", clipIds: [] },
      preconditions: {},
      signal: expect.any(AbortSignal),
    });
    await expect(test.readAdapter.tryExecute({
      toolCallId: "tool-invalid",
      toolName: "read_timeline",
      args: { hidden: true },
    }, signal)).resolves.toMatchObject({ ok: false, code: "capability_input_invalid" });
  });

  it("mints target/revision authority and rejects a forged approval before write dispatch", async () => {
    const test = await setup();
    const signal = new AbortController().signal;
    const plan = {
      planId: "plan-a",
      baseRevision: "deadbeef",
      summary: "Move clip A",
      operations: [{ kind: "move" as const, clipId: "clip-a", startFrame: 48 }],
    };
    const prepared = await test.writeAdapter.prepare({
      toolCallId: "tool-write",
      toolName: "apply_edit_plan",
      args: plan,
    }, signal);
    expect(prepared?.invocation.input).toEqual({ operation: "apply_edit_plan", ...plan });
    expect(prepared?.invocation.target).toEqual({ kind: "timeline", clipIds: ["clip-a"] });
    expect(prepared?.invocation.preconditions).toEqual({ timeline: { revision: "deadbeef" } });

    await expect(test.writeAdapter.execute(prepared!, {
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: "forged",
    }, signal)).resolves.toMatchObject({ ok: false, code: "capability_authority_invalid" });
    expect(test.write).not.toHaveBeenCalled();

    const approval = {
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: prepared!.invocation.actionHash,
    };
    await expect(test.writeAdapter.execute(prepared!, approval, signal)).resolves.toMatchObject({
      ok: true,
      result: { operation: "apply_edit_plan", revision: "cafebabe" },
    });
    expect(test.write).toHaveBeenCalledWith({
      input: prepared!.invocation.input,
      target: prepared!.invocation.target,
      preconditions: prepared!.invocation.preconditions,
      ...approval,
      signal: expect.any(AbortSignal),
    });

    test.write.mockResolvedValueOnce({
      operation: "apply_edit_plan",
      ok: true,
      revision: "cafebabe",
      planId: "plan-a",
      summary: "Move clip A",
      applied: false,
      replayed: true,
      validateOnly: true,
      baseRevision: "deadbeef",
      appliedOperationCount: 1,
      diagnostics: [],
      diff: { changed: true, totalEntryCount: 1, truncated: false, entries: [{ path: "$.tracks[0]", change: "changed" }] },
      undoToken: "timeline-undo:v1:receipt-a",
    });
    await expect(test.writeAdapter.execute(prepared!, approval, signal)).resolves.toMatchObject({
      ok: true,
      result: { operation: "apply_edit_plan", applied: false, replayed: true },
    });
  });

  it("fails closed on injected, nested, or operation-mismatched renderer results", async () => {
    const test = await setup();
    const signal = new AbortController().signal;
    const call = {
      toolCallId: "tool-read",
      toolName: "inspect_timeline_range",
      args: { startFrame: 0, endFrame: 24 },
    };
    test.read.mockResolvedValueOnce({
      operation: "inspect_timeline_range",
      revision: "deadbeef",
      startFrame: 0,
      endFrame: 24,
      tracks: [],
      textClips: [],
      path: "/private/project-a",
    });
    await expect(test.readAdapter.tryExecute(call, signal)).resolves.toMatchObject({
      ok: false,
      code: "capability_output_invalid",
    });

    test.read.mockResolvedValueOnce({
      operation: "inspect_timeline_range",
      revision: "deadbeef",
      startFrame: 0,
      endFrame: 24,
      tracks: [{ id: "video-track", type: "video", clips: [], url: "file:///private.mp4" }],
      textClips: [],
    });
    await expect(test.readAdapter.tryExecute(call, signal)).resolves.toMatchObject({
      ok: false,
      code: "capability_output_invalid",
    });

    test.read.mockResolvedValueOnce({
      operation: "read_timeline",
      revision: "deadbeef",
      fps: 30,
      scale: 1,
      playheadFrame: 0,
      durationFrames: 0,
      valid: true,
      tracks: [],
      textClips: [],
      transitions: [],
    });
    await expect(test.readAdapter.tryExecute(call, signal)).resolves.toMatchObject({
      ok: false,
      code: "capability_output_invalid",
    });

    const prepared = await test.writeAdapter.prepare({
      toolCallId: "tool-write",
      toolName: "apply_edit_plan",
      args: {
        planId: "plan-a",
        baseRevision: "deadbeef",
        summary: "Move clip A",
        operations: [{ kind: "move", clipId: "clip-a", startFrame: 48 }],
      },
    }, signal);
    test.write.mockResolvedValueOnce({
      operation: "apply_edit_plan",
      ok: true,
      revision: "cafebabe",
      applied: true,
      replayed: false,
      timeline: { url: "file:///private.mp4" },
    });
    await expect(test.writeAdapter.execute(prepared!, {
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: prepared!.invocation.actionHash,
    }, signal)).resolves.toMatchObject({ ok: false, code: "capability_output_invalid" });
  });
});
