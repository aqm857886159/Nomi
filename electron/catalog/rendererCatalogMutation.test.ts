import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogState } from "./types";
import {
  sanitizeRendererMappingMutation,
  sanitizeRendererModelMutation,
  sanitizeRendererVendorMutation,
  sanitizeRendererVendorApiKeyMutation,
  sanitizeRendererCatalogImport,
  upsertRendererCatalogVendorApiKey,
} from "./rendererCatalogMutation";
import * as store from "./catalogStore";
import { fetchModelList } from "../ai/onboarding/modelListProbe";
vi.mock("../ai/onboarding/modelListProbe", async (original) => ({ ...await original<typeof import("../ai/onboarding/modelListProbe")>(), fetchModelList: vi.fn() }));

vi.mock("./catalogStore", async (importActual) => {
  const actual = await importActual<typeof import("./catalogStore")>();
  return {
    ...actual,
    readCatalog: vi.fn(),
    upsertModelCatalogVendorApiKey: vi.fn((vendorKey: string, payload: unknown) => ({ vendorKey, payload })),
    upsertModelCatalogVendor: vi.fn((payload: unknown) => payload),
  };
});

function state(): CatalogState {
  return {
    version: 1,
    revision: 1,
    vendors: [{ key: "relay", name: "Relay", enabled: false, authType: "bearer", createdAt: "", updatedAt: "" }],
    models: [
      {
        vendorKey: "relay",
        modelKey: "image-1",
        labelZh: "Image",
        kind: "image",
        enabled: false,
        meta: { adapter: { state: "testing", modes: [{ taskKind: "text_to_image", state: "failed" }] } },
        createdAt: "",
        updatedAt: "",
      },
    ],
    mappings: [],
    apiKeysByVendor: { relay: { apiKey: "encrypted", enabled: true, createdAt: "", updatedAt: "" } },
  } as unknown as CatalogState;
}

