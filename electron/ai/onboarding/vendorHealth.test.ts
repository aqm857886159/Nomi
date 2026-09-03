import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  ipcMain: { handle: () => {} },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

const readCatalog = vi.fn();
vi.mock("../../catalog/catalogStore", () => ({
  readCatalog: () => readCatalog(),
  normalizeProviderKind: (v: unknown, fallback = "openai-compatible") =>
    v === "anthropic" || v === "openai-compatible" || v === "openai-responses" ? v : fallback,
}));

import { checkVendorHealth, classifyProbe, resetVendorHealthCache } from "./vendorHealth";

const encryptedRecord = (plain: string, updatedAt: string) => ({
  apiKey: Buffer.from(plain).toString("base64"),
  enc: "safeStorage" as const,
  enabled: true,
  updatedAt,
});

describe("classifyProbe — 探测结果 → 四态的唯一映射表", () => {
  const at = 1_700_000_000_000;

  it("拉到模型列表 = 能用", () => {
    expect(classifyProbe("v", { ok: true, statuses: [200] }, at)).toEqual({
      vendorKey: "v",
      state: "reachable",
      checkedAt: at,
    });
  });

  it("401/403 = 凭证不对，报「连不上」并带上上游原话", () => {
    const r = classifyProbe("v", { ok: false, error: "invalid api key", statuses: [401] }, at);
    expect(r.state).toBe("unreachable");
    expect(r.reason).toBe("invalid api key");
  });

  it("凭证不对优先于「没这个端点」——/models 回 401、/v1/models 回 404 时不能判成 unsupported", () => {
    // 这正是只看 lastStatus 会踩的坑：末位是 404，据此说「不支持预检」就把 key 失效吞掉了。
    expect(classifyProbe("v", { ok: false, error: "unauthorized", statuses: [401, 404] }, at).state).toBe(
      "unreachable",
    );
  });

  it("候选全 404/405 = 这家没有模型列表接口，不是连不上", () => {
    expect(classifyProbe("v", { ok: false, failureKind: "unsupported", error: "HTTP 404", statuses: [404, 404] }, at).state).toBe("unsupported");
    expect(classifyProbe("v", { ok: false, failureKind: "unsupported", error: "HTTP 405", statuses: [405] }, at).state).toBe("unsupported");
  });

  it("2xx 但解析不出模型列表 = 没法预检，**不许**报「连不上」", () => {
    // 火山语音那类原生上游、以及后台 SPA 回 index.html 的地址都会走到这里。
    // 误报「连不上」会让本来能用的家看着像坏了——宁可漏报。
    expect(
      classifyProbe("v", { ok: false, failureKind: "invalid_response", error: "返回的不是模型列表（像是网页）", statuses: [200, 200] }, at).state,
    ).toBe("unsupported");
  });

  it("有一个候选 200、另一个 404 也算没法预检", () => {
    expect(classifyProbe("v", { ok: false, failureKind: "invalid_response", error: "x", statuses: [404, 200] }, at).state).toBe("unsupported");
  });

  it("unsupported 不带 reason——那不是错误，没有要给用户看的原因", () => {
    expect(classifyProbe("v", { ok: false, failureKind: "unsupported", error: "HTTP 404", statuses: [404] }, at).reason).toBeUndefined();
  });

  it("fetch 全抛错（statuses 空）= 真连不上", () => {
    expect(classifyProbe("v", { ok: false, error: "网络不可达", statuses: [] }, at).state).toBe("unreachable");
  });

  it("5xx = 连不上（上游此刻确实用不了）", () => {
    expect(classifyProbe("v", { ok: false, error: "HTTP 502", statuses: [502, 502] }, at).state).toBe("unreachable");
  });

  it.each(["auth", "rate_limit", "network", "upstream"] as const)(
    "does not call %s unsupported just because HTTP statuses are 200 or 404", (failureKind) => {
      expect(classifyProbe("v", { ok: false, failureKind, error: "real failure", statuses: [200, 404] }, at))
        .toMatchObject({ state: "unreachable", reason: "real failure" });
    },
  );

  it("maps a classified invalid list response to unsupported preflight, not broken generation", () => {
    expect(classifyProbe("v", { ok: false, failureKind: "invalid_response", statuses: [200] }, at).state)
      .toBe("unsupported");
  });
});

