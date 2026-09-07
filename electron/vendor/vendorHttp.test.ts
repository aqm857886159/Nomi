import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VendorRequestError, categorizeVendorFailure, requestBinary, requestJson } from "./vendorHttp";
import { setSubmitOutboundDepsForTests } from "./vendorOutboundGuard";
import type { Vendor } from "../catalog/types";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";

const vendor = { key: "kie", authType: "bearer", baseUrlHint: "https://api.kie.ai" } as unknown as Vendor;

/**
 * 提交侧出站授权跑在每一次 requestVendor 之前，所以**本文件的每个用例都得先把网络事实钉死**。
 * 不钉死会怎样：这里的 vendor 指向真实域名 `api.kie.ai`，授权会去做真 DNS——开发机开着 fake-ip
 * 时解析成 198.18.x 被拦（8 条用例一起红），CI 上根本解析不出来走 unresolvable 分支放行（全绿）。
 * 同一份断言在两台机器上走两条路，正是「本地红、线上绿」那一族。钉成「公网、无代理」这一格，
 * 让本文件只测它该测的东西：传输层的错误分类。
 */
beforeEach(() => {
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: "93.184.216.34", family: 4 as const }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
  });
});

afterEach(() => {
  setSubmitOutboundDepsForTests(null);
  delete process.env.NOMI_VENDOR_HTTP_TIMEOUT_MS;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it("redacts the exact opaque API credential from upstream message, structured detail, and encoded result", async () => {
    const secret = "opaqueCredentialValue987654";
    stubFetch(() => new Response(JSON.stringify({ message: `invalid credential ${secret}` }), { status: 400 }));

    const error = await requestJson(
      vendor,
      secret,
      "POST",
      "https://api.kie.ai/v1/task",
      { Authorization: `Bearer ${secret}` },
      {},
      {},
    ).catch((e) => e);

    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 400, category: "input" });
    expect(`${error.message}${JSON.stringify(error.structured)}`).not.toContain(secret);
  });

  it("redacts an opaque custom auth header value echoed by an upstream 400 detail", async () => {
    const customHeaderSecret = "opaqueCustomHeaderValue987654";
    stubFetch(() => new Response(JSON.stringify({ errors: { detail: `bad x-workspace-auth ${customHeaderSecret}` } }), { status: 400 }));

    const error = await requestJson(
      { ...vendor, authType: "none" } as Vendor,
      "",
      "POST",
      "https://api.kie.ai/v1/task",
      { "X-Workspace-Auth": customHeaderSecret, "Content-Type": "application/json" },
      {},
      {},
    ).catch((e) => e);

    assert(error instanceof VendorRequestError);
    expect(`${error.message}${JSON.stringify(error.structured)}`).not.toContain(customHeaderSecret);
  });

  it("redacts arbitrary gateway header values and encoded variants while preserving public header detail", async () => {
    const workspaceSecret = "SENTINEL-CUSTOM-HEADER-SECRET";
    const randomNameSecret = "opaque+Credential/Value=987654%";
    const encodedRandomSecret = encodeURIComponent(randomNameSecret);
    stubFetch(() => new Response(JSON.stringify({
      message: `ordinary-validation-marker content-type=application/json workspace=${workspaceSecret} random=${encodedRandomSecret}`,
    }), { status: 500 }));

    const built = buildHttpRequest({
      baseUrl: "https://api.kie.ai",
      authType: "none",
      apiKey: "",
      context: buildTemplateContext({ request: {}, params: {}, model: {}, modelKey: "m", apiKey: "" }),
      operation: { method: "POST", path: "/v1/task", body: {} },
      extraHeaders: {
        "X-Workspace": workspaceSecret,
        "X-Random-Gateway-Field": randomNameSecret,
      },
    });

    const error = await requestJson(
      { ...vendor, authType: "none" } as Vendor,
      "",
      built.method,
      built.url,
      built.headers,
      built.query,
      built.body,
    ).catch((caught) => caught);

    assert(error instanceof VendorRequestError);
    const exposed = `${error.message}${JSON.stringify(error.structured)}`;
    expect(exposed).toContain("ordinary-validation-marker");
    expect(exposed).toContain("content-type=application/json");
    for (const secret of [workspaceSecret, randomNameSecret, encodedRandomSecret]) expect(exposed).not.toContain(secret);
  });

  it("redacts the actual query-auth value echoed by an upstream 500 message", async () => {
    const querySecret = "opaqueQueryCredentialValue987654";
    stubFetch(() => new Response(JSON.stringify({ message: `query api_key=${querySecret}` }), { status: 500 }));

    const error = await requestJson(
      { ...vendor, authType: "query", authQueryParam: "api_key" } as Vendor,
      querySecret,
      "GET",
      "https://api.kie.ai/v1/task",
      {},
      {},
      null,
    ).catch((e) => e);

    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ httpStatus: 500, category: "server" });
    expect(`${error.message}${JSON.stringify(error.structured)}`).not.toContain(querySecret);
  });

  it("redacts encoded outbound query credentials without deleting ordinary upstream detail", async () => {
    const secret = "opaque+Credential/Value=987654%";
    const encoded = encodeURIComponent(secret);
    const wireEncoded = new URLSearchParams({ api_key: secret }).toString().slice("api_key=".length);
    const doubleEncoded = encodeURIComponent(wireEncoded);
    stubFetch(() => new Response(JSON.stringify({
      message: `ordinary-validation-marker rejected ${encoded} ${wireEncoded} ${doubleEncoded}`,
    }), { status: 500 }));

    const error = await requestJson(
      { ...vendor, authType: "query", authQueryParam: "api_key" } as Vendor,
      secret,
      "GET",
      "https://api.kie.ai/v1/task",
      {},
      {},
      null,
    ).catch((e) => e);

    assert(error instanceof VendorRequestError);
    const exposed = `${error.message}${JSON.stringify(error.structured)}`;
    expect(exposed).toContain("ordinary-validation-marker");
    for (const variant of [secret, encoded, wireEncoded, doubleEncoded]) {
      expect(exposed).not.toContain(variant);
    }
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

  // 出站授权是一段真的会 await（要做 DNS）的窗口，取消正好可以落在里面。这条钉的是钱：
  // 窗口里取消 → 付费请求**一次都没发出去**，而且抛的是调用方给的取消原因，不是伪装的网络超时。
  it("授权窗口内取消 → 原样抛取消原因，且付费请求从未发出", async () => {
    let releaseResolve: () => void = () => {};
    setSubmitOutboundDepsForTests({
      resolve: () => new Promise<readonly { address: string; family: 4 | 6 }[]>((resolve) => {
        releaseResolve = () => resolve([{ address: "93.184.216.34", family: 4 }]);
      }),
      readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
      isApplicationProxyActive: () => false,
    });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const controller = new AbortController();
    const pending = requestJson(vendor, "k", "GET", "https://x", {}, {}, null, controller.signal);
    await Promise.resolve();
    controller.abort(new Error("cancel during authorization"));
    releaseResolve();

    await expect(pending).rejects.toThrow("cancel during authorization");
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("maps a bounded response-body deadline to the stable timeout category and reason", async () => {
    vi.useFakeTimers(); process.env.NOMI_VENDOR_HTTP_TIMEOUT_MS = "10";
    stubFetch(() => new Response(new ReadableStream({ pull: () => new Promise(() => {}) })));
    const pending = requestJson(vendor, "k", "GET", "https://x", {}, {}, null).catch((caught) => caught);
    await vi.advanceTimersByTimeAsync(11);
    const error = await pending;
    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({
      category: "timeout", retryable: true, reasonCode: "response_timeout",
      upstreamMsg: "读取响应超时（0s）",
    });
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

describe("requestBinary shared vendor transport", () => {
  it("preserves binary bytes and response content type", async () => {
    const bytes = Buffer.from([0, 255, 1, 254]);
    stubFetch(() => new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } }));

    await expect(requestBinary(vendor, "k", "POST", "https://x", {}, {}, { input: "hi" })).resolves.toEqual({
      bytes,
      contentType: "audio/mpeg",
    });
  });

  it("keeps JSON logical errors structured and redacted on a byte-declared endpoint", async () => {
    const secret = "binaryEndpointCredential987654";
    stubFetch(() => new Response(JSON.stringify({ code: 402, message: `balance empty ${secret}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const error = await requestBinary(
      vendor,
      secret,
      "POST",
      "https://x",
      { Authorization: `Bearer ${secret}` },
      {},
      { input: "hi" },
    ).catch((caught) => caught);

    assert(error instanceof VendorRequestError);
    expect(error.structured).toMatchObject({ logicalCode: 402, category: "balance", retryable: false });
    expect(`${error.message}${JSON.stringify(error.structured)}`).not.toContain(secret);
  });
});
