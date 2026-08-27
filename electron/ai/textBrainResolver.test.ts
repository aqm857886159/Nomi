import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCatalog } from "../catalog/catalogStore";
import type { ApiKeyRecord } from "../catalog/secrets";
import type { CatalogState, Model, Vendor } from "../catalog/types";
import * as resolver from "./textBrainResolver";

const FORBIDDEN_OWNER_IMPORT = /(?:from|import\s*\()\s*["'](?:ai|@ai-sdk\/[^"']*|@mariozechner\/[^"']*|@earendil-works\/pi-[^"']*|[^"']*(?:agentChatV2|agentLoop|agentSession|agentStream))['"]/;
const safeStorageMocks = vi.hoisted(() => ({
  decryptString: vi.fn((): string => { throw new Error("test keychain locked"); }),
}));

vi.mock("../catalog/catalogStore", () => ({ readCatalog: vi.fn() }));
vi.mock("electron", () => ({ safeStorage: { decryptString: safeStorageMocks.decryptString } }));

const vendor = (key: string, overrides: Partial<Vendor> = {}): Vendor => ({ key, name: key, enabled: true, authType: "bearer", createdAt: "", updatedAt: "", ...overrides });
const model = (vendorKey: string, modelKey: string, overrides: Partial<Model> = {}): Model => ({ vendorKey, modelKey, labelZh: modelKey, kind: "text", enabled: true, createdAt: "", updatedAt: "", ...overrides });
const key = (vendorKey: string, apiKey: string, enc: ApiKeyRecord["enc"] = "plain"): ApiKeyRecord => ({ vendorKey, apiKey, enc, enabled: true, createdAt: "", updatedAt: "" });
const catalog = (overrides: Partial<CatalogState> = {}): CatalogState => ({ version: 8, vendors: [], models: [], mappings: [], apiKeysByVendor: {}, ...overrides });

describe("Nomi text brain resolver", () => {
  beforeEach(() => {
    safeStorageMocks.decryptString.mockReset().mockImplementation((): string => { throw new Error("test keychain locked"); });
    vi.mocked(readCatalog).mockReturnValue(catalog());
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("detects static and dynamic imports from every forbidden SDK prefix", () => {
    const imports = [
      "ai", "@ai-sdk/openai", "@mariozechner/pi-coding-agent",
      "@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai",
    ].flatMap((specifier) => [
      `import { dependency } from "${specifier}";`,
      `const dependency = await import('${specifier}');`,
    ]);
    expect(imports.filter((source) => !FORBIDDEN_OWNER_IMPORT.test(source))).toEqual([]);
  });

  it("allows Zod, Node, and the resolver's existing local dependencies", () => {
    const imports = [
      "zod", "node:fs", "../catalog/catalogStore", "../catalog/secrets", "./agentUserContent",
    ].flatMap((specifier) => [
      `import { dependency } from "${specifier}";`,
      `const dependency = await import('${specifier}');`,
    ]);
    expect(imports.filter((source) => FORBIDDEN_OWNER_IMPORT.test(source))).toEqual([]);
  });

  it("has no Agent-runtime or SDK import", () => {
    const source = readFileSync(new URL("./textBrainResolver.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(FORBIDDEN_OWNER_IMPORT);
  });

  it("prefers the complete vendor/model identity even for same-named models", () => {
    const state = catalog({ vendors: [vendor("a"), vendor("b")], models: [model("a", "gpt-5.2"), model("b", "gpt-5.2")] });
    expect(resolver.selectTextModelCandidates(state, { vendorKey: " b ", modelKey: " gpt-5.2 " }).map((candidate) => candidate.vendor.key)).toEqual(["b", "a"]);
  });

  it("keeps model-only preferences compatible and stable", () => {
    const state = catalog({ vendors: [vendor("a"), vendor("b")], models: [model("a", "other"), model("a", "preferred"), model("b", "preferred")] });
    expect(resolver.selectTextModelCandidates(state, { modelKey: "preferred" }).map((candidate) => `${candidate.vendor.key}/${candidate.model.modelKey}`))
      .toEqual(["a/preferred", "b/preferred", "a/other"]);
  });

  it("ranks ordinary chat ahead of preview and vision models without a preference", () => {
    const state = catalog({ vendors: [vendor("a")], models: [model("a", "vision"), model("a", "chat-1"), model("a", "chat-2"), model("a", "preview")] });
    expect(resolver.selectTextModelCandidates(state).map((candidate) => candidate.model.modelKey)).toEqual(["chat-1", "chat-2", "vision", "preview"]);
  });

  it("prioritizes image capability for rich input, but a user preference still wins", () => {
    const state = catalog({ vendors: [vendor("a")], models: [model("a", "plain", { meta: { supportsImageInput: false } }), model("a", "vision", { meta: { supportsImageInput: true } })] });
    expect(resolver.selectTextModelCandidates(state, undefined, true)[0].model.modelKey).toBe("vision");
    expect(resolver.selectTextModelCandidates(state, { modelKey: "plain" }, true)[0].model.modelKey).toBe("plain");
  });

  it("excludes prompt-refine-only, disabled, non-text and orphaned candidates", () => {
    const state = catalog({
      vendors: [vendor("a"), vendor("off", { enabled: false })],
      models: [model("a", "refiner", { meta: { promptRefineOnly: true } }), model("a", "disabled", { enabled: false }), model("a", "image", { kind: "image" }), model("off", "off"), model("missing", "orphan"), model("a", "chat")],
    });
    expect(resolver.selectTextModelCandidates(state).map((candidate) => candidate.model.modelKey)).toEqual(["chat"]);
  });

  it("selects the first usable credential after ranking and skips locked keys", () => {
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("a"), vendor("b")], models: [model("a", "preferred"), model("b", "fallback")],
      apiKeysByVendor: { a: key("a", "bG9ja2Vk", "safeStorage"), b: key("b", "test-usable-key") },
    }));
    expect(resolver.chooseTextModel("preferred", false, "a")).toMatchObject({ vendor: { key: "b" }, model: { modelKey: "fallback" }, apiKey: "test-usable-key" });
  });

  it("reports a structured locked failure only when the first real selection decrypts", () => {
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("a")], models: [model("a", "chat")],
      apiKeysByVendor: { a: key("a", "bG9ja2Vk", "safeStorage") },
    }));
    let failure: unknown;
    try {
      resolver.chooseTextModel();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: "TextModelCredentialError",
      code: "text_model_credential_locked",
    });
    expect(safeStorageMocks.decryptString).toHaveBeenCalledTimes(1);
  });

  it("allows auth-free local vendors without touching a stale encrypted credential", () => {
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("local", { authType: "none" })], models: [model("local", "chat")],
      apiKeysByVendor: { local: key("local", "c3RhbGU=", "safeStorage") },
    }));
    expect(resolver.chooseTextModel()).toMatchObject({ vendor: { key: "local" }, apiKey: "" });
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "ok", brain: { vendor: "local", modelKey: "chat" } });
    expect(safeStorageMocks.decryptString).not.toHaveBeenCalled();
  });

  it("returns only public model keys from the reusable status API", () => {
    vi.mocked(readCatalog).mockReturnValue(catalog({ vendors: [vendor("a")], models: [model("a", "chat")], apiKeysByVendor: { a: key("a", "test-secret") } }));
    expect(resolver.resolveTextBrainKeys()).toEqual({ vendor: "a", modelKey: "chat" });
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "ok", brain: { vendor: "a", modelKey: "chat" } });
  });

  it("preserves the stable missing-model error signature", () => {
    expect(() => resolver.chooseTextModel()).toThrow("Model is not configured: no usable text model. Open model settings and add an API key.");
    expect(resolver.resolveTextBrainKeys()).toBeNull();
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });
  });

  it("treats an encrypted credential as configured without touching the keychain", () => {
    const state = catalog({ vendors: [vendor("a")], models: [model("a", "chat")] });
    vi.mocked(readCatalog).mockReturnValue(state);
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });
    state.apiKeysByVendor.a = key("a", "bG9ja2Vk", "safeStorage");
    expect(resolver.resolveTextBrainKeys()).toEqual({ vendor: "a", modelKey: "chat" });
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "ok", brain: { vendor: "a", modelKey: "chat" } });
    expect(safeStorageMocks.decryptString).not.toHaveBeenCalled();
  });

  it("treats a disabled credential as missing without touching the keychain", () => {
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("a")], models: [model("a", "chat")],
      apiKeysByVendor: { a: { ...key("a", "bG9ja2Vk", "safeStorage"), enabled: false } },
    }));
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });
    expect(() => resolver.chooseTextModel()).toThrow("Model is not configured: no usable text model. Open model settings and add an API key.");
    expect(safeStorageMocks.decryptString).not.toHaveBeenCalled();
  });

  it("ignores locked credentials belonging to excluded candidates", () => {
    vi.mocked(readCatalog).mockReturnValue(catalog({ vendors: [vendor("a")], models: [model("a", "refiner", { meta: { promptRefineOnly: true } })], apiKeysByVendor: { a: key("a", "bG9ja2Vk", "safeStorage") } }));
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });
  });
});

it("prompt library imports the resolver directly, without loading the Agent", () => {
  const source = readFileSync(new URL("../promptLibrary/promptLibraryIpc.ts", import.meta.url), "utf8");
  expect(source).toContain('import("../ai/textBrainResolver")');
  expect(source).not.toContain('import("../ai/agentChatV2")');
});

it("the missing-model recovery card does not re-probe the unreachable startup locked state", () => {
  const source = readFileSync(new URL("../../src/workbench/ai/NoTextModelRecoveryCard.tsx", import.meta.url), "utf8");
  expect(source).not.toContain("getTextBrainStatus");
  expect(source).not.toContain("status === 'locked'");
});
