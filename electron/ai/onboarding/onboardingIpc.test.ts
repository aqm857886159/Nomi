import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }));
vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), on: vi.fn(), quit: vi.fn() },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
}));
vi.mock("../../ipcSenderGuard", () => ({ assertTrustedSender: vi.fn() }));
vi.mock("../../catalog/catalogStore", () => ({
  normalizeProviderKind: (value: string) => value === "anthropic" || value === "openai-responses" ? value : "openai-compatible",
}));
vi.mock("./vendorHealth", () => ({ checkVendorHealth: vi.fn() }));

import { registerOnboardingIpc } from "./onboardingIpc";

beforeEach(() => { handlers.clear(); registerOnboardingIpc(); });
afterEach(() => vi.unstubAllGlobals());

describe("onboarding discovery IPC preserves the shared result contract", () => {
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
    "uses the same case-insensitive override for a %s POST protocol test", async (providerKind) => {
      const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);
      const name = providerKind === "anthropic" ? "X-API-KEY" : "AUTHORIZATION";
      const override = providerKind === "anthropic" ? "override" : "Bearer override";
      expect(await handlers.get("nomi:onboarding:test-connection")?.({}, {
        baseUrl: "https://gateway.test/v1", providerKind, apiKey: "stored", modelId: "model", headers: { [name]: override },
      })).toMatchObject({ ok: true });
      const path = providerKind === "anthropic" ? "/messages"
        : providerKind === "openai-responses" ? "/responses" : "/chat/completions";
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(`https://gateway.test/v1${path}`);
      expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
      expect(new Headers(fetchSpy.mock.calls[0][1].headers).get(name)).toBe(override);
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
      expect(body).toEqual(providerKind === "openai-responses"
        ? { model: "model", input: "ping", max_output_tokens: 16 }
        : { model: "model", messages: [{ role: "user", content: "ping" }], max_tokens: 1 });
    },
  );

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
