import { createProductionRunService } from '../productionRun/productionRunService'
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 画布付费生成的唯一口子（发动机收敛第一刀 第 1–4 步）。走真仓库、真 Run 服务、真收据机构、真提交出口；
// 只有画布那台的传输换成进程内的假供应商（canvasShotTestUtils）。
// 设计卡：docs/plan/2026-10-05-engine-convergence-cut1-step12-design-card.md、…-step34-design-card.md。

import { canvasProviderId } from "./canvasTransportProvider";
import { CANVAS_TEST_PROJECT as PROJECT, canvasTestRequest as request, setupCanvasShots } from "./canvasShotTestUtils";
import { canvasRunIdFor, openCanvasRuns } from "../productionRun/canvasShotRunIndex";
import { SubmissionReceiptUnknownError } from "../productionRun/submissionOutbox";
import { generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { VendorRequestError } from "../vendor/vendorHttp";
import { matchNomiErrorCode, tagNomiError, type NomiErrorCode } from "../shared/nomiErrorCodes";
import { generatedMediaValidationError } from "../assets/generatedMediaDecode";
import { handOffToNetwork } from "../outboundDispatchEvidence";
import { SYNC_RESULT_URL, decodeFailed, download403, kindMismatch, outboundRefused } from "./resultLandingTestUtils";

// 结果落地门（assets/localizeTaskAsset）用真的：同步供应商的结果只在它那里落地，「答过了」的正证据也只有它挂得上。
// 只把它下面的落盘（projectAssetStore.importRemoteAsset）换成按剧本失败。
const importRemoteAsset = vi.hoisted(() => vi.fn());
vi.mock("../assets/projectAssetStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assets/projectAssetStore")>()),
  importRemoteAsset: (...args: unknown[]) => importRemoteAsset(...args),
}));
const { localizeTaskAsset } = await import("../assets/localizeTaskAsset");

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

// ── 同步供应商「答了、本机落地失败」（2026-10-28，设计卡 docs/plan/2026-10-28-sync-landing-not-unknown.md ★9）──
// 同步供应商的回答就是结果，结果在交的那一下（adapter.submit → runTask → localizeTaskAsset）里落地。回答 200 之后落地失败，
// 是「答过了、可能已扣」的确定结局：不锁、不说没拿到回复、不重发、预留不动，可以再点（再点 = 新的一笔）。

/** 同步供应商答了 200、结果在回答里：画布那台照 runTask 的做法当场落地（真的落地门），落盘那一步按剧本失败。 */
function answeredThenLandingFails(failure: unknown) {
  return async (): Promise<never> => {
    importRemoteAsset.mockRejectedValueOnce(failure);
    await localizeTaskAsset(PROJECT, SYNC_RESULT_URL, "image");
    throw new Error("the landing gate was expected to fail");
  };
}

const landed = (id = "task-ok") => ({ id, kind: "text_to_image", status: "succeeded" as const, assets: [{ type: "image", url: `nomi-local://asset/${PROJECT}/assets/out.png` }], raw: {} });

type Harness = ReturnType<typeof setup>;

function reservationStatus(harness: Harness, runRecordId: string) {
  const run = runOf(harness.repository, runRecordId)!;
  return Object.values(harness.repository.readBudgetLedger(PROJECT, run.runId).reservations).map((reservation) => reservation.status);
}

function envelopeState(harness: Harness, runRecordId: string) {
  const run = runOf(harness.repository, runRecordId)!;
  const file = path.join(harness.root, ".nomi", "runs", run.runId, "jobs", run.jobs[0]!.jobId, "runtime-envelope.json");
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { state: string }).state;
}

async function thrownBy(work: Promise<unknown>): Promise<Error> {
  return work.then(() => { throw new Error("expected the submission to fail"); }, (error: Error) => error);
}

