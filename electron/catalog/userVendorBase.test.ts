import { afterEach, describe, expect, it, vi } from "vitest";
import { localizeAssetsForVendor, resolveAssetIngestionWithFallback, type LocalAsset } from "./assetLocalization";
import { userVendorBaseUrl } from "./userVendorBase";
import { setProductionRunE2eFixturePackagedState } from "../shared/productionRunE2eFixtureGate";

// 走真实路径：目标 vendor（带用户保存的 baseUrlHint）→ 候选通道排序 → localizeAssetsForVendor 真的发 multipart。
// 只把最底层的 HTTP 换成记账替身，看参考图到底被传到了哪个 URL。
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const read = (url: string): LocalAsset | null => ({ bytes: PNG, contentType: "image/png", fileName: url.split("/").pop() || "a.png" });
const keys = (key: string) => (vendorKey: string) => (vendorKey === key ? "k" : null);

async function uploadedTo(vendor: { key: string; baseUrlHint?: string }, allVendors = [vendor]): Promise<string[]> {
  const postMultipart = vi.fn().mockResolvedValue({ url: "https://cdn.test/a.png" });
  await localizeAssetsForVendor(
    { referenceImageUrls: ["nomi-local://asset/p/a.png"] },
    (kind) => resolveAssetIngestionWithFallback(vendor, allVendors, keys("apimart"), kind),
    read, vi.fn(), postMultipart,
  );
  return postMultipart.mock.calls.map((call) => String(call[0]));
}

describe("APIMart 参考图上传跟着用户保存的接口地址走", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setProductionRunE2eFixturePackagedState(undefined);
  });

  it("用户填了国内线路 api.apib.ai → 上传打到 api.apib.ai", async () => {
    expect(await uploadedTo({ key: "apimart", baseUrlHint: "https://api.apib.ai" })).toEqual(["https://api.apib.ai/v1/uploads/images"]);
  });

  it("base 是本机夹具 → 上传打到本机", async () => {
    expect(await uploadedTo({ key: "apimart", baseUrlHint: "http://127.0.0.1:4321/" })).toEqual(["http://127.0.0.1:4321/v1/uploads/images"]);
  });

  it("base 末尾带 /v1 不会拼出 /v1/v1", async () => {
    expect(await uploadedTo({ key: "apimart", baseUrlHint: "https://api.apib.ai/v1" })).toEqual(["https://api.apib.ai/v1/uploads/images"]);
  });

  it("目标是别家（如 openai）、apimart 只是兜底通道：兜底也用用户 apimart 连接的地址", async () => {
    const apimart = { key: "apimart", baseUrlHint: "https://api.apib.ai" };
    expect(await uploadedTo({ key: "openai" }, [{ key: "openai" }, apimart])).toEqual(["https://api.apib.ai/v1/uploads/images"]);
  });

  it("连 apimart 连接记录都不在目录里：退回种子默认域（没有用户地址可跟）", async () => {
    expect(await uploadedTo({ key: "openai" }, [{ key: "openai" }])).toEqual(["https://api.apimart.ai/v1/uploads/images"]);
  });

  it("夹具口：E2E 夹具 + 回环地址时，夹具点名的那家 base 指到夹具；非回环地址不认", () => {
    setProductionRunE2eFixturePackagedState(false);
    vi.stubEnv("NOMI_E2E", "1");
    vi.stubEnv("NOMI_E2E_PRODUCTION_FIXTURE", "1");
    vi.stubEnv("NOMI_E2E_FIXTURE_BASE_URL", "http://127.0.0.1:5555");
    expect(userVendorBaseUrl({ key: "apimart", baseUrlHint: "https://api.apimart.ai" })).toBe("http://127.0.0.1:5555");
    expect(userVendorBaseUrl({ key: "kie", baseUrlHint: "https://api.kie.ai" })).toBe("https://api.kie.ai");
    vi.stubEnv("NOMI_E2E_FIXTURE_BASE_URL", "https://evil.example");
    expect(userVendorBaseUrl({ key: "apimart", baseUrlHint: "https://api.apimart.ai" })).toBe("https://api.apimart.ai");
  });

  it("涓嶆湇浠庢病鏈夋墦寮€ E2E 鐨勭幆澧冨啀璺宠繃 loopback 夹具", () => {
    vi.stubEnv("NOMI_E2E", "0");
    vi.stubEnv("NOMI_E2E_PRODUCTION_FIXTURE", "1");
    vi.stubEnv("NOMI_E2E_FIXTURE_BASE_URL", "http://127.0.0.1:5555");
    expect(userVendorBaseUrl({ key: "apimart", baseUrlHint: "https://api.apimart.ai" }))
      .toBe("https://api.apimart.ai");
  });
});
