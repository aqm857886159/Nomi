// 交给主进程观察者的那一笔收尾了 → 按这一次自己的运行记录号摇渲染层去收（它按号进这一镜的同一本账）。
// 真仓库、真 Run 服务（带事件旁路）、真提交出口、真观察者；只有画布那台的传输是进程内假供应商。
// 设计卡：docs/plan/2026-11-07-shot-result-ownership.md（修补轮）。渲染层那一半在 shotResultOwnership.test.ts。
import { describe, expect, it, vi } from "vitest";
import { CANVAS_TEST_PROJECT as PROJECT, canvasTestRequest, setupCanvasShots } from "./canvasShotTestUtils";
import { canvasRunIdFor, openCanvasRuns } from "../productionRun/canvasShotRunIndex";
import { observeSingleShotGeneration } from "../productionRun/singleShotGenerationObserver";
import { markSingleShotAttention, markSingleShotCompleted } from "../productionRun/singleShotRunLifecycle";
import type { CanvasTaskResult } from "./canvasTransportProvider";

const queued = (id: string) => async (): Promise<CanvasTaskResult> => ({ id, kind: "text_to_image", status: "queued", assets: [], raw: {} });
const notice = (runRecordId: string, nodeId = "node-a") => ({ projectId: PROJECT, immutableProjectUuid: "uuid-1", projectGeneration: 1, nodeId, runRecordId });

function harness(options: Parameters<typeof setupCanvasShots>[0] = {}) {
  const handed = new Map<string, unknown>();
  const h = setupCanvasShots({ ...options, observe: (submission, _projectId, runId) => { handed.set(runId, submission); } });
  /** 主进程观察者做的事（appIntegrationRunObservation 同一套）：查到结局 → 出片落进 Run 记完成 / 失败记需要处理。 */
  const observerFinishes = async (runRecordId: string) => {
    const runId = canvasRunIdFor(runRecordId);
    const result = await observeSingleShotGeneration({
      submission: handed.get(runId) as never,
      input: { projectId: PROJECT, operationId: runId },
      pollHorizonMs: 1, initialDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined,
    });
    if (result.nextAction === "completed") markSingleShotCompleted(h.service.repository, PROJECT, runId, { artifactId: result.materialized!.artifactId });
    else if (result.nextAction === "attention") markSingleShotAttention(h.service.repository, PROJECT, runId);
    return result.nextAction;
  };
  const resend = (runRecordId: string, acknowledged: string) => h.runs.submit({
    projectId: PROJECT, nodeId: "node-a", runRecordId, vendor: "acme", request: canvasTestRequest("node-a"),
    gesture: h.gesture, senderId: h.senderId, acknowledgedOpenRuns: [canvasRunIdFor(acknowledged)],
  });
  return { ...h, observerFinishes, resend };
}

describe("交给观察者的那一笔收尾了：按这一次自己的运行记录号摇渲染层", () => {
  it("用户确认再发之后，旧那笔的图晚到：摇一次，带它的项目身份、节点和它自己的号", async () => {
    const h = harness();
    h.vendor.answer = queued("task-a");
    await h.submit("node-a", "run-a");
    // 渲染层等满了、落可找回：交给观察者。
    h.runs.release({ projectId: PROJECT, runRecordId: "run-a" });
    h.vendor.answer = queued("task-c");
    await h.resend("run-c", "run-a");
    await expect(h.observerFinishes("run-a")).resolves.toBe("completed");
    expect(h.settled).toEqual([notice("run-a")]);
  });

  it("观察者停在「只差取回」：不摇（节点上那条本来就是可找回；摇了会和放手来回打转）", async () => {
    const h = harness();
    h.vendor.answer = queued("task-a");
    await h.submit("node-a", "run-a");
    h.runs.release({ projectId: PROJECT, runRecordId: "run-a" });
    const runId = canvasRunIdFor("run-a");
    markSingleShotAttention(h.service.repository, PROJECT, runId, h.repository.read(PROJECT, runId)!.jobs[0]!.jobId, { cause: new Error("HTTP 403 download expired") });
    h.runs.release({ projectId: PROJECT, runRecordId: "run-a" });
    h.runs.recoverOrphans(PROJECT);
    expect(h.settled).toEqual([]);
  });

  it("接住过的不再摇第二次（渲染层随后放手、打开项目都不再摇）", async () => {
    const h = harness();
    h.vendor.answer = queued("task-a");
    await h.submit("node-a", "run-a");
    h.runs.release({ projectId: PROJECT, runRecordId: "run-a" });
    await h.observerFinishes("run-a");
    await vi.waitFor(() => expect(openCanvasRuns(h.root, "node-a")).toEqual([]));
    h.runs.release({ projectId: PROJECT, runRecordId: "run-a" });
    h.runs.recoverOrphans(PROJECT);
    expect(h.settled).toEqual([notice("run-a")]);
  });

  it("渲染层自己等到的那一笔不摇（它手上已经有了）", async () => {
    const h = harness();
    h.vendor.answer = queued("task-a");
    await h.submit("node-a", "run-a");
    await expect(h.runs.poll({ projectId: PROJECT, runRecordId: "run-a", senderId: h.senderId })).resolves.toMatchObject({ status: "succeeded" });
    expect(h.settled).toEqual([]);
  });

  it("交给观察者之后用户点了「重新取回」：渲染层拿回驱动，收尾时不再摇一遍", async () => {
    const h = harness();
    h.vendor.answer = queued("task-a");
    await h.submit("node-a", "run-a");
    h.runs.release({ projectId: PROJECT, runRecordId: "run-a" });
    await expect(h.runs.poll({ projectId: PROJECT, runRecordId: "run-a", senderId: h.senderId })).resolves.toMatchObject({ status: "succeeded" });
    expect(h.settled).toEqual([]);
  });

  it("摇的时候没人接（没有窗口）：「没收尾」标记留着，打开项目再摇，接住了才删", async () => {
    let unavailable = true;
    const h = harness({ notifySettled: async () => { if (unavailable) throw new Error("renderer unavailable"); } });
    h.vendor.answer = queued("task-a");
    await h.submit("node-a", "run-a");
    h.runs.release({ projectId: PROJECT, runRecordId: "run-a" });
    await h.observerFinishes("run-a");
    await vi.waitFor(() => expect(h.settled).toEqual([notice("run-a")]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openCanvasRuns(h.root, "node-a").map((open) => open.runId)).toEqual([canvasRunIdFor("run-a")]);

    unavailable = false;
    h.runs.recoverOrphans(PROJECT);
    await vi.waitFor(() => expect(openCanvasRuns(h.root, "node-a")).toEqual([]));
    expect(h.settled).toEqual([notice("run-a"), notice("run-a")]);
  });
});
