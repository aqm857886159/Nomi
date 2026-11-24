import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { executeAssetReadTarget, executeExportWriteTarget } from "./phase4CapabilityTargets";

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
    projectId: "project-a",
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

describe("Phase 4 waveform deadline and cancellation", () => {
  const asset = {
    id: "asset-a", projectId: "project-a", name: "clip.mp4",
    data: { mediaType: "video", url: "nomi-local://project-a/clip.mp4" },
  };
  const page = { items: [asset], cursor: null };
  const assetRequest = {
    projectId: "project-a",
    input: { operation: "read_waveform", assetId: "asset-a", buckets: 2 },
    target: { kind: "asset", assetIds: ["asset-a"] },
  };
  const list = vi.fn();
  const fetchMedia = vi.fn();
  const decodeAudioData = vi.fn();
  const close = vi.fn();
  const response = () => new Response(new Uint8Array([1]));

  beforeEach(() => {
    vi.useFakeTimers();
    list.mockReset().mockResolvedValue(page);
    fetchMedia.mockReset().mockImplementation(async () => response());
    decodeAudioData.mockReset();
    close.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("window", { nomiDesktop: { assets: { list } } });
    vi.stubGlobal("fetch", fetchMedia);
    vi.stubGlobal("AudioContext", class {
      decodeAudioData = decodeAudioData;
      close = close;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["fetch", "body", "decode"])("cancels during %s before the clock advances", async (step) => {
    if (step === "fetch") fetchMedia.mockReturnValue(new Promise(() => undefined));
    if (step === "body") fetchMedia.mockResolvedValue({
      ok: true, headers: new Headers(), arrayBuffer: () => new Promise(() => undefined),
    });
    decodeAudioData.mockReturnValue(new Promise(() => undefined));
    close.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const request = { ...assetRequest, signal: controller.signal };
    const outcome = executeAssetReadTarget(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMedia).toHaveBeenCalledOnce();
    expect(decodeAudioData).toHaveBeenCalledTimes(step === "decode" ? 1 : 0);
    controller.abort(new Error("stopped"));
    expect((fetchMedia.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(step === "decode" ? 1 : 0);
    await expect(outcome).resolves.toBe(controller.signal.reason);
  });

  it("bounds pagination, fetch and decode with one deadline", async () => {
    const wait = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(resolve, ms, value));
    list.mockImplementation(() => wait(8_000, page));
    fetchMedia.mockImplementation(() => wait(12_000, response()));
    decodeAudioData.mockReturnValue(new Promise(() => undefined));
    const rejected = vi.fn();
    const outcome = executeAssetReadTarget(assetRequest).catch(rejected);
    await vi.advanceTimersByTimeAsync(25_999);
    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: "TimeoutError" }));
    expect((fetchMedia.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    await outcome;
  });

  it("stops paginating after expiry, even if an in-flight page eventually resolves", async () => {
    let finishPage!: () => void;
    list.mockReturnValue(new Promise((resolve) => {
      finishPage = () => resolve({ ...page, cursor: "next" });
    }));
    const rejected = vi.fn();
    const outcome = executeAssetReadTarget(assetRequest).catch(rejected);
    await vi.advanceTimersByTimeAsync(26_000);
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: "TimeoutError" }));
    finishPage();
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledOnce();
    expect(fetchMedia).not.toHaveBeenCalled();
    await outcome;
  });

  it("returns sampled values for a slow read that still fits the combined budget", async () => {
    fetchMedia.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(response()), 16_000)));
    decodeAudioData.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({
      duration: 1, sampleRate: 4, length: 4, numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.25, -0.75, 0, 1]),
    }), 8_000)));
    const outcome = executeAssetReadTarget(assetRequest);
    await vi.advanceTimersByTimeAsync(24_000);
    await expect(outcome).resolves.toMatchObject({
      operation: "read_waveform",
      buckets: [{ peak: 0.75, rms: 0.559 }, { peak: 1, rms: 0.7071 }],
    });
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
