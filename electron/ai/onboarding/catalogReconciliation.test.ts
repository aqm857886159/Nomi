import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const broadcast = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: broadcast } }] },
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  ipcMain: { handle: () => {} },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

const readCatalog = vi.fn();
vi.mock("../../catalog/catalogStore", () => ({
  readCatalog: () => readCatalog(),
  mutateCatalog: (fn: (tx: { upsertModel: (patch: unknown) => void }, state: ReturnType<typeof readCatalog>) => void) => {
    const state = readCatalog();
    fn({ upsertModel: (raw) => {
      const patch = raw as { vendorKey: string; modelKey: string };
      const model = state.models.find((row: { vendorKey: string; modelKey: string }) => row.vendorKey === patch.vendorKey && row.modelKey === patch.modelKey);
      Object.assign(model, patch);
    } }, state);
  },
  normalizeProviderKind: (v: unknown, fallback = "openai-compatible") =>
    v === "anthropic" || v === "openai-compatible" || v === "openai-responses" ? v : fallback,
}));

import { reconcileVendorModelList, resetCatalogReconciliationCache } from "./catalogReconciliation";

const encryptedRecord = (plain: string, updatedAt: string) => ({
  apiKey: Buffer.from(plain).toString("base64"),
  enc: "safeStorage" as const,
  enabled: true,
  updatedAt,
});

// D-1117-delete-verification：这里原来是「供应商连接健康」（打开面板探一次、说成连得上 / 连不上），
// 那套判断整个删了。留下的只有拉模型列表、对账「暂未列出」——它不产出任何对这家的判断。

function okResponse(ids: string[] = ["gpt-4o"]) {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
}

