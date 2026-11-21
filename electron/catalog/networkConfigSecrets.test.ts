import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_CATALOG_VERSION } from "./types";

// 「凭据类网络配置」（proxyUrl / extraHeaders）加密落盘 —— 与 customConfigSecrets.test.ts 同范式：
// mock 一个可逆的 safeStorage，用临时 catalog 文件走真实 catalogStore 读写，断言：
//  ① 存量明文可读、迁移前不碰钥匙串、不改盘；② 显式写触发加密、明文不进盘；③ 迁移幂等；
//  ④ safeStorage 不可用时 fail-closed、盘 byte-for-byte 不变；⑤ 渲染 DTO / 导出永不带明文凭据。

const safeStorageState = vi.hoisted(() => ({
  available: true,
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value, "utf8")),
}));
let mockedUserDataRoot = "";
const tempRoots: string[] = [];

function seal(value: string): Buffer<ArrayBuffer> {
  return Buffer.from(`sealed:${[...value].reverse().join("")}`, "utf8");
}
function unseal(value: Buffer): string {
  const text = value.toString("utf8");
  if (!text.startsWith("sealed:")) throw new Error("invalid ciphertext");
  return [...text.slice("sealed:".length)].reverse().join("");
}

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: safeStorageState.isEncryptionAvailable,
    encryptString: safeStorageState.encryptString,
    decryptString: unseal,
  },
}));

const catalogFile = () => path.join(mockedUserDataRoot, "model-catalog.json");
const timestamp = "2026-09-01T00:00:00.000Z";

