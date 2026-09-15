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

  it("ComfyUI 的 certifying 没有可撤的 run —— 照样放人走，如实标注「本地放弃」", () => {
    // 这条以前断言「仍然拒绝」。拒绝的本意是不制造两个真相，但代价是用户完全没有出口
    // （真机死锁里只能重启 app）。真相唯一性现在由「终态不许被覆写」那道守卫保证
    // （integrationSession.start 的 outcome 回写前先查 isTerminalIntegrationStage），
    // 所以这里改成永远放人走，并且**绝不抛异常**——它一抛，会话层的 cancel 就跟着没出口。
    const certification = { cancel: vi.fn(), get: vi.fn() } as unknown as ConnectionCertificationService;
    expect(cancelCertifyingRun(certification, { kind: "comfyui-workflow" }))
      .toEqual({ code: "certification_abandoned_locally" });
    expect(certification.cancel).not.toHaveBeenCalled();
  });

  it("HTTP 会话还没拿到 childRunRef（startHttp 没返回就被打断）也放人走", () => {
    const certification = { cancel: vi.fn(), get: vi.fn() } as unknown as ConnectionCertificationService;
    expect(cancelCertifyingRun(certification, { kind: "http-api-provider" }))
      .toEqual({ code: "certification_abandoned_locally" });
    expect(certification.cancel).not.toHaveBeenCalled();
  });

  it("run 记录已经不在了（连接被删）= 没有远端在受理，干净取消", () => {
    const certification = {
      cancel: vi.fn(() => undefined),
      get: vi.fn(() => undefined),
    } as unknown as ConnectionCertificationService;
    expect(cancelCertifyingRun(certification, { kind: "http-api-provider", childRunRef: { runId: "gone" } }))
      .toBeUndefined();
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
