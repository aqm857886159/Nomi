import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCatalog } from "../catalog/catalogStore";
import type { ApiKeyRecord } from "../catalog/secrets";
import type { CatalogState, Model, Vendor } from "../catalog/types";
import * as resolver from "./textBrainResolver";

const FORBIDDEN_OWNER_IMPORT = /(?:from|import\s*\()\s*["'](?:ai|@ai-sdk\/[^"']*|@mariozechner\/[^"']*|@earendil-works\/pi-[^"']*|[^"']*(?:agentChatV2|agentLoop|agentSession|agentStream))['"]/;
const safeStorageMocks = vi.hoisted(() => ({
  decryptString: vi.fn((_value: Buffer): string => { throw new Error("test keychain locked"); }),
}));

vi.mock("../catalog/catalogStore", () => ({ readCatalog: vi.fn() }));
vi.mock("electron", () => ({ safeStorage: { decryptString: safeStorageMocks.decryptString } }));

const vendor = (key: string, overrides: Partial<Vendor> = {}): Vendor => ({ key, name: key, enabled: true, authType: "bearer", createdAt: "", updatedAt: "", ...overrides });
/**
 * 免鉴权的家（本地网关那一档）。**排序/身份**这几条测的是候选表怎么排，不是钥匙——
 * 2026-09-12 起候选表就是「现在能用的」全集（可用性 owner），所以这些夹具必须是真能用的家，
 * 否则测的就变成「没配 key 会不会被滤掉」了（那一条另有专测）。
 */
const freeVendor = (key: string, overrides: Partial<Vendor> = {}): Vendor => vendor(key, { authType: "none", ...overrides });
const model = (vendorKey: string, modelKey: string, overrides: Partial<Model> = {}): Model => ({ vendorKey, modelKey, labelZh: modelKey, kind: "text", enabled: true, createdAt: "", updatedAt: "", ...overrides });
const key = (vendorKey: string, apiKey: string, enc: ApiKeyRecord["enc"] = "plain"): ApiKeyRecord => ({ vendorKey, apiKey, enc, enabled: true, createdAt: "", updatedAt: "" });
const catalog = (overrides: Partial<CatalogState> = {}): CatalogState => ({ version: 8, vendors: [], models: [], mappings: [], apiKeysByVendor: {}, ...overrides });

describe("Nomi text brain resolver", () => {
  beforeEach(() => {
    safeStorageMocks.decryptString.mockReset().mockImplementation((_value: Buffer): string => { throw new Error("test keychain locked"); });
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
    const state = catalog({ vendors: [freeVendor("a"), freeVendor("b")], models: [model("a", "gpt-5.2"), model("b", "gpt-5.2")] });
    expect(resolver.selectTextModelCandidates(state, { vendorKey: " b ", modelKey: " gpt-5.2 " }).map((candidate) => candidate.vendor.key)).toEqual(["b"]);
  });

  it("keeps model-only preferences compatible and stable", () => {
    const state = catalog({ vendors: [freeVendor("a"), freeVendor("b")], models: [model("a", "other"), model("a", "preferred"), model("b", "preferred")] });
    expect(resolver.selectTextModelCandidates(state, { modelKey: "preferred" }).map((candidate) => `${candidate.vendor.key}/${candidate.model.modelKey}`))
      .toEqual(["a/preferred", "b/preferred", "a/other"]);
  });

  it("ranks ordinary chat ahead of preview and vision models without a preference", () => {
    const state = catalog({ vendors: [freeVendor("a")], models: [model("a", "vision"), model("a", "chat-1"), model("a", "chat-2"), model("a", "preview")] });
    expect(resolver.selectTextModelCandidates(state).map((candidate) => candidate.model.modelKey)).toEqual(["chat-1", "chat-2", "vision", "preview"]);
  });

  it("prioritizes image capability for rich input, but a user preference still wins", () => {
    const state = catalog({ vendors: [freeVendor("a")], models: [model("a", "plain", { meta: { supportsImageInput: false } }), model("a", "vision", { meta: { supportsImageInput: true } })] });
    expect(resolver.selectTextModelCandidates(state, undefined, true)[0].model.modelKey).toBe("vision");
    expect(resolver.selectTextModelCandidates(state, { modelKey: "plain" }, true)[0].model.modelKey).toBe("plain");
  });

  it("excludes prompt-refine-only, disabled, non-text and orphaned candidates", () => {
    const state = catalog({
      vendors: [freeVendor("a"), freeVendor("off", { enabled: false })],
      models: [model("a", "refiner", { meta: { promptRefineOnly: true } }), model("a", "disabled", { enabled: false }), model("a", "image", { kind: "image" }), model("off", "off"), model("missing", "orphan"), model("a", "chat")],
    });
    expect(resolver.selectTextModelCandidates(state).map((candidate) => candidate.model.modelKey)).toEqual(["chat"]);
  });

  it("allows credential fallback only for automatic selection without an explicit vendor identity", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => {
      const decoded = value.toString("utf8");
      if (decoded === "locked") throw new Error("test keychain locked");
      return decoded;
    });
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("a"), vendor("b")], models: [model("a", "preferred"), model("b", "fallback")],
      apiKeysByVendor: {
        a: key("a", "bG9ja2Vk", "safeStorage"),
        b: key("b", "dGVzdC11c2FibGUta2V5", "safeStorage"),
      },
    }));
    expect(resolver.chooseTextModel()).toMatchObject({ vendor: { key: "b" }, model: { modelKey: "fallback" }, apiKey: "test-usable-key" });
  });

  it("returns structured unavailable instead of using an unrelated same-name model when the explicit credential is missing", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => value.toString("utf8"));
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("selected"), vendor("unrelated")],
      models: [model("selected", "chat"), model("unrelated", "chat")],
      apiKeysByVendor: { unrelated: key("unrelated", "dW5yZWxhdGVkLXNlY3JldA==", "safeStorage") },
    }));

    expect(() => resolver.chooseTextModel("chat", false, "selected")).toThrow(expect.objectContaining({
      code: "text_model_unavailable",
      reason: "credential_missing",
      vendorKey: "selected",
      modelKey: "chat",
    }));
    // 候选表现在就是「能用的」全集，所以每**家**有 safeStorage 记录的都会被探一次（memo 化，不随模型数增长）。
    // 被选中的那家压根没有记录 → 不开钥匙串；无关那家探了也没被用上——「不回退到别家」仍然成立。
    expect(safeStorageMocks.decryptString).toHaveBeenCalledTimes(1);
  });

  it("returns needs_resave for explicit legacy plaintext and never decrypts or falls back", () => {
    const sentinel = "SENTINEL-EXPLICIT-PLAIN";
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => value.toString("utf8"));
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("selected"), vendor("unrelated")],
      models: [model("selected", "chat"), model("unrelated", "chat")],
      apiKeysByVendor: {
        selected: key("selected", sentinel, "plain"),
        unrelated: key("unrelated", "dW5yZWxhdGVkLXNlY3JldA==", "safeStorage"),
      },
    }));

    expect(() => resolver.chooseTextModel("chat", false, "selected")).toThrow(expect.objectContaining({
      code: "text_model_unavailable",
      reason: "credential_needs_resave",
    }));
    // 明文那家一次都不解（plain 不用开钥匙串就知道是 needs_resave）；无关那家探一次，未被采用。
    expect(safeStorageMocks.decryptString).toHaveBeenCalledTimes(1);
  });

  it("returns structured unavailable after explicit safeStorage decrypt failure without trying another vendor", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => {
      if (value.toString("utf8") === "selected-locked") throw new Error("test keychain locked");
      return value.toString("utf8");
    });
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("selected"), vendor("unrelated")],
      models: [model("selected", "chat"), model("unrelated", "chat")],
      apiKeysByVendor: {
        selected: key("selected", Buffer.from("selected-locked").toString("base64"), "safeStorage"),
        unrelated: key("unrelated", Buffer.from("unrelated-secret").toString("base64"), "safeStorage"),
      },
    }));

    expect(() => resolver.chooseTextModel("chat", false, "selected")).toThrow(expect.objectContaining({
      code: "text_model_unavailable",
      reason: "credential_locked",
    }));
    // 每家一次：selected（解不开 → locked）与 unrelated（解得开但不是用户选的那家）。
    expect(safeStorageMocks.decryptString).toHaveBeenCalledTimes(2);
  });

  it("does not replace an explicitly disabled model with an unrelated enabled same-name model", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => value.toString("utf8"));
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("selected"), vendor("unrelated")],
      models: [model("selected", "chat", { enabled: false }), model("unrelated", "chat")],
      apiKeysByVendor: { unrelated: key("unrelated", Buffer.from("unrelated-secret").toString("base64"), "safeStorage") },
    }));

    expect(() => resolver.chooseTextModel("chat", false, "selected")).toThrow(expect.objectContaining({
      code: "text_model_unavailable",
      reason: "model_disabled",
    }));
    // unrelated 有记录，作为候选被探了一次；selected 没记录，不开钥匙串。它仍然不会被顶替。
    expect(safeStorageMocks.decryptString).toHaveBeenCalledTimes(1);
  });

  it("migrates an explicit disabled identity only to its active lineage successor", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => value.toString("utf8"));
    const successorKey = "selected--candidate-2";
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [
        vendor("unrelated"),
        vendor("selected"),
        vendor(successorKey, { meta: {
          adapterCandidateRootVendorKey: "selected",
          adapterCandidateSourceVendorKey: "selected",
          adapterCandidatePromotionPredecessors: {
            chat: { vendorKey: "selected", publishedModes: ["chat"] },
          },
        } }),
      ],
      models: [
        model("unrelated", "chat"),
        model("selected", "chat", { enabled: false }),
        model(successorKey, "chat", { meta: { adapter: { activeRevision: "revision-2", modes: [] } } }),
      ],
      apiKeysByVendor: {
        unrelated: key("unrelated", Buffer.from("unrelated-secret").toString("base64"), "safeStorage"),
        [successorKey]: key(successorKey, Buffer.from("successor-secret").toString("base64"), "safeStorage"),
      },
    }));

    expect(resolver.chooseTextModel("chat", false, "selected")).toMatchObject({
      vendor: { key: successorKey },
      model: { vendorKey: successorKey, modelKey: "chat" },
      apiKey: "successor-secret",
    });
    // 两家有记录（unrelated / successor）各探一次，选中的 successor 再解一次取明文。
    expect(safeStorageMocks.decryptString).toHaveBeenCalledTimes(3);
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

  it("never selects or advertises a legacy plaintext credential as a usable text brain", () => {
    const sentinel = "SENTINEL-LEGACY-TEXT-BRAIN";
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("legacy")],
      models: [model("legacy", "chat")],
      apiKeysByVendor: { legacy: key("legacy", sentinel, "plain") },
    }));
    expect(() => resolver.chooseTextModel()).toThrow("Model is not configured: no usable text model");
    expect(resolver.resolveTextBrainKeys()).toBeNull();
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });
    expect(safeStorageMocks.decryptString).not.toHaveBeenCalled();
  });

  it("returns only public model keys from the reusable status API", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => value.toString("utf8"));
    vi.mocked(readCatalog).mockReturnValue(catalog({ vendors: [vendor("a")], models: [model("a", "chat")], apiKeysByVendor: { a: key("a", "dGVzdC1zZWNyZXQ=", "safeStorage") } }));
    expect(resolver.resolveTextBrainKeys()).toEqual({ vendor: "a", modelKey: "chat" });
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "ok", brain: { vendor: "a", modelKey: "chat" } });
  });

  it("preserves the stable missing-model error signature", () => {
    expect(() => resolver.chooseTextModel()).toThrow("Model is not configured: no usable text model. Open model settings and add an API key.");
    expect(resolver.resolveTextBrainKeys()).toBeNull();
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });
  });

  // 2026-09-12 P0-10：首屏就绪与「助手下拉里有没有东西」必须是**同一个**答案。
  // 旧实现只看「有没有一条 safeStorage 记录」，于是当前宿主身份解不开那把 key 时，
  // 首页照样说「已连接」而下拉是空的。现在两边都读可用性 owner：解得开才算就绪。
  it("首屏就绪 = 钥匙此刻真解得开，不是「有一条密文记录」", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => {
      if (value.toString("utf8") === "locked") throw new Error("test keychain locked");
      return value.toString("utf8");
    });
    const state = catalog({ vendors: [vendor("a")], models: [model("a", "chat")] });
    vi.mocked(readCatalog).mockReturnValue(state);
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });

    // 密文在，但这个宿主解不开 → 就绪必须仍是 missing（下拉这时也是空的）。
    state.apiKeysByVendor.a = key("a", Buffer.from("locked").toString("base64"), "safeStorage");
    expect(resolver.resolveTextBrainKeys()).toBeNull();
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "missing" });

    // 解得开 → 就绪为 ok，且和 chooseTextModel 选到的是同一条。
    state.apiKeysByVendor.a = key("a", Buffer.from("usable").toString("base64"), "safeStorage");
    expect(resolver.resolveTextBrainKeys()).toEqual({ vendor: "a", modelKey: "chat" });
    expect(resolver.resolveTextBrainStatus()).toEqual({ status: "ok", brain: { vendor: "a", modelKey: "chat" } });
    expect(resolver.chooseTextModel()).toMatchObject({ vendor: { key: "a" }, model: { modelKey: "chat" } });
  });

  it("钥匙探测按家记忆化：同一家 N 个文本模型只开一次钥匙串", () => {
    safeStorageMocks.decryptString.mockImplementation((value: Buffer) => value.toString("utf8"));
    vi.mocked(readCatalog).mockReturnValue(catalog({
      vendors: [vendor("a")],
      models: [model("a", "chat-1"), model("a", "chat-2"), model("a", "chat-3")],
      apiKeysByVendor: { a: key("a", Buffer.from("secret").toString("base64"), "safeStorage") },
    }));
    expect(resolver.resolveTextBrainKeys()).toEqual({ vendor: "a", modelKey: "chat-1" });
    // 3 个模型 → 1 次，不是 3 次（开销随**家**数走，不随模型数走）。
    expect(safeStorageMocks.decryptString).toHaveBeenCalledTimes(1);
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