describe("renderer Catalog mutation boundary", () => {
  afterEach(() => {
    vi.mocked(store.upsertModelCatalogVendorApiKey).mockClear();
    vi.mocked(store.upsertModelCatalogVendor).mockClear();
    vi.mocked(store.readCatalog).mockReset();
  });

  it("cannot raw-enable or forge publication for an uncertified adapter vendor/model/mapping", () => {
    const catalog = state();
    const vendor = sanitizeRendererVendorMutation(
      { key: "relay", enabled: true, meta: { adapter: { activeRevision: "forged" } } },
      catalog,
    );
    const model = sanitizeRendererModelMutation(
      {
        vendorKey: "relay",
        modelKey: "image-1",
        enabled: true,
        meta: { adapter: { activeRevision: "forged", modes: [{ taskKind: "text_to_image", state: "verified" }] } },
      },
      catalog,
    );
    const mapping = sanitizeRendererMappingMutation(
      {
        id: "raw",
        vendorKey: "relay",
        modelKey: "image-1",
        taskKind: "text_to_image",
        enabled: true,
        create: { method: "POST", path: "/generate" },
      },
      catalog,
    );

    expect(vendor.enabled).toBe(false);
    expect((vendor.meta as Json | undefined)?.adapter).toBeUndefined();
    expect(model.enabled).toBe(false);
    expect((model.meta as { adapter: unknown }).adapter).toEqual(
      (catalog.models[0].meta as { adapter: unknown }).adapter,
    );
    expect(mapping.enabled).toBe(false);
  });

  it("stages a renderer-created model as unverified even when adapter metadata is omitted", () => {
    const catalog = state();
    catalog.models = [];
    const model = sanitizeRendererModelMutation(
      {
        vendorKey: "relay",
        modelKey: "new-image",
        labelZh: "New",
        kind: "image",
        enabled: true,
      },
      catalog,
    );
    expect(model.enabled).toBe(false);
    expect(model.meta).toMatchObject({ adapter: { state: "unverified", modes: [] } });
  });

  it("never promotes a vendor while a renderer saves its API key", () => {
    expect(sanitizeRendererVendorApiKeyMutation({ apiKey: "sk-test", enabled: true })).toEqual({
      apiKey: "sk-test",
      enabled: false,
    });
  });

  it("imports renderer packages as unverified drafts instead of trusting serialized publication state", () => {
    const sanitized = sanitizeRendererCatalogImport({
      vendors: [
        {
          vendor: { key: "relay", enabled: true },
          models: [
            { vendorKey: "relay", modelKey: "image", enabled: true, meta: { adapter: { activeRevision: "forged" } } },
          ],
          mappings: [{ vendorKey: "relay", modelKey: "image", taskKind: "text_to_image", enabled: true }],
        },
      ],
    });
    expect(sanitized).toMatchObject({
      vendors: [
        {
          vendor: { enabled: false },
          models: [{ enabled: false, meta: { adapter: { state: "unverified", modes: [] } } }],
          mappings: [{ enabled: false }],
        },
      ],
    });
  });

  it("saves a configured credential enabled, independently of verification", async () => {
    const catalog = state();
    catalog.vendors[0] = { ...catalog.vendors[0], enabled: true } as never;
    vi.mocked(store.readCatalog).mockReturnValue(catalog);

    catalog.vendors[0].baseUrlHint = "https://relay.test/v1";
    vi.mocked(fetchModelList).mockResolvedValue({ ok: true, models: ["image-1"], statuses: [200] });
    await upsertRendererCatalogVendorApiKey("relay", { apiKey: "sk-test", enabled: true });

    expect(store.upsertModelCatalogVendorApiKey).toHaveBeenCalledWith("relay", { apiKey: "sk-test", enabled: true });
    expect(store.upsertModelCatalogVendor).not.toHaveBeenCalled();
  });

  it("rejects sign-in placement edits on certification-owned connections, in words the user can read", () => {
    const catalog = state();
    catalog.vendors[0] = {
      ...catalog.vendors[0],
      enabled: true,
      baseUrlHint: "https://old.example/v1",
      meta: { adapter: { activeRevision: "revision-old" } },
    } as never;

    expect(() => sanitizeRendererVendorMutation(
      { key: "relay", authType: "x-api-key", authHeader: "X-Key" },
      catalog,
    )).toThrow("这个连接的鉴权方式不能在这里改");
    // 以前抛给用户的就是这句英文原话（2026-09-29 用户截图）。
    expect(() => sanitizeRendererVendorMutation({ key: "relay", authType: "x-api-key" }, catalog))
      .not.toThrow(/Certification-owned|integration session/);
  });

  // 2026-09-29：新装机点过「继续验证 → 自检」的 APIMart 会带上 meta.adapter，于是设置里改接口地址
  // 被这道锁拒掉，老装机却能改。地址归用户在设置里亲手改——新老装机一个样。
  it("lets the settings page change the address of a certification-owned connection", () => {
    const catalog = state();
    catalog.vendors[0] = {
      ...catalog.vendors[0],
      enabled: true,
      baseUrlHint: "https://old.example/v1",
      meta: { adapter: { activeRevision: "revision-old" } },
    } as never;

    expect(sanitizeRendererVendorMutation({ key: "relay", baseUrlHint: "https://new.example/v1" }, catalog))
      .toMatchObject({ key: "relay", baseUrlHint: "https://new.example/v1" });
  });
});

type Json = Record<string, unknown>;