describe("checkVendorHealth — 前置跳过（不发请求的那些）", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    resetVendorHealthCache();
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function catalog(vendor: Record<string, unknown> | null, apiKey = "sk-test") {
    return {
      vendors: vendor ? [vendor] : [],
      apiKeysByVendor: apiKey ? { v: encryptedRecord(apiKey, "2026-08-11T00:00:00Z") } : {},
    };
  }

  it("legacy plaintext never reaches a health-probe request, header, error, or log", async () => {
    const sentinel = "SENTINEL-LEGACY-HEALTH";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    readCatalog.mockReturnValue({
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1" }],
      apiKeysByVendor: { v: { apiKey: sentinel, enc: "plain", enabled: true, updatedAt: "one" } },
    });
    const result = await checkVendorHealth("v");
    expect(result.state).toBe("unsupported");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify([result, errorSpy.mock.calls, warnSpy.mock.calls])).not.toContain(sentinel);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("没这家 → unsupported，一个请求都不发", async () => {
    readCatalog.mockReturnValue(catalog(null));
    expect((await checkVendorHealth("v")).state).toBe("unsupported");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("本地后端（authType=none）→ 不探（comfyui-local / codex-local 各有专属卡）", async () => {
    readCatalog.mockReturnValue(
      catalog({ key: "v", authType: "none", hasApiKey: true, baseUrlHint: "http://127.0.0.1:8188" }),
    );
    expect((await checkVendorHealth("v")).state).toBe("unsupported");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("没填地址 → 不探", async () => {
    readCatalog.mockReturnValue(catalog({ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "" }));
    expect((await checkVendorHealth("v")).state).toBe("unsupported");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("没 key → 不探（卡片这时是「待接入」）", async () => {
    readCatalog.mockReturnValue(
      catalog({ key: "v", authType: "bearer", hasApiKey: false, baseUrlHint: "https://api.example.com/v1" }, ""),
    );
    expect((await checkVendorHealth("v")).state).toBe("unsupported");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("checkVendorHealth — 缓存与并发（「重开面板不回退」靠这个）", () => {
  const fetchSpy = vi.fn();

  function okResponse() {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "gpt-4o" }] }),
    };
  }

  beforeEach(() => {
    resetVendorHealthCache();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
    readCatalog.mockReturnValue({
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1" }],
      apiKeysByVendor: { v: encryptedRecord("sk-a", "2026-08-11T00:00:00Z") },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("新鲜期内重复检查命中缓存，不再打上游", async () => {
    expect((await checkVendorHealth("v")).state).toBe("reachable");
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await checkVendorHealth("v");
    await checkVendorHealth("v");
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("force（用户点「重新检查」）跳过缓存", async () => {
    await checkVendorHealth("v");
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await checkVendorHealth("v", true);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("并发请求合流成一次探测（去重）", async () => {
    const [a, b, c] = await Promise.all([checkVendorHealth("v"), checkVendorHealth("v"), checkVendorHealth("v")]);
    expect(fetchSpy.mock.calls.length).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("换了 key（updatedAt 变）→ 缓存失效，重探", async () => {
    await checkVendorHealth("v");
    const callsAfterFirst = fetchSpy.mock.calls.length;
    readCatalog.mockReturnValue({
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1" }],
      apiKeysByVendor: { v: encryptedRecord("sk-b", "2026-08-11T09:00:00Z") },
    });
    await checkVendorHealth("v");
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("改了地址 → 缓存失效，重探", async () => {
    await checkVendorHealth("v");
    const callsAfterFirst = fetchSpy.mock.calls.length;
    readCatalog.mockReturnValue({
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.other.com/v1" }],
      apiKeysByVendor: { v: encryptedRecord("sk-a", "2026-08-11T00:00:00Z") },
    });
    await checkVendorHealth("v");
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("凭证送的是 Bearer 头，且探的是 /models", async () => {
    await checkVendorHealth("v");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/models");
    expect(new Headers((init as { headers: Record<string, string> }).headers).get("authorization")).toBe("Bearer sk-a");
  });

  it("replays saved custom-header auth and gateway headers instead of inventing Bearer", async () => {
    readCatalog.mockReturnValue({
      vendors: [{ key: "v", authType: "x-api-key", authHeader: "X-Tenant-Key", hasApiKey: true,
        baseUrlHint: "https://api.example.com/v1", meta: { extraHeaders: { "X-Gateway": "private-tenant" } } }],
      apiKeysByVendor: { v: encryptedRecord("custom-key", "one") },
    });
    expect((await checkVendorHealth("v")).state).toBe("reachable");
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({ "X-Tenant-Key": "custom-key", "X-Gateway": "private-tenant" });
  });

  it("replays saved query auth and invalidates cache when its configuration changes", async () => {
    const vendor = { key: "v", authType: "query", authQueryParam: "token", hasApiKey: true,
      baseUrlHint: "https://api.example.com/v1", meta: { extraHeaders: { "X-Gateway": "tenant-one" } } };
    readCatalog.mockReturnValue({ vendors: [vendor], apiKeysByVendor: { v: encryptedRecord("query-key", "one") } });
    await checkVendorHealth("v");
    expect(new URL(fetchSpy.mock.calls[0][0]).searchParams.get("token")).toBe("query-key");
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({ "X-Gateway": "tenant-one" });

    vendor.authQueryParam = "api_key";
    vendor.meta.extraHeaders["X-Gateway"] = "tenant-two";
    await checkVendorHealth("v");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(new URL(fetchSpy.mock.calls[1][0]).searchParams.get("api_key")).toBe("query-key");
    expect(fetchSpy.mock.calls[1][1].headers).toEqual({ "X-Gateway": "tenant-two" });
  });

  it("does not report a business auth failure in HTTP200 as unsupported", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: 401, data: [], message: "expired" }) });
    expect(await checkVendorHealth("v")).toMatchObject({
      state: "unreachable",
      reason: expect.stringContaining("HTTP 200: provider returned expired."),
    });
    expect((await checkVendorHealth("v")).reason).toContain("Next:");
  });

  it.each(["authorization", "AUTHORIZATION"])("sends only the saved %s override, not two Bearer values", async (header) => {
    readCatalog.mockReturnValue({
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1",
        meta: { extraHeaders: { [header]: "Bearer gateway-override" } } }],
      apiKeysByVendor: { v: encryptedRecord("stored", "one") },
    });
    expect((await checkVendorHealth("v")).state).toBe("reachable");
    expect(new Headers(fetchSpy.mock.calls[0][1].headers).get("authorization")).toBe("Bearer gateway-override");
  });
});
