/**
 * 「这条连接归不归认证适配器管」只有一份判据（2026-09-29，A10b 结构修复）。
 *
 * 报错用户的现场：在内置 APIMart 上点「继续验证」手加了一个模型去自检，那一行带上了 `meta.adapter`。
 * 同一条判据此前在 4 个文件里各抄一份，全都把「这家名下任何一行带标记」当成「整条连接归认证管」——
 * 于是 Agent 那条生成路对整家 APIMart 关门（画布那条路不查，照样出图），设置页也锁住了连接。
 *
 * 这里钉三件事，全部经过唯一的主人 `isCertificationOwnedConnection`：
 *   (a) 用户自己加、自己自检的模型只管它自己：每一家内置都不会因此整家翻成认证连接；
 *   (b) AI 接入建出来的连接仍是认证连接，鉴权放法（authType / authHeader / authQueryParam /
 *       providerKind）不重新接入就改不了——安全锁不许因为这次放宽而变松；
 *   · 连接本身带标记、或内置目录里的模型带标记，照旧算认证连接。
 * (c) 画布与 Agent 对同一份目录给同一个答案，见 electron/parity/certificationOwnershipParity.test.ts。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState, Model } from "./types";
import { applyBuiltinSeeds, builtinCatalogModelKeys } from "./seedBuiltins";
import { BUILTIN_VENDOR_SEEDS } from "./builtinVendorSeeds";
import { carriesCertificationMark, isCertificationOwnedConnection } from "./certificationOwnership";

/**
 * (b) 那一段要走真实的 AI 接入写门并落盘；钥匙串那一层按仓库既有做法替身（见
 * modelOnboarding/credentialInvariants.test.ts）——替身仍然加密，不是直存明文。
 */
vi.mock("./secrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./secrets")>();
  const wrap = (plain: string): string => `enc:${Buffer.from(plain, "utf8").toString("base64")}`;
  const unwrap = (value: string): string =>
    value.startsWith("enc:") ? Buffer.from(value.slice(4), "base64").toString("utf8") : value;
  return {
    ...actual,
    makeApiKeyRecordFromPlain: (plain: string, vendorKey: string, enabled: boolean, createdAt: string, updatedAt: string) =>
      ({ vendorKey, apiKey: wrap(plain), enc: "safeStorage" as const, enabled, createdAt, updatedAt }),
    decryptApiKeyRecord: (record?: { apiKey?: string }) => (record?.apiKey ? unwrap(record.apiKey) : ""),
    apiKeyDecryptStatus: (record?: { apiKey?: string }) => (record?.apiKey ? "ok" : "missing"),
  };
});

const NOW = "2026-09-29T00:00:00.000Z";
const MARK = { adapter: { state: "failed", modes: [], updatedAt: NOW } };

