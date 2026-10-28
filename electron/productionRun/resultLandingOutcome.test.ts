import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// 类测试：「供应商答了、结果在回答里，Nomi 本机落地失败」这一类的全部形状（2026-10-28，设计卡
// docs/plan/2026-10-28-sync-landing-not-unknown.md ★9 A6 / A9，反例 X1–X6、X10、X11 的判据那一层）。
//
// 一类问题从哪里回来：每一个错误码都可能从落地门下面冒出来（今天的生产者、将来新加的码）。这里逐个码从**真的**落地门
// （assets/localizeTaskAsset）抛出，经**真的**提交出口（画布单镜 Run → submissionOutbox），断言结局一律是确定的
// 「答了、没落下」，渲染层读到的第一个码只说提交之后的话。判据的另一半：没有落地门挂的正证据，什么形状都不放行成确定结局。

import { canvasRunIdFor, openCanvasRuns } from "./canvasShotRunIndex";
import { SubmissionNotDispatchedError, SubmissionReceiptUnknownError, submissionFailureOutcome } from "./submissionOutbox";
import { CANVAS_TEST_PROJECT as PROJECT, setupCanvasShots } from "../capabilityCore/canvasShotTestUtils";
import { NOMI_ERROR_ONLY_BEFORE_SUBMIT, matchNomiErrorCode, tagNomiError, type NomiErrorCode } from "../shared/nomiErrorCodes";
import { answeredSubmissionFailure, withResultLandingEvidence } from "../outboundDispatchEvidence";
import { VendorRequestError } from "../vendor/vendorHttp";
import { SYNC_RESULT_URL, decodeFailed, diskWriteFailed, download403, kindMismatch, outboundRefused } from "../capabilityCore/resultLandingTestUtils";

const importRemoteAsset = vi.hoisted(() => vi.fn());
vi.mock("../assets/projectAssetStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assets/projectAssetStore")>()),
  importRemoteAsset: (...args: unknown[]) => importRemoteAsset(...args),
}));
const { localizeTaskAsset } = await import("../assets/localizeTaskAsset");

