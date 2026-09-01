import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  applyExport: vi.fn(),
  createCoordinator: vi.fn(),
  receipt: {
    disposition: vi.fn(),
    prepare: vi.fn(),
    commit: vi.fn(),
    abort: vi.fn(),
  },
}));

vi.mock("./exportToolCall", () => ({ applyExportToolCall: deps.applyExport }));
vi.mock("../../generationCanvas/agent/proposalUndo", () => ({
  createProposalReceiptCoordinator: deps.createCoordinator,
}));

import { SurfacePortWireError } from "../../../../electron/shared/surfacePortBinding";
import { useGenerationCanvasStore } from "../../generationCanvas/store/generationCanvasStore";
import { executeExportWriteTarget } from "./phase4CapabilityTargets";

const result = {
  operation: "export_timeline" as const,
  accepted: true as const,
  jobId: "job-a",
  backend: "filtergraph" as const,
  timelineRevision: "revision-a",
  durationFrames: 30,
  profile: { aspectRatio: "16:9" as const, resolution: "1080p" as const, quality: "standard" as const },
};

function request(assertCurrent: () => void = () => undefined) {
  return {
    input: { operation: "export_timeline", expectedRevision: "revision-a" },
    target: { kind: "export", timelineRevision: "revision-a" },
    receiptProposalId: "receipt-a",
    approvalId: "approval-a",
    actionHash: "a".repeat(64),
    signal: new AbortController().signal,
    assertCurrent,
  } as const;
}

function canvasBytes(): string {
  const state = useGenerationCanvasStore.getState();
  return JSON.stringify({
    nodes: state.nodes,
    edges: state.edges,
    groups: state.groups,
    selectedNodeIds: state.selectedNodeIds,
  });
}

beforeEach(() => {
  deps.applyExport.mockReset().mockResolvedValue(result);
  deps.receipt.disposition.mockReset().mockResolvedValue("missing");
  deps.receipt.prepare.mockReset().mockResolvedValue(true);
  deps.receipt.commit.mockReset().mockResolvedValue(true);
  deps.receipt.abort.mockReset().mockResolvedValue(undefined);
  deps.createCoordinator.mockReset().mockReturnValue(deps.receipt);
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] });
});

describe("Phase 4 Export renderer target", () => {
  it("uses an empty compensation receipt and never treats Export as Canvas Undo", async () => {
    const canvasNode = useGenerationCanvasStore.getState().addNode({
      kind: "image",
      title: "Unrelated Canvas work",
      prompt: "must survive",
    });
    const before = canvasBytes();

    await expect(executeExportWriteTarget(request())).resolves.toEqual(result);

    expect(deps.createCoordinator).toHaveBeenCalledWith(expect.objectContaining({
      hostApprovalId: "approval-a",
      hostActionHash: "a".repeat(64),
      prepareCompensation: "none",
    }));
    expect(deps.receipt.prepare).toHaveBeenCalledWith("receipt-a", { nodes: [], edges: [], groups: [] });
    expect(deps.receipt.commit).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: "receipt-a",
      compensation: [],
      watchNodes: [],
    }));
    expect(canvasBytes()).toBe(before);
    expect(useGenerationCanvasStore.getState().nodes[0]?.id).toBe(canvasNode.id);
  });

  it("aborts a prepared receipt with zero export effects when project rotation wins before effect start", async () => {
    let finishPrepare!: (value: boolean) => void;
    deps.receipt.prepare.mockReturnValueOnce(new Promise((resolve) => { finishPrepare = resolve; }));
    let live = true;
    const pending = executeExportWriteTarget(request(() => {
      if (!live) throw new SurfacePortWireError("surface_port_stale");
    }));
    await vi.waitFor(() => expect(deps.receipt.prepare).toHaveBeenCalledOnce());
    live = false;
    finishPrepare(true);

    await expect(pending).rejects.toMatchObject({ code: "surface_port_stale" });
    expect(deps.applyExport).not.toHaveBeenCalled();
    expect(deps.receipt.commit).not.toHaveBeenCalled();
    expect(deps.receipt.abort).toHaveBeenCalledWith("receipt-a");
  });

  it("keeps a post-effect failure ambiguous and refuses to start the Export a second time", async () => {
    let live = true;
    deps.applyExport.mockImplementationOnce(async () => {
      live = false;
      return result;
    });
    const guarded = request(() => {
      if (!live) throw new SurfacePortWireError("surface_port_stale");
    });

    await expect(executeExportWriteTarget(guarded)).rejects.toMatchObject({ code: "surface_port_stale" });
    expect(deps.applyExport).toHaveBeenCalledOnce();
    expect(deps.receipt.abort).not.toHaveBeenCalled();
    expect(deps.receipt.commit).not.toHaveBeenCalled();

    live = true;
    deps.receipt.disposition.mockResolvedValueOnce("preparing");
    await expect(executeExportWriteTarget(guarded)).rejects.toMatchObject({
      code: "capability_receipt_unresolved",
    });
    expect(deps.applyExport).toHaveBeenCalledOnce();
  });

  it("leaves unrelated Canvas bytes unchanged while an interrupted Export receipt stays preparing", async () => {
    useGenerationCanvasStore.getState().addNode({ kind: "text", title: "Draft", prompt: "keep" });
    const before = canvasBytes();
    deps.receipt.disposition.mockResolvedValueOnce("preparing");

    await expect(executeExportWriteTarget(request())).rejects.toMatchObject({
      code: "capability_receipt_unresolved",
    });
    expect(deps.applyExport).not.toHaveBeenCalled();
    expect(deps.receipt.abort).not.toHaveBeenCalled();
    expect(canvasBytes()).toBe(before);
  });
});