/** A1 的结局（A3–A5、A8、X8、X9 同一份）：确定失败、不锁、预留不动、信封不记未知、画布 Run 收尾。 */
function expectAnsweredButNotLanded(harness: Harness, runRecordId: string, thrown: Error, firstCode: NomiErrorCode) {
  expect(thrown).not.toBeInstanceOf(SubmissionReceiptUnknownError);
  expect(matchNomiErrorCode(thrown.message), "抛给渲染层的是落地错误本身，第一个码就是真原因").toBe(firstCode);
  const run = runOf(harness.repository, runRecordId)!;
  expect(run.jobs).toHaveLength(1);
  expect(run.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "output_retrieval_failed" });
  expect(run.jobs[0]!.providerTaskId, "同步结果没有任务号：不给「重新取回」").toBeUndefined();
  expect(matchNomiErrorCode(run.jobs[0]!.errorMessage ?? ""), "重开项目照 Run 账本回话，读到的也是真原因").toBe(firstCode);
  expect(reservationStatus(harness, runRecordId), "答过了、可能已扣：预留不释放，也不挂成待核对").toEqual(["reserved"]);
  expect(envelopeState(harness, runRecordId)).toBe("sealed");
  expect(openCanvasRuns(harness.root), "画布 Run 已收尾").toEqual([]);
  expect(harness.repository.list(PROJECT), "不进任务中心「要你处理」").toEqual([]);
}

/** X1–X4 / X10 / X11 的结局：结果未知，锁住这一镜、预留挂成待核对、不重发。 */
async function expectResultUnknown(harness: Harness, runRecordId: string, thrown: Error, executes = 1) {
  expect(thrown).toBeInstanceOf(SubmissionReceiptUnknownError);
  expect(runOf(harness.repository, runRecordId)!.jobs[0]?.status).toBe("submission_unknown");
  expect(reservationStatus(harness, runRecordId)).toEqual(["unsettled"]);
  expect(harness.vendor.executes).toHaveLength(executes);
  await expect(harness.submit("node-a", `${runRecordId}-again`)).rejects.toMatchObject({ code: "production_shot_claimed", reason: "needs_reconcile" });
  expect(harness.vendor.executes, "核对之前不许再交").toHaveLength(executes);
}

function answered(status: number): VendorRequestError {
  return new VendorRequestError(`Provider request failed (HTTP ${status})`, { vendorKey: "acme", method: "POST", url: "x", httpStatus: status, upstreamMsg: "upstream said no", category: "server", retryable: status >= 500 }, { httpStatus: status, envelopeFailure: false, taskIdReturned: false });
}

const connectRefused = () => Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:443"), { code: "ECONNREFUSED", syscall: "connect" });

describe("同步供应商答了、本机落地失败：确定结局，不是结果未知（A1–A5、A8）", () => {
  afterEach(() => { importRemoteAsset.mockReset(); });

  it("A1 + A2：字节解码失败 → 真原因「读不出」、不锁、预留不动；同一节点再点 ↑ 是新的一笔、落地成功", async () => {
    const harness = setup();
    harness.vendor.answer = async (call) => (call === 1 ? answeredThenLandingFails(decodeFailed())() : landed());

    const thrown = await thrownBy(harness.submit("node-a", "run-node-a-1"));
    expectAnsweredButNotLanded(harness, "run-node-a-1", thrown, "output-unreadable");
    expect(harness.vendor.executes).toHaveLength(1);

    await expect(harness.submit("node-a", "run-node-a-2")).resolves.toMatchObject({ status: "succeeded" });
    expect(harness.vendor.executes, "再点 = 供应商收到第 2 次").toHaveLength(2);
    expect(runOf(harness.repository, "run-node-a-2")!.jobs[0]).toMatchObject({ status: "ready" });
  });

  it("A3：200 之后结果下载 403（hardenedFetch 的真错误）→ retrieval-download", async () => {
    const harness = setup();
    harness.vendor.answer = answeredThenLandingFails(await download403());
    expectAnsweredButNotLanded(harness, "run-node-a-1", await thrownBy(harness.submit("node-a", "run-node-a-1")), "retrieval-download");
    expect(harness.vendor.executes).toHaveLength(1);
  });

  it("A4：类型不符（视频任务回来一张图）→ retrieval-download", async () => {
    const harness = setup();
    harness.vendor.answer = answeredThenLandingFails(kindMismatch());
    expectAnsweredButNotLanded(harness, "run-node-a-1", await thrownBy(harness.submit("node-a", "run-node-a-1")), "retrieval-download");
  });

  it("A5：取片被出网策略拦（hardenedFetch 的真拒绝）→ outbound-blocked", async () => {
    const harness = setup();
    harness.vendor.answer = answeredThenLandingFails(await outboundRefused());
    expectAnsweredButNotLanded(harness, "run-node-a-1", await thrownBy(harness.submit("node-a", "run-node-a-1")), "outbound-blocked");
  });

  it("A8：批量卡轮到的那一镜落地失败 → 同 A1；下一张卡可以再生成它", async () => {
    const harness = setup();
    harness.vendor.answer = async (call) => (call === 1 ? answeredThenLandingFails(decodeFailed())() : landed());
    harness.consent([{ nodeId: "node-a", runRecordId: "run-a" }]);
    expectAnsweredButNotLanded(harness, "run-a", await thrownBy(harness.submit("node-a", "run-a")), "output-unreadable");

    harness.consent([{ nodeId: "node-a", runRecordId: "run-a-2" }]);
    await expect(harness.submit("node-a", "run-a-2")).resolves.toMatchObject({ status: "succeeded" });
    expect(harness.vendor.executes).toHaveLength(2);
  });

  it("同一运行记录号重放 / 重启：照 Run 账本回失败（真原因），不交观察者、不再交", async () => {
    const harness = setup();
    harness.vendor.answer = answeredThenLandingFails(decodeFailed());
    await thrownBy(harness.submit("node-a", "run-node-a-1"));
    const replayed = await harness.submit("node-a", "run-node-a-1");
    expect(replayed).toMatchObject({ status: "failed" });
    expect(matchNomiErrorCode(String(replayed.error))).toBe("output-unreadable");
    const restarted = setup({ root: harness.root });
    restarted.runs.recoverOrphans(PROJECT);
    expect(restarted.observed, "没有任务号：不交给观察者").toEqual([]);
    expect(harness.vendor.executes.length + restarted.vendor.executes.length).toBe(1);
  });
});

