import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// 画布单镜一次出 N 张（张数 1–4）：主进程那一侧。画布那台交回 N 份已落盘的产物 → Run 账上 N 份、回给渲染层 N 份；
// 同一次意图重试（重放）、重开后再查，回的也是同样的 N 份；供应商只收到一次。
// 设计卡 docs/plan/2026-11-09-multi-result-landing.md ★9 第 2、4、6 条。

import { CANVAS_TEST_PROJECT as PROJECT, setupCanvasShots } from "./canvasShotTestUtils";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function setup(count: number) {
  const harness = setupCanvasShots();
  roots.push(harness.root);
  // 画布那台（runtime.runTask）已经把每一张落进项目：N 个本地文件、N 条 nomi-local 地址。
  const assets = Array.from({ length: count }, (_, index) => {
    const relative = `assets/multi-${index + 1}.png`;
    fs.writeFileSync(path.join(harness.root, relative), `png-${index + 1}`);
    return { type: "image", url: `nomi-local://asset/${PROJECT}/${relative}` };
  });
  return { ...harness, assets };
}

const jobArtifacts = (harness: ReturnType<typeof setup>, runRecordId: string) => {
  const run = harness.repository.read(PROJECT, canvasRunIdFor(runRecordId))!;
  const jobId = run.jobs[0]!.jobId;
  return run.artifacts.filter((artifact) => artifact.jobId === jobId);
};

describe("画布单镜一次出 N 张", () => {
  it.each([1, 2, 4])("同步出 %i 张：账上 N 份（号各不相同）、回话 N 份、供应商一次", async (count) => {
    const harness = setup(count);
    harness.vendor.answer = async () => ({ id: `task-multi-${count}`, kind: "text_to_image", status: "succeeded", assets: harness.assets, raw: {} });

    const result = await harness.submit("node-a", "run-a");

    expect(result.status).toBe("succeeded");
    expect(result.assets.map((asset) => asset.url)).toEqual(harness.assets.map((asset) => asset.url));
    const artifacts = jobArtifacts(harness, "run-a");
    expect(artifacts.map((artifact) => artifact.projectRelativePath)).toEqual(harness.assets.map((_, index) => `assets/multi-${index + 1}.png`));
    expect(new Set(artifacts.map((artifact) => artifact.artifactId)).size).toBe(count);
    // N=1 的号和以前一字不差。
    expect(artifacts[0]!.artifactId).toBe(`canvas-artifact-task-multi-${count}`);
    expect(harness.vendor.executes).toHaveLength(1);

    // 同一次意图重试（同一个运行记录号）：照账本回话，同样 N 份，不再交。
    const replayed = await harness.submit("node-a", "run-a");
    expect(replayed.assets.map((asset) => asset.url)).toEqual(harness.assets.map((asset) => asset.url));
    expect(harness.vendor.executes).toHaveLength(1);
  });

  it.each([1, 2, 4])("受理后由渲染层查出 %i 张：出片那一次落 N 份，之后再查回的也是这 N 份", async (count) => {
    const harness = setup(count);
    harness.vendor.answer = async () => ({ id: `task-async-${count}`, kind: "text_to_image", status: "queued", assets: [], raw: {} });
    harness.vendor.poll = (taskId) => ({ id: taskId, kind: "text_to_image", status: "succeeded", assets: harness.assets, raw: {} });

    await harness.submit("node-a", "run-a");
    const polled = await harness.runs.poll({ projectId: PROJECT, runRecordId: "run-a", senderId: harness.senderId });
    expect(polled?.assets.map((asset) => asset.url)).toEqual(harness.assets.map((asset) => asset.url));
    expect(jobArtifacts(harness, "run-a")).toHaveLength(count);

    // 已收尾的那一笔再查（重开项目、观察者已收完）：从账本复原，同样 N 份。
    const again = await harness.runs.poll({ projectId: PROJECT, runRecordId: "run-a", senderId: harness.senderId });
    expect(again?.assets.map((asset) => asset.url)).toEqual(harness.assets.map((asset) => asset.url));
    expect(harness.vendor.executes).toHaveLength(1);
  });
});