function seeded(): CatalogState {
  const base = { version: 3, revision: 1, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;
  return applyBuiltinSeeds(base, NOW).state;
}

function withModel(state: CatalogState, model: Partial<Model> & Pick<Model, "vendorKey" | "modelKey">): CatalogState {
  return {
    ...state,
    models: [...state.models, { labelZh: model.modelKey, kind: "image", enabled: false, createdAt: NOW, updatedAt: NOW, ...model } as Model],
  };
}

function markModel(state: CatalogState, vendorKey: string, modelKey: string): CatalogState {
  return {
    ...state,
    models: state.models.map((model) => model.vendorKey === vendorKey && model.modelKey === modelKey
      ? { ...model, meta: { ...(model.meta as Record<string, unknown> | undefined), ...MARK } }
      : model),
  };
}

function markVendor(state: CatalogState, vendorKey: string): CatalogState {
  return {
    ...state,
    vendors: state.vendors.map((vendor) => vendor.key === vendorKey ? { ...vendor, meta: { ...MARK } } : vendor),
  };
}

describe("认证标记本身", () => {
  it("只认 meta 上有没有 adapter 这一格；空、数组、别的键都不算", () => {
    expect(carriesCertificationMark({ adapter: { state: "unverified" } })).toBe(true);
    expect(carriesCertificationMark({ adapter: undefined })).toBe(true);
    expect(carriesCertificationMark(undefined)).toBe(false);
    expect(carriesCertificationMark(null)).toBe(false);
    expect(carriesCertificationMark([{ adapter: {} }])).toBe(false);
    expect(carriesCertificationMark({ archetypeId: "gpt-image-2" })).toBe(false);
  });
});

describe("这条连接归不归认证适配器管（唯一判据）", () => {
  const catalog = seeded();
  const builtinKeys = BUILTIN_VENDOR_SEEDS.map((seed) => seed.key).filter((key) => catalog.vendors.some((vendor) => vendor.key === key));

  it("种子里的每一家内置都在目录里（否则下面的全家扫描是空转）", () => {
    expect(builtinKeys.length).toBeGreaterThan(10);
    expect(builtinKeys).toContain("apimart");
  });

  it("新装机什么都没点过：哪一家都不是认证连接", () => {
    expect(builtinKeys.filter((key) => isCertificationOwnedConnection(catalog, key))).toEqual([]);
  });

  it("(a) 用户自己加、自检过的模型只管它自己：每一家内置都不会因此整家翻成认证连接", () => {
    const flipped = builtinKeys.filter((vendorKey) => isCertificationOwnedConnection(
      withModel(catalog, { vendorKey, modelKey: "user-added-self-check", meta: { ...MARK } }),
      vendorKey,
    ));
    expect(flipped).toEqual([]);
  });

  it("(a) 报错用户的原样现场：APIMart 上手填 gpt-image-1 去自检", () => {
    const trap = withModel(catalog, { vendorKey: "apimart", modelKey: "gpt-image-1", meta: { adapter: { state: "unverified", modes: [], updatedAt: NOW } } });
    expect(builtinCatalogModelKeys("apimart").has("gpt-image-1")).toBe(false);
    expect(isCertificationOwnedConnection(trap, "apimart")).toBe(false);
  });

  it("内置目录里的模型带了标记：整条连接归认证（代码拥有的契约被接管了）", () => {
    const withCatalogModels = builtinKeys.filter((vendorKey) => builtinCatalogModelKeys(vendorKey).size > 0);
    expect(withCatalogModels.length).toBeGreaterThan(10);
    const notOwned = withCatalogModels.filter((vendorKey) => {
      const catalogModel = catalog.models.find((model) => model.vendorKey === vendorKey && builtinCatalogModelKeys(vendorKey).has(model.modelKey));
      if (!catalogModel) return true;
      return !isCertificationOwnedConnection(markModel(catalog, vendorKey, catalogModel.modelKey), vendorKey);
    });
    expect(notOwned).toEqual([]);
  });

  it("连接本身带标记：不管是哪一家，整条连接归认证", () => {
    expect(builtinKeys.filter((vendorKey) => !isCertificationOwnedConnection(markVendor(catalog, vendorKey), vendorKey))).toEqual([]);
  });

  it("非内置的连接（AI 接入 / 声明卡 / 手接的中转）：它的每一行都来自认证，任何一行带标记都算", () => {
    const relay: CatalogState = {
      ...catalog,
      vendors: [...catalog.vendors, { key: "example-relay", name: "Example Relay", enabled: true, baseUrlHint: "https://api.example-relay.com", authType: "bearer", createdAt: NOW, updatedAt: NOW }],
    };
    expect(isCertificationOwnedConnection(relay, "example-relay")).toBe(false);
    expect(isCertificationOwnedConnection(withModel(relay, { vendorKey: "example-relay", modelKey: "demo-image", meta: { ...MARK } }), "example-relay")).toBe(true);
  });

  it("没有这家连接、也没有它的模型：不是认证连接（不替不存在的连接下结论）", () => {
    expect(isCertificationOwnedConnection(catalog, "no-such-connection")).toBe(false);
  });
});

/**
 * 第五份判据回不来：「这一行 meta 上有没有 adapter」这个问法只许出现在主人里。以前 4 份判据全是从
 * 这一句长出来的（`hasOwnProperty.call(meta, "adapter")` 换个函数名再包一层），所以守住问法，
 * 就守住了「再抄一份」这条路——换什么函数名都一样红。要回答「这条连接归不归认证管」，import 主人。
 * 复验它会红：在任意一个 electron/ 或 src/ 生产文件里写回一句 `Object.prototype.hasOwnProperty.call(meta, "adapter")`。
 */
describe("主人之外没有第二份判据", () => {
  const OWNER = path.join("electron", "catalog", "certificationOwnership.ts");
  const PRESENCE = /hasOwnProperty\.call\([^)]*["']adapter["']\s*\)|Object\.hasOwn\([^)]*["']adapter["']\s*\)|Reflect\.has\([^)]*["']adapter["']\s*\)|["']adapter["']\s+in\s+[A-Za-z_$(]/;

  function productionSources(root: string): string[] {
    return (fs.readdirSync(root, { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx|mts|cts)$/.test(file) && !/\.test\.|\.spec\.|[\\/]__tests__[\\/]/.test(file))
      .map((file) => path.join(root, file));
  }

  it("electron/ 与 src/ 的生产代码里，只有主人自己问「meta 上有没有 adapter」", () => {
    const files = [...productionSources("electron"), ...productionSources("src")];
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(OWNER);
    const askers = files.filter((file) => PRESENCE.test(fs.readFileSync(file, "utf8")));
    expect(askers).toEqual([OWNER]);
  });
});

/**
 * (b) 走的是真实的 AI 接入写门（`model.setup` 的 submit_declaration → registerDeclaredProvider），
 * 不是手搓一个带标记的状态：安全锁守不守得住，要看真实写进盘里的那一份。
 * 复验它会红：把判据改成「只认连接本身的标记」（非内置家也按内置家那样只看连接本身）→ 这条当场红。
 */
describe("(b) AI 接入建的连接：仍是认证连接，鉴权放法照样锁", () => {
  let root: string;


  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cert-owner-"));
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
    vi.resetModules();
  });

  afterEach(() => {
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("声明卡登记进来的连接归认证；改鉴权放法要重新接入，改地址仍归用户", async () => {
    const doc = "https://docs.example-relay.com/api";
    const declaration = JSON.stringify({
      provider: { baseUrl: "https://api.example-relay.com", authType: "bearer", authHeader: "Authorization" },
      sources: [{ url: doc, evidence: "POST /v1/images/generations returns data[0].url" }],
      assetIngestion: { strategy: "none", sourceUrl: doc },
      models: [{
        modelKey: "demo-image",
        labelZh: "Demo Image",
        kind: "image",
        modes: [{
          taskKind: "text_to_image",
          delivery: "synchronous",
          create: { method: "POST", path: "/v1/images/generations", body: { prompt: "{{request.prompt}}" }, response_mapping: { image_url: "data.0.url" } },
          sourceUrls: [doc],
        }],
      }],
    });
    const { dispatchModelSetup } = await import("../capabilityCore/modelOnboarding/dispatch");
    const submitted = await dispatchModelSetup({
      sessions: {} as never,
      owner: "claude" as never,
      withCredentialElicitationTicket: (projection: Record<string, unknown>) => projection,
    }, { action: "submit_declaration", name: "Example Relay", declaration });
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true);
    const vendorKey = (submitted as { vendorKey?: string }).vendorKey!;

    const { readCatalog } = await import("./catalogStore");
    const owner = await import("./certificationOwnership");
    expect(owner.isCertificationOwnedConnection(readCatalog(), vendorKey)).toBe(true);

    const { upsertRendererCatalogVendor } = await import("./rendererCatalogMutation");
    const vendor = readCatalog().vendors.find((item) => item.key === vendorKey)!;
    const attempts: Array<[string, string]> = [["authType", "x-api-key"], ["authHeader", "X-Other-Key"], ["authQueryParam", "key"], ["providerKind", "custom"]];
    for (const [field, value] of attempts) {
      expect(() => upsertRendererCatalogVendor({ key: vendorKey, name: vendor.name, [field]: value }), field)
        .toThrow("这个连接的鉴权方式不能在这里改");
    }
    const after = readCatalog().vendors.find((item) => item.key === vendorKey)!;
    for (const [field] of attempts) expect(after[field as keyof typeof after], field).toBe(vendor[field as keyof typeof vendor]);

    // 地址仍归用户（热修那一刀的本意）：认证连接也照样能在设置里改。
    upsertRendererCatalogVendor({ key: vendorKey, name: vendor.name, baseUrlHint: "https://api.example-relay.com/v2" });
    expect(readCatalog().vendors.find((item) => item.key === vendorKey)?.baseUrlHint).toBe("https://api.example-relay.com/v2");
  });
});
