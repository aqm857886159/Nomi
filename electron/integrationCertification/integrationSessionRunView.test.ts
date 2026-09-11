import { describe, expect, it, vi } from "vitest";
import type { ConnectionCertificationService } from "./service";
import { cancelCertifyingRun, modelResultsFromRun } from "./integrationSessionRunView";

function run(stage: string, models: unknown[] = []) {
  return { id: "run-1", stage, models } as never;
}

describe("cancelCertifyingRun", () => {
  it("HTTP 会话在 certifying 可以取消：run 被撤成终态，会话不带 blockingReason", () => {
    const certification = {
      cancel: vi.fn(() => run("cancelled")),
      get: vi.fn(() => run("cancelled")),
    } as unknown as ConnectionCertificationService;
    expect(cancelCertifyingRun(certification, {
      kind: "http-api-provider",
      childRunRef: { runId: "run-1" },
    })).toBeUndefined();
    expect(certification.cancel).toHaveBeenCalledWith("run-1");
  });

  it("远端已经受理、run 撤不掉时仍然放人走，但如实标注原因", () => {
    const certification = {
      cancel: vi.fn(() => run("certifying")),
      get: vi.fn(() => run("certifying")),
    } as unknown as ConnectionCertificationService;
    expect(cancelCertifyingRun(certification, {
      kind: "http-api-provider",
      childRunRef: { runId: "run-1" },
    })).toEqual({ code: "certification_already_submitted" });
  });

  it("ComfyUI 的 certifying 没有可撤的 run —— 仍然拒绝，不制造两个真相", () => {
    const certification = { cancel: vi.fn(), get: vi.fn() } as unknown as ConnectionCertificationService;
    expect(() => cancelCertifyingRun(certification, { kind: "comfyui-workflow" }))
      .toThrow(/Cannot cancel certification in progress/);
    expect(certification.cancel).not.toHaveBeenCalled();
  });
});

describe("modelResultsFromRun", () => {
  it("把逐模型的原始错误（HTTP 状态 + 原文）投影到会话面上", () => {
    const results = modelResultsFromRun(run("partial", [
      {
        modelKey: "gpt-5.6-sol",
        modes: [{ taskKind: "chat", state: "failed", attempts: 1, stage: "create", error: "model is overloaded", httpStatus: 503, errorCategory: "provider" }],
      },
      {
        modelKey: "gpt-5.5",
        modes: [{ taskKind: "chat", state: "verified", attempts: 1, verifiedAt: "2026-09-12T00:00:10.000Z" }],
      },
    ]));
    expect(results).toEqual([
      { modelKey: "gpt-5.6-sol", taskKind: "chat", state: "failed", attempts: 1, stage: "create", error: "model is overloaded", httpStatus: 503, errorCategory: "provider" },
      { modelKey: "gpt-5.5", taskKind: "chat", state: "verified", attempts: 1, verifiedAt: "2026-09-12T00:00:10.000Z" },
    ]);
  });

  it("没有 run 或没有模型时不造空壳字段", () => {
    expect(modelResultsFromRun(undefined)).toEqual([]);
    expect(modelResultsFromRun(run("queued"))).toEqual([]);
  });
});
