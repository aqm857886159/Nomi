import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCanvasWriteAdmission, buildCanvasWriteAdmissionForOperation } from "../../../../electron/shared/agentCapabilities/canvasWriteEvidence";
import type { CanvasWriteInput } from "../../../../electron/shared/agentCapabilities/canvasWrite";
import type { GenerationCanvasSnapshot } from "../model/generationCanvasTypes";

const deps = vi.hoisted(() => ({
  applyProposalBatch: vi.fn(),
  createProposalReceiptCoordinator: vi.fn(() => ({
    prepare: vi.fn(),
    commit: vi.fn(),
    abort: vi.fn(),
    disposition: vi.fn(),
  })),
}));

vi.mock("./proposalTxn", () => ({ applyProposalBatch: deps.applyProposalBatch }));
vi.mock("./proposalUndo", () => ({ createProposalReceiptCoordinator: deps.createProposalReceiptCoordinator }));

import { captureCanvasWriteRawEvidence, executeCanvasWriteTarget } from "./canvasWriteTarget";

const executionGuard = {
  signal: new AbortController().signal,
  assertCurrent: vi.fn(),
};

function writableSnapshot(prompt = "old prompt", locked = false): GenerationCanvasSnapshot {
  return {
    nodes: [{
      id: "node-real",
      kind: "image",
      title: "Shot",
      position: { x: 0, y: 0 },
      prompt,
      locked,
    }],
    edges: [],
    selectedNodeIds: [],
    groups: [],
  };
}

beforeEach(() => {
  deps.applyProposalBatch.mockReset();
  deps.createProposalReceiptCoordinator.mockClear();
});

describe("canvas.write renderer evidence capture", () => {
  it("resolves an alias to the canonical node and excludes transient/provider state", () => {
    const snapshot: GenerationCanvasSnapshot = {
      nodes: [{
        id: "node-real",
        kind: "video",
        title: "Shot",
        position: { x: 10, y: 20 },
        size: { width: 300, height: 200 },
        prompt: "old prompt",
        locked: true,
        categoryId: "shots",
        groupId: "group-a",
        status: "running",
        progress: { updatedAt: 1, percent: 30 },
        meta: {
          modelKey: "seedance-2",
          modelVendor: "volcengine",
          archetype: { id: "seedance", modeId: "i2v", variantId: "pro" },
          unrelatedTransient: "do-not-copy",
        },
        result: {
          id: "result-a",
          type: "video",
          taskId: "task-a",
          assetId: "asset-a",
          assetRefId: "asset-ref-a",
          url: "nomi-local://mutable-localization",
          providerUrl: "https://provider.invalid/private",
          raw: { secret: true },
          createdAt: 1,
        },
      }],
      edges: [],
      selectedNodeIds: ["node-real"],
      groups: [{
        id: "group-a",
        name: "Shots",
        categoryId: "shots",
        nodeIds: ["node-real"],
        color: "red",
        collapsed: true,
        createdAt: 1,
        updatedAt: 2,
      }],
    };

    expect(captureCanvasWriteRawEvidence(snapshot, "client-alias", () => "node-real")).toEqual({
      node: {
        id: "node-real",
        kind: "video",
        title: "Shot",
        prompt: "old prompt",
        locked: true,
        categoryId: "shots",
        groupId: "group-a",
        model: {
          modelKey: "seedance-2",
          vendorKey: "volcengine",
          archetypeId: "seedance",
          modeId: "i2v",
          variantId: "pro",
        },
        currentResult: {
          id: "result-a",
          type: "video",
          taskId: "task-a",
          assetId: "asset-a",
          assetRefId: "asset-ref-a",
        },
      },
      groups: [{ id: "group-a", categoryId: "shots", nodeIds: ["node-real"] }],
    });
  });

  it("revalidates inside the transaction and passes exact Host receipt correlation", async () => {
    const snapshot = writableSnapshot();
    const admission = buildCanvasWriteAdmission(captureCanvasWriteRawEvidence(snapshot, "node-real"));
    deps.applyProposalBatch.mockImplementation(async (_steps, _turn, _coordinator, batchAdmission) => {
      batchAdmission.beforePrepare();
      return {
        status: "committed",
        proposalId: batchAdmission.proposalId,
        results: [{}],
        clientIdToNodeId: {},
        reconciliation: { ok: true, deviations: [] },
        compensation: [],
        watchNodes: [],
      };
    });

    await expect(executeCanvasWriteTarget({
      input: { operation: "set_node_prompt", nodeId: "node-real", prompt: "new prompt" },
      ...admission,
      receiptProposalId: "receipt-host-a",
      approvalId: "approval-host-a",
      actionHash: "a".repeat(64),
      ...executionGuard,
    }, () => snapshot)).resolves.toEqual({
      applied: true,
      proposalId: "receipt-host-a",
      operation: "set_node_prompt",
      affectedNodeIds: ["node-real"],
      reconciliation: { ok: true, deviationCount: 0 },
    });
    expect(deps.applyProposalBatch).toHaveBeenCalledOnce();
    expect(deps.createProposalReceiptCoordinator).toHaveBeenCalledWith(expect.objectContaining({
      hostApprovalId: "approval-host-a",
      hostActionHash: "a".repeat(64),
    }));
  });

  it("returns a committed domain result for storyboard-side aliases", async () => {
    const snapshot = writableSnapshot();
    const input: CanvasWriteInput = {
      operation: "create_camera_move",
      shotClientId: "node-real",
      move: "push_in",
    };
    const evidence = captureCanvasWriteRawEvidence(snapshot, { operation: input.operation, input });
    const admission = buildCanvasWriteAdmissionForOperation(evidence, input);
    deps.applyProposalBatch.mockImplementation(async (_steps, _turn, _coordinator, batchAdmission) => {
      batchAdmission.beforePrepare();
      return {
        status: "committed",
        proposalId: batchAdmission.proposalId,
        results: [{ cameraMoveNodeId: "camera-reference-1", targetNodeId: "node-real" }],
        clientIdToNodeId: {},
        reconciliation: { ok: true, deviations: [] },
        compensation: [],
        watchNodes: [],
      };
    });

    await expect(executeCanvasWriteTarget({
      input,
      ...admission,
      receiptProposalId: "receipt-camera",
      approvalId: "approval-camera",
      actionHash: "b".repeat(64),
      ...executionGuard,
    }, () => snapshot)).resolves.toEqual({
      applied: true,
      proposalId: "receipt-camera",
      operation: "create_camera_move",
      result: { cameraMoveNodeId: "camera-reference-1", targetNodeId: "node-real" },
      reconciliation: { ok: true, deviationCount: 0 },
    });
  });

  it.each([
    ["content", writableSnapshot("changed prompt")],
    ["lock", writableSnapshot("old prompt", true)],
  ])("rejects %s drift at the final boundary", async (_kind, current) => {
    const captured = writableSnapshot();
    const admission = buildCanvasWriteAdmission(captureCanvasWriteRawEvidence(captured, "node-real"));
    deps.applyProposalBatch.mockImplementation(async (_steps, _turn, _coordinator, batchAdmission) => {
      batchAdmission.beforePrepare();
      throw new Error("must not continue");
    });

    await expect(executeCanvasWriteTarget({
      input: { operation: "set_node_prompt", nodeId: "node-real", prompt: "new prompt" },
      ...admission,
      receiptProposalId: "receipt-host-a",
      approvalId: "approval-host-a",
      actionHash: "a".repeat(64),
      ...executionGuard,
    }, () => current)).rejects.toMatchObject({ code: "capability_target_stale" });
  });
});
