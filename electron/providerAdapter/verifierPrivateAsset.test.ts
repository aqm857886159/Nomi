// 回归钉：自建/局域网端点的产物必须能在接入验证阶段下载到。
//
// 真实走查跑出来的（tests/ux/local-gateway-onboarding.walk.mjs）：本地网关出的图片/视频，
// URL 本身就在私网上，hardenedFetch 按 SSRF 拒下载 → 卡在 verify_asset →
// 「Refusing to fetch private/loopback host: 127.0.0.1」→ 本地端点的图片/视频能力
// **永远无法通过验证**（文本因为不下载产物所以能过，于是表现为「文本行、出图不行」）。
//
// 放行的边界必须钉死：只放行与用户刚填的端点**完全同源**的 URL；换个私网地址照样拒。
// 这条边界不能松——松了就等于让上游随便指一个内网地址让我们去打。
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Model, Vendor } from "../catalog/types";
import type { AdapterModeDraft } from "./types";
import { verifyAdapterMode } from "./verifier";

const LOCAL_BASE = "http://127.0.0.1:8188";
const VALID_PNG = fs.readFileSync(path.join(__dirname, "__fixtures__", "certification-media", "valid.png"));

function vendor(baseUrlHint: string | null): Vendor {
  return { key: "local-gw", name: "local", baseUrlHint, authType: "none", enabled: true, createdAt: "t", updatedAt: "t" } as unknown as Vendor;
}

const imageModel = { modelKey: "m-img", vendorKey: "local-gw", kind: "image", enabled: true, createdAt: "t", updatedAt: "t" } as unknown as Model;

const mode: AdapterModeDraft = {
  taskKind: "text_to_image",
  create: { method: "POST", path: "/v1/images/generations", body: {} },
  sourceUrls: [],
};

/** 跑一次验证，返回 fetchAsset 收到的选项。产物 URL 可指定，默认与端点同源。 */
async function runVerify(baseUrlHint: string | null, assetUrl = `${LOCAL_BASE}/asset/a.png`) {
  const fetchAsset = vi.fn(async () => ({ contentType: "image/png", bytes: VALID_PNG }));
  const result = await verifyAdapterMode(
    { vendor: vendor(baseUrlHint), model: imageModel, apiKey: "", mode },
    {
      execute: async () => ({ response: {}, request: {} }),
      normalize: async () => ({
        result: { id: "r", kind: "text_to_image", status: "succeeded", assets: [{ type: "image", url: assetUrl }] } as never,
        providerMeta: {},
      }),
      fetchAsset,
    },
  );
  return { result, options: fetchAsset.mock.calls[0]?.[1] };
}

describe("接入验证下载本地端点产物（issue #4 / #43 第二道墙）", () => {
  it("放行与用户所填端点同源的私网产物 URL", async () => {
    const { result, options } = await runVerify(LOCAL_BASE);
    expect(result.ok).toBe(true);
    expect(options?.allowedPrivateOrigins).toEqual([LOCAL_BASE]);
  });

  it("端点带路径时只取 origin（/v1 不该进白名单）", async () => {
    const { options } = await runVerify(`${LOCAL_BASE}/v1`);
    expect(options?.allowedPrivateOrigins).toEqual([LOCAL_BASE]);
  });

  it("拿不到合法 origin 就不放行——保守失败，绝不敞开私网", async () => {
    for (const bad of [null, "", "not a url", "file:///etc/passwd"]) {
      const { options } = await runVerify(bad);
      expect(options?.allowedPrivateOrigins, `baseUrlHint=${String(bad)}`).toBeUndefined();
    }
  });

  it("只放行这一个 origin：上游若指向别的内网地址，白名单里也不会有它", async () => {
    const { options } = await runVerify(LOCAL_BASE, "http://192.168.1.1/admin.png");
    // 白名单仍只有用户填的那个 origin，hardenedFetch 按 origin 全等比对 → 这个 URL 会被拒。
    expect(options?.allowedPrivateOrigins).toEqual([LOCAL_BASE]);
    expect(options?.allowedPrivateOrigins).not.toContain("http://192.168.1.1");
  });
});
