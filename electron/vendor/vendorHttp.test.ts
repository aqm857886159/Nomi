import { afterEach, describe, expect, it, vi } from "vitest";
import { VendorRequestError, categorizeVendorFailure, requestJson } from "./vendorHttp";
import type { Vendor } from "../catalog/types";

const vendor = { key: "kie", authType: "bearer", baseUrlHint: "https://api.kie.ai" } as unknown as Vendor;

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (impl: () => Promise<Response> | Response) => vi.stubGlobal("fetch", vi.fn(async () => impl()));

describe("categorizeVendorFailure", () => {
  it("查表不是猜:401→auth/402→balance/429→quota可重试/422→input/503→server可重试", () => {
    expect(categorizeVendorFailure(401)).toEqual({ category: "auth", retryable: false });
    expect(categorizeVendorFailure(402)).toEqual({ category: "balance", retryable: false });
    expect(categorizeVendorFailure(429)).toEqual({ category: "quota", retryable: true });
    expect(categorizeVendorFailure(422)).toEqual({ category: "input", retryable: false });
    expect(categorizeVendorFailure(503)).toEqual({ category: "server", retryable: true });
    expect(categorizeVendorFailure(undefined, 402)).toEqual({ category: "balance", retryable: false });
  });
});

describe("requestJson 结构化错误(S4-0,修压扁根因)", () => {
  it("HTTP 200 + 逻辑错误信封(kie 风格)→ VendorRequestError 带 logicalCode/category", async () => {
    stubFetch(() => new Response(JSON.stringify({ code: 402, msg: "余额不足" }), { status: 200 }));
    const error = await requestJson(vendor, "k", "POST", "https://api.kie.ai/v1/task", {}, {}, { a: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error.structured).toMatchObject({ vendorKey: "kie", logicalCode: 402, category: "balance", retryable: false, upstreamMsg: "余额不足" });
    expect(error.structured.httpStatus).toBeUndefined();
  });

  it("真 HTTP 429 → quota 可重试,message 保留旧格式(下游正则过渡期不破)", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }));
    const error = await requestJson(vendor, "k", "POST", "https://x", {}, {}, {}).catch((e) => e);
    expect(error.structured).toMatchObject({ httpStatus: 429, category: "quota", retryable: true });
    expect(String(error.message)).toContain("Provider request failed (HTTP 429)");
  });

  it("网络层抛错 → category network 可重试", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const error = await requestJson(vendor, "k", "GET", "https://x", {}, {}, null).catch((e) => e);
    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error.structured).toMatchObject({ category: "network", retryable: true, upstreamMsg: "fetch failed" });
  });

  it("成功路径原样回 JSON", async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(requestJson(vendor, "k", "GET", "https://x", {}, {}, null)).resolves.toEqual({ ok: 1 });
  });
});