describe("B4 candidate credentials", () => {
  afterEach(() => vi.clearAllMocks());
  it("validates through the connection's configured network route", async () => {
    const catalog = state();
    catalog.vendors[0].baseUrlHint = "https://relay.test/v1";
    catalog.vendors[0].network = { proxyEnabled: true, proxyUrl: "http://127.0.0.1:7897" };
    vi.mocked(store.readCatalog).mockReturnValue(catalog);
    vi.mocked(fetchModelList).mockResolvedValue({ ok: true, models: ["image-1"], statuses: [200] });
    await upsertRendererCatalogVendorApiKey("relay", { apiKey: "candidate-test" });
    expect(fetchModelList).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ proxyUrl: "http://127.0.0.1:7897" }));
  });
  it("network failure still saves the candidate, with no pending marker", async () => {
    const catalog = state();
    catalog.vendors[0].baseUrlHint = "https://relay.test/v1";
    vi.mocked(store.readCatalog).mockReturnValue(catalog);
    vi.mocked(fetchModelList).mockResolvedValue({ ok: false, statuses: [], failureKind: "network", error: "offline" });
    await upsertRendererCatalogVendorApiKey("relay", { apiKey: "candidate-test" });
    expect(store.upsertModelCatalogVendorApiKey).toHaveBeenCalledWith("relay", { apiKey: "candidate-test", enabled: true });
  });
  /**
   * T-QA-13 的门岗（2026-09-18）。走查夹具「注入 key → hasApiKey」这条路整条死掉过，
   * 而且是**静默**死的：所有靠它的走查照样跑、照样绿，只是模型那一档从来没真通过。
   *
   * 根因不是夹具写错，是 `ApiKeyRecord.enabled` 一个布尔背了两个意思——「用户停用了这把钥匙」
   * （`credentialRecordCounts` 的读法）和「还没经过认证晋升」（渲染层写入的写法）。免鉴权的家
   * （本地 ComfyUI / Ollama / loopback 夹具）没有第二种意思可讲：它不发鉴权，没有「验过没验过」。
   * 于是它落进 enabled:false，`credentialRecordCounts` 判它不算数，`hasApiKey` 恒 false。
   *
   * 这两条断言就是那条不变量：免鉴权的家，① 不许拿「无法验证密钥」当失败报（没这件事可做），
   * ② 凭据写进去必须算数。任一条回退，靠夹具注入凭据的走查会再次整批变成假绿。
   */
  it("a no-auth vendor's credential counts (fixture key injection stays alive)", async () => {
    const catalog = state();
    catalog.vendors[0] = { ...catalog.vendors[0], authType: "none", baseUrlHint: "http://127.0.0.1:1/v1" };
    vi.mocked(store.readCatalog).mockReturnValue(catalog);
    await upsertRendererCatalogVendorApiKey("relay", { apiKey: "fixture-key" });
    expect(store.upsertModelCatalogVendorApiKey).toHaveBeenCalledWith("relay", { apiKey: "fixture-key", enabled: true });
    expect(fetchModelList).not.toHaveBeenCalled();
  });
  it("a no-auth vendor never reports a credential verification failure", async () => {
    const catalog = state();
    catalog.vendors[0] = { ...catalog.vendors[0], authType: "none", baseUrlHint: null };
    vi.mocked(store.readCatalog).mockReturnValue(catalog);
    await expect(upsertRendererCatalogVendorApiKey("relay", { apiKey: "fixture-key" })).resolves.toBeDefined();
  });
  // F1（D-1117-delete-verification 第一轮验收）：上一轮把这条改成「照存、标待验证」，丢了主分支的拒收闸。
  it.each([401, 403])("%i never overwrites the previous credential or disables its vendor", async (status) => {
    const catalog = state();
    catalog.vendors[0] = { ...catalog.vendors[0], enabled: true, baseUrlHint: "https://relay.test/v1" };
    vi.mocked(store.readCatalog).mockReturnValue(catalog);
    vi.mocked(fetchModelList).mockResolvedValue({ ok: false, status, statuses: [status], failureKind: "auth", error: `HTTP ${status}` });
    await expect(Promise.resolve().then(() => upsertRendererCatalogVendorApiKey("relay", { apiKey: "invalid-test-key" }))).rejects.toThrow();
    expect(store.upsertModelCatalogVendorApiKey).not.toHaveBeenCalled();
    expect(store.upsertModelCatalogVendor).not.toHaveBeenCalled();
  });
});
