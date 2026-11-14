// 失败路径实测（⑬）：生产代码整条走——fetchTaskResult → executeProfileOperation → vendorHttp.requestJson →
// 出站守卫（authorizeSubmitDestination：凭据绑定）→ retrievalStageError。连接的密钥绑在旧 origin 上、查询要去新地址，
// 守卫在请求离开本机之前就拦下，所以零网络、零花费；拦下的那条错误是守卫真生成的，不是手写的形状。
//
// 修前：抛出去的是提交前的码，正文「这次生成**没有发出去**……」，structured.upstreamMsg 也是这句。
// （2026-11-13 前这里用的是按地址拒绝那一层（fake-ip 合成地址）；那一层删了，提交前的码只剩凭据绑定这一个生产者。）
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.TEMP || "/tmp", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
}));

const { APIMART_STATUS_MAPPING, APIMART_VIDEO_QUERY_OP } = await import("../catalog/apimartVendor");
type Model = import("../catalog/types").Model;
type Vendor = import("../catalog/types").Vendor;
type Mapping = import("../catalog/types").Mapping;

// 密钥保存时确认的是旧地址；现在的地址被改了而密钥没重新保存（例如手改了 catalog 文件）。
// 新地址用 .example 而不是 api.apimart.ai：后者在代码声明的官方备用域里，凭据规则本来就放行，
// 写成它这条测试会真的去请求公网（2026-11-13 本线踩过一次，见下面的测试网络闸）。
const NEW_BASE = "https://api.relay-moved.example";
const VENDOR = { key: "apimart", name: "APIMart", enabled: true, baseUrlHint: NEW_BASE, authType: "bearer", authHeader: "Authorization", credentialBinding: { origin: "https://api.relay-old.example", authType: "bearer", authHeader: "Authorization", confirmedAt: "2026-10-01T00:00:00.000Z" }, createdAt: "", updatedAt: "" } as Vendor;
const MODEL = { modelKey: "doubao-seedance-2.0", vendorKey: "apimart", labelZh: "Seedance 2.0", kind: "video", enabled: true, createdAt: "", updatedAt: "" } as Model;

vi.mock("../catalog/executableModel", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog/executableModel")>(),
  findExecutableModel: () => ({ vendor: VENDOR, model: MODEL, apiKey: "synthetic-key", customConfig: {} }),
}));

const { fetchTaskResult } = await import("./taskResultQuery");
const { admitTask, taskCache } = await import("../runtime");
const { matchNomiErrorCode } = await import("../shared/nomiErrorCodes");

const PRE_SUBMIT_CLAIM = /没有发出去|没发出去|还没请求|没被请求到|重新生成|was never sent|generate again/;

// 守卫万一没拦住，测试网络闸让这次查询在本机失败，绝不出网。
beforeEach(() => { vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1"); });

describe("查询被 Nomi 自己的出站守卫拦下（凭据绑定）——生产代码整条走", () => {
  it("抛出去的是 retrieval-query；没有「没发出去 / 重新生成」；原码留在正文、标明 Nomi 本机拦下；没有冒充的服务商原话", async () => {
    taskCache.delete("task_real_guard");
    admitTask("task_real_guard", {
      vendor: "apimart",
      request: { kind: "image_to_video", prompt: "cat", extras: { modelKey: MODEL.modelKey } },
      raw: {},
      mapping: { vendorKey: "apimart", taskKind: "image_to_video", modelKey: MODEL.modelKey, name: "seedance", enabled: true, create: APIMART_VIDEO_QUERY_OP, query: APIMART_VIDEO_QUERY_OP, statusMapping: APIMART_STATUS_MAPPING, createdAt: "", updatedAt: "" } as Mapping,
      model: MODEL,
      providerMeta: { task_id: "task_real_guard", query_id: "task_real_guard" },
      wantedKind: "video",
    });
    const error = await fetchTaskResult({ taskId: "task_real_guard" }).then(() => null, (caught: Error) => caught);
    expect(error, "守卫应当拦下这次查询").toBeInstanceOf(Error);
    expect(matchNomiErrorCode(error!.message)).toBe("retrieval-query");
    expect(error!.message).not.toMatch(PRE_SUBMIT_CLAIM);
    expect(error!.message).toContain("outbound-blocked-credential-origin");
    expect(error!.message).toContain("api.relay-moved.example");
    expect((error as { structured?: { upstreamMsg?: string } }).structured?.upstreamMsg ?? "").toBe("");
  });
});
