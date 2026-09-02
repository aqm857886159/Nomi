import { describe, expect, it, vi } from "vitest";

import { CANVAS_WRITE_ALIASES } from "../shared/agentCapabilities/canvasWrite";
import type {
  CanvasWriteBatchRawEvidence,
  CanvasWriteRawEvidence,
} from "../shared/agentCapabilities/canvasWriteEvidence";
import { createMainCapabilityExecutorRegistry, type CanvasWritePort } from "./capabilityExecutorRegistry";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createPiCanvasWriteTransportAdapter } from "./canvasWriteTransportAdapters";
import { reprepareEffectiveCall } from "../projectAgentHost/projectAgentApprovalHelpers";

const RAW_EVIDENCE: CanvasWriteRawEvidence = {
  node: {
    id: "node-real",
    kind: "image",
    title: "Shot",
    prompt: "old prompt",
    locked: false,
    categoryId: "shots",
    groupId: null,
    model: { modelKey: "model-a", vendorKey: "vendor-a", archetypeId: null, modeId: null, variantId: null },
    currentResult: null,
  },
  groups: [],
};

async function setup(rawEvidence: unknown = RAW_EVIDENCE) {
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
  const capture = vi.fn(async () => structuredClone(rawEvidence));
  const write = vi.fn<CanvasWritePort["write"]>(async ({ input, receiptProposalId }) => {
    const operation = (input as { operation?: string }).operation;
    if (
      operation === "propose_storyboard_plan" ||
      operation === "arrange_storyboard_to_timeline" ||
      operation === "create_staging_reference" ||
      operation === "create_camera_move"
    ) {
      return {
        applied: true,
        proposalId: receiptProposalId,
        operation,
        result: { persisted: true, operation },
        reconciliation: { ok: true, deviationCount: 0 },
      };
    }
    return operation === "tidy_canvas"
      ? {
          applied: true,
          proposalId: receiptProposalId,
          operation: "tidy_canvas",
          affectedNodeIds: ["node-real"],
          categoryId: "shots",
          nodeCount: 1,
          reconciliation: { ok: true, deviationCount: 0 },
        }
      : {
          applied: true,
          proposalId: receiptProposalId,
          operation: "set_node_prompt",
          affectedNodeIds: ["node-real"],
          reconciliation: { ok: true, deviationCount: 0 },
        };
  });
  const port: CanvasWritePort = { capture, write };
  const executor = createMainCapabilityExecutorRegistry({
    resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
    resolveCanvasWritePort: async () => port,
  });
  return {
    capture,
    write,
    adapter: createPiCanvasWriteTransportAdapter({
      registry,
      capturedPort,
      requestId: "request-a",
      port,
      executor,
    }),
  };
}