const roots: string[] = [];
afterEach(() => {
  importRemoteAsset.mockReset();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const ALL_CODES = Object.keys(NOMI_ERROR_ONLY_BEFORE_SUBMIT) as NomiErrorCode[];

/** 让真的落地门在落盘那一步按 `failure` 失败，拿回它抛出的错误（带取回阶段码与正证据）。 */
async function throughLandingGate(failure: unknown): Promise<Error> {
  importRemoteAsset.mockRejectedValueOnce(failure);
  return localizeTaskAsset(PROJECT, SYNC_RESULT_URL, "image").then(() => { throw new Error("expected the landing gate to fail"); }, (error: Error) => error);
}

function answered(status: number): VendorRequestError {
  return new VendorRequestError(`Provider request failed (HTTP ${status})`, { vendorKey: "acme", method: "POST", url: "x", httpStatus: status, upstreamMsg: "upstream", category: "server", retryable: false }, { httpStatus: status, envelopeFailure: false, taskIdReturned: false });
}

describe("A9：每一个错误码从真的落地门抛出，出口结局一律「答了、没落下」", () => {
  it.each(ALL_CODES)("%s", async (code) => {
    const harness = setupCanvasShots();
    roots.push(harness.root);
    // 画布那台照 runTask 的做法当场落地：落地门抛出来的就是交的那一下抛出来的。
    harness.vendor.answer = async () => { throw await throughLandingGate(new Error(tagNomiError(code, `landing failed with ${code}`))); };

    const thrown = await harness.submit("node-a", "run-a").then(() => null, (error: Error) => error);

    expect(thrown).not.toBeInstanceOf(SubmissionReceiptUnknownError);
    const firstCode = matchNomiErrorCode(thrown?.message ?? "");
    expect(firstCode, "提交前那几个码改挂取回阶段码，其余原样").toBe(NOMI_ERROR_ONLY_BEFORE_SUBMIT[code] ? "retrieval-download" : code);
    expect(NOMI_ERROR_ONLY_BEFORE_SUBMIT[firstCode!], "渲染层读到的第一个码只说提交之后的话").toBe(false);
    const run = harness.repository.read(PROJECT, canvasRunIdFor("run-a"))!;
    expect(run.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "output_retrieval_failed" });
    expect(Object.values(harness.repository.readBudgetLedger(PROJECT, run.runId).reservations).map((reservation) => reservation.status)).toEqual(["reserved"]);
    expect(openCanvasRuns(harness.root)).toEqual([]);
    expect(harness.vendor.executes).toHaveLength(1);
  });
});

describe("A6 与真实生产者：落地门下面的各种失败都挂得上正证据、码都说提交之后的话", () => {
  it.each([
    ["A6 写盘失败（无码 EACCES）", async () => diskWriteFailed(), "retrieval-download"],
    ["字节解码失败", async () => decodeFailed(), "output-unreadable"],
    ["结果下载 403", download403, "retrieval-download"],
    ["类型不符", async () => kindMismatch(), "retrieval-download"],
    ["取片被出网策略拦", outboundRefused, "outbound-blocked"],
  ] as const)("%s → 第一个码 %s，结局 result_landing_failed", async (_label, failure, expected) => {
    const landed = await throughLandingGate(await failure());
    expect(matchNomiErrorCode(landed.message)).toBe(expected);
    expect(answeredSubmissionFailure(landed)).toBe(true);
    expect(submissionFailureOutcome(landed, false)).toBe("result_landing_failed");
    // 上面再包几层（执行器 / 运行时把它当 cause 带着）也认得出：证据在 cause 链上任何一层都算。
    expect(submissionFailureOutcome(new Error("runTask failed", { cause: new Error("vendor layer", { cause: landed }) }), false)).toBe("result_landing_failed");
  });
});

describe("判据的另一半：没有落地门挂的正证据，什么形状都不放行成确定结局", () => {
  it("X10：正文里带着任何一个码（含取回阶段那几个）、但不是落地门挂的 → 结果未知", () => {
    for (const code of ALL_CODES) {
      expect(submissionFailureOutcome(new Error(tagNomiError(code, "x")), false), code).toBe("unknown");
    }
    expect(submissionFailureOutcome(decodeFailed(), false), "真的读不出错误，没经过落地门").toBe("unknown");
  });

  it("X1–X4：写出去之后断了 / 超时 / 5xx / 名单外 4xx → 结果未知", () => {
    const shapes: unknown[] = [
      new Error("acme create failed: socket hang up"),
      new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" }) }),
      new TypeError("fetch failed", { cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }) }),
      answered(500), answered(503),
      ...[418, 408, 409, 410, 413, 425, 451].map(answered),
    ];
    for (const shape of shapes) expect(submissionFailureOutcome(shape, false)).toBe("unknown");
  });

  it("X5 / X6：另外两档照旧", () => {
    for (const status of [400, 401, 402, 403, 404, 422, 429]) expect(submissionFailureOutcome(answered(status), false), String(status)).toBe("provider_rejected");
    expect(submissionFailureOutcome(new SubmissionNotDispatchedError("refused locally", "never_reached_network"), false)).toBe("not_dispatched");
    expect(submissionFailureOutcome(new SubmissionNotDispatchedError("connect refused", "connect_failed"), true)).toBe("not_dispatched");
  });

  it("X11：之前有一次可能已被收下，最后一次哪怕是「答了、没落下」也是结果未知", async () => {
    const landed = await throughLandingGate(decodeFailed());
    expect(submissionFailureOutcome(landed, true)).toBe("unknown");
  });

  it("答过了先于「拒绝」判：落地时碰上的 4xx（取片 403）不是对这次提交的拒绝", () => {
    const landed = withResultLandingEvidence(new Error(tagNomiError("retrieval-download", "x"), { cause: answered(403) }));
    expect(submissionFailureOutcome(landed, false)).toBe("result_landing_failed");
  });
});
