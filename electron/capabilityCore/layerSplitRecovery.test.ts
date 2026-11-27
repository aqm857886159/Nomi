import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import { envelopeRefFor } from "../productionRun/productionGenerationBinding";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";
import type { TaskResultLayer } from "../shared/contracts/taskResultLayer";
import { createRunObservationDrivers } from "./appIntegrationRunObservation";
import { CANVAS_TEST_PROJECT as projectId, setupCanvasShots } from "./canvasShotTestUtils";
import type { CanvasShotRequest } from "./appIntegrationCanvasShot";
import type { CanvasTaskResult, CanvasTransport } from "./canvasTransportProvider";
import type { TaskResultDto } from "../../src/workbench/api/taskApi";
import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import {
  readLayerSplitMark,
  readWhiteboardEditingState,
} from "../../src/workbench/generationCanvas/nodes/whiteboard/whiteboardState";
import {
  landTaskResults,
  type LandTaskResultsDeps,
} from "../../src/workbench/generationCanvas/runner/landTaskResults";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const nodeId = "layer-split-node";
const projectBinding = { projectId, immutableProjectUuid: "uuid-layer-split", projectGeneration: 1 };
const url = (name: string) => `nomi-local://asset/${projectId}/assets/${name}`;

const SPLIT_LAYERS: TaskResultLayer[] = [
  { zIndex: 0, name: "底图" },
  { zIndex: 1, name: "标题字", text: "海边短片", box: { left: 0, top: 0, right: 1280, bottom: 360 } },
  { zIndex: 2, name: "人物", box: { left: 640, top: 360, right: 1920, bottom: 1440 } },
];

const splitPaidResult: CanvasTaskResult = {
  id: "split-order-1",
  kind: "image_edit",
  status: "succeeded",
  assets: [
    { type: "image", url: url("base.png"), width: 2560, height: 1440 },
    { type: "image", url: url("title.png"), width: 600, height: 300 },
    { type: "image", url: url("character.png"), width: 600, height: 500 },
  ],
  layers: SPLIT_LAYERS,
  provenance: {
    provider: "apimart",
    modelKey: "seedream-5-5",
    timestamp: 100,
    params: { layer_decomposition: true, layer_count: 30 },
    cost: { amount: 8.46, currency: "credits", unit: "actual" },
  },
  raw: { vendorTaskId: "split-order-1", layerCount: 3 },
};

const splitRequest: CanvasShotRequest = {
  kind: "image_edit",
  prompt: "",
  extras: {
    modelKey: "seedream-5-5",
    projectId,
    nodeId,
    archetype: { id: "seedream-5-5", modeId: "layers" },
    referenceImages: [url("source.png")],
  },
};

function landingDeps(over: Partial<LandTaskResultsDeps> = {}): LandTaskResultsDeps {
  return {
    renderBoard: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
    persist: vi.fn(async () => ({ url: url("composite.png"), previewState: "source" as const })),
    readImageSize: vi.fn(async (assetUrl: string) =>
      assetUrl.endsWith("base.png") ? { width: 2560, height: 1440 } : { width: 600, height: 300 },
    ),
    ...over,
  };
}

function createSplitFixture(result = splitPaidResult) {
  const post = vi.fn(async (id: string): Promise<CanvasTaskResult> => ({
    id,
    kind: result.kind,
    status: "queued",
    assets: [],
    raw: {},
  }));
  const fetchPayloads: Array<Record<string, unknown>> = [];
  const query = vi.fn((id: string): CanvasTaskResult => structuredClone({ ...result, id }));
  const transport: CanvasTransport = {
    execute: () => post(`split-order-${post.mock.calls.length + 1}`),
    fetchResult: async (payload) => {
      fetchPayloads.push(payload);
      return { result: query(String(payload.taskId)) };
    },
  };
  const driver: { current?: ReturnType<typeof createRunObservationDrivers> } = {};
  const host = setupCanvasShots({
    vendorKey: "apimart",
    transport,
    observe: (submission, project, runId) =>
      driver.current!.observeSingleShotRun(
        submission as Parameters<ReturnType<typeof createRunObservationDrivers>["observeSingleShotRun"]>[0],
        project,
        runId,
      ),
  });
  driver.current = createRunObservationDrivers({
    repository: host.service.repository,
    buildSchedulerForRun: () => null,
  });
  roots.push(host.root);
  for (const asset of result.assets) {
    fs.writeFileSync(path.join(host.root, "assets", path.basename(asset.url)), "png-bytes");
  }
  const restart = () => setupCanvasShots({ vendorKey: "apimart", root: host.root, transport });
  const submit = (h: ReturnType<typeof setupCanvasShots>, runRecordId: string) =>
    h.runs.submit({
      projectId,
      nodeId,
      runRecordId,
      vendor: "apimart",
      request: splitRequest,
      senderId: h.senderId,
      gesture: h.gesture,
    });
  const poll = (h: ReturnType<typeof setupCanvasShots>, runRecordId: string) =>
    h.runs.poll({ projectId, runRecordId, senderId: h.senderId });
  const envelope = (runRecordId: string) => {
    const record = host.repository.read(projectId, canvasRunIdFor(runRecordId))!;
    return JSON.parse(
      fs.readFileSync(path.join(host.root, envelopeRefFor(record.runId, record.jobs[0]!.jobId)), "utf8"),
    );
  };
  return { host, restart, post, query, fetchPayloads, submit, poll, envelope };
}