const UNKNOWN_SHAPES: ReadonlyArray<readonly [string, () => Error]> = [
  ["X1 写出去之后连接被重置（socket hang up）", () => new Error("acme create failed: socket hang up")],
  ["X1 写出去之后连接被重置（ECONNRESET）", () => new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" }) })],
  ["X2 响应头超时", () => new TypeError("fetch failed", { cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }) })],
  ["X2 响应体超时", () => new TypeError("terminated", { cause: Object.assign(new Error("Body Timeout Error"), { code: "UND_ERR_BODY_TIMEOUT" }) })],
  ["X3 供应商回 5xx", () => answered(503)],
  ...[418, 408, 409, 410, 413, 425, 451].map((status) => [`X4 供应商回 ${status}（名单外）`, () => answered(status)] as const),
  ["X10 正文带着 output-unreadable 字样、不是落地门挂的", () => new Error(tagNomiError("output-unreadable", "Generated media validation failed (decode_failed)"))],
  ["X10 读不出的错误由交的那一层直接抛（没经过落地门）", () => generatedMediaValidationError("decode_failed")],
];

describe("反例：结果未知仍是结果未知（X1–X4、X10–X12）", () => {
  afterEach(() => { importRemoteAsset.mockReset(); });

  it.each(UNKNOWN_SHAPES)("%s → submission_unknown、锁住、预留待核对、不重发", async (_label, failure) => {
    const harness = setup();
    harness.vendor.answer = async () => { throw failure(); };
    await expectResultUnknown(harness, "run-node-a-1", await thrownBy(harness.submit("node-a", "run-node-a-1")));
  });

  it("X11：前一次可能已到达（声明幂等、连接层失败、重发一次），后一次落地失败 → 仍是结果未知（最不确定的那次说了算）", async () => {
    const harness = setup({ submitIdempotency: true });
    harness.vendor.answer = async (call) => {
      if (call === 1) throw new Error("acme create failed: socket hang up");
      return answeredThenLandingFails(decodeFailed())();
    };
    await expectResultUnknown(harness, "run-node-a-1", await thrownBy(harness.submit("node-a", "run-node-a-1")), 2);
  });

  it("X12：落地失败被别的代码当 cause 包一层，外层是之后又交出去的一笔、写出去后断了（app-fetch 账本里它在途）→ submission_unknown、锁住、预留待核对、不重发", async () => {
    let calls = 0;
    const harness = setup({ transport: {
      networkTransport: "app-fetch",
      execute: async () => {
        calls += 1;
        // ① 回答到手，真的落地门落地失败（落地门在这个错误上挂着落地正证据）。
        const landing = await answeredThenLandingFails(decodeFailed())().catch((error: Error) => error);
        // ② 之后又交出去一笔付费请求，写出去之后连接被重置：app-fetch 账本里这一笔仍在途（可能已被收下）。
        await handOffToNetwork("https://provider.test/v1/images/generations", { method: "POST", body: "{}" }, async () => {
          throw new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" }) });
        }).catch(() => undefined);
        // ③ 别的代码把落地错误当 cause 带进这一笔的失败：到达出口的是外层，证据不外借。
        throw Object.assign(new Error("acme follow-up call failed: socket hang up", { cause: landing }), { code: "ECONNRESET" });
      },
      fetchResult: async () => { throw new Error("no query"); },
    } });

    const thrown = await thrownBy(harness.submit("node-a", "run-node-a-1"));

    expect(thrown).toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(matchNomiErrorCode(thrown.message), "渲染层读到的第一个码").toBe("submission-unknown");
    expect(runOf(harness.repository, "run-node-a-1")!.jobs[0]?.status).toBe("submission_unknown");
    expect(reservationStatus(harness, "run-node-a-1")).toEqual(["unsettled"]);
    expect(envelopeState(harness, "run-node-a-1")).toBe("submitted_unknown");
    expect(calls).toBe(1);
    await expect(harness.submit("node-a", "run-node-a-2")).rejects.toMatchObject({ code: "production_shot_claimed", reason: "needs_reconcile" });
    expect(calls, "核对之前不许再交").toBe(1);
  });
});