function vendor(extra?: Record<string, unknown>, key = "relay") {
  return {
    key,
    name: "Relay",
    enabled: true,
    authType: "bearer",
    providerKind: "openai-compatible",
    baseUrlHint: "https://relay.example/v1",
    ...(extra || {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function writeCatalog(value: unknown): void {
  fs.writeFileSync(catalogFile(), JSON.stringify(value), "utf8");
}

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-network-config-secrets-"));
  tempRoots.push(mockedUserDataRoot);
  safeStorageState.available = true;
  safeStorageState.isEncryptionAvailable.mockReset().mockImplementation(() => safeStorageState.available);
  safeStorageState.encryptString.mockReset().mockImplementation(seal);
  vi.resetModules();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("credential-bearing network config secure persistence", () => {
  it("reads a v11 legacy plaintext proxy/headers without probing safeStorage or rewriting bytes", async () => {
    const persisted = {
      version: 11,
      vendors: [
        vendor({
          network: { proxyUrl: "http://user:pass@127.0.0.1:7897" },
          meta: { extraHeaders: { Authorization: "Bearer legacy-token" } },
        }),
      ],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    };
    writeCatalog(persisted);
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    const state = store.readCatalog();
    // Version stays at 11 until an explicit write can migrate the secret atomically.
    expect(state.version).toBe(11);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
    // Outbound consumers still read the effective values (legacy fallback under the overlay).
    const readVendor = state.vendors[0];
    expect(readVendor.network?.proxyUrl).toBe("http://user:pass@127.0.0.1:7897");
    const { extractVendorExtraHeaders } = store;
    expect(extractVendorExtraHeaders(readVendor)).toEqual({ Authorization: "Bearer legacy-token" });
  });

  it("encrypts legacy proxy/headers on the next explicit vendor write and removes all plaintext", async () => {
    writeCatalog({
      version: 11,
      vendors: [
        vendor({
          network: { proxyUrl: "http://user:pass@127.0.0.1:7897" },
          meta: { extraHeaders: { "HTTP-Referer": "secret-referer" } },
        }),
      ],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");
    const network = await import("./networkConfigStore");

    // A plain re-save (no network fields supplied) must migrate, not drop, the legacy secrets.
    store.upsertModelCatalogVendor({ key: "relay", name: "Renamed relay" });

    const disk = fs.readFileSync(catalogFile(), "utf8");
    expect(disk).not.toContain("user:pass");
    expect(disk).not.toContain("secret-referer");
    const state = store.readCatalog();
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    // Effective values still resolve after migration (now from the encrypted record).
    const record = state.apiKeysByVendor["relay"];
    expect(network.decryptProxyUrl(record.networkConfig)).toBe("http://user:pass@127.0.0.1:7897");
    expect(network.decryptExtraHeaders(record.networkConfig)).toEqual({ "HTTP-Referer": "secret-referer" });
    // The persisted vendor row carries no plaintext credential fields.
    const diskVendor = JSON.parse(disk).vendors[0];
    expect(diskVendor.network).toBeUndefined();
    expect(diskVendor.meta?.extraHeaders).toBeUndefined();
  });

  it("is idempotent: re-saving an already-migrated vendor keeps the same decrypted values", async () => {
    writeCatalog({
      version: 11,
      vendors: [vendor({ network: { proxyUrl: "socks5://127.0.0.1:1080" }, meta: { extraHeaders: { "X-Key": "v1" } } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");
    const network = await import("./networkConfigStore");

    store.upsertModelCatalogVendor({ key: "relay", name: "First save" });
    store.upsertModelCatalogVendor({ key: "relay", name: "Second save" });
    store.upsertModelCatalogVendor({ key: "relay", name: "Third save" });

    const state = store.readCatalog();
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(state.vendors[0].name).toBe("Third save");
    const record = state.apiKeysByVendor["relay"];
    expect(network.decryptProxyUrl(record.networkConfig)).toBe("socks5://127.0.0.1:1080");
    expect(network.decryptExtraHeaders(record.networkConfig)).toEqual({ "X-Key": "v1" });
    expect(fs.readFileSync(catalogFile(), "utf8")).not.toContain("socks5://127.0.0.1:1080".replace("socks5", "socks5"));
  });

  it("encrypts a freshly supplied proxy and headers on save and never writes them as plaintext", async () => {
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");
    const network = await import("./networkConfigStore");

    store.upsertModelCatalogVendor({
      ...vendor(),
      network: { proxyUrl: "http://user:pass@proxy.local:8080" },
      meta: { extraHeaders: { Authorization: "Bearer fresh-token" } },
    });

    const disk = fs.readFileSync(catalogFile(), "utf8");
    expect(disk).not.toContain("user:pass");
    expect(disk).not.toContain("fresh-token");
    const record = store.readCatalog().apiKeysByVendor["relay"];
    expect(network.decryptProxyUrl(record.networkConfig)).toBe("http://user:pass@proxy.local:8080");
    expect(network.decryptExtraHeaders(record.networkConfig)).toEqual({ Authorization: "Bearer fresh-token" });
  });

  it("clears the encrypted proxy when a save supplies an empty proxy", async () => {
    writeCatalog({
      version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true,
      vendors: [],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");
    const network = await import("./networkConfigStore");

    store.upsertModelCatalogVendor({ ...vendor(), network: { proxyUrl: "http://127.0.0.1:7897" } });
    expect(network.decryptProxyUrl(store.readCatalog().apiKeysByVendor["relay"].networkConfig)).toBe("http://127.0.0.1:7897");

    // Explicit empty proxy clears it; other credentials (none here) would remain.
    store.upsertModelCatalogVendor({ key: "relay", name: "Relay", network: { proxyUrl: "" } });
    const record = store.readCatalog().apiKeysByVendor["relay"];
    expect(record?.networkConfig?.proxyUrl).toBeUndefined();
  });

  it("preserves an already-encrypted proxy on an unrelated re-save without re-encrypting", async () => {
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");
    const network = await import("./networkConfigStore");

    store.upsertModelCatalogVendor({ ...vendor(), network: { proxyUrl: "http://keep.me:7897" } });
    const encryptCallsAfterFirstSave = safeStorageState.encryptString.mock.calls.length;

    // A rename with no network payload must not touch the encrypted proxy at all.
    store.upsertModelCatalogVendor({ key: "relay", name: "Renamed" });
    expect(safeStorageState.encryptString.mock.calls.length).toBe(encryptCallsAfterFirstSave);
    expect(network.decryptProxyUrl(store.readCatalog().apiKeysByVendor["relay"].networkConfig)).toBe("http://keep.me:7897");
  });

  it("never surfaces proxy or headers through the renderer vendor DTO", async () => {
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");

    store.upsertModelCatalogVendor({
      ...vendor(),
      network: { proxyUrl: "http://user:pass@127.0.0.1:7897" },
      meta: { extraHeaders: { Authorization: "Bearer dto-token" }, label: "safe" },
    });

    const dto = store.listModelCatalogVendors()[0];
    expect(dto.network?.proxyUrl).toBeUndefined();
    const meta = dto.meta as Record<string, unknown> | undefined;
    expect(meta?.extraHeaders).toBeUndefined();
    // Non-credential meta survives.
    expect(meta?.label).toBe("safe");
    expect(JSON.stringify(dto)).not.toContain("user:pass");
    expect(JSON.stringify(dto)).not.toContain("dto-token");
  });

  it("never includes plaintext proxy/headers in renderer-facing catalog exports without keys", async () => {
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");
    store.upsertModelCatalogVendor({
      ...vendor(),
      network: { proxyUrl: "http://user:pass@127.0.0.1:7897" },
      meta: { extraHeaders: { Authorization: "Bearer export-token" } },
    });

    const exported = JSON.stringify(store.exportModelCatalogPackage());
    expect(exported).not.toContain("user:pass");
    expect(exported).not.toContain("export-token");
  });

  /**
   * 2026-09-21：导出侧不再带凭据（`includeApiKeys` 已删，理由在 catalogPackageFormat.ts），
   * 所以这条用例改成从**手写的包**导入——那正是它现在唯一的真实来源：
   * 用户（或他的 AI）照着供应商文档写一份配置文件，其中带上代理与请求头。
   * 要证的那件事没变、而且更重要了：写进来的凭据在本机重新加密落盘，明文一个字节都不许留在盘上。
   */
  it("re-encrypts proxy/headers that arrive in a hand-written import package", async () => {
    const importRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-network-config-import-"));
    tempRoots.push(importRoot);
    mockedUserDataRoot = importRoot;
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    vi.resetModules();
    const store2 = await import("./catalogStore");
    const network2 = await import("./networkConfigStore");

    const result = store2.importModelCatalogPackage({
      vendors: [
        {
          vendor: {
            ...vendor(),
            network: { proxyUrl: "http://user:pass@127.0.0.1:7897" },
            meta: { extraHeaders: { Authorization: "Bearer portable-token" } },
          },
          models: [],
          mappings: [],
        },
      ],
    });
    expect(result).toEqual({
      imported: { vendors: 1, models: 0, mappings: 0 },
      kept: { vendors: 0, models: 0, mappings: 0 },
      conflicts: [],
      errors: [],
    });
    const disk = fs.readFileSync(catalogFile(), "utf8");
    expect(disk).not.toContain("user:pass");
    expect(disk).not.toContain("portable-token");
    const record = store2.readCatalog().apiKeysByVendor["relay"];
    expect(network2.decryptProxyUrl(record.networkConfig)).toBe("http://user:pass@127.0.0.1:7897");
    expect(network2.decryptExtraHeaders(record.networkConfig)).toEqual({ Authorization: "Bearer portable-token" });
  });

  it("fails closed and leaves a v11 legacy catalog byte-for-byte unchanged when safeStorage is unavailable", async () => {
    safeStorageState.available = false;
    writeCatalog({
      version: 11,
      vendors: [vendor({ network: { proxyUrl: "http://user:pass@127.0.0.1:7897" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    expect(() => store.upsertModelCatalogVendor({ key: "relay", name: "Renamed" })).toThrow(/安全存储不可用/);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });

  it("fails closed when a fresh proxy save hits unavailable safeStorage and writes nothing", async () => {
    safeStorageState.available = false;
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    expect(() =>
      store.upsertModelCatalogVendor({ ...vendor(), network: { proxyUrl: "http://user:pass@127.0.0.1:7897" } }),
    ).toThrow(/安全存储不可用/);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });

  it("advances a clean v11 catalog to the current version on read without probing safeStorage", async () => {
    writeCatalog({ version: 11, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");

    expect(store.readCatalog().version).toBe(CURRENT_CATALOG_VERSION);
    expect(JSON.parse(fs.readFileSync(catalogFile(), "utf8")).version).toBe(CURRENT_CATALOG_VERSION);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });
});