function assertLandedEditableWhiteboard(results: Awaited<ReturnType<typeof landTaskResults>>) {
  expect(results).toHaveLength(1);
  const [landed] = results;
  expect(readLayerSplitMark(landed)).toEqual({ layers: 3 });
  const node = createGenerationNode({ id: nodeId, kind: "image", prompt: "" });
  const state = readWhiteboardEditingState({ ...node, result: landed });
  expect(state).toBeDefined();
  expect(state!.layers.map((layer) => layer.name)).toEqual(["背景", "底图", "标题字", "人物"]);
  expect(state!.canvasAssets.map((asset) => asset.url)).toEqual([
    url("base.png"),
    url("title.png"),
    url("character.png"),
  ]);
  expect(state!.canvasAssets[1]).toMatchObject({ x: 0, y: 0, width: 640, height: 180 });
  expect(state!.canvasAssets[2]).toMatchObject({ x: 320, y: 180, width: 640, height: 540 });
}

describe("layer split paid result recovery", () => {
  it("preserves layers when background observer settles while window is closed (+0 extra POST)", async () => {
    const f = createSplitFixture();
    await f.submit(f.host, "bg-split");
    f.host.runs.releaseSender(f.host.senderId);
    await vi.waitFor(() =>
      expect(f.host.settled.map((entry) => entry.runRecordId)).toEqual(["bg-split"]),
    );

    const settled = (await f.poll(f.host, "bg-split"))!;
    expect(settled.layers).toEqual(SPLIT_LAYERS);
    expect(f.envelope("bg-split").settledResult.layers).toEqual(SPLIT_LAYERS);

    const node = createGenerationNode({ id: nodeId, kind: "image", prompt: "" });
    const landed = await landTaskResults(
      settled as unknown as TaskResultDto,
      node,
      projectBinding,
      undefined,
      landingDeps(),
    );
    assertLandedEditableWhiteboard(landed);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it("preserves layers and archetype modeId across app restart before and after settlement (+0 extra POST)", async () => {
    const f = createSplitFixture();
    await f.submit(f.host, "restart-split");
    // Restart while the task is still polling: fallback fetchResult must receive frozen archetype.modeId = "layers".
    const midFlight = f.restart();
    const polledAfterRestart = (await f.poll(midFlight, "restart-split"))!;
    expect(f.fetchPayloads[0]).toMatchObject({
      taskId: "split-order-1",
      vendor: "apimart",
      taskKind: "image_edit",
      modelKey: "seedream-5-5",
      projectId,
      archetype: { id: "seedream-5-5", modeId: "layers" },
    });
    expect(polledAfterRestart.layers).toEqual(SPLIT_LAYERS);

    // Restart a second time after snapshot commit: reads settledResult from disk without hitting upstream.
    const queryCallsBeforeSecondRestart = f.query.mock.calls.length;
    const coldRestart = f.restart();
    const replayed = await f.poll(coldRestart, "restart-split");
    expect(f.query).toHaveBeenCalledTimes(queryCallsBeforeSecondRestart);
    expect(replayed).toEqual(splitPaidResult);

    const node = createGenerationNode({ id: nodeId, kind: "image", prompt: "" });
    const landed = await landTaskResults(
      replayed as unknown as TaskResultDto,
      node,
      projectBinding,
      undefined,
      landingDeps(),
    );
    assertLandedEditableWhiteboard(landed);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it("recovers into an editable whiteboard on manual retrieve-again after initial composite landing failure (+0 extra POST)", async () => {
    const f = createSplitFixture();
    await f.submit(f.host, "retry-land");
    const online = await f.poll(f.host, "retry-land");
    const node = createGenerationNode({ id: nodeId, kind: "image", prompt: "" });

    // First landing attempt fails during local board composite render: marks recoverable, never fragments into 3 flat versions.
    let firstError: unknown;
    try {
      await landTaskResults(
        online as unknown as TaskResultDto,
        node,
        projectBinding,
        undefined,
        landingDeps({
          renderBoard: vi.fn(async () => {
            throw new Error("leafer temporary failure");
          }),
        }),
      );
    } catch (error) {
      firstError = error;
    }
    expect(matchNomiErrorCode((firstError as Error).message)).toBe("retrieval-download");

    // User clicks "重新取回" (even after restart): snapshot still carries layers, lands as 1 editable whiteboard, 0 new POSTs.
    const retrievedAgain = (await f.poll(f.restart(), "retry-land"))!;
    expect(retrievedAgain.layers).toEqual(SPLIT_LAYERS);
    const landed = await landTaskResults(
      retrievedAgain as unknown as TaskResultDto,
      node,
      projectBinding,
      undefined,
      landingDeps(),
    );
    assertLandedEditableWhiteboard(landed);
    expect(f.post).toHaveBeenCalledTimes(1);
  });
});
