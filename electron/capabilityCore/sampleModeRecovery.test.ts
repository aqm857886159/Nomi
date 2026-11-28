import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorld, type World } from "../../tests/world";
import { makeApiKeyRecordFromPlain } from "../catalog/secrets";
import { installFetchCapture, type FetchCapture } from "../parity/generationParityTestUtils";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import { resetFingerprintCacheForTests } from "../vendor/fingerprintCache";
import { taskCache } from "../tasks/taskCache";
import { CANVAS_TEST_PROJECT as projectId, setupCanvasShots } from "./canvasShotTestUtils";
import { createRunObservationDrivers } from "./appIntegrationRunObservation";
import { lazyCanvasTransport, type CanvasTaskResult } from "./canvasTransportProvider";
import type { TaskResultDto } from "../../src/workbench/api/taskApi";
import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { appendNodeResultVersion } from "../../src/workbench/generationCanvas/model/nodeResultLifecycle";
import { finalsMadeFrom, isSampleFinalResult, sampleExpiry, sampleFactsOf, sampleFinalExecutionNode, sampleRowOf } from "../../src/workbench/generationCanvas/model/sampleFacts";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { normalizeCatalogTaskResults } from "../../src/workbench/generationCanvas/runner/catalogTaskResultParse";

vi.mock("electron", async () => {
  const { electronStub } = await import("../parity/parityElectronMock");
  const { tmpdir } = await import("node:os");
  return electronStub(tmpdir());
});

// 媒体下载与探测的边界。提交、查询、回执、观察者、找回和节点版本都走生产入口。
vi.mock("../assets/projectAssetStore", async (original) => ({
  ...await original<typeof import("../assets/projectAssetStore")>(),
  importRemoteAsset: async ({ url }: { url: string }) => {
    const file = path.basename(new URL(url).pathname);
    fs.writeFileSync(path.join(world.rootDir, "assets", file), file);
    return { id: file, data: { url: `nomi-local://asset/${projectId}/assets/${file}`, durationSeconds: 5.25 } };
  },
}));

const vendor = "apimart";
const modelKey = "doubao-seedance-2.5-sample";
const meta = { modelVendor: vendor, modelKey, archetype: { id: "seedance-2.5-apimart-sample", modeId: "t2v" }, duration: 5 };
const nodeId = "sample-node";
let world: World;
let restore: () => void;
let upstream: FetchCapture;
let queryState: "complete" | "polling" | "missing" = "complete";

beforeEach(() => {
  const now = new Date().toISOString();
  world = buildWorld({ projects: [], encryptedApiKeys: { apimart: makeApiKeyRecordFromPlain("sample-mode-fixture", vendor, true, now, now) } });
  restore = world.activate();
  upstream = installFetchCapture();
  queryState = "complete";
  let orders = 0;
  upstream.respondWith(({ method, url }) => {
    const route = new URL(url).pathname;
    if (method === "POST" && route === "/v1/videos/generations")
      return { status: 200, payload: { code: 200, data: [{ task_id: `sample-order-${++orders}`, status: "submitted" }] } };
    if (method !== "GET" || !route.startsWith("/v1/tasks/")) throw new Error(`Unexpected ${method} ${route}`);
    const id = path.basename(route);
    return { status: 200, payload: { code: 200, data: { id, status: queryState === "polling" ? "processing" : "completed",
      credits_cost: id === "sample-order-1" ? 3 : 9,
      result: { videos: queryState === "missing" ? [] : [{ url: [`https://media.example/${id}.mp4`] }] },
    } } };
  });
});

afterEach(() => { upstream.restore(); restore(); world.cleanup(); });

function restart() {
  taskCache.clear();
  resetFingerprintCacheForTests();
  const host = setupCanvasShots({ root: world.rootDir, vendorKey: vendor, transport: lazyCanvasTransport(),
    observe: (submission, project, runId) => driver.observeSingleShotRun(
      submission as Parameters<typeof driver.observeSingleShotRun>[0], project, runId),
  });
  const driver: ReturnType<typeof createRunObservationDrivers> = createRunObservationDrivers({ repository: host.repository, buildSchedulerForRun: () => null });
  return host;
}

