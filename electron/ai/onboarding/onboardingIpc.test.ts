import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }));
vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), on: vi.fn(), quit: vi.fn() },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
}));
vi.mock("../../ipcSenderGuard", () => ({ assertTrustedSender: vi.fn() }));
vi.mock("../../catalog/catalogStore", () => ({
  normalizeProviderKind: (value: string) => value === "anthropic" || value === "openai-responses" ? value : "openai-compatible",
  // 2026-09-21：探测路现在从「已保存的那条连接」取鉴权方案词（connectionAuthSpec），所以这份
  // mock 要能回答「这条 baseUrl 有没有已保存的连接」。这里全是全新接入，恒空 → 缺省 Bearer，
  // 本文件既有断言逐字不变。
  readCatalog: () => ({ version: 8, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }),
}));

vi.mock("../../catalog/rendererCatalogMutation", () => ({
  upsertRendererCatalogVendorApiKey: vi.fn(async () => { throw new Error("candidate rejected; old key preserved"); }),
}));

import { registerOnboardingIpc } from "./onboardingIpc";

beforeEach(() => { handlers.clear(); registerOnboardingIpc(); });
afterEach(() => vi.unstubAllGlobals());

describe("onboarding discovery IPC preserves the shared result contract", () => {
  it("returns credential rejection in the IPC result envelope", async () => {
    const handler = handlers.get("nomi:model-catalog:vendor-api-key:upsert");
    expect(handler).toBeTypeOf("function");
    expect(await handler?.({}, "vendor", { apiKey: "invalid-fixture" })).toEqual({
      ok: false, error: "candidate rejected; old key preserved",
    });
  });
  it("does not register the removed raw manual Catalog commit bypass", () => {
    expect(handlers.has("nomi:onboarding:manual-commit")).toBe(false);
  });
  // D-1117-delete-verification（协调 2026-11-18 Q7）：「测试连接」整个删了，拉模型列表是唯一一条免费探测。
  // vendor-price-preview 不是探测：只读公开价目（不带凭据），不判任何连接能不能用，给发送键印约价。
  it("does not register the removed test-connection probe", () => {
    expect(handlers.has("nomi:onboarding:test-connection")).toBe(false);
    expect([...handlers.keys()].filter((channel) => channel.startsWith("nomi:onboarding:")).sort())
      .toEqual([
        "nomi:onboarding:guess-kinds",
        "nomi:onboarding:list-models",
        "nomi:onboarding:model-account",
        "nomi:onboarding:model-unit-prices",
        "nomi:onboarding:model-usage",
        "nomi:onboarding:vendor-account-balance",
        "nomi:onboarding:vendor-price-preview",
      ]);
  });
  it("forwards HTTP200 auth errors through list-models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 401, data: [], message: "expired" }), { status: 200 })));
    const result = await handlers.get("nomi:onboarding:list-models")?.({}, {
      baseUrl: "https://gateway.test/v1", apiKey: "secret", probe: "reachability",
    });
    expect(result).toMatchObject({
      ok: false,
      status: 200,
      failureKind: "auth",
      error: expect.stringContaining("HTTP 200: provider returned expired."),
    });
    expect((result as { error?: string })?.error).toContain("Next:");
  });

  it("classifies invalid addresses before the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await handlers.get("nomi:onboarding:list-models")?.({}, { baseUrl: "invalid", probe: "reachability" }))
      .toMatchObject({ ok: false, failureKind: "invalid_response" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies an invalid credential header as auth", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await handlers.get("nomi:onboarding:list-models")?.({}, { baseUrl: "https://gateway.test/v1", apiKey: "密钥", probe: "reachability" }))
      .toMatchObject({ ok: false, failureKind: "auth" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("replays an uppercase custom auth override exactly once", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await handlers.get("nomi:onboarding:list-models")?.({}, {
      baseUrl: "https://gateway.test/v1", apiKey: "stored", headers: { AUTHORIZATION: "Bearer override" }, probe: "reachability",
    })).toMatchObject({ ok: true });
    expect(new Headers(fetchSpy.mock.calls[0][1].headers).get("authorization")).toBe("Bearer override");
  });

  it.each(["openai-compatible", "openai-responses", "anthropic"])(
    "uses the same case-insensitive override for a %s free model-list check", async (providerKind) => {
      const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);
      const name = providerKind === "anthropic" ? "X-API-KEY" : "AUTHORIZATION";
      const override = providerKind === "anthropic" ? "override" : "Bearer override";
      expect(await handlers.get("nomi:onboarding:list-models")?.({}, {
        baseUrl: "https://gateway.test/v1", providerKind, apiKey: "stored", headers: { [name]: override },
      })).toMatchObject({ ok: true });
      const path = "/models";
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(`https://gateway.test/v1${path}`);
      expect(fetchSpy.mock.calls[0][1].method).toBe("GET");
      expect(new Headers(fetchSpy.mock.calls[0][1].headers).get(name)).toBe(override);
      expect(fetchSpy.mock.calls[0][1].body).toBeUndefined();
    },
  );

  it.each([
    { name: "chat protocol", payload: { providerKind: "openai-compatible" } },
    { name: "responses protocol", payload: { providerKind: "openai-responses" } },
    { name: "anthropic protocol", payload: { providerKind: "anthropic", baseUrl: "https://api.anthropic.test/v1" } },
    { name: "no protocol given", payload: {} as { baseUrl?: string } },
  ])("never sends POST for $name", async ({ payload }) => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method || "GET" });
      return new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 });
    }));
    const result = await handlers.get("nomi:onboarding:list-models")?.({}, {
      apiKey: "stored",
      ...payload,
      baseUrl: payload.baseUrl || "https://gateway.test/v1",
    });
    expect(result).toMatchObject({ ok: true });
    expect(requests).not.toEqual([]);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("uses the provider-specific proxy for discovery and reachability without replacing the app route", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit & { dispatcher?: unknown }) =>
      new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await handlers.get("nomi:onboarding:list-models")?.({}, {
      baseUrl: "https://gateway.test/v1",
      apiKey: "stored",
      proxyUrl: "http://127.0.0.1:7897",
    })).toMatchObject({ ok: true });

    // per-connection 代理作为显式 dispatcher 流到 appFetch（不改全局路由）；
    // 它是 SelectiveProxyDispatcher（私网走直连、公网走代理），满足 { dispatch } 形状。
    expect(fetchSpy.mock.calls[0][1].dispatcher).toEqual(expect.objectContaining({ dispatch: expect.any(Function) }));
  });
});