describe("reconcileVendorModelList — 不该发的不发", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    resetCatalogReconciliationCache();
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function catalog(vendor: Record<string, unknown> | null, apiKey = "sk-test") {
    return {
      models: [],
      vendors: vendor ? [vendor] : [],
      apiKeysByVendor: apiKey ? { v: encryptedRecord(apiKey, "2026-08-11T00:00:00Z") } : {},
    };
  }

  it("legacy plaintext never reaches a list request, header, error, or log", async () => {
    const sentinel = "SENTINEL-LEGACY-HEALTH";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    readCatalog.mockReturnValue({
      models: [],
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1" }],
      apiKeysByVendor: { v: { apiKey: sentinel, enc: "plain", enabled: true, updatedAt: "one" } },
    });
    await expect(reconcileVendorModelList("v")).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify([errorSpy.mock.calls, warnSpy.mock.calls])).not.toContain(sentinel);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("没这家 → 一个请求都不发", async () => {
    readCatalog.mockReturnValue(catalog(null));
    await reconcileVendorModelList("v");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("本地后端（authType=none）→ 不拉", async () => {
    readCatalog.mockReturnValue(catalog({ key: "v", authType: "none", hasApiKey: true, baseUrlHint: "http://127.0.0.1:8188" }));
    await reconcileVendorModelList("v");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("没填地址 → 不拉", async () => {
    readCatalog.mockReturnValue(catalog({ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "" }));
    await reconcileVendorModelList("v");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("没 key / 创作者关了 key → 不拉（旧版留下的待复验标记也不再让它拉）", async () => {
    readCatalog.mockReturnValue(catalog({ key: "v", authType: "bearer", hasApiKey: false, baseUrlHint: "https://api.example.com/v1" }, ""));
    await reconcileVendorModelList("v");
    readCatalog.mockReturnValue({
      models: [],
      vendors: [{ key: "v", authType: "bearer", hasApiKey: false, baseUrlHint: "https://api.example.com/v1" }],
      apiKeysByVendor: { v: { ...encryptedRecord("pending", "pending"), enabled: false, verificationPending: true } },
    });
    await reconcileVendorModelList("v");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("reconcileVendorModelList — 请求形状与合流", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    resetCatalogReconciliationCache();
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async () => okResponse());
    vi.stubGlobal("fetch", fetchSpy);
    readCatalog.mockReturnValue({
      models: [],
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1" }],
      apiKeysByVendor: { v: encryptedRecord("sk-a", "2026-08-11T00:00:00Z") },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("并发请求合流成一次", async () => {
    await Promise.all([reconcileVendorModelList("v"), reconcileVendorModelList("v"), reconcileVendorModelList("v")]);
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  it("凭证送的是 Bearer 头，且拉的是 /models", async () => {
    await reconcileVendorModelList("v");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/models");
    expect(new Headers((init as { headers: Record<string, string> }).headers).get("authorization")).toBe("Bearer sk-a");
  });

  it("replays saved custom-header auth and gateway headers instead of inventing Bearer", async () => {
    readCatalog.mockReturnValue({
      models: [],
      vendors: [{ key: "v", authType: "x-api-key", authHeader: "X-Tenant-Key", hasApiKey: true,
        baseUrlHint: "https://api.example.com/v1", meta: { extraHeaders: { "X-Gateway": "private-tenant" } } }],
      apiKeysByVendor: { v: encryptedRecord("custom-key", "one") },
    });
    await reconcileVendorModelList("v");
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({ "X-Tenant-Key": "custom-key", "X-Gateway": "private-tenant" });
  });

  it("replays saved query auth, and a changed configuration sends the new one", async () => {
    const vendor = { key: "v", authType: "query", authQueryParam: "token", hasApiKey: true,
      baseUrlHint: "https://api.example.com/v1", meta: { extraHeaders: { "X-Gateway": "tenant-one" } } };
    readCatalog.mockReturnValue({
      models: [], vendors: [vendor], apiKeysByVendor: { v: encryptedRecord("query-key", "one") } });
    await reconcileVendorModelList("v");
    expect(new URL(fetchSpy.mock.calls[0][0]).searchParams.get("token")).toBe("query-key");
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({ "X-Gateway": "tenant-one" });

    vendor.authQueryParam = "api_key";
    vendor.meta.extraHeaders["X-Gateway"] = "tenant-two";
    await reconcileVendorModelList("v");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(new URL(fetchSpy.mock.calls[1][0]).searchParams.get("api_key")).toBe("query-key");
    expect(fetchSpy.mock.calls[1][1].headers).toEqual({ "X-Gateway": "tenant-two" });
  });

  it.each(["authorization", "AUTHORIZATION"])("sends only the saved %s override, not two Bearer values", async (header) => {
    readCatalog.mockReturnValue({
      models: [],
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1",
        meta: { extraHeaders: { [header]: "Bearer gateway-override" } } }],
      apiKeysByVendor: { v: encryptedRecord("stored", "one") },
    });
    await reconcileVendorModelList("v");
    expect(new Headers(fetchSpy.mock.calls[0][1].headers).get("authorization")).toBe("Bearer gateway-override");
  });

  it("拉不到（401 / 断网）什么都不写、也不广播——这里不产出「连不上」", async () => {
    const catalog = {
      models: [{ vendorKey: "v", modelKey: "gone", kind: "text", enabled: true, meta: {} }],
      vendors: [{ key: "v", authType: "bearer", hasApiKey: true, baseUrlHint: "https://api.example.com/v1" }],
      apiKeysByVendor: { v: encryptedRecord("sk-a", "one") },
    };
    readCatalog.mockReturnValue(catalog);
    broadcast.mockClear();
    fetchSpy.mockImplementation(async () => new Response("denied", { status: 401 }));
    await reconcileVendorModelList("v");
    fetchSpy.mockImplementation(async () => { throw new Error("offline"); });
    await reconcileVendorModelList("v");
    expect(catalog.models[0]).toEqual({ vendorKey: "v", modelKey: "gone", kind: "text", enabled: true, meta: {} });
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('live catalog reconciliation delivery', () => {
  const row = () => ({ vendorKey: 'v', modelKey: 'gone', kind: 'text', enabled: true, meta: { catalogLifecycle: 'value' } })
  const state = () => ({ vendors: [{ key: 'v', authType: 'bearer', hasApiKey: true, baseUrlHint: 'https://gateway.test/v1' }], models: [row()], apiKeysByVendor: { v: encryptedRecord('synthetic', 'one') } })
  beforeEach(() => { resetCatalogReconciliationCache(); broadcast.mockClear() })
  afterEach(() => vi.unstubAllGlobals())
  it('marks unlisted from a full response and broadcasts invalidation, without touching the user enable decision', async () => {
    // 2026-09-21：后台对账只落旁注。两处同改：① 断言从 enabled:false 改成 enabled 原样为 true
    // ② 清单从空数组改成「有内容但不含这一条」——一份成功但空的清单不再算证据（网关抖动会回它）。
    const catalog = state()
    readCatalog.mockReturnValue(catalog)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'still-here' }] }))))
    await reconcileVendorModelList('v')
    expect(catalog.models[0]).toMatchObject({ enabled: true, unlisted: true })
    expect(broadcast).toHaveBeenCalledWith('nomi:model-catalog:changed')
  })
  it('drops old list evidence if the connection changes while the request is in flight', async () => {
    const catalog = state()
    readCatalog.mockReturnValue(catalog)
    let respond!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
    const pending = reconcileVendorModelList('v')
    catalog.vendors[0].baseUrlHint = 'https://replacement.test/v1'
    respond(new Response(JSON.stringify({ data: [{ id: 'still-here' }] })))
    await pending
    expect(catalog.models[0].enabled).toBe(true)
    expect(broadcast).not.toHaveBeenCalled()
  })
})