type Host = ReturnType<typeof setupCanvasShots>;
const posts = () => upstream.calls.filter(call => call.method === "POST");
const poll = (h: Host, runRecordId: string) => h.runs.poll({ projectId, runRecordId, senderId: h.senderId });
const node = () => ({ ...createGenerationNode({ id: nodeId, kind: "video", prompt: "灯塔" }), meta });
function submit(h: Host, runRecordId: string, request: ReturnType<typeof buildCatalogTaskRequest>["request"], resendDecisionId?: string) {
  return h.runs.submit({ projectId, runRecordId, nodeId, gesture: h.gesture, senderId: h.senderId, vendor,
    request: { ...request, extras: { ...request.extras, projectId } }, resendDecisionId });
}
function land(current: ReturnType<typeof node>, receipt: CanvasTaskResult | null) {
  expect(receipt?.status).toBe("succeeded");
  const [result] = normalizeCatalogTaskResults(receipt as TaskResultDto, current);
  return { ...current, ...appendNodeResultVersion(current, result) };
}
async function makeSample(h: Host) {
  const current = node();
  const { request } = buildCatalogTaskRequest(current);
  const accepted = await submit(h, "draft", request);
  expect(posts().map(call => call.body)).toEqual([expect.objectContaining({ resolution: "480p", draft: true })]);
  h.runs.releaseSender(h.senderId);
  await vi.waitFor(() => expect(h.settled.map(n => n.runRecordId)).toContain("draft"));
  const settled = await poll(h, "draft");
  const online = land(current, settled);
  const fresh = restart();
  const recovered = await poll(fresh, "draft");
  expect(recovered).toEqual(settled);
  expect(await submit(fresh, "draft", request)).toEqual(settled);
  const restored = land(current, recovered);
  const sample = sampleFactsOf(restored, restored.result)!;
  expect(sample).toEqual(sampleFactsOf(online, online.result));
  expect(sample).toMatchObject({ vendorKey: vendor, modelKey, draftTaskId: accepted.id,
    createdAt: restored.result.provenance!.timestamp, extras: { ...JSON.parse(JSON.stringify(request.extras)), projectId } });
  expect(restored.result).toMatchObject({ durationSeconds: 5.25, provenance: { cost: { amount: 3, currency: "credits", unit: "actual" } } });
  expect(sampleRowOf(restored)?.sample).toEqual(sample);
  expect(sampleExpiry(sample.createdAt, sample.archetype.sampleOf.spec.ttlHours, sample.createdAt + 1)).toMatchObject({ kind: "days", count: 2 });
  expect(posts()).toHaveLength(1);
  const final = { draftTaskId: sample.draftTaskId, resolution: "1080p" };
  const execution = sampleFinalExecutionNode(restored, sample, final);
  return { fresh, restored, finalRequest: (id: string) => buildCatalogTaskRequest(execution, { idempotencyKey: id, sampleFinal: final }).request };
}

describe("样片和高清按原单找回", () => {
  it.each(["polling", "missing"] as const)("样片后台结案；高清在 %s 时重启，再点出高清附着原单", async (state) => {
    const { fresh, restored, finalRequest } = await makeSample(restart());
    const first = await submit(fresh, "hd", finalRequest("hd"));
    queryState = state;
    if (state === "missing") {
      fresh.runs.releaseSender(fresh.senderId);
      await vi.waitFor(() => expect(fresh.repository.read(projectId, canvasRunIdFor("hd"))?.jobs[0]?.errorCode).toBe("output_retrieval_failed"));
    } else {
      await poll(fresh, "hd");
      expect(fresh.repository.read(projectId, canvasRunIdFor("hd"))?.jobs[0]?.status).toBe("polling");
    }
    const next = restart();
    expect(await submit(next, "another-click", finalRequest("another-click"))).toMatchObject({ id: first.id });
    expect(posts()).toHaveLength(2);
    queryState = "complete";
    const complete = await poll(next, "another-click");
    const reboot = restart();
    expect(await poll(reboot, "hd")).toEqual(complete);
    const hd = land(restored, complete);
    expect(hd.result).toMatchObject({ versionNo: 2, durationSeconds: 5.25, provenance: { cost: { amount: 9, currency: "credits", unit: "actual" } } });
    expect(isSampleFinalResult(hd.result)).toBe(true);
    expect(finalsMadeFrom(hd, restored.result.taskId!)).toEqual([hd.result]);
    await expect(submit(reboot, "no-consent", finalRequest("no-consent"))).rejects.toMatchObject({ reason: "resend_confirmation_required" });
    expect(posts().map(call => call.body)).toEqual([expect.objectContaining({ draft: true }),
      { model: "seedance-2.5", draft_task_id: restored.result.taskId, resolution: "1080p" }]);
  });

  it("在同一会话确认再出高清，复用第二版且只付一笔高清", async () => {
    const { fresh, restored, finalRequest } = await makeSample(restart());
    await submit(fresh, "hd", finalRequest("hd"));
    const hd = land(restored, await poll(fresh, "hd"));
    await expect(submit(fresh, "repeat", finalRequest("repeat"))).rejects.toMatchObject({ reason: "resend_confirmation_required" });
    const confirmed = await submit(fresh, "confirmed", finalRequest("confirmed"), fresh.resendDecisionFor(nodeId));
    expect(posts()).toHaveLength(2);
    const reused = land({ ...hd, result: restored.result }, confirmed);
    expect(reused.result.id).toBe(hd.result.id);
    expect(reused.result.versionNo).toBe(2);
    expect(reused.history).toHaveLength(2);
  });
});
