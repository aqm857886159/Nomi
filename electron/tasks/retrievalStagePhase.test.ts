// 取回阶段的错误只说取回阶段的话（⑬，用户 10-22 拍板）。
//
// 任务已经提交、钱已经花了之后，查任务 / 取结果 / 下载这一段报的错，不能挂「还没发出去、可以重新生成」
// 那一族的码（asset-*、outbound-blocked-submit、outbound-blocked-credential-origin、submission-*、model-config）。
// 今天就有活的生产者：查询请求同样过 vendorHttp 的出站守卫，被拦时一律按「提交」挂码（守卫不知道这是查询）。
//
// 出口只有一个：fetchTaskResult（20 个调用者共用）。这里用它的真实实现，只把执行器换成按剧本抛错。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mapping, Model } from "../catalog/types";

const executeProfileOperation = vi.hoisted(() => vi.fn());
const localizeTaskAsset = vi.hoisted(() => vi.fn());
const importRemoteAsset = vi.hoisted(() => vi.fn());
const MODEL = { modelKey: "m-video", vendorKey: "relay", labelZh: "m", kind: "video", enabled: true, createdAt: "", updatedAt: "" } as Model;
const QUERY_OP = { method: "GET", path: "/v1/tasks/{{providerMeta.task_id}}", response_mapping: { status: "status", video_url: "url" } };

vi.mock("electron", () => ({
  app: { getPath: () => process.env.TEMP || "/tmp", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
}));
vi.mock("../runtime", async () => {
  const actual = await vi.importActual<typeof import("../runtime")>("../runtime");
  return {
    ...actual,
    executeProfileOperation: (...args: unknown[]) => executeProfileOperation(...args),
    localizeTaskAsset: (...args: unknown[]) => localizeTaskAsset(...args),
    findExecutableModel: () => ({ vendor: { key: "relay", baseUrlHint: "https://relay.example.test/v1" }, model: MODEL, apiKey: "k" }),
    findTaskMapping: () => null,
  };
});
// 落地门（assets/localizeTaskAsset）用真的：只把它下面的落盘换成按剧本抛错。
vi.mock("../assets/projectAssetStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assets/projectAssetStore")>()),
  importRemoteAsset: (...args: unknown[]) => importRemoteAsset(...args),
}));

const { fetchTaskResult } = await import("./taskResultQuery");
const { retrievalStageError } = await import("./retrievalStageError");
const { localizeTaskAsset: realLocalizeTaskAsset } = await import("../assets/localizeTaskAsset");
const { answeredSubmissionFailure } = await import("../outboundDispatchEvidence");
const { admitTask, taskCache } = await import("../runtime");
const { VendorRequestError } = await import("../vendor/vendorHttp");
const { matchNomiErrorCode, tagNomiError, NOMI_ERROR_ONLY_BEFORE_SUBMIT } = await import("../shared/nomiErrorCodes");
const { readTask } = await import("../capabilityCore/readTask");
type NomiErrorCode = import("../shared/nomiErrorCodes").NomiErrorCode;

/** 提交前那一族的口径：任何一句出现在取回阶段的报错里都是假话。 */
const PRE_SUBMIT_CLAIM = /没有发出去|没发出去|还没请求|没被请求到|重新生成|was never sent|generate again/;

function admitPolling(taskId: string, withQuery = true) {
  taskCache.delete(taskId);
  admitTask(taskId, {
    vendor: "relay",
    request: { kind: "text_to_video", prompt: "cat", extras: { modelKey: MODEL.modelKey } },
    raw: withQuery ? {} : { url: "https://cdn.example.test/out.mp4" },
    mapping: { vendorKey: "relay", taskKind: "text_to_video", modelKey: MODEL.modelKey, name: "m", enabled: true, create: QUERY_OP, ...(withQuery ? { query: QUERY_OP } : {}), createdAt: "", updatedAt: "" } as unknown as Mapping,
    model: MODEL,
    providerMeta: { task_id: taskId, query_id: taskId },
    projectId: "project-1",
    wantedKind: "video",
  });
}

