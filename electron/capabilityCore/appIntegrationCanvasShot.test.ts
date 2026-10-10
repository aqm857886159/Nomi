import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

// 画布付费生成的唯一口子（发动机收敛第一刀 第 1–4 步）。走真仓库、真 Run 服务、真收据机构、真提交出口；
// 只有画布那台的传输换成进程内的假供应商（canvasShotTestUtils）。
// 设计卡：docs/plan/2026-10-05-engine-convergence-cut1-step12-design-card.md、…-step34-design-card.md。

import { canvasProviderId } from "./canvasTransportProvider";
import { CANVAS_TEST_PROJECT as PROJECT, canvasTestRequest as request, setupCanvasShots } from "./canvasShotTestUtils";
import { canvasRunIdFor, openCanvasRuns } from "../productionRun/canvasShotRunIndex";
import { SubmissionReceiptUnknownError } from "../productionRun/submissionOutbox";
import { generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { VendorRequestError } from "../vendor/vendorHttp";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function setup(options: Parameters<typeof setupCanvasShots>[0] = {}) {
  const harness = setupCanvasShots(options);
  if (!options.root) roots.push(harness.root);
  return harness;
}

const runOf = (repository: ReturnType<typeof setup>["repository"], runRecordId: string) => repository.read(PROJECT, canvasRunIdFor(runRecordId));

const queued = (id: string) => async () => ({ id, kind: "text_to_image", status: "queued" as const, assets: [], raw: {} });

function rejection(): VendorRequestError {
  return new VendorRequestError("Provider request failed (HTTP 400): content policy", { vendorKey: "acme", method: "POST", url: "x", httpStatus: 400, upstreamMsg: "content policy", category: "input", retryable: false }, { httpStatus: 400, envelopeFailure: false, taskIdReturned: false });
}

describe("画布单节点 ↑ 经单镜 Run", () => {
  it("同步出图：一次点击 = 一个 Run、一份手势批准、一次交、出片记进 Run、收尾", async () => {
    const { repository, vendor, submit, root, receipts } = setup();

    const result = await submit("node-a", "run-node-a-1");

    expect(result).toMatchObject({ status: "succeeded", assets: [{ url: `nomi-local://asset/${PROJECT}/assets/out.png` }] });
    expect(vendor.executes).toHaveLength(1);
    expect(vendor.executes[0]).toEqual({ vendor: "acme", request: request("node-a") });
    const run = runOf(repository, "run-node-a-1")!;
    expect(run.origin.host).toBe("canvas");
    expect(run.status).toBe("completed");
    expect(run.jobs).toHaveLength(1);
    expect(run.jobs[0]).toMatchObject({ status: "ready", provider: canvasProviderId("acme"), providerTaskId: "task-sync-1" });
    expect(run.artifacts.find((artifact) => artifact.kind === "image")).toMatchObject({ projectRelativePath: "assets/out.png" });
    const approval = repository.readApprovals(PROJECT, run.runId)[0];
    expect(approval?.receiptId).toBeTruthy();
    // 收据一次写完：记在库里、已经用掉、是这个窗口批的（主进程手势）。
    expect(receipts.verifyReceipt(receipts.resolveReceiptToken(approval!.receiptId!))).toMatchObject({ decidedBy: "human:gesture", humanActor: "web_contents:7:1:app://nomi" });
    expect(openCanvasRuns(root)).toEqual([]);
    expect(repository.list(PROJECT)).toEqual([]);
  });

  it("受理后由渲染层查：每一次查都过 Run，出片那一次物化并收尾", async () => {
    const { repository, vendor, submit, runs } = setup();
    vendor.answer = queued("task-async");
    vendor.poll = (taskId, call) => call === 1
      ? { id: taskId, kind: "text_to_image", status: "running", assets: [], raw: {} }
      : { id: taskId, kind: "text_to_image", status: "succeeded", assets: [{ type: "image", url: `nomi-local://asset/${PROJECT}/assets/out.png` }], raw: {} };

    await expect(submit("node-a", "run-node-a-1")).resolves.toMatchObject({ id: "task-async", status: "queued" });
    expect(runOf(repository, "run-node-a-1")!.jobs[0]?.status).toBe("provider_accepted");

    await expect(runs.poll({ projectId: PROJECT, runRecordId: "run-node-a-1", senderId: 7 })).resolves.toMatchObject({ status: "running" });
    expect(runOf(repository, "run-node-a-1")!.jobs[0]?.status).toBe("polling");
    await expect(runs.poll({ projectId: PROJECT, runRecordId: "run-node-a-1", senderId: 7 })).resolves.toMatchObject({ status: "succeeded" });
    expect(runOf(repository, "run-node-a-1")).toMatchObject({ status: "completed", jobs: [{ status: "ready" }] });
    expect(vendor.executes).toHaveLength(1);
  });

  it("同一次意图重试（同一个运行记录号）：照 Run 账本回话，供应商只收到一次", async () => {
    const { vendor, submit } = setup();
    vendor.answer = queued("task-async");
    await submit("node-a", "run-node-a-1");
    await expect(submit("node-a", "run-node-a-1")).resolves.toMatchObject({ id: "task-async" });
    expect(vendor.executes).toHaveLength(1);
  });

  it("同一个运行记录号两次同时到（还没写盘）：第二次等第一次，供应商只收到一次", async () => {
    const { vendor, submit } = setup();
    vendor.answer = queued("task-async");
    const [first, second] = await Promise.all([submit("node-a", "run-node-a-1"), submit("node-a", "run-node-a-1")]);
    expect(first).toEqual(second);
    expect(vendor.executes).toHaveLength(1);
  });

  it("同一节点上一笔还在路上：第二次点击被拒（还在生成），别的节点照常", async () => {
    const { vendor, submit } = setup();
    vendor.answer = async () => ({ id: `task-${vendor.executes.length}`, kind: "text_to_image", status: "queued", assets: [], raw: {} });
    await submit("node-a", "run-node-a-1");
    await expect(submit("node-a", "run-node-a-2")).rejects.toMatchObject({ code: "node_generation_in_flight" });
    await expect(submit("node-b", "run-node-b-1")).resolves.toMatchObject({ status: "queued" });
    expect(vendor.executes.map((call) => call.request.extras?.nodeId)).toEqual(["node-a", "node-b"]);
  });

  it("同一节点两次点击同时到（还没写盘）：只交一笔", async () => {
    const { vendor, submit } = setup();
    vendor.answer = async () => ({ id: `task-${vendor.executes.length}`, kind: "text_to_image", status: "queued", assets: [], raw: {} });
    const outcomes = await Promise.allSettled([submit("node-a", "run-node-a-1"), submit("node-a", "run-node-a-2")]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(vendor.executes).toHaveLength(1);
  });

  it("供应商当场明确拒绝：原话回给节点、这一笔记成没花钱、节点可以再点（F3）", async () => {
    const { repository, vendor, submit, root } = setup();
    vendor.answer = async (call) => {
      if (call > 1) return { id: "task-ok", kind: "text_to_image", status: "succeeded", assets: [{ type: "image", url: `nomi-local://asset/${PROJECT}/assets/out.png` }], raw: {} };
      throw rejection();
    };

    await expect(submit("node-a", "run-node-a-1")).rejects.toBeInstanceOf(VendorRequestError);
    expect(runOf(repository, "run-node-a-1")!.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_rejected" });
    expect(openCanvasRuns(root)).toEqual([]);

    await expect(submit("node-a", "run-node-a-2", "a blue cube")).resolves.toMatchObject({ status: "succeeded" });
    expect(vendor.executes).toHaveLength(2);
  });

  it("写出去之后断了：结果没法确认，这个节点在核对前不许再点；重启后照样拦（F3 另一半）", async () => {
    const { repository, vendor, submit, root } = setup();
    vendor.answer = async () => { throw new Error("acme create failed: socket hang up"); };

    await expect(submit("node-a", "run-node-a-1")).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(runOf(repository, "run-node-a-1")!.jobs[0]?.status).toBe("submission_unknown");
    await expect(submit("node-a", "run-node-a-2")).rejects.toMatchObject({ code: "production_shot_claimed", reason: "needs_reconcile" });
    // 节点上指去核对：这一笔进任务中心「要你处理」（制作列表里只多它一个；收尾了的画布 Run 不进）。
    expect(repository.list(PROJECT).map((run) => run.runId)).toEqual([canvasRunIdFor("run-node-a-1")]);

    const restarted = setup({ root });
    await expect(restarted.submit("node-a", "run-node-a-3")).rejects.toMatchObject({ code: "production_shot_claimed", reason: "needs_reconcile" });
    expect(vendor.executes.length + restarted.vendor.executes.length).toBe(1);
  });

  it("3D-BOX 预演没好：主进程准入就拒，Run 都不建，一个字节不发", async () => {
    const { repository, vendor, submit, root } = setup({ previewBlock: "rendering" });
    await expect(submit("node-a", "run-node-a-1")).rejects.toMatchObject({ code: "director_preview_blocked", reason: "rendering" });
    expect(vendor.executes).toHaveLength(0);
    expect(runOf(repository, "run-node-a-1")).toBeNull();
    expect(openCanvasRuns(root)).toEqual([]);
  });

  it("受理之后渲染层不在了（重启）：打开项目把没收尾的那一笔交给观察者；点了停也交给观察者", async () => {
    const { vendor, submit, root, runs, observed } = setup();
    vendor.answer = queued("task-async");
    await submit("node-a", "run-node-a-1");
    runs.recoverOrphans(PROJECT);
    expect(observed).toEqual([]);

    const restarted = setup({ root });
    restarted.runs.recoverOrphans(PROJECT);
    expect(restarted.observed).toEqual([[PROJECT, canvasRunIdFor("run-node-a-1")]]);

    runs.release({ projectId: PROJECT, runRecordId: "run-node-a-1" });
    expect(observed).toHaveLength(1);
  });

  it("旧运行记录（没有 Run）：查询回 null，交给旧路找回", async () => {
    const { runs } = setup();
    await expect(runs.poll({ projectId: PROJECT, runRecordId: "run-legacy-1", senderId: 7 })).resolves.toBeNull();
  });
});

// ── 批量卡（「生成全部」、分镜整批、框选生成；发动机收敛第一刀第 3 步）──
// 一张批量卡 = 一份授权：卡上点了确认，卡上列出的每一镜各有一个单镜 Run、出价开着；轮到它才冻住请求、批、交。
describe("批量卡：一张卡一份授权，盖住卡上列出的镜", () => {
  it("点了确认什么都不发；轮到哪一镜交哪一镜，每一镜的结局读它自己的 Run", async () => {
    const { repository, vendor, consent, submit } = setup();
    consent([{ nodeId: "node-a", runRecordId: "run-a" }, { nodeId: "node-b", runRecordId: "run-b" }]);

    expect(vendor.executes).toHaveLength(0);
    expect(generationPresentationOutcome(runOf(repository, "run-a")!)).toMatchObject({ closedBy: "open", generating: [], undecided: [{ reason: "open" }] });

    await submit("node-a", "run-a");
    await submit("node-b", "run-b", "a blue cube");

    expect(vendor.executes.map((call) => call.request.prompt)).toEqual(["a red cube", "a blue cube"]);
    for (const id of ["run-a", "run-b"]) {
      const run = runOf(repository, id)!;
      expect(run.jobs).toHaveLength(1);
      expect(generationPresentationOutcome(run)).toMatchObject({ closedBy: "resolved", generating: [run.generationPlan!.candidate.candidateId], removed: [], undecided: [] });
    }
    // 冻进合同的是交的那一刻的请求（上游这一批刚出的参考也在里面），不是点确认时的那一份。
    expect(runOf(repository, "run-b")!.generationPlan!.contract!.parameters).toEqual({ vendor: "acme", request: request("node-b", "a blue cube") });
  });

  // 先落节点、再发请求（架构③）之后，画布单节点 Run 以来源节点为落点（origin.nodeId）。升级前那一版建的批量确认草稿没记它：
  // 不发、按「没交」收尾，但不能悄悄没了——画布那一镜如实说「升级后这批没有发出，需要重新确认」（协调会话 10-09）。
  it("升级前留下的批量确认（没记来源节点）：不发、收回出价，并带着「升级后没有发出」的码回给画布", async () => {
    const { repository, vendor, consent, submit } = setup();
    consent([{ nodeId: "node-a", runRecordId: "run-a" }]);
    const runId = canvasRunIdFor("run-a");
    // 模拟上一版写下的 Run：origin 里没有 nodeId。
    const read = repository.read.bind(repository);
    repository.read = ((projectId: string, id: string) => {
      const run = read(projectId, id);
      if (!run || id !== runId) return run;
      const { nodeId: _dropped, ...origin } = run.origin;
      return { ...run, origin };
    }) as typeof repository.read;

    await expect(submit("node-a", "run-a")).rejects.toMatchObject({ code: "canvas_consent_predates_upgrade" });

    expect(vendor.executes).toHaveLength(0);
    const after = read(PROJECT, runId)!;
    expect(after.jobs).toEqual([]);
    expect(generationPresentationOutcome(after)).toMatchObject({ generating: [], undecided: [{ reason: "stopped" }] });
  });

  it("reported case: 去掉一项就不发那一项——主进程拒交，供应商一次都收不到", async () => {
    const { repository, vendor, consent, withdraw, submit } = setup();
    consent([{ nodeId: "node-a", runRecordId: "run-a" }, { nodeId: "node-b", runRecordId: "run-b" }]);

    withdraw(["run-b"], "removed");

    await expect(submit("node-b", "run-b")).rejects.toMatchObject({ code: "canvas_generation_withdrawn" });
    await submit("node-a", "run-a");
    expect(vendor.executes.map((call) => call.request.extras?.nodeId)).toEqual(["node-a"]);
    const removed = runOf(repository, "run-b")!;
    expect(removed.jobs).toEqual([]);
    expect(generationPresentationOutcome(removed)).toMatchObject({ removed: [removed.generationPlan!.candidate.candidateId], generating: [] });
  });

  it("中途点 ×：已经交了的照常收完，还没轮到的一镜都不发", async () => {
    const { repository, vendor, consent, withdraw, submit, runs } = setup();
    vendor.answer = queued("task-a");
    consent([{ nodeId: "node-a", runRecordId: "run-a" }, { nodeId: "node-b", runRecordId: "run-b" }, { nodeId: "node-c", runRecordId: "run-c" }]);
    await submit("node-a", "run-a");

    withdraw(["run-a", "run-b", "run-c"], "user_closed");

    await expect(submit("node-b", "run-b")).rejects.toMatchObject({ code: "canvas_generation_withdrawn" });
    await expect(submit("node-c", "run-c")).rejects.toMatchObject({ code: "canvas_generation_withdrawn" });
    await expect(runs.poll({ projectId: PROJECT, runRecordId: "run-a", senderId: 7 })).resolves.toMatchObject({ status: "succeeded" });
    expect(vendor.executes).toHaveLength(1);
    expect(generationPresentationOutcome(runOf(repository, "run-b")!)).toMatchObject({ closedBy: "user_closed", undecided: [{ reason: "user_closed" }] });
  });

  it("× 之后再来一张卡（「继续」）：已经交出去的那一镜还在路上，不会再交一次", async () => {
    const { vendor, consent, withdraw, submit } = setup();
    vendor.answer = queued("task-a");
    consent([{ nodeId: "node-a", runRecordId: "run-a" }, { nodeId: "node-b", runRecordId: "run-b" }]);
    await submit("node-a", "run-a");
    withdraw(["run-a", "run-b"], "user_closed");

    consent([{ nodeId: "node-a", runRecordId: "run-a-2" }, { nodeId: "node-b", runRecordId: "run-b-2" }]);
    await expect(submit("node-a", "run-a-2")).rejects.toMatchObject({ code: "node_generation_in_flight" });
    await submit("node-b", "run-b-2");
    expect(vendor.executes.map((call) => call.request.extras?.nodeId)).toEqual(["node-a", "node-b"]);
  });

  it("关窗：这个窗口同意了、还没交的收回；重开项目后没人会再交的同意也收回", async () => {
    const { repository, vendor, consent, submit, runs, root } = setup();
    vendor.answer = queued("task-a");
    consent([{ nodeId: "node-a", runRecordId: "run-a" }, { nodeId: "node-b", runRecordId: "run-b" }]);
    await submit("node-a", "run-a");

    runs.releaseSender(7);
    await expect(submit("node-b", "run-b")).rejects.toMatchObject({ code: "canvas_generation_withdrawn" });
    expect(generationPresentationOutcome(runOf(repository, "run-b")!)).toMatchObject({ closedBy: "stopped" });

    // 重启：上一次进程里同意了、没来得及交的那一镜（没有窗口会再交它）。
    consent([{ nodeId: "node-c", runRecordId: "run-c" }], 9);
    const restarted = setup({ root });
    restarted.runs.recoverOrphans(PROJECT);
    expect(generationPresentationOutcome(runOf(repository, "run-c")!)).toMatchObject({ closedBy: "stopped" });
    await expect(restarted.submit("node-c", "run-c")).rejects.toMatchObject({ code: "canvas_generation_withdrawn" });
    expect(vendor.executes.length + restarted.vendor.executes.length).toBe(1);
  });

  it("批量里写出去之后断了：结果没法确认，重启后这个节点再来一张卡也不盲重发", async () => {
    const { repository, vendor, consent, submit, root } = setup();
    vendor.answer = async () => { throw new Error("acme create failed: socket hang up"); };
    consent([{ nodeId: "node-a", runRecordId: "run-a" }]);
    await expect(submit("node-a", "run-a")).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(runOf(repository, "run-a")!.jobs[0]?.status).toBe("submission_unknown");

    const restarted = setup({ root });
    restarted.consent([{ nodeId: "node-a", runRecordId: "run-a-2" }]);
    await expect(restarted.submit("node-a", "run-a-2")).rejects.toMatchObject({ code: "production_shot_claimed", reason: "needs_reconcile" });
    expect(vendor.executes.length + restarted.vendor.executes.length).toBe(1);
  });

  it("批量里供应商当场明确拒绝：这一镜没受理、没扣钱，下一张卡可以再生成它（F3）", async () => {
    const { repository, vendor, consent, submit } = setup();
    vendor.answer = async (call) => {
      if (call === 1) throw rejection();
      return { id: "task-ok", kind: "text_to_image", status: "succeeded", assets: [{ type: "image", url: `nomi-local://asset/${PROJECT}/assets/out.png` }], raw: {} };
    };
    consent([{ nodeId: "node-a", runRecordId: "run-a" }]);
    await expect(submit("node-a", "run-a")).rejects.toBeInstanceOf(VendorRequestError);
    expect(runOf(repository, "run-a")!.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_rejected" });
    expect(generationPresentationOutcome(runOf(repository, "run-a")!)).toMatchObject({ failedBeforeSending: [runOf(repository, "run-a")!.generationPlan!.candidate.candidateId] });

    consent([{ nodeId: "node-a", runRecordId: "run-a-2" }]);
    await expect(submit("node-a", "run-a-2")).resolves.toMatchObject({ status: "succeeded" });
    expect(vendor.executes).toHaveLength(2);
  });

  it("轮到的那一镜预演没好：主进程拒，这一镜的同意收回，一个字节不发", async () => {
    const { repository, vendor, consent, submit } = setup({ previewBlock: "failed" });
    consent([{ nodeId: "node-a", runRecordId: "run-a" }]);
    await expect(submit("node-a", "run-a")).rejects.toMatchObject({ code: "director_preview_blocked" });
    expect(vendor.executes).toHaveLength(0);
    expect(generationPresentationOutcome(runOf(repository, "run-a")!)).toMatchObject({ closedBy: "stopped", generating: [] });
  });

  it("同一个运行记录号不能开两份同意", () => {
    const { consent } = setup();
    consent([{ nodeId: "node-a", runRecordId: "run-a" }]);
    expect(() => consent([{ nodeId: "node-a", runRecordId: "run-a" }])).toThrow(/canvas_consent_duplicate/);
  });
});
