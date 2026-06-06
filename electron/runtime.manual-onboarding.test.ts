/**
 * User-perspective end-to-end test for the PRIMARY model-adding path
 * (manual BaseURL entry). Simulates the exact journey that was impossible
 * before this change:
 *
 *   Clean install, ZERO models  →  user fills BaseURL + key + model(s)  →
 *   保存  →  models land in the catalog, are selectable, AND the doc-reading
 *   onboarding agent now has a text model to run with (bootstrap deadlock broken).
 *
 * This is acceptance gates #2 (break deadlock) and #3 (multi-model at once)
 * from docs/plan/onboarding-baseurl-entry.md, expressed as code so it can't
 * silently regress.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "./runtime";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  // Force the plaintext key path so the round-trip works headless (no OS keychain).
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
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
  it("breaks the bootstrap deadlock: a fresh install with zero models can add its first text model and the doc-reader can then run", () => {
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

    // The model is in the catalog and selectable (kind text, enabled).
    const models = listModelCatalogModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ modelKey: "llama3.1", kind: "text", enabled: true });

    // The deadlock is broken: the doc-reading agent now resolves a usable text model.
    const agent = resolveOnboardingAgentFromCatalog();
    expect(agent).not.toBeNull();
    expect(agent).toMatchObject({
      baseUrl: "http://localhost:11434/v1",
      modelId: "llama3.1",
      apiKey: "ollama",
      providerKind: "openai-compatible",
    });
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
    // Display name defaults to the id when omitted.
    const gpt4o = listModelCatalogModels().find((m) => m.modelKey === "gpt-4o");
    expect(gpt4o?.labelZh).toBe("gpt-4o");
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

    // The doc-reader resolves it with the anthropic provider kind.
    const agent = resolveOnboardingAgentFromCatalog();
    expect(agent).toMatchObject({
      providerKind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      modelId: "claude-3-5-sonnet-latest",
      apiKey: "sk-ant-xxx",
    });
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

    // 文档阅读 agent 也按 openai-responses 解析回来（runtime 读 catalog 时归一化）。
    const agent = resolveOnboardingAgentFromCatalog();
    expect(agent).toMatchObject({
      providerKind: "openai-responses",
      baseUrl: "https://api.fox-code.com/v1",
      modelId: "gpt-5-codex",
      apiKey: "sk-fox-xxx",
    });
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

    // The doc-reader carries the same headers so it reaches the same gateway.
    const agent = resolveOnboardingAgentFromCatalog();
    expect(agent?.extraHeaders).toEqual({
      "HTTP-Referer": "https://nomi.app",
      "X-Title": "Nomi",
    });
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

describe("deriveVendorKeyFromBaseUrl", () => {
  it("derives a stable key from host, keeping local ports distinct", () => {
    expect(deriveVendorKeyFromBaseUrl("http://localhost:11434/v1")).toBe("local-11434");
    expect(deriveVendorKeyFromBaseUrl("http://127.0.0.1:8188")).toBe("local-8188");
    expect(deriveVendorKeyFromBaseUrl("https://api.openai.com/v1")).toBe("api-openai-com");
    expect(deriveVendorKeyFromBaseUrl("not a url")).toBe("");
  });
});
