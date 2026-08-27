import assert from "node:assert/strict";
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
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ vendorKey: "kie", logicalCode: 402, category: "balance", retryable: false, upstreamMsg: "余额不足" });
    expect(error.structured.httpStatus).toBeUndefined();
  });

  it("真 HTTP 429 → quota 可重试,message 保留旧格式(下游正则过渡期不破)", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }));
    const error = await requestJson(vendor, "k", "POST", "https://x", {}, {}, {}).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 429, category: "quota", retryable: true });
    expect(String(error.message)).toContain("Provider request failed (HTTP 429)");
  });

  it("魔搭风格复数 errors 信封(HTTP 400)→ 提取真实原因,不再压成「(no detail from provider)」", async () => {
    stubFetch(() => new Response(JSON.stringify({ errors: { message: "size must be pixels like 1024x1024" } }), { status: 400 }));
    const error = await requestJson(vendor, "k", "POST", "https://api-inference.modelscope.cn/v1/images/generations", {}, {}, {}).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 400, category: "input", retryable: false });
    expect(error.structured.upstreamMsg).toBe("size must be pixels like 1024x1024");
    expect(String(error.message)).not.toContain("no detail from provider");
  });

  it("网络层抛错 → category network 可重试", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const error = await requestJson(vendor, "k", "GET", "https://x", {}, {}, null).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "network", retryable: true, upstreamMsg: "fetch failed" });
  });

  it("网络连接失败保留底层原因，并在截断前移除密钥与URL鉴权", async () => {
    const key = "SYNTHETIC_VENDOR_NETWORK_KEY";
    stubFetch(() => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error(
      `Connect Timeout Error (10000ms) at https://user:pass@fixture.invalid/v1?token=UNKNOWN_QUERY_SECRET ${key}`,
    ), { code: "UND_ERR_CONNECT_TIMEOUT" }) })));
    const error = await requestJson(vendor, key, "POST", "https://fixture.invalid/v1", {}, {}, {}).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "network", retryable: true });
    expect(error.structured.upstreamMsg).toContain("UND_ERR_CONNECT_TIMEOUT");
    expect(error.structured.upstreamMsg).toContain("10000ms");
    expect(JSON.stringify(error.structured)).not.toMatch(/SYNTHETIC_|user:pass|UNKNOWN_QUERY_SECRET/);
  });

  it("响应流断开也使用同一底层网络原因，不丢掉socket code", async () => {
    stubFetch(() => new Response(new ReadableStream({ start(controller) {
      controller.error(new TypeError("terminated", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }));
    } })));
    const error = await requestJson(vendor, "k", "GET", "https://fixture.invalid/v1", {}, {}, null).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "network", retryable: true });
    expect(error.structured.upstreamMsg).toContain("UND_ERR_SOCKET");
    expect(error.structured.upstreamMsg).toContain("other side closed");
  });

  it("网络诊断URL不保留请求地址内的userinfo、query或fragment", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const error = await requestJson(vendor, "k", "GET", "https://user:pass@fixture.invalid/v1?token=UNKNOWN_TOKEN#private", {}, {}, null).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured.url).toBe("https://fixture.invalid/v1");
    expect(`${error.message}${JSON.stringify(error.structured)}`).not.toMatch(/user:pass|UNKNOWN_TOKEN|#private/);
  });

  it("调用方取消请求 → 原样抛出取消原因，不伪装成可重试的网络超时", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));
    const pending = requestJson(vendor, "k", "GET", "https://x", {}, {}, null, controller.signal);

    controller.abort(new Error("cancel vendor request"));

    await expect(pending).rejects.toThrow("cancel vendor request");
    await expect(pending).rejects.not.toBeInstanceOf(VendorRequestError);
  });

  it("成功路径原样回 JSON", async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(requestJson(vendor, "k", "GET", "https://x", {}, {}, null)).resolves.toEqual({ ok: 1 });
  });

  it("普通 API 响应超过共享上限时稳定失败，不泄露响应 body", async () => {
    const sentinel = "SIGNED_URL_SECRET_SENTINEL";
    stubFetch(() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"value":"${sentinel}${"x".repeat(200)}"}`));
        controller.close();
      },
    }), { status: 200 }));
    const error = await requestJson(vendor, "k", "GET", "https://x", {}, {}, null, undefined, { maxResponseBytes: 32 })
      .catch((caught) => caught);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "network", retryable: false, upstreamMsg: "Provider response exceeded the safe size limit" });
    expect(`${error.message}${JSON.stringify(error.structured)}`).not.toContain(sentinel);
  });

  it("请求头含非法字符(密钥混中文)→ 发送前拦截为 auth 不可重试,根本不发 fetch(治 ByteString 误判网络)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const error = await requestJson(
      vendor,
      "k",
      "POST",
      "https://api.kie.ai/api/v1/jobs/createTask",
      { Authorization: "Bearer 衣abc", "Content-Type": "application/json" },
      {},
      { a: 1 },
    ).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "auth", retryable: false });
    expect(error.structured.upstreamMsg).toContain("API 密钥含非法字符");
    expect(fetchSpy).not.toHaveBeenCalled(); // 不再让 fetch 抛 ByteString → 不会被误判成网络超时
  });

  it("非鉴权头含非法字符 → input 类(不归咎密钥)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const error = await requestJson(vendor, "k", "POST", "https://x", { "X-Note": "标题" }, {}, { a: 1 }).catch((e) => e);
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ category: "input", retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