describe("canvas.write Pi transport", () => {
  it("prepares tidy_canvas through the same verified write transport", async () => {
    const batchEvidence: CanvasWriteBatchRawEvidence = {
      nodes: [
        {
          id: "node-real",
          kind: "image",
          title: "Shot",
          prompt: "old",
          locked: false,
          categoryId: "shots",
          groupId: null,
          position: { x: 0, y: 0 },
          model: RAW_EVIDENCE.node.model,
          currentResult: null,
        },
      ],
      edges: [],
      groups: [],
      resolvedReferences: [],
    };
    const test = await setup(batchEvidence);
    const signal = new AbortController().signal;
    const prepared = await test.adapter.prepare(
      {
        toolCallId: "tool-tidy",
        toolName: "tidy_canvas",
        args: { categoryId: "shots" },
      },
      signal,
    );
    expect(test.capture).toHaveBeenCalledWith({
      operation: "tidy_canvas",
      input: { operation: "tidy_canvas", categoryId: "shots" },
      signal,
    });
    expect(prepared?.invocation.target).toEqual({ kind: "canvas", nodeIds: ["node-real"] });
    const approval = {
      receiptProposalId: "receipt-tidy",
      approvalId: "approval-tidy",
      actionHash: prepared!.invocation.actionHash,
    };
    await expect(test.adapter.execute(prepared!, approval, signal)).resolves.toMatchObject({
      ok: true,
      result: { operation: "tidy_canvas", proposalId: "receipt-tidy", categoryId: "shots", nodeCount: 1 },
    });
  });

  it("captures raw evidence before minting and dispatches one main-authorized write", async () => {
    const test = await setup();
    const signal = new AbortController().signal;
    const prepared = await test.adapter.prepare(
      {
        toolCallId: "tool-a",
        toolName: CANVAS_WRITE_ALIASES.setNodePrompt,
        args: { nodeId: "client-alias", prompt: "new prompt" },
      },
      signal,
    );

    expect(test.capture).toHaveBeenCalledWith({ operation: "set_node_prompt", nodeId: "client-alias", signal });
    expect(prepared?.invocation.input).toEqual({
      operation: "set_node_prompt",
      nodeId: "client-alias",
      prompt: "new prompt",
    });
    expect(prepared?.invocation.target).toEqual({ kind: "canvas", nodeIds: ["node-real"] });
    expect(prepared?.invocation.preconditions.nodes).toEqual([
      { nodeId: "node-real", contentHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/) },
    ]);

    const approval = {
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: prepared!.invocation.actionHash,
    };
    await expect(test.adapter.execute(prepared!, approval, signal)).resolves.toEqual({
      ok: true,
      result: {
        applied: true,
        proposalId: "receipt-a",
        operation: "set_node_prompt",
        affectedNodeIds: ["node-real"],
        reconciliation: { ok: true, deviationCount: 0 },
      },
      silent: true,
    });
    expect(test.write).toHaveBeenCalledWith({
      input: prepared!.invocation.input,
      target: prepared!.invocation.target,
      preconditions: prepared!.invocation.preconditions,
      ...approval,
      signal: expect.any(AbortSignal),
    });
  });

  it("routes storyboard-side aliases through the canonical approved write path", async () => {
    const batchEvidence: CanvasWriteBatchRawEvidence = {
      nodes: [
        {
          id: "node-real",
          kind: "video",
          title: "Shot",
          prompt: "old",
          locked: false,
          categoryId: "shots",
          groupId: null,
          position: { x: 0, y: 0 },
          model: RAW_EVIDENCE.node.model,
          currentResult: null,
        },
      ],
      edges: [],
      groups: [],
      resolvedReferences: [{ requestedId: "node-real", nodeId: "node-real" }],
    };
    const test = await setup(batchEvidence);
    const signal = new AbortController().signal;
    const prepared = await test.adapter.prepare(
      {
        toolCallId: "tool-camera",
        toolName: "create_camera_move",
        args: { shotClientId: "node-real", move: "push_in" },
      },
      signal,
    );
    expect(prepared?.invocation.target).toEqual({ kind: "canvas", nodeIds: ["node-real"] });
    const approval = {
      receiptProposalId: "receipt-camera",
      approvalId: "approval-camera",
      actionHash: prepared!.invocation.actionHash,
    };
    await expect(test.adapter.execute(prepared!, approval, signal)).resolves.toMatchObject({
      ok: true,
      result: {
        applied: true,
        operation: "create_camera_move",
        result: { persisted: true, operation: "create_camera_move" },
      },
    });
    expect(test.write).toHaveBeenCalledTimes(1);
  });

  it("re-prepares an approved generation card with vendor and variant fields", async () => {
    const batchEvidence: CanvasWriteBatchRawEvidence = {
      nodes: [
        {
          id: "node-real",
          kind: "video",
          title: "Shot",
          prompt: "old",
          locked: false,
          categoryId: "shots",
          groupId: null,
          position: { x: 0, y: 0 },
          model: { modelKey: null, vendorKey: null, archetypeId: null, modeId: null, variantId: null },
          currentResult: null,
        },
      ],
      edges: [],
      groups: [],
      resolvedReferences: [],
    };
    const test = await setup(batchEvidence);
    const signal = new AbortController().signal;
    const originalCall = {
      toolCallId: "tool-generation-card",
      toolName: "create_canvas_nodes",
      args: {
        summary: "Create a generation card",
        nodes: [{
          clientId: "video-1",
          kind: "video",
          title: "Shot",
          prompt: "original prompt",
          modelKey: "seedance-2",
          vendor: "kie",
          modelVendor: "kie",
          modeId: "t2v",
          variantId: "standard",
          params: { resolution: "720p" },
        }],
      },
    };
    const prepared = await test.adapter.prepare(originalCall, signal);
    expect(prepared).not.toBeNull();

    const editedArgs = {
      ...originalCall.args,
      nodes: [{ ...originalCall.args.nodes[0], prompt: "edited prompt", variantId: "fast" }],
    };
    const effective = await reprepareEffectiveCall(
      originalCall,
      { ok: true, effectiveArgs: editedArgs, overridesDelta: { nodes: editedArgs.nodes } },
      prepared!,
      (call) => test.adapter.prepare(call, signal),
    );

    expect(effective.ok).toBe(true);
    if (!effective.ok) return;
    expect(effective.call.args).toEqual(editedArgs);
    expect(effective.prepared.invocation.input).toMatchObject({
      operation: "create_canvas_nodes",
      nodes: editedArgs.nodes,
    });
    expect(test.capture).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed raw evidence and mismatched approval authority before execute dispatch", async () => {
    const malformed = await setup({ node: { id: "node-real" }, groups: [] });
    const signal = new AbortController().signal;
    await expect(
      malformed.adapter.prepare(
        {
          toolCallId: "tool-a",
          toolName: CANVAS_WRITE_ALIASES.setNodePrompt,
          args: { nodeId: "node-real", prompt: "new" },
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: "capability_input_invalid" });

    const test = await setup();
    const prepared = await test.adapter.prepare(
      {
        toolCallId: "tool-a",
        toolName: CANVAS_WRITE_ALIASES.setNodePrompt,
        args: { nodeId: "node-real", prompt: "new" },
      },
      signal,
    );
    await expect(
      test.adapter.execute(
        prepared!,
        {
          receiptProposalId: "receipt-a",
          approvalId: "approval-a",
          actionHash: "forged",
        },
        signal,
      ),
    ).resolves.toMatchObject({ ok: false, code: "capability_authority_invalid" });
    expect(test.write).not.toHaveBeenCalled();
  });
});
