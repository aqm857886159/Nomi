/**
 * User-perspective end-to-end test for the PRIMARY model-adding path
 * (manual BaseURL entry). Simulates the exact journey that was impossible
 * before this change:
 *
 *   Clean install, ZERO models  →  user fills BaseURL + key + model(s)  →
 *   保存  →  models and credentials land in the catalog as non-executable
 *   candidates until the certification path promotes verified modes.
 *
 * This guards the newer verified-only visibility boundary while retaining the
 * multi-model transaction coverage from docs/plan/onboarding-baseurl-entry.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitOnboardedModelsToCatalog } from "./catalog/catalogCommit";
import {
  commitManualOpenAiCompatibleModels,
  deriveVendorKeyFromBaseUrl,
  ensureBuiltinModelSeeds,
  extractVendorExtraHeaders,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  normalizeProviderKind,
  resolveOnboardingAgentFromCatalog,
  upsertModelCatalogModel,
  upsertModelCatalogMapping,
  upsertModelCatalogVendor,
} from "./runtime";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];
const safeStorageTest = vi.hoisted(() => ({
  encryptString: vi.fn((value: string) => Buffer.from(value)),
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  // Provide a deterministic safeStorage round-trip for headless tests.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: safeStorageTest.encryptString,
    decryptString: (b: Buffer) => b.toString(),
  },
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-manual-onboarding-");
  safeStorageTest.encryptString.mockReset();
  safeStorageTest.encryptString.mockImplementation((value: string) => Buffer.from(value));
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("ensureBuiltinModelSeeds — 内置模型种子（启动时调一次）", () => {
  it("写入 kie vendor + Seedance 模型(meta.archetypeId) + 首帧 mapping，且幂等不重复", () => {
    // 干净安装：seed 前目录为空（readCatalog 不自动 seed，避免污染）
    expect(listModelCatalogVendors()).toHaveLength(0);
    expect(listModelCatalogModels()).toHaveLength(0);

    ensureBuiltinModelSeeds();

    expect(listModelCatalogVendors().map((v) => v.key)).toContain("kie");
    const seedance = listModelCatalogModels().find((m) => m.modelKey === "bytedance/seedance-2");
    expect(seedance).toMatchObject({ vendorKey: "kie", kind: "video", enabled: true });
    expect((seedance?.meta as { archetypeId?: string } | undefined)?.archetypeId).toBe("seedance-2");
    expect(
      listModelCatalogMappings().some((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video"),
    ).toBe(true);

    // 幂等：再调一次不重复
    ensureBuiltinModelSeeds();
    expect(listModelCatalogVendors().filter((v) => v.key === "kie")).toHaveLength(1);
    expect(listModelCatalogModels().filter((m) => m.modelKey === "bytedance/seedance-2")).toHaveLength(1);
  });
});

describe("manual model entry — user journey", () => {
  it("stages a fresh model without making an unverified connection executable", () => {
    // Precondition: clean install — nothing the doc-reading agent could use.
    expect(resolveOnboardingAgentFromCatalog()).toBeNull();
    expect(listModelCatalogModels()).toHaveLength(0);

    // The user fills the manual form and hits 保存.
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "本地 Ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      models: [{ id: "llama3.1", displayName: "Llama 3.1" }],
    });

    expect(result.vendorKey).toBe("local-11434");
    expect(result.committed).toEqual([{ modelKey: "llama3.1", displayName: "Llama 3.1" }]);

    // Saving only stages the candidate. Certification owns the enabled transition.
    const models = listModelCatalogModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      modelKey: "llama3.1",
      kind: "text",
      enabled: false,
      meta: { adapter: { state: "unverified", modes: [] } },
    });
    expect(listModelCatalogVendors()[0]).toMatchObject({ key: "local-11434", enabled: false });

    expect(resolveOnboardingAgentFromCatalog()).toBeNull();
  });

  it("does not report a legacy plaintext credential as healthy or executable", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "Legacy",
      baseUrl: "https://legacy.example.test/v1",
      apiKey: "temporary-secure-write",
      models: [{ id: "legacy-text", kind: "text" }],
    });
    const catalogFile = path.join(mockedUserDataRoot, "model-catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as {
      apiKeysByVendor: Record<string, { apiKey: string; enc?: string; enabled: boolean }>;
    };
    catalog.apiKeysByVendor['legacy-example-test'] = {
      ...catalog.apiKeysByVendor['legacy-example-test'],
      apiKey: "sentinel-legacy-plain",
      enc: "plain",
    };
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));

    expect(listModelCatalogVendors().find((vendor) => vendor.key === 'legacy-example-test')?.hasApiKey).toBe(false);
  });

  it("adds multiple models under one vendor in a single save", () => {
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "我的中转站",
      baseUrl: "https://api.relay.example.com/v1",
      apiKey: "sk-abc",
      models: [
        { id: "gpt-4o" },
        { id: "gpt-4o-mini", displayName: "4o mini" },
        { id: "claude-3.5" },
      ],
    });

    expect(result.committed).toHaveLength(3);
    // One vendor, three models.
    expect(listModelCatalogVendors()).toHaveLength(1);
    expect(listModelCatalogModels().map((m) => m.modelKey).sort()).toEqual([
      "claude-3.5",
      "gpt-4o",
      "gpt-4o-mini",
    ]);
    // 显示名缺省时人话化排版，不再落裸 id（审计 A13，humanizeModelKey）。
    const gpt4o = listModelCatalogModels().find((m) => m.modelKey === "gpt-4o");
    expect(gpt4o?.labelZh).toBe("Gpt 4o");
  });

  it("records provenance as manual and writes NO http mapping (text runs via direct AI SDK path)", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "x",
      baseUrl: "https://api.x.test/v1",
      apiKey: "k",
      models: [{ id: "m1" }],
    });
    const model = listModelCatalogModels()[0] as { onboarding?: { addedVia?: string } };
    expect(model.onboarding?.addedVia).toBe("manual");
  });

  it("de-duplicates repeated model ids and rejects empty/invalid input", () => {
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "y",
      baseUrl: "https://api.y.test/v1",
      apiKey: "k",
      models: [{ id: "dup" }, { id: "dup" }, { id: "  " }, { id: "real" }],
    });
    expect(result.committed.map((c) => c.modelKey)).toEqual(["dup", "real"]);

    expect(() =>
      commitManualOpenAiCompatibleModels({ vendorName: "z", baseUrl: "ftp://nope", apiKey: "k", models: [{ id: "a" }] }),
    ).toThrow(/http/);
    expect(() =>
      commitManualOpenAiCompatibleModels({ vendorName: "z", baseUrl: "https://ok.test/v1", apiKey: "", models: [{ id: "a" }] }),
    ).toThrow(/API Key/);
    expect(() =>
      commitManualOpenAiCompatibleModels({ vendorName: "z", baseUrl: "https://ok.test/v1", apiKey: "k", models: [] }),
    ).toThrow(/模型/);
  });

  it("supports Anthropic-native endpoints (blank BaseURL defaults to the official host)", () => {
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "Claude 原生",
      baseUrl: "",
      apiKey: "sk-ant-xxx",
      providerKind: "anthropic",
      models: [{ id: "claude-3-5-sonnet-latest" }],
    });
    // Blank BaseURL filled in with the canonical host → stable vendor key.
    expect(result.vendorKey).toBe("api-anthropic-com");

    const vendor = listModelCatalogVendors()[0] as {
      providerKind?: string;
      baseUrlHint?: string | null;
      authType?: string;
    };
    expect(vendor.providerKind).toBe("anthropic");
    expect(vendor.baseUrlHint).toBe("https://api.anthropic.com");
    expect(vendor.authType).toBe("x-api-key");

    // Saving provider metadata does not bypass certification.
    expect(resolveOnboardingAgentFromCatalog()).toBeNull();
  });

  it("supports OpenAI Responses relays (foxcode codex shape): persists openai-responses + bearer, survives round-trip", () => {
    // 这正是 2026-06-06 接不进来的那类供应商：wire_api=responses。改前 main.ts 的 2 值
    // clamp 会把它降级成 openai-compatible；改后全链路走 normalizeProviderKind，存活到底。
    const result = commitManualOpenAiCompatibleModels({
      vendorName: "foxcode codex",
      baseUrl: "https://api.fox-code.com/v1",
      apiKey: "sk-fox-xxx",
      providerKind: "openai-responses",
      models: [{ id: "gpt-5-codex" }],
    });
    expect(result.vendorKey).toBe("api-fox-code-com");

    const vendor = listModelCatalogVendors()[0] as {
      providerKind?: string;
      baseUrlHint?: string | null;
      authType?: string;
    };
    // 第 3 协议存盘不被吞，认证仍是 bearer（非 anthropic 的 x-api-key）。
    expect(vendor.providerKind).toBe("openai-responses");
    expect(vendor.baseUrlHint).toBe("https://api.fox-code.com/v1");
    expect(vendor.authType).toBe("bearer");

    expect(resolveOnboardingAgentFromCatalog()).toBeNull();
  });

  it("persists custom request headers on the vendor and surfaces them to the agent", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "中转站",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "k",
      headers: { "HTTP-Referer": "https://nomi.app", "X-Title": "Nomi", blankKey: "  " },
      models: [{ id: "gpt-4o" }],
    });

    const vendor = listModelCatalogVendors()[0];
    // Headers land under vendor.meta.extraHeaders, blanks dropped.
    expect(extractVendorExtraHeaders(vendor)).toEqual({
      "HTTP-Referer": "https://nomi.app",
      "X-Title": "Nomi",
    });

    // Header persistence is independent from executable visibility.
    expect(resolveOnboardingAgentFromCatalog()).toBeNull();
  });

  it("re-adding under the same endpoint reuses the vendor and appends models (upsert)", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "same",
      baseUrl: "https://api.same.test/v1",
      apiKey: "k1",
      models: [{ id: "first" }],
    });
    commitManualOpenAiCompatibleModels({
      vendorName: "same",
      baseUrl: "https://api.same.test/v1",
      apiKey: "k2",
      models: [{ id: "second" }],
    });
    expect(listModelCatalogVendors()).toHaveLength(1);
    expect(listModelCatalogModels().map((m) => m.modelKey).sort()).toEqual(["first", "second"]);
  });

  it("keeps a published custom-call model and vendor enabled when its credential is re-saved", () => {
    const baseUrl = "https://scripted.example.test/v1";
    const vendorKey = deriveVendorKeyFromBaseUrl(baseUrl);
    upsertModelCatalogVendor({
      key: vendorKey,
      name: "Scripted",
      enabled: true,
      baseUrlHint: baseUrl,
      authType: "bearer",
    });
    upsertModelCatalogModel({
      vendorKey,
      modelKey: "scripted-image",
      modelAlias: "published-alias",
      labelZh: "Published Scripted Image",
      kind: "image",
      enabled: true,
      customCall: { script: "return { assets: ['https://example.test/image.png'] }", updatedAt: "t" },
      meta: { adapter: { state: "failed", modes: [], updatedAt: "t" }, contractMarker: "published" },
      onboarding: { addedVia: "agent", addedAt: "old", fields: [] },
    });
    upsertModelCatalogMapping({
      id: "scripted-image-t2i",
      vendorKey,
      modelKey: "scripted-image",
      taskKind: "text_to_image",
      name: "Published mapping",
      enabled: true,
      create: { method: "POST", path: "/published/images" },
    });

    commitManualOpenAiCompatibleModels({
      vendorName: "Scripted",
      baseUrl,
      apiKey: "sk-resaved",
      models: [{ id: "scripted-image", displayName: "Unverified replacement", kind: "video" }],
    });

    expect(listModelCatalogVendors().find((vendor) => vendor.key === vendorKey)?.enabled).toBe(true);
    expect(listModelCatalogModels().find((model) => model.vendorKey === vendorKey && model.modelKey === "scripted-image")).toMatchObject({
      modelAlias: "published-alias",
      labelZh: "Published Scripted Image",
      kind: "image",
      enabled: true,
      customCall: { script: expect.stringContaining("assets") },
      meta: { contractMarker: "published" },
      onboarding: { addedVia: "agent", addedAt: "old" },
    });
    expect(listModelCatalogMappings().find((mapping) => mapping.id === "scripted-image-t2i")).toMatchObject({
      taskKind: "text_to_image",
      enabled: true,
      create: { path: "/published/images" },
    });
  });

  it("stages a manual connection re-save without changing the shared active vendor, credential, or sibling model", () => {
    const activeBaseUrl = "https://shared.example.test/v1";
    const vendorKey = deriveVendorKeyFromBaseUrl(activeBaseUrl);
    commitManualOpenAiCompatibleModels({
      vendorName: "Shared",
      baseUrl: activeBaseUrl,
      apiKey: "active-key",
      models: [{ id: "target", kind: "image" }, { id: "sibling", kind: "video" }],
    });
    upsertModelCatalogVendor({
      key: vendorKey,
      name: "Shared",
      enabled: true,
      baseUrlHint: activeBaseUrl,
      authType: "bearer",
      providerKind: "openai-compatible",
      meta: { extraHeaders: { "X-Active": "yes" } },
    });
    for (const [modelKey, kind] of [["target", "image"], ["sibling", "video"]] as const) {
      upsertModelCatalogModel({ vendorKey, modelKey, labelZh: modelKey, kind, enabled: true });
      upsertModelCatalogMapping({
        vendorKey,
        modelKey,
        taskKind: kind === "image" ? "text_to_image" : "text_to_video",
        name: modelKey,
        enabled: true,
        create: { method: "POST", path: `/active-${modelKey}` },
      });
    }
    const catalogFile = path.join(mockedUserDataRoot, "model-catalog.json");
    const activeBefore = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as {
      vendors: Array<Record<string, unknown>>;
      models: Array<Record<string, unknown>>;
      mappings: Array<Record<string, unknown>>;
      apiKeysByVendor: Record<string, unknown>;
    };

    const result = commitManualOpenAiCompatibleModels({
      vendorName: "Candidate",
      baseUrl: "https://shared.example.test/v2",
      apiKey: "candidate-key",
      providerKind: "openai-responses",
      headers: { "X-Candidate": "yes" },
      models: [{ id: "target", kind: "video" }],
    });
    const after = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as typeof activeBefore;

    expect(result.vendorKey).not.toBe(vendorKey);
    expect(after.vendors.find((vendor) => vendor.key === vendorKey)).toEqual(
      activeBefore.vendors.find((vendor) => vendor.key === vendorKey),
    );
    expect(after.apiKeysByVendor[vendorKey]).toEqual(activeBefore.apiKeysByVendor[vendorKey]);
    expect(after.models.filter((model) => model.vendorKey === vendorKey)).toEqual(
      activeBefore.models.filter((model) => model.vendorKey === vendorKey),
    );
    expect(after.mappings.filter((mapping) => mapping.vendorKey === vendorKey)).toEqual(
      activeBefore.mappings.filter((mapping) => mapping.vendorKey === vendorKey),
    );
    expect(after.vendors.find((vendor) => vendor.key === result.vendorKey)).toMatchObject({
      enabled: false,
      baseUrlHint: "https://shared.example.test/v2",
      providerKind: "openai-responses",
      meta: expect.objectContaining({ adapterCandidateSourceVendorKey: vendorKey }),
    });

    const replacement = commitManualOpenAiCompatibleModels({
      vendorName: "Candidate retry",
      baseUrl: "https://shared.example.test/v2",
      apiKey: "candidate-key-retry",
      providerKind: "openai-responses",
      headers: { "X-Candidate": "yes" },
      models: [{ id: "target", kind: "video" }],
    });
    const afterRetry = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as typeof activeBefore;
    expect(replacement.vendorKey).not.toBe(result.vendorKey);
    expect(afterRetry.vendors.some((vendor) => vendor.key === result.vendorKey)).toBe(false);
    expect(afterRetry.models.some((model) => model.vendorKey === result.vendorKey)).toBe(false);
    expect(afterRetry.mappings.some((mapping) => mapping.vendorKey === result.vendorKey)).toBe(false);
    expect(afterRetry.apiKeysByVendor[result.vendorKey]).toBeUndefined();
    expect(afterRetry.vendors.find((vendor) => vendor.key === replacement.vendorKey)?.meta).toMatchObject({
      adapterCandidateSourceVendorKey: vendorKey,
      adapterCandidateRootVendorKey: vendorKey,
      adapterCandidateRevisionId: expect.stringMatching(/^manual-onboarding-/),
    });
  });

  it("commits every manual model in one transaction and publishes official per-mode DTO fields", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "Batch",
      baseUrl: "https://batch.example.test/v1",
      apiKey: "batch-key",
      models: [{ id: "image-a", kind: "image" }, { id: "video-b", kind: "video" }],
    });
    const catalogFile = path.join(mockedUserDataRoot, "model-catalog.json");
    const parsed = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as { models: unknown[] };
    expect(parsed.models).toHaveLength(2);

    const rows = listModelCatalogModels() as Array<Record<string, unknown>>;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelKey: "image-a", published: false, publishedModes: [] }),
      expect.objectContaining({ modelKey: "video-b", published: false, publishedModes: [] }),
    ]));
    expect(safeStorageTest.encryptString).toHaveBeenCalledTimes(1);
  });

  it("persists every model predecessor when a manual batch spans root and a promoted candidate", () => {
    const baseUrl = "https://mixed-predecessor.example.test/v1";
    const rootVendorKey = deriveVendorKeyFromBaseUrl(baseUrl);
    commitManualOpenAiCompatibleModels({
      vendorName: "Mixed predecessor",
      baseUrl,
      apiKey: "root-key",
      models: [{ id: "image-a", kind: "image" }, { id: "video-b", kind: "video" }],
    });
    const catalogFile = path.join(mockedUserDataRoot, "model-catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as {
      vendors: Array<Record<string, unknown>>;
      models: Array<Record<string, unknown>>;
      mappings: Array<Record<string, unknown>>;
      apiKeysByVendor: Record<string, unknown>;
    };
    const promotedVendorKey = `${rootVendorKey}--candidate-promoted-a`;
    const rootVendor = catalog.vendors.find((vendor) => vendor.key === rootVendorKey)!;
    const rootImage = catalog.models.find((model) => model.vendorKey === rootVendorKey && model.modelKey === "image-a")!;
    const rootVideo = catalog.models.find((model) => model.vendorKey === rootVendorKey && model.modelKey === "video-b")!;
    Object.assign(rootVendor, { enabled: true });
    Object.assign(rootImage, { enabled: false });
    Object.assign(rootVideo, { enabled: true });
    catalog.vendors.push({
      ...rootVendor,
      key: promotedVendorKey,
      enabled: true,
      meta: {
        adapterCandidateSourceVendorKey: rootVendorKey,
        adapterCandidateRootVendorKey: rootVendorKey,
        adapterCandidateRevisionId: "promoted-a",
      },
    });
    catalog.models.push({ ...rootImage, vendorKey: promotedVendorKey, enabled: true });
    catalog.mappings.push(
      { id: "root-a", vendorKey: rootVendorKey, modelKey: "image-a", taskKind: "text_to_image", name: "root a", enabled: false, create: { method: "POST", path: "/root-a" }, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" },
      { id: "candidate-a", vendorKey: promotedVendorKey, modelKey: "image-a", taskKind: "text_to_image", name: "candidate a", enabled: true, create: { method: "POST", path: "/candidate-a" }, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" },
      { id: "root-b", vendorKey: rootVendorKey, modelKey: "video-b", taskKind: "text_to_video", name: "root b", enabled: true, create: { method: "POST", path: "/root-b" }, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" },
    );
    catalog.apiKeysByVendor[promotedVendorKey] = catalog.apiKeysByVendor[rootVendorKey];
    fs.writeFileSync(catalogFile, JSON.stringify(catalog), "utf8");

    const result = commitManualOpenAiCompatibleModels({
      vendorName: "Mixed next",
      baseUrl: "https://mixed-predecessor.example.test/v2",
      apiKey: "next-key",
      models: [{ id: "image-a", kind: "image" }, { id: "video-b", kind: "video" }],
    });
    const after = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as typeof catalog;

    expect(after.vendors.find((vendor) => vendor.key === result.vendorKey)?.meta).toMatchObject({
      adapterCandidateModelPredecessors: {
        "image-a": { vendorKey: promotedVendorKey, publishedModes: ["text_to_image"] },
        "video-b": { vendorKey: rootVendorKey, publishedModes: ["text_to_video"] },
      },
    });
  });

  it("leaves the catalog byte-identical when a later candidate is invalid", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "Existing",
      baseUrl: "https://existing.example.test/v1",
      apiKey: "existing-key",
      models: [{ id: "existing", kind: "text" }],
    });
    const catalogFile = path.join(mockedUserDataRoot, "model-catalog.json");
    const before = fs.readFileSync(catalogFile);
    const valid = {
      status: "success",
      trialId: "",
      docsUrl: "",
      draft: {
        vendorKey: "atomic-relay",
        vendorName: "Atomic",
        vendorBaseUrl: "https://atomic.example.test/v1",
        vendorAuth: { type: "bearer" },
        modelKey: "first",
        modelDisplayName: "First",
        targetKind: "text",
        modelFields: [],
      },
    };

    expect(() => commitOnboardedModelsToCatalog({
      entries: [
        { outcome: valid, userApiKey: "atomic-key", addedVia: "manual" },
        { outcome: { ...valid, draft: { ...valid.draft, vendorBaseUrl: "" } }, userApiKey: "atomic-key", addedVia: "manual" },
      ],
    })).toThrow(/incomplete draft/);
    expect(fs.readFileSync(catalogFile)).toEqual(before);
  });

  it("leaves the catalog byte-identical when the single batch encryption fails without echoing the secret", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "Existing",
      baseUrl: "https://existing.example.test/v1",
      apiKey: "existing-key",
      models: [{ id: "existing", kind: "text" }],
    });
    const catalogFile = path.join(mockedUserDataRoot, "model-catalog.json");
    const before = fs.readFileSync(catalogFile);
    const sentinel = "sentinel-batch-secret";
    safeStorageTest.encryptString.mockImplementation(() => { throw new Error(`failed ${sentinel}`); });

    let error: unknown;
    try {
      commitManualOpenAiCompatibleModels({
        vendorName: "Atomic",
        baseUrl: "https://atomic.example.test/v1",
        apiKey: sentinel,
        models: [{ id: "first", kind: "text" }, { id: "second", kind: "image" }],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(sentinel);
    expect(fs.readFileSync(catalogFile)).toEqual(before);
  });

  it("serializes concurrent batches without losing either catalog update", async () => {
    await Promise.all([
      Promise.resolve().then(() => commitManualOpenAiCompatibleModels({
        vendorName: "First",
        baseUrl: "https://first.example.test/v1",
        apiKey: "first-key",
        models: [{ id: "first-a", kind: "text" }, { id: "first-b", kind: "image" }],
      })),
      Promise.resolve().then(() => commitManualOpenAiCompatibleModels({
        vendorName: "Second",
        baseUrl: "https://second.example.test/v1",
        apiKey: "second-key",
        models: [{ id: "second-a", kind: "text" }, { id: "second-b", kind: "video" }],
      })),
    ]);

    expect(listModelCatalogModels().map((model) => model.modelKey).sort()).toEqual([
      "first-a", "first-b", "second-a", "second-b",
    ]);
  });
});

describe("normalizeProviderKind — 唯一归一化器（替代 main.ts 旧的 2 值 clamp）", () => {
  it("放行三个合法值原样返回", () => {
    expect(normalizeProviderKind("openai-compatible")).toBe("openai-compatible");
    expect(normalizeProviderKind("anthropic")).toBe("anthropic");
    expect(normalizeProviderKind("openai-responses")).toBe("openai-responses");
  });

  it("对脏输入回落到 openai-compatible（新信任边界：任意脏值不得抵达工厂）", () => {
    // CTO 评审要求的对抗输入：null/undefined/带空格/大小写/对象/数字。
    for (const bad of [null, undefined, "", "  openai-responses  ", "OpenAI-Responses", "responses", "gpt", 42, {}, []]) {
      expect(normalizeProviderKind(bad as unknown)).toBe("openai-compatible");
    }
  });

  it("尊重显式 fallback 参数", () => {
    expect(normalizeProviderKind("nonsense", "anthropic")).toBe("anthropic");
  });
});

describe("manual entry — per-model kind（Issue #8 中转图片/视频接入）", () => {
  it("图片模型：建 image 模型 + 比例/清晰度参数 + 参考图能力 + t2i 与 image_edit 两条 mapping", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "我的中转",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-x",
      models: [{ id: "dall-e-3", kind: "image" }],
    });
    const model = listModelCatalogModels().find((m) => m.modelKey === "dall-e-3");
    expect(model).toMatchObject({ kind: "image", enabled: false });
    const meta = model?.meta as { parameters?: Array<{ key: string }>; imageOptions?: { supportsReferenceImages?: boolean } } | undefined;
    // 分辨率放开：比例 + 清晰度（治「只能出 1K」），不再是写死的像素 size。
    expect((meta?.parameters || []).map((p) => p.key)).toEqual(expect.arrayContaining(["aspect_ratio", "resolution", "quality"]));
    // 参考图能力：驱动节点参考图槽 → 图生图。
    expect(meta?.imageOptions?.supportsReferenceImages).toBe(true);
    const vk = deriveVendorKeyFromBaseUrl("https://relay.example.com");
    const t2i = listModelCatalogMappings().find((x) => x.vendorKey === vk && x.taskKind === "text_to_image");
    expect(t2i?.create.path).toBe("/v1/images/generations");
    expect(t2i?.enabled).toBe(false);
    expect(t2i?.query).toBeUndefined();
    // 图生图 mapping：chat/completions 多模态。
    const edit = listModelCatalogMappings().find((x) => x.vendorKey === vk && x.taskKind === "image_edit");
    expect(edit?.create.path).toBe("/v1/chat/completions");
    expect(edit?.enabled).toBe(false);
  });

  it("同一中转的 Nano Banana 与 Grok：image_edit mapping 按模型精确分流，不再共用错误端点", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "混合图片中转",
      baseUrl: "https://mixed-relay.example.com",
      apiKey: "sk-x",
      models: [
        { id: "google/nano-banana-edit", kind: "image" },
        { id: "grok-imagine-image-quality", kind: "image" },
      ],
    });
    const vendorKey = deriveVendorKeyFromBaseUrl("https://mixed-relay.example.com");
    const edits = listModelCatalogMappings().filter((mapping) => mapping.vendorKey === vendorKey && mapping.taskKind === "image_edit");
    expect(edits).toHaveLength(2);
    expect(edits.find((mapping) => mapping.modelKey === "google/nano-banana-edit")?.create.path).toBe("/v1/chat/completions");
    expect(edits.find((mapping) => mapping.modelKey === "grok-imagine-image-quality")?.create.path).toBe("/v1/images/edits");
  });

  it("视频模型：建 video 模型 + /v1/video/generations 异步 create + 轮询 query", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "我的中转",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-x",
      models: [{ id: "kling-v1", kind: "video" }],
    });
    expect(listModelCatalogModels().find((m) => m.modelKey === "kling-v1")).toMatchObject({ kind: "video", enabled: false });
    const mp = listModelCatalogMappings().find((x) => x.taskKind === "text_to_video" && x.create.path === "/v1/video/generations");
    expect(mp).toBeTruthy();
    expect(mp?.enabled).toBe(false);
    expect(mp?.query?.path).toBe("/v1/video/generations/{{providerMeta.task_id}}");
  });

  it("视频模型同时建「图生视频」通道（缺它 → 连了首帧的节点被拒发「没有图生视频通道」）", () => {
    commitManualOpenAiCompatibleModels({
      vendorName: "我的中转",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-x",
      models: [{ id: "doubao-seedance-2-0-260128", kind: "video" }],
    });
    const i2v = listModelCatalogMappings().find(
      (x) => x.taskKind === "image_to_video" && x.modelKey === "doubao-seedance-2-0-260128",
    );
    expect(i2v).toBeTruthy();
    expect(i2v?.create.path).toBe("/v1/video/generations");
    // 首帧位必须读 image_url（taskParams 聚合首帧/参考图的那个键）。回归：参数键曾叫 image，
    // commit 的 reconcile 就把 body 的 image_url 槽覆盖成 {{request.params.image}}——那个键
    // taskParams 从不产出，连线的首帧静默到不了 wire（通道建了也白建）。
    const i2vBody = JSON.stringify(i2v?.create.body);
    expect(i2vBody).toContain("request.params.image_url");
    expect(i2vBody).not.toContain("request.params.image}}");
    // 文生视频那条同一个 body 模板，同样不许被覆盖。
    const t2vBody = JSON.stringify(
      listModelCatalogMappings().find((x) => x.taskKind === "text_to_video" && x.create.path === "/v1/video/generations")?.create.body,
    );
    expect(t2vBody).toContain("request.params.image_url");
    expect(t2vBody).not.toContain("request.params.image}}");
    // 视频是异步任务：图生视频这条也得带轮询，否则拿到 task_id 就断了。
    expect(i2v?.query?.path).toBe("/v1/video/generations/{{providerMeta.task_id}}");
  });

  it("混合一把加：图片+视频+文本各落对类型", () => {
    const res = commitManualOpenAiCompatibleModels({
      vendorName: "我的中转",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-x",
      models: [{ id: "flux-1", kind: "image" }, { id: "cogvideox", kind: "video" }, { id: "gpt-4o", kind: "text" }],
    });
    expect(res.committed).toHaveLength(3);
    const byKey = Object.fromEntries(listModelCatalogModels().map((m) => [m.modelKey, m.kind]));
    expect(byKey["flux-1"]).toBe("image");
    expect(byKey["cogvideox"]).toBe("video");
    expect(byKey["gpt-4o"]).toBe("text");
  });

  it("缺省 kind 仍按 text（向后兼容旧调用）", () => {
    commitManualOpenAiCompatibleModels({ vendorName: "本地", baseUrl: "http://localhost:11434/v1", apiKey: "x", models: [{ id: "llama3.1" }] });
    expect(listModelCatalogModels().find((m) => m.modelKey === "llama3.1")?.kind).toBe("text");
  });
});

describe("deriveVendorKeyFromBaseUrl", () => {
  it("derives a stable key from host, keeping local ports distinct", () => {
    expect(deriveVendorKeyFromBaseUrl("http://localhost:11434/v1")).toBe("local-11434");
    expect(deriveVendorKeyFromBaseUrl("http://127.0.0.1:8188")).toBe("local-8188");
    expect(deriveVendorKeyFromBaseUrl("https://api.openai.com/v1")).toBe("api-openai-com");
    expect(deriveVendorKeyFromBaseUrl("not a url")).toBe("");
  });
});
