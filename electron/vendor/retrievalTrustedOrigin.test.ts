/**
 * 取回侧私网例外的唯一判据（#975 A，2026-10-04 协调会话拍板）：**这条连接自己的 base URL 的精确 origin**，
 * 只在产物就在这个 origin 上、而且它是私网 / 回环字面量时给。
 *
 * 四类必须钉住：同 origin 放行；同主机不同端口拒；别的回环 / 内网地址拒；内置 APIMart 这类公网家完全不受影响
 * （不给例外——给了反而会关掉跟随跳转）。再加两扇门：画布（localizeTaskAsset）与正式生成
 * （generationOutputMaterializer）都把这句判据的答案交给取回，不各自另算。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { trustedRetrievalOrigin } from "./vendorOutboundGuard";

const LOCAL = { baseUrlHint: "http://127.0.0.1:52931" };

describe("trustedRetrievalOrigin：只信这条连接自己的精确 origin", () => {
  it("同 origin（协议 + 主机 + 端口完全一致）放行，base 带路径也一样", async () => {
    expect(await trustedRetrievalOrigin(LOCAL, "http://127.0.0.1:52931/out.mp4")).toBe("http://127.0.0.1:52931");
    expect(await trustedRetrievalOrigin({ baseUrlHint: "http://127.0.0.1:52931/api/v1/" }, "http://127.0.0.1:52931/files/a.mp4?x=1")).toBe("http://127.0.0.1:52931");
    expect(await trustedRetrievalOrigin({ baseUrlHint: "http://192.168.1.9:8188" }, "http://192.168.1.9:8188/view?filename=a.png")).toBe("http://192.168.1.9:8188");
    expect(await trustedRetrievalOrigin({ baseUrlHint: "http://localhost:8000" }, "http://localhost:8000/a.png")).toBe("http://localhost:8000");
  });

  it("同主机不同端口拒", async () => {
    expect(await trustedRetrievalOrigin(LOCAL, "http://127.0.0.1:8188/out.mp4")).toBeUndefined();
    expect(await trustedRetrievalOrigin(LOCAL, "http://127.0.0.1/out.mp4")).toBeUndefined();
  });

  it("换协议拒", async () => {
    expect(await trustedRetrievalOrigin(LOCAL, "https://127.0.0.1:52931/out.mp4")).toBeUndefined();
  });

  it("别的回环 / 内网地址拒（localhost 与 127.0.0.1 也不互认）", async () => {
    expect(await trustedRetrievalOrigin(LOCAL, "http://127.0.0.2:52931/out.mp4")).toBeUndefined();
    expect(await trustedRetrievalOrigin(LOCAL, "http://localhost:52931/out.mp4")).toBeUndefined();
    expect(await trustedRetrievalOrigin(LOCAL, "http://[::1]:52931/out.mp4")).toBeUndefined();
    expect(await trustedRetrievalOrigin(LOCAL, "http://10.0.0.5:52931/out.mp4")).toBeUndefined();
  });

  it("链路本地（云元数据）就算是连接自己的地址也不给", async () => {
    expect(await trustedRetrievalOrigin({ baseUrlHint: "http://169.254.169.254" }, "http://169.254.169.254/latest/meta-data")).toBeUndefined();
  });

  it("内置 APIMart 等公网家：同 origin 也不给例外（本来就放行，给了只会关掉跳转）", async () => {
    expect(await trustedRetrievalOrigin({ baseUrlHint: "https://api.apimart.ai" }, "https://api.apimart.ai/v1/files/a.mp4")).toBeUndefined();
    expect(await trustedRetrievalOrigin({ baseUrlHint: "https://api.apimart.ai" }, "https://upload.apimart.ai/a.mp4")).toBeUndefined();
  });

  it("没有连接 / 地址非法 / 不是 http(s)：没有例外", async () => {
    expect(await trustedRetrievalOrigin(undefined, "http://127.0.0.1:52931/out.mp4")).toBeUndefined();
    expect(await trustedRetrievalOrigin({ baseUrlHint: "" }, "http://127.0.0.1:52931/out.mp4")).toBeUndefined();
    expect(await trustedRetrievalOrigin({ baseUrlHint: "file:///tmp/comfy" }, "file:///tmp/comfy/a.png")).toBeUndefined();
    expect(await trustedRetrievalOrigin(LOCAL, "not a url")).toBeUndefined();
  });
});

describe("两扇取回门都只问这一句判据", () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock("../assets/projectAssetStore"); });

  it("画布（localizeTaskAsset）：把连接自己的 origin 交给落盘取回；公网家什么都不交", async () => {
    const importRemoteAsset = vi.fn(async () => ({ id: "a", data: { url: "nomi-local://p/a.mp4" } }));
    vi.doMock("../assets/projectAssetStore", () => ({ importRemoteAsset }));
    vi.doMock("../assets/assetEvents", () => ({ broadcastAssetLocalizationStarted: vi.fn(async () => {}) }));
    vi.doMock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));
    vi.doMock("../assets/localizedAsset", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../assets/localizedAsset")>()),
      probeLocalizedDurationSeconds: async () => undefined,
    }));
    const { localizeTaskAsset } = await import("../assets/localizeTaskAsset");
    await localizeTaskAsset("p", "http://127.0.0.1:52931/out.mp4", "video", undefined, { key: "local-52931", ...LOCAL });
    await localizeTaskAsset("p", "https://cdn.apimart.ai/out.mp4", "video", undefined, { key: "apimart", baseUrlHint: "https://api.apimart.ai" });
    const calls = importRemoteAsset.mock.calls as unknown as Array<[unknown, { trustedPrivateOrigin?: string }]>;
    expect(calls[0]?.[1].trustedPrivateOrigin).toBe("http://127.0.0.1:52931");
    expect(calls[1]?.[1].trustedPrivateOrigin).toBeUndefined();
  });

  it("正式生成（generationOutputMaterializer）：产物与海报各问一次，按各自的 URL 判", async () => {
    const { createGenerationOutputMaterializer } = await import("../capabilityCore/generationOutputMaterializer");
    const fetchOutput = vi.fn(async (url: string, _options: { trustedPrivateOrigin?: string }) => ({ bytes: Buffer.from("x"), contentType: url.endsWith(".png") ? "image/png" : "video/mp4" }));
    const writeAsset = vi.fn(() => ({ id: "asset-1", data: { relativePath: "assets/generated/v.mp4" } }));
    const materializer = createGenerationOutputMaterializer({
      fetchOutput: fetchOutput as never,
      writeAsset: writeAsset as never,
      resolveVendor: () => LOCAL,
    });
    await materializer.materialize({
      projectId: "p", providerTaskId: "t", providerId: "local-52931",
      output: { kind: "video", url: "http://127.0.0.1:52931/out.mp4", thumbnailUrl: "http://127.0.0.1:9000/poster.png" },
    });
    expect(fetchOutput.mock.calls[0]?.[1].trustedPrivateOrigin).toBe("http://127.0.0.1:52931");
    // 海报在同主机另一个端口：不给例外，取回由出站策略照旧拒。
    expect(fetchOutput.mock.calls[1]?.[1].trustedPrivateOrigin).toBeUndefined();
  });
});
