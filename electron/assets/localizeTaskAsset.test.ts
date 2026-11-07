import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogFields } from "../logging/logger";

const importRemoteAsset = vi.fn();
const logWarn = vi.fn<(scope: string, event: string, fields?: LogFields, error?: unknown) => void>();
vi.mock("./projectAssetStore", () => ({ importRemoteAsset }));
vi.mock("../logging/logger", () => ({ logWarn }));
vi.mock("./assetEvents", () => ({ broadcastAssetLocalizationStarted: vi.fn(async () => {}) }));
vi.mock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));

const { localizeTaskAsset } = await import("./localizeTaskAsset");
const { hardenedFetch } = await import("../hardenedFetch");
const { answeredSubmissionFailure } = await import("../outboundDispatchEvidence");
const { matchNomiErrorCode, tagNomiError } = await import("../shared/nomiErrorCodes");

/** 签名结果地址的形状：查询串里就是「拿到就能下载」的凭据，路径里是任务号。二者都不许进日志。 */
const SIGNED_RESULT_URL = "https://cdn.provider.test/tasks/task-7781/result.mp4?X-Amz-Signature=secret-signature&Expires=1893456000";

/** 一次真实的被拒取回（403 + 32KB 错误页），错误上挂的是 hardenedFetch 自己的诊断，不是手拼的。 */
async function refusedRetrieval(): Promise<unknown> {
  const body = Buffer.alloc(32 * 1024, 0x3c);
  return hardenedFetch(SIGNED_RESULT_URL, { allowContentTypes: ["video/", "application/octet-stream"] }, {
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    createPinnedDispatcher: () => ({ close: async () => {}, destroy: async () => {} }) as never,
    readOutboundEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
    fetch: async () => new Response(body, {
      status: 403,
      headers: { "Content-Type": "application/xml", "Content-Length": String(body.length) },
    }),
  }).catch((error: unknown) => error);
}

function loggedFields(): LogFields {
  expect(logWarn).toHaveBeenCalledTimes(1);
  const [scope, event, fields] = logWarn.mock.calls[0];
  expect(scope).toBe("assets");
  expect(event).toBe("localize-retrieval-failed");
  return fields ?? {};
}

describe("localizeTaskAsset 取回失败留一条结构化警告（2026-09-28：这条路径以前一个字都不写）", () => {
  beforeEach(() => {
    importRemoteAsset.mockReset();
    logWarn.mockReset();
  });

  it("记主机 / 路由 / 状态码 / 类型 / 大小 / 耗时，不记 URL 的路径与查询串；抛回的是带取回阶段码的落地错误（原话留在正文）", async () => {
    const error = await refusedRetrieval();
    expect(error).toBeInstanceOf(Error);
    importRemoteAsset.mockRejectedValueOnce(error);

    const thrown = await localizeTaskAsset("project-1", SIGNED_RESULT_URL, "video", "node-1").then(() => null, (caught: Error) => caught);
    expect(matchNomiErrorCode(thrown?.message ?? "")).toBe("retrieval-download");
    expect(thrown?.message).toContain((error as Error).message);

    const fields = loggedFields();
    expect(fields).toMatchObject({
      kind: "video",
      host: "cdn.provider.test",
      route: "direct",
      status: 403,
      contentType: "application/xml",
      declaredBytes: 32 * 1024,
      receivedBytes: 0,
    });
    expect(fields.elapsedMs).toEqual(expect.any(Number));
    expect(JSON.stringify(fields)).not.toMatch(/Signature|secret|Expires|task-7781|result\.mp4|\?/);
    // 错误本身交给 logger 的脱敏（redactError）处理，这里只确认交了出去。
    expect(logWarn.mock.calls[0][3]).toBe(error);
  });

  it("不是取回这一步失败（字节校验 / 落盘）也记：主机取自地址，取回字段为空，同样不带路径与查询串", async () => {
    importRemoteAsset.mockRejectedValueOnce(new Error("Generated media validation failed (kind_mismatch)"));

    await expect(localizeTaskAsset("project-1", SIGNED_RESULT_URL, "image")).rejects.toThrow(/kind_mismatch/);

    const fields = loggedFields();
    expect(fields).toMatchObject({ kind: "image", host: "cdn.provider.test", route: null, status: null, contentType: null });
    expect(fields.elapsedMs).toEqual(expect.any(Number));
    expect(JSON.stringify(fields)).not.toMatch(/Signature|task-7781|\?/);
  });

  it("落地成功不写警告", async () => {
    importRemoteAsset.mockResolvedValueOnce({ id: "asset-1", name: "image.png", data: { url: "nomi-local://asset/project-1/assets/generated/image.png" } });

    await expect(localizeTaskAsset("project-1", SIGNED_RESULT_URL, "image")).resolves.toMatchObject({ assetId: "asset-1" });
    expect(logWarn).not.toHaveBeenCalled();
  });

});

describe("localizeTaskAsset 是结果落地门：失败时挂取回阶段码和「答过了」的正证据（2026-10-28）", () => {
  beforeEach(() => {
    importRemoteAsset.mockReset();
    logWarn.mockReset();
  });

  it("无码的落盘错误（EACCES）→ retrieval-download + 正证据", async () => {
    importRemoteAsset.mockRejectedValueOnce(Object.assign(new Error("EACCES: permission denied, open '/p/assets/generated/a.png'"), { code: "EACCES" }));
    const thrown = await localizeTaskAsset("project-1", SIGNED_RESULT_URL, "image").then(() => null, (caught: Error) => caught);
    expect(matchNomiErrorCode(thrown?.message ?? "")).toBe("retrieval-download");
    expect(answeredSubmissionFailure(thrown)).toBe(true);
  });

  it("已经带取回阶段的码（出站被拦 / 读不出）：同一个错误对象原样抛回，只多挂正证据", async () => {
    for (const code of ["outbound-blocked", "output-unreadable"] as const) {
      const own = new Error(tagNomiError(code, "x"));
      importRemoteAsset.mockRejectedValueOnce(own);
      await expect(localizeTaskAsset("project-1", SIGNED_RESULT_URL, "image")).rejects.toBe(own);
      expect(answeredSubmissionFailure(own), code).toBe(true);
    }
  });

  it("错误对象不许加属性（冻结）：包一层挂证据，原错误在 cause 上、码不变", async () => {
    const frozen = Object.freeze(new Error(tagNomiError("output-unreadable", "decode_failed")));
    importRemoteAsset.mockRejectedValueOnce(frozen);
    const thrown = await localizeTaskAsset("project-1", SIGNED_RESULT_URL, "image").then(() => null, (caught: Error) => caught);
    expect(thrown).not.toBe(frozen);
    expect(thrown?.cause).toBe(frozen);
    expect(matchNomiErrorCode(thrown?.message ?? "")).toBe("output-unreadable");
    expect(answeredSubmissionFailure(thrown)).toBe(true);
  });

  it("没经过落地门的错误，哪怕正文带着同样的码，也没有正证据（证据不从文字推）", () => {
    expect(answeredSubmissionFailure(new Error(tagNomiError("output-unreadable", "x")))).toBe(false);
    expect(answeredSubmissionFailure(new Error(tagNomiError("retrieval-download", "x")))).toBe(false);
  });
});
