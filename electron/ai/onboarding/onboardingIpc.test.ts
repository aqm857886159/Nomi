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
vi.mock("./vendorHealth", () => ({ checkVendorHealth: vi.fn() }));

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
  it.each(["list-models", "test-connection"])("forwards HTTP200 auth errors through %s", async (channel) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 401, data: [], message: "expired" }), { status: 200 })));
    const result = await handlers.get(`nomi:onboarding:${channel}`)?.({}, {
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

  it.each(["list-models", "test-connection"])("classifies invalid addresses before the network: %s", async (channel) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await handlers.get(`nomi:onboarding:${channel}`)?.({}, { baseUrl: "invalid", probe: "reachability" }))
      .toMatchObject({ ok: false, failureKind: "invalid_response" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["list-models", "test-connection"])("classifies an invalid credential header as auth: %s", async (channel) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await handlers.get(`nomi:onboarding:${channel}`)?.({}, { baseUrl: "https://gateway.test/v1", apiKey: "密钥", probe: "reachability" }))
      .toMatchObject({ ok: false, failureKind: "auth" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["list-models", "test-connection"])("replays an uppercase custom auth override exactly once through %s", async (channel) => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await handlers.get(`nomi:onboarding:${channel}`)?.({}, {
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
      expect(await handlers.get("nomi:onboarding:test-connection")?.({}, {
        baseUrl: "https://gateway.test/v1", providerKind, apiKey: "stored", modelId: "model", headers: { [name]: override },
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
    { name: "forced chat", payload: { providerKind: "openai-compatible" } },
    { name: "forced responses", payload: { providerKind: "openai-responses" } },
    { name: "automatic ordinary host", payload: { autoProbe: true } },
    { name: "automatic anthropic host", payload: { autoProbe: true, baseUrl: "https://api.anthropic.test/v1" } },
    { name: "reachability only", payload: { probe: "reachability" } },
  ])("never sends POST for $name", async ({ payload }) => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method || "GET" });
      return new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 });
    }));
    const result = await handlers.get("nomi:onboarding:test-connection")?.({}, {
      baseUrl: payload.baseUrl || "https://gateway.test/v1",
      apiKey: "stored",
      modelId: "model",
      ...payload,
    });
    expect(result).toMatchObject({ ok: true });
    expect(requests).not.toEqual([]);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    if (payload.baseUrl?.includes("anthropic")) expect(result).toMatchObject({ detectedKind: "anthropic" });
    else expect(result).not.toHaveProperty("detectedKind");
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