describe("反例：确定的另外两档照旧（X5、X6）", () => {
  it.each([400, 401, 402, 403, 404, 422, 429])("X5 明确拒绝名单 %i（无任务号）→ provider_rejected、预留释放、节点可再点", async (status) => {
    const harness = setup();
    harness.vendor.answer = async (call) => { if (call === 1) throw answered(status); return landed(); };
    await expect(harness.submit("node-a", "run-node-a-1")).rejects.toBeInstanceOf(VendorRequestError);
    expect(runOf(harness.repository, "run-node-a-1")!.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_rejected" });
    expect(reservationStatus(harness, "run-node-a-1")).toEqual(["released"]);
    await expect(harness.submit("node-a", "run-node-a-2")).resolves.toMatchObject({ status: "succeeded" });
  });

  it("X6 连上之前就失败（建连被拒）→ provider_not_reached、预留释放、节点可再点", async () => {
    const harness = setup();
    harness.vendor.answer = async (call) => { if (call <= 2) throw new TypeError("fetch failed", { cause: connectRefused() }); return landed(); };
    await expect(harness.submit("node-a", "run-node-a-1")).rejects.toThrow();
    expect(runOf(harness.repository, "run-node-a-1")!.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_not_reached" });
    expect(reservationStatus(harness, "run-node-a-1")).toEqual(["released"]);
    await expect(harness.submit("node-a", "run-node-a-2")).resolves.toMatchObject({ status: "succeeded" });
  });

  it("X6 在本机就被拦下（一个请求都没交给网络）→ provider_not_reached、预留释放、不重发", async () => {
    let calls = 0;
    const harness = setup({ transport: {
      networkTransport: "app-fetch",
      execute: async () => { calls += 1; throw new Error("outbound policy refused before any request was handed to the network"); },
      fetchResult: async () => { throw new Error("no query"); },
    } });
    await expect(harness.submit("node-a", "run-node-a-1")).rejects.toThrow();
    expect(runOf(harness.repository, "run-node-a-1")!.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_not_reached" });
    expect(reservationStatus(harness, "run-node-a-1")).toEqual(["released"]);
    expect(calls).toBe(1);
  });
});

describe("反例：答过了就不重发、不判「没发出去」（X8、X9）", () => {
  afterEach(() => { importRemoteAsset.mockReset(); });

  it("对照组：声明幂等时，真的连接层失败确实会用同一个键重发一次（X8 / X11 的装置是活的）", async () => {
    const harness = setup({ submitIdempotency: true });
    harness.vendor.answer = async (call) => { if (call === 1) throw new Error("acme create failed: socket hang up"); return landed(); };
    await expect(harness.submit("node-a", "run-node-a-1")).resolves.toMatchObject({ status: "succeeded" });
    expect(harness.vendor.executes).toHaveLength(2);
  });

  it("X8：落地失败碰上「声明幂等 + 正文像连接层错误（socket hang up）」→ 不重发，供应商只收到 1 次", async () => {
    const harness = setup({ submitIdempotency: true });
    harness.vendor.answer = answeredThenLandingFails(new Error("socket hang up"));
    const thrown = await thrownBy(harness.submit("node-a", "run-node-a-1"));
    expect(harness.vendor.executes).toHaveLength(1);
    expectAnsweredButNotLanded(harness, "run-node-a-1", thrown, "retrieval-download");
  });

  it("X9：非 app-fetch 传输，落地证据 + cause 链深处有取片的建连失败 → 不判「没发出去」：不释放、不重发", async () => {
    const harness = setup();
    const retrievalConnectFailure = new Error(tagNomiError("retrieval-download", "download step could not connect to the result host"), { cause: new TypeError("fetch failed", { cause: connectRefused() }) });
    harness.vendor.answer = answeredThenLandingFails(retrievalConnectFailure);
    const thrown = await thrownBy(harness.submit("node-a", "run-node-a-1"));
    expect(harness.vendor.executes).toHaveLength(1);
    expectAnsweredButNotLanded(harness, "run-node-a-1", thrown, "retrieval-download");
  });
});


it('C2: the host identifies the original unknown Run after another click is refused and after restart', async () => {
  const h = setup()
  h.vendor.answer = async () => { throw new Error('acme create failed: socket hang up') }
  await expect(h.submit('node-a', 'original')).rejects.toBeInstanceOf(SubmissionReceiptUnknownError)
  await expect(h.submit('node-a', 'refused')).rejects.toMatchObject({ code: 'production_shot_claimed' })
  const original = runOf(h.repository, 'original')!
  expect(h.runs.unknownRuns({ projectId: PROJECT, nodeId: 'node-a' })).toEqual([{ runId: original.runId, jobId: original.jobs[0].jobId }])
  expect(h.runs.unknownRuns({ projectId: PROJECT, nodeId: 'other' })).toEqual([])
  const restarted = setup({ root: h.root })
  expect(restarted.runs.unknownRuns({ projectId: PROJECT, nodeId: 'node-a' })).toEqual([{ runId: original.runId, jobId: original.jobs[0].jobId }])
  expect(h.vendor.executes).toHaveLength(1)
})

it('C7: v0.24.0 persisted unknown Run is found, survives a refused click, releases and submits once after upgrade', async () => {
  const snapshot = path.resolve('tests/fixtures/old-user-data/runs/v0.24.0-canvas-unknown')
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'))
  expect(manifest.recordedFrom).toBe('9f3bb3c575058156690c0663a6c88a0b28dfa2a2')
  const fx = setup()
  fs.cpSync(path.join(snapshot, '.nomi'), path.join(fx.root, '.nomi'), { recursive: true })
  const query = () => fx.runs.unknownRuns({ projectId: PROJECT, nodeId: manifest.nodeId })
  const before = fx.repository.read(PROJECT, manifest.runId)!
  expect(before.jobs[0].status).toBe('submission_unknown')
  expect(query()).toEqual([{ runId: manifest.runId, jobId: before.jobs[0].jobId }])
  await expect(fx.submit(manifest.nodeId, 'upgrade-refused')).rejects.toMatchObject({ reason: 'needs_reconcile' })
  expect(fx.vendor.executes).toHaveLength(0)
  expect(query()).toEqual([{ runId: manifest.runId, jobId: before.jobs[0].jobId }])
  const service = createProductionRunService({ repository: fx.repository, projectRootResolver: () => fx.root })
  await service.command(PROJECT, manifest.runId, { commandId: 'upgrade-release', expectedRevision: before.revision,
    type: 'job.reconcile', payload: { jobId: before.jobs[0].jobId, outcome: 'user_checked_abandon' }, humanGesture: true, issuedAt: '2026-11-02T00:00:00.000Z' })
  expect(query()).toEqual([])
  expect(fx.vendor.executes).toHaveLength(0)
  await expect(fx.submit(manifest.nodeId, 'upgrade-new-intent')).resolves.toMatchObject({ status: 'succeeded' })
  expect(fx.vendor.executes).toHaveLength(1)
})