/** 出站守卫在查询时拦下的真实形状（vendorHttp.requestJson：refusal 同时进 message 与 structured.upstreamMsg）。 */
function queryRefusedByGuard(code: "outbound-blocked-submit" | "outbound-blocked-credential-origin") {
  const refusal = code === "outbound-blocked-submit"
    ? tagNomiError(code, "这次生成**没有发出去**：relay.example.test 解析到 198.18.0.7（RFC 2544 段），请确认本地代理后重新生成。")
    : tagNomiError(code, "changed=origin bound=https://relay.example.test attempted=https://evil.example.test");
  return new VendorRequestError(`Provider request refused by outbound policy at relay GET https://relay.example.test/v1/tasks/t: ${refusal}`, {
    vendorKey: "relay", method: "GET", url: "https://relay.example.test/v1/tasks/t", upstreamMsg: refusal, category: "network", retryable: false,
  } as never);
}

beforeEach(() => {
  executeProfileOperation.mockReset();
  localizeTaskAsset.mockReset();
  importRemoteAsset.mockReset();
});

describe("C1/C2：查询时被 Nomi 自己拦下——改挂取回阶段码，原码留在技术详情，不冒充服务商原话", () => {
  for (const code of ["outbound-blocked-submit", "outbound-blocked-credential-origin"] as const) {
    it(`${code} → retrieval-query；正文不出「没发出去 / 重新生成」；原码与「Nomi 本机拦下」留在正文里；不带 upstreamMsg`, async () => {
      admitPolling("task_guard");
      executeProfileOperation.mockRejectedValue(queryRefusedByGuard(code));
      const error = await fetchTaskResult({ taskId: "task_guard" }).then(() => null, (caught: Error) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(matchNomiErrorCode(error!.message)).toBe("retrieval-query");
      expect(error!.message).not.toMatch(PRE_SUBMIT_CLAIM);
      expect(error!.message).toContain(code);
      expect(error!.message).toMatch(/Nomi/);
      expect((error as { structured?: { upstreamMsg?: string } }).structured?.upstreamMsg ?? "").toBe("");
    });
  }

  it("asset-upload-failed（#1285 修前的形状）同样改挂", async () => {
    admitPolling("task_asset");
    executeProfileOperation.mockRejectedValue(new Error(tagNomiError("asset-upload-failed", "素材上传失败：first.png 的所有上传通道都没成功，所以还没请求这次选的服务商。详情：x")));
    const error = await fetchTaskResult({ taskId: "task_asset" }).then(() => null, (caught: Error) => caught);
    expect(matchNomiErrorCode(error!.message)).toBe("retrieval-query");
    expect(error!.message).not.toMatch(PRE_SUBMIT_CLAIM);
    expect(error!.message).toContain("asset-upload-failed");
  });

  it("对照：服务商真回的 503 原话照旧保留（#1213 要它），码是 retrieval-query", async () => {
    admitPolling("task_503");
    executeProfileOperation.mockRejectedValue(new VendorRequestError("Provider request failed (HTTP 503) at relay GET x: 当前分组下无可用渠道", {
      vendorKey: "relay", method: "GET", url: "x", httpStatus: 503, upstreamMsg: "当前分组下无可用渠道", category: "server", retryable: true,
    } as never));
    const error = await fetchTaskResult({ taskId: "task_503" }).then(() => null, (caught: Error) => caught);
    expect(matchNomiErrorCode(error!.message)).toBe("retrieval-query");
    expect((error as { structured?: { upstreamMsg?: string } }).structured?.upstreamMsg).toBe("当前分组下无可用渠道");
  });

  it("对照：取回阶段自己的码（outbound-blocked）原样放行", async () => {
    admitPolling("task_retrieval_guard");
    const own = new Error(tagNomiError("outbound-blocked", "取片被安全策略拦下"));
    executeProfileOperation.mockRejectedValue(own);
    const error = await fetchTaskResult({ taskId: "task_retrieval_guard" }).then(() => null, (caught: Error) => caught);
    expect(error).toBe(own);
  });
});

describe("C1：没有查询步的任务，下载产物失败也经同一个出口", () => {
  // 挂码从「这里包一层」搬进了落地门自己（2026-10-28）：用真的落地门，只让它下面的落盘抛无码错误。
  it("落地门下面抛无码错误 → retrieval-download（落地门挂码，出口原样放行）", async () => {
    admitPolling("task_noquery", false);
    localizeTaskAsset.mockImplementation(realLocalizeTaskAsset);
    importRemoteAsset.mockRejectedValue(new Error("socket hang up"));
    const error = await fetchTaskResult({ taskId: "task_noquery" }).then(() => null, (caught: Error) => caught);
    expect(matchNomiErrorCode(error?.message ?? "")).toBe("retrieval-download");
    expect(importRemoteAsset).toHaveBeenCalledTimes(1);
    expect(error?.message).toContain("socket hang up");
    expect(answeredSubmissionFailure(error)).toBe(true);
  });

  it("有查询步的任务：读到地址后落地失败 → retrieval-download（readResult 不再改挂第二层）", async () => {
    admitPolling("task_query_land");
    executeProfileOperation.mockResolvedValue({ request: {}, response: { status: "succeeded", url: "https://cdn.example.test/out.mp4" } });
    importRemoteAsset.mockRejectedValue(new Error("Fetch failed: HTTP 403"));
    const error = await fetchTaskResult({ taskId: "task_query_land" }).then(() => null, (caught: Error) => caught);
    expect(matchNomiErrorCode(error?.message ?? "")).toBe("retrieval-download");
    expect(importRemoteAsset).toHaveBeenCalledTimes(1);
    expect(error?.message).toContain("HTTP 403");
    expect(error?.message.match(/NOMI_ERR::/g)).toHaveLength(1);
  });
});

describe("C8：MCP read_task 读到的报错不再带提交前口径", () => {
  it("查询被出站守卫拦 → read_task 的 message 里没有「没发出去 / 重新生成」", async () => {
    admitPolling("task_mcp");
    executeProfileOperation.mockRejectedValue(queryRefusedByGuard("outbound-blocked-submit"));
    const read = await readTask({ fetchTaskResult: fetchTaskResult as never }, { taskId: "task_mcp" });
    expect(read.state).toBe("query_failed");
    expect(read.message).not.toMatch(PRE_SUBMIT_CLAIM);
  });
});

describe("C3：码表给每个码登记阶段，出口只按这张表放行", () => {
  it("每个提交前的码都被改挂、其余原样放行", () => {
    for (const [code, onlyBeforeSubmit] of Object.entries(NOMI_ERROR_ONLY_BEFORE_SUBMIT) as Array<[NomiErrorCode, boolean]>) {
      const original = new Error(tagNomiError(code, "x"));
      const wrapped = retrievalStageError("retrieval-download", original);
      if (onlyBeforeSubmit) {
        expect(matchNomiErrorCode(wrapped.message), code).toBe("retrieval-download");
        expect(wrapped.message, code).toContain(code);
      } else {
        expect(wrapped, code).toBe(original);
      }
    }
  });

  it("提交前那一族一个不少", () => {
    const submit = Object.entries(NOMI_ERROR_ONLY_BEFORE_SUBMIT).filter(([, only]) => only).map(([code]) => code).sort();
    expect(submit).toEqual(["aspect-ratio-unsupported", "asset-invalid", "asset-too-large", "asset-upload-failed", "model-config", "outbound-blocked-credential-origin", "outbound-blocked-submit", "reference-not-in-use", "submission-unknown"]);
  });
});
