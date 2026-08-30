/**
 * P2·importModelCatalogPackage 事务边界回归。
 *
 * 旧实现：逐 bundle 调公开 upsert（每个都 readCatalog→mutate→writeCatalog 立即落盘），
 * 一个 bundle 中途 throw 时，它前面已落盘的 vendor/key/model 不回滚 —— 磁盘上留下「半接入
 * vendor」（如 vendor + key 写了、但它的 model 校验失败没写，得到一个不可用的空壳供应商）。
 *
 * 根治：整包先在内存攒好、逐项校验，全部成功才一次性写盘；任一 bundle 失败则**整体不写**，
 * 返回清晰 errors + imported 计数全 0。事务边界设在单一写盘点，而不是逐函数补症状。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AntigravityConnectionStatus, AntigravityTestRequest } from "../shared/antigravity";

const antigravityProof = vi.hoisted(() => vi.fn<(request?: AntigravityTestRequest) => boolean>(() => false));

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

vi.mock("../ai/antigravityConnection", () => ({
  antigravityConnection: {
    canEnable: antigravityProof,
    hasPassed: antigravityProof,
  },
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

const CURRENT = 3;

function writeRawCatalog(value: unknown): void {
  fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(value), "utf8");
}

function emptyCatalog(): void {
  writeRawCatalog({ version: CURRENT, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
}

function vendorBundle(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vendor: { key: "acme", name: "Acme", enabled: true, authType: "bearer", baseUrlHint: "https://acme.test" },
    apiKey: { apiKey: "sk-acme", enabled: true },
    models: [{ modelKey: "acme-large", vendorKey: "acme", kind: "text", enabled: true }],
    mappings: [],
    ...over,
  };
}

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-catalog-import-");
  antigravityProof.mockReset();
  antigravityProof.mockReturnValue(false);
  vi.resetModules();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("importModelCatalogPackage — 事务边界（全成功才写，任一失败整体不写）", () => {
  it("全部合法 → 一次性落盘，imported 计数正确，errors 为空", async () => {
    emptyCatalog();
    const { importModelCatalogPackage, listModelCatalogVendors, listModelCatalogModels } = await import("./catalogStore");
    const res = importModelCatalogPackage({
      vendors: [
        vendorBundle(),
        vendorBundle({
          vendor: { key: "globe", name: "Globe", enabled: true, authType: "bearer", baseUrlHint: "https://globe.test" },
          apiKey: { apiKey: "sk-globe", enabled: true },
          models: [{ modelKey: "globe-mini", vendorKey: "globe", kind: "image", enabled: true }],
        }),
      ],
    }) as { imported: { vendors: number; models: number; mappings: number }; errors: string[] };

    expect(res.errors).toEqual([]);
    expect(res.imported).toEqual({ vendors: 2, models: 2, mappings: 0 });
    expect(listModelCatalogVendors().map((v) => v.key).sort()).toEqual(["acme", "globe"]);
    expect(listModelCatalogModels().length).toBe(2);
  });

  it("第二个 bundle 的 model 非法（缺 modelKey）→ 整体不写，第一个合法 vendor 也不该留半成品", async () => {
    emptyCatalog();
    const { importModelCatalogPackage, listModelCatalogVendors, listModelCatalogModels } = await import("./catalogStore");
    const res = importModelCatalogPackage({
      vendors: [
        vendorBundle(), // 合法
        vendorBundle({
          vendor: { key: "broken", name: "Broken", enabled: true, authType: "bearer", baseUrlHint: "https://broken.test" },
          apiKey: { apiKey: "sk-broken", enabled: true },
          // modelKey 缺失 → upsert 校验抛错
          models: [{ vendorKey: "broken", kind: "text", enabled: true }],
        }),
      ],
    }) as { imported: { vendors: number; models: number; mappings: number }; errors: string[] };

    // 失败：errors 非空、imported 全 0。
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.imported).toEqual({ vendors: 0, models: 0, mappings: 0 });
    // 关键：磁盘没留下任何半成品——第一个合法的 acme 也不在（整体回滚）。
    expect(listModelCatalogVendors()).toEqual([]);
    expect(listModelCatalogModels()).toEqual([]);
  });

  it("第一个 bundle 的 vendor 非法（缺 key）→ 后续合法 bundle 也整体不写", async () => {
    emptyCatalog();
    const { importModelCatalogPackage, listModelCatalogVendors } = await import("./catalogStore");
    const res = importModelCatalogPackage({
      vendors: [
        vendorBundle({ vendor: { name: "NoKey", enabled: true } }), // 缺 key → 抛
        vendorBundle(), // 合法的 acme
      ],
    }) as { imported: { vendors: number; models: number; mappings: number }; errors: string[] };

    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.imported).toEqual({ vendors: 0, models: 0, mappings: 0 });
    expect(listModelCatalogVendors()).toEqual([]);
  });

  it("整体不写时，已有 catalog 内容保持原样（不被空导入抹掉）", async () => {
    // 预置一个已有 vendor。
    writeRawCatalog({
      version: CURRENT,
      vendors: [{ key: "preexisting", name: "Pre", enabled: true, authType: "bearer", baseUrlHint: "https://pre.test", createdAt: "t", updatedAt: "t" }],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const { importModelCatalogPackage, listModelCatalogVendors } = await import("./catalogStore");
    importModelCatalogPackage({
      vendors: [vendorBundle({ vendor: { name: "NoKey", enabled: true } })], // 非法 → 整体失败
    });
    // 已有 vendor 仍在，没被半截事务搞坏。
    expect(listModelCatalogVendors().map((v) => v.key)).toEqual(["preexisting"]);
  });

  it("空导入（vendors 为空）→ imported 全 0，errors 空，磁盘不被破坏", async () => {
    emptyCatalog();
    const { importModelCatalogPackage } = await import("./catalogStore");
    const res = importModelCatalogPackage({ vendors: [] }) as {
      imported: { vendors: number; models: number; mappings: number };
      errors: string[];
    };
    expect(res).toEqual({ imported: { vendors: 0, models: 0, mappings: 0 }, errors: [] });
  });
});

describe("Antigravity reserved process mapping write choke", () => {
  const status = (passed = false): AntigravityConnectionStatus => ({
    state: passed ? "ready" : "unverified",
    version: "1.1.21",
    checkedAt: 1,
    loginCommand: "agy",
    models: [{ id: "real-model", label: "Real" }],
    checks: passed
      ? [{ capability: "image", modelId: "auto", state: "passed", version: "1.1.21", checkedAt: 1 }]
      : [],
  });

  it.each([true, false])("rejects another vendor claiming the reserved parser when enabled=%s", async (enabled) => {
    emptyCatalog();
    const [{ upsertModelCatalogMapping }, { antigravityImageMappings }] = await Promise.all([
      import("./catalogStore"),
      import("./antigravityCatalog"),
    ]);
    const malicious = { ...antigravityImageMappings(status(false))[0], vendorKey: "attacker", enabled };

    expect(() => upsertModelCatalogMapping(malicious)).toThrow("ANTIGRAVITY_INVALID_CONFIG");
  });

  it("allows a canonical disabled mapping without proof", async () => {
    emptyCatalog();
    const [{ upsertModelCatalogMapping }, { antigravityImageMappings }] = await Promise.all([
      import("./catalogStore"),
      import("./antigravityCatalog"),
    ]);

    expect(() => upsertModelCatalogMapping(antigravityImageMappings(status(false))[0])).not.toThrow();
  });

  it("requires exact historical proof for a canonical enabled mapping", async () => {
    emptyCatalog();
    const [{ upsertModelCatalogMapping }, { antigravityImageMappings }] = await Promise.all([
      import("./catalogStore"),
      import("./antigravityCatalog"),
    ]);
    const mapping = antigravityImageMappings(status(true))[0];

    expect(() => upsertModelCatalogMapping(mapping)).toThrow("ANTIGRAVITY_TEST_REQUIRED");
    antigravityProof.mockImplementation((request) => request?.capability === "image" && request?.modelId === "auto");
    expect(() => upsertModelCatalogMapping(mapping)).not.toThrow();
  });

  it("does not let an enabled non-Antigravity row with the same id bypass proof", async () => {
    const [{ antigravityImageMappings }] = await Promise.all([import("./antigravityCatalog")]);
    const canonical = antigravityImageMappings(status(true))[0];
    writeRawCatalog({
      version: CURRENT,
      vendors: [],
      models: [],
      mappings: [{ ...canonical, vendorKey: "attacker", enabled: true }],
      apiKeysByVendor: {},
    });
    const { upsertModelCatalogMapping } = await import("./catalogStore");

    expect(() => upsertModelCatalogMapping(canonical)).toThrow("ANTIGRAVITY_TEST_REQUIRED");
  });

  it("rejects a poisoned import and rolls back earlier valid bundles", async () => {
    emptyCatalog();
    const [{ importModelCatalogPackage, listModelCatalogVendors }, { antigravityImageMappings }] = await Promise.all([
      import("./catalogStore"),
      import("./antigravityCatalog"),
    ]);
    const poisoned = { ...antigravityImageMappings(status(false))[0], vendorKey: "attacker", enabled: false };
    const result = importModelCatalogPackage({
      vendors: [vendorBundle(), vendorBundle({
        vendor: { key: "attacker", name: "Attacker", enabled: true, authType: "none" },
        apiKey: undefined,
        models: [],
        mappings: [poisoned],
      })],
    }) as { imported: { vendors: number; models: number; mappings: number }; errors: string[] };

    expect(result.errors).toContain("ANTIGRAVITY_INVALID_CONFIG");
    expect(result.imported).toEqual({ vendors: 0, models: 0, mappings: 0 });
    expect(listModelCatalogVendors()).toEqual([]);
  });
});
