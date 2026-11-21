import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_CATALOG_VERSION } from "./types";
import { withoutVendorFieldLossNotice } from "../shared/vendorFieldLossNotice";

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
const timestamp = "2026-08-16T00:00:00.000Z";

function vendor(meta?: Record<string, unknown>, key = "signed-relay") {
  return {
    key,
    name: "Signed relay",
    enabled: true,
    authType: "bearer",
    providerKind: "openai-compatible",
    baseUrlHint: "https://relay.example/v1",
    ...(meta ? { meta } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function writeCatalog(value: unknown): void {
  fs.writeFileSync(catalogFile(), JSON.stringify(value), "utf8");
}

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-custom-config-secrets-"));
  tempRoots.push(mockedUserDataRoot);
  safeStorageState.available = true;
  safeStorageState.isEncryptionAvailable.mockReset().mockImplementation(() => safeStorageState.available);
  safeStorageState.encryptString.mockReset().mockImplementation(seal);
  vi.resetModules();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("custom-call custom config secure persistence", () => {
  it("does not probe safeStorage when a v9 catalog has no API keys", async () => {
    writeCatalog({ version: 9, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");

    expect(store.readCatalog().apiKeysByVendor).toEqual({});
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("does not probe safeStorage when every v9 API key is already encrypted", async () => {
    writeCatalog({
      version: 9,
      vendors: [vendor()],
      models: [],
      mappings: [],
      apiKeysByVendor: {
        "signed-relay": {
          vendorKey: "signed-relay",
          apiKey: seal("already-encrypted").toString("base64"),
          enc: "safeStorage",
          enabled: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    });
    const store = await import("./catalogStore");

    expect(store.readCatalog().apiKeysByVendor["signed-relay"].enc).toBe("safeStorage");
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("reads a v9 plaintext API key without probing safeStorage or encrypting it during the v10 structural migration", async () => {
    const apiKey = "plain-key-remains-readable";
    const persisted = {
      version: 9,
      vendors: [vendor()],
      models: [],
      mappings: [],
      apiKeysByVendor: {
        "signed-relay": {
          vendorKey: "signed-relay",
          apiKey,
          enc: "plain",
          enabled: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
    writeCatalog(persisted);
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    const state = store.readCatalog();
    const record = state.apiKeysByVendor["signed-relay"];
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(record).toEqual(persisted.apiKeysByVendor["signed-relay"]);
    expect(secrets.apiKeyDecryptStatus(record)).toBe("needs_resave");
    expect(secrets.decryptApiKeyRecord(record)).toBe("");
    expect(fs.readFileSync(catalogFile(), "utf8")).toContain(apiKey);
  });

  it("encrypts a newly saved API key only on the explicit credential write", async () => {
    const apiKey = "new-key-encrypted-on-write";
    writeCatalog({ version: 9, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    expect(store.readCatalog().apiKeysByVendor).toEqual({});
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();

    store.upsertModelCatalogVendorApiKey("signed-relay", { apiKey, enabled: true });
    const record = store.readCatalog().apiKeysByVendor["signed-relay"];
    expect(safeStorageState.isEncryptionAvailable).toHaveBeenCalledTimes(1);
    expect(record.enc).toBe("safeStorage");
    expect(secrets.apiKeyDecryptStatus(record)).toBe("ok");
    expect(secrets.decryptApiKeyRecord(record)).toBe(apiKey);
    expect(fs.readFileSync(catalogFile(), "utf8")).not.toContain(apiKey);
  });

  it("reads a v8 catalog without probing safeStorage or rewriting any bytes", async () => {
    const apiKey = "legacy-api-key-42";
    const signingKey = "secondary-secret-42";
    const persisted = {
      version: 8,
      vendors: [vendor({ customConfig: { signingKey, region: "cn-beijing" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {
        "signed-relay": {
          vendorKey: "signed-relay",
          apiKey,
          enc: "plain",
          enabled: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
    writeCatalog(persisted);
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");
    const state = store.readCatalog();
    const record = state.apiKeysByVendor["signed-relay"];

    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(state.version).toBe(8);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
    expect(record).toEqual(persisted.apiKeysByVendor["signed-relay"]);
    expect(secrets.apiKeyDecryptStatus(record)).toBe("needs_resave");
    expect(secrets.decryptApiKeyRecord(record)).toBe("");
    expect(secrets.decryptCustomConfigWithLegacy(record, state.vendors[0].meta)).toEqual({
      signingKey,
      region: "cn-beijing",
    });
    expect(store.listModelCatalogVendors()[0].meta).toBeUndefined();
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([
      { name: "region", hasValue: true },
      { name: "signingKey", hasValue: true },
    ]);
  });

  it("advances a v8 catalog with no legacy customConfig to the current version without probing safeStorage", async () => {
    writeCatalog({ version: 8, vendors: [vendor({ label: "public-only" })], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");

    expect(store.readCatalog().version).toBe(CURRENT_CATALOG_VERSION);
    expect(JSON.parse(fs.readFileSync(catalogFile(), "utf8")).version).toBe(CURRENT_CATALOG_VERSION);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("migrates a v1 catalog to the current version while preserving a legacy API key without probing safeStorage", async () => {
    const apiKey = "v1-legacy-api-key";
    writeCatalog({
      version: 1,
      vendors: [vendor()],
      models: [],
      mappings: [],
      apiKeysByVendor: {
        "signed-relay": {
          vendorKey: "signed-relay",
          apiKey,
          enabled: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    const state = store.readCatalog();
    const record = state.apiKeysByVendor["signed-relay"];
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(record.apiKey).toBe(apiKey);
    expect(record.enc).toBe("plain");
    expect(secrets.apiKeyDecryptStatus(record)).toBe("needs_resave");
    expect(secrets.decryptApiKeyRecord(record)).toBe("");
    expect(JSON.parse(fs.readFileSync(catalogFile(), "utf8")).version).toBe(CURRENT_CATALOG_VERSION);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("stops a v7 forward migration at v8 when legacy customConfig still needs an explicit credential write", async () => {
    writeCatalog({
      version: 7,
      vendors: [vendor({ customConfig: { signingKey: "v7-legacy-secret" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");

    expect(store.readCatalog().version).toBe(8);
    const disk = fs.readFileSync(catalogFile(), "utf8");
    expect(JSON.parse(disk).version).toBe(8);
    expect(disk).toContain("v7-legacy-secret");
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("reads a future catalog without probing safeStorage or rewriting any bytes", async () => {
    const future = {
      version: 99,
      vendors: [vendor({ customConfig: { signingKey: "future-secret" }, futureOnly: true })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    };
    writeCatalog(future);
    const before = fs.readFileSync(catalogFile(), "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = await import("./catalogStore");

    expect(store.readCatalog().version).toBe(99);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("preserves hidden legacy customConfig when a public vendor DTO is written back (extraHeaders now encrypted)", async () => {
    const signingKey = "hidden-round-trip-secret";
    writeCatalog({
      version: 8,
      // 'x-tenant' rides extraHeaders, which is now a credential-bearing field: a public
      // DTO masks it and a write encrypts it into the credential record, not the vendor row.
      vendors: [vendor({ customConfig: { signingKey }, extraHeaders: { "x-tenant": "tenant-a" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");
    const network = await import("./networkConfigStore");

    const publicDto = store.listModelCatalogVendors()[0];
    // The DTO no longer carries the (credential-bearing) extraHeaders in plaintext.
    expect(publicDto.meta).toBeUndefined();
    store.upsertModelCatalogVendor({ ...publicDto, name: "Renamed relay" });

    const disk = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    expect(disk.vendors[0].name).toBe("Renamed relay");
    // customConfig stays hidden; extraHeaders left the plaintext vendor row entirely.
    expect(disk.vendors[0].meta).toEqual({ customConfig: { signingKey } });
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([
      { name: "signingKey", hasValue: true },
    ]);
    // The header value is now in the encrypted credential record and still resolves.
    expect(network.decryptExtraHeaders(store.readCatalog().apiKeysByVendor["signed-relay"].networkConfig)).toEqual({
      "x-tenant": "tenant-a",
    });
  });

  it("migrates legacy extraHeaders into the encrypted record on an ordinary vendor edit with meta omitted", async () => {
    const signingKey = "hidden-ordinary-edit-secret";
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { signingKey }, extraHeaders: { "x-tenant": "tenant-a" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");
    const network = await import("./networkConfigStore");

    store.upsertModelCatalogVendor({
      key: "signed-relay",
      name: "Ordinary edit",
      enabled: false,
      baseUrlHint: "https://relay-edited.example/v1",
    });

    const disk = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    expect(disk.vendors[0]).toMatchObject({
      name: "Ordinary edit",
      enabled: false,
      baseUrlHint: "https://relay-edited.example/v1",
    });
    // extraHeaders no longer persists as plaintext; only the still-legacy customConfig remains.
    expect(disk.vendors[0].meta).toEqual({ customConfig: { signingKey } });
    expect(disk).not.toContain("tenant-a");
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([
      { name: "signingKey", hasValue: true },
    ]);
    expect(network.decryptExtraHeaders(store.readCatalog().apiKeysByVendor["signed-relay"].networkConfig)).toEqual({
      "x-tenant": "tenant-a",
    });
  });

  it("encrypts an explicitly supplied vendor meta.customConfig and extraHeaders instead of persisting plaintext", async () => {
    const signingKey = "direct-vendor-write-secret";
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");
    const network = await import("./networkConfigStore");

    const projected = store.upsertModelCatalogVendor({
      ...vendor(),
      meta: { customConfig: { signingKey }, extraHeaders: { "x-tenant": "tenant-a" } },
    });

    const disk = fs.readFileSync(catalogFile(), "utf8");
    const state = store.readCatalog();
    expect(disk).not.toContain(signingKey);
    expect(disk).not.toContain("tenant-a");
    // Both credential-bearing configs left the projected DTO and the on-disk vendor row.
    expect(projected.meta).toBeUndefined();
    expect(JSON.parse(disk).vendors[0].meta).toBeUndefined();
    expect(store.listModelCatalogVendors()[0].meta).toBeUndefined();
    // readCatalog's INTERNAL vendor carries the decrypted overlay for outbound consumers.
    expect((state.vendors[0].meta as { extraHeaders?: unknown }).extraHeaders).toEqual({ "x-tenant": "tenant-a" });
    expect(secrets.decryptCustomConfigRecord(state.apiKeysByVendor["signed-relay"])).toEqual({ signingKey });
    expect(network.decryptExtraHeaders(state.apiKeysByVendor["signed-relay"].networkConfig)).toEqual({
      "x-tenant": "tenant-a",
    });
  });

  it("atomically replaces legacy config during catalog import and removes all plaintext", async () => {
    const oldSecret = "legacy-import-secret";
    const newSecret = "encrypted-import-secret";
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { oldSecret }, extraHeaders: { "x-tenant": "tenant-a" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");
    const publicVendor = store.listModelCatalogVendors()[0];

    // 给一个**已存在**的 vendor 换凭据 = 覆盖，必须是用户在确认那一步显式选的。
    // 默认的 'keep' 会保留本机那一份（导入是合并，不是覆盖），所以这条用例走 replace。
    expect(
      store.importModelCatalogPackage(
        {
          vendors: [
            {
              vendor: publicVendor,
              apiKey: { customConfig: { newSecret } },
              models: [],
              mappings: [],
            },
          ],
        },
        { conflictPolicy: "replace" },
      ),
    ).toEqual({
      imported: { vendors: 1, models: 0, mappings: 0 },
      kept: { vendors: 0, models: 0, mappings: 0 },
      conflicts: [{ kind: "vendor", vendorKey: publicVendor.key }],
      errors: [],
    });

    const disk = fs.readFileSync(catalogFile(), "utf8");
    const state = store.readCatalog();
    expect(disk).not.toContain(oldSecret);
    expect(disk).not.toContain(newSecret);
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(state.vendors[0].meta).toEqual({ extraHeaders: { "x-tenant": "tenant-a" } });
    expect(secrets.decryptCustomConfigRecord(state.apiKeysByVendor["signed-relay"])).toEqual({ newSecret });
  });

  it("merges mixed legacy and encrypted config across vendors with encrypted entries winning", async () => {
    const encrypted = (value: string) => ({ value: seal(value).toString("base64"), enc: "safeStorage" as const });
    writeCatalog({
      version: 8,
      vendors: [
        vendor({ customConfig: { shared: "legacy-loses", legacyOnly: "legacy-only" } }),
        vendor({ customConfig: { otherLegacy: "other-legacy" } }, "other-relay"),
      ],
      models: [],
      mappings: [],
      apiKeysByVendor: {
        "signed-relay": {
          vendorKey: "signed-relay",
          apiKey: "",
          enc: "plain",
          enabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          customConfig: {
            shared: encrypted("encrypted-wins"),
            encryptedOnly: encrypted("encrypted-only"),
          },
        },
        "other-relay": {
          vendorKey: "other-relay",
          apiKey: "",
          enc: "plain",
          enabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          customConfig: { otherEncrypted: encrypted("other-encrypted") },
        },
      },
    });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    expect(
      store.upsertModelCatalogCustomCallConfig("signed-relay", [
        { name: "shared", keepFrom: "shared" },
        { name: "legacyOnly", keepFrom: "legacyOnly" },
        { name: "encryptedOnly", keepFrom: "encryptedOnly" },
      ]),
    ).toEqual([
      { name: "encryptedOnly", hasValue: true },
      { name: "legacyOnly", hasValue: true },
      { name: "shared", hasValue: true },
    ]);

    const state = store.readCatalog();
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(secrets.decryptCustomConfigRecord(state.apiKeysByVendor["signed-relay"])).toEqual({
      shared: "encrypted-wins",
      legacyOnly: "legacy-only",
      encryptedOnly: "encrypted-only",
    });
    expect(secrets.decryptCustomConfigRecord(state.apiKeysByVendor["other-relay"])).toEqual({
      otherLegacy: "other-legacy",
      otherEncrypted: "other-encrypted",
    });
  });

  it("migrates fully shadowed legacy config without probing unavailable safeStorage", async () => {
    safeStorageState.available = false;
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { shared: "legacy-shadowed" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {
        "signed-relay": {
          vendorKey: "signed-relay",
          apiKey: "",
          enc: "plain",
          enabled: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          customConfig: {
            shared: { value: seal("encrypted-wins").toString("base64"), enc: "safeStorage" },
          },
        },
      },
    });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    expect(
      store.upsertModelCatalogCustomCallConfig("signed-relay", [
        { name: "shared", keepFrom: "shared" },
      ]),
    ).toEqual([{ name: "shared", hasValue: true }]);

    const state = store.readCatalog();
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(secrets.decryptCustomConfigRecord(state.apiKeysByVendor["signed-relay"])).toEqual({
      shared: "encrypted-wins",
    });
    // 这条路径会跑到 v13 迁移，而它给修复前写过的自建连接盖了一条「声明可能丢了」的提示
    // （vendorFieldLossRepair.ts）。本条断言问的是「旧 customConfig 明文清干净了吗」，剥掉那条再看。
    expect(withoutVendorFieldLossNotice(state.vendors[0].meta)).toBeUndefined();
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("cleans empty and invalid legacy fields across vendors only on explicit save without probing safeStorage", async () => {
    safeStorageState.available = false;
    writeCatalog({
      version: 8,
      vendors: [
        vendor({ customConfig: {}, label: "first-public" }),
        vendor({ customConfig: ["invalid-legacy-shape"], label: "second-public" }, "other-relay"),
      ],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    expect(store.readCatalog().version).toBe(8);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();

    expect(store.upsertModelCatalogCustomCallConfig("signed-relay", [])).toEqual([]);
    const state = store.readCatalog();
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(state.vendors.map((item) => withoutVendorFieldLossNotice(item.meta))).toEqual([
      { label: "first-public" },
      { label: "second-public" },
    ]);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("stores new values as ciphertext and returns only masked names to the renderer", async () => {
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    const projected = store.upsertModelCatalogCustomCallConfig("signed-relay", [
      { name: "accessKey", value: "ak-user-visible-once" },
      { name: "secretKey", value: "sk-never-on-disk" },
    ]);
    const disk = fs.readFileSync(catalogFile(), "utf8");
    const record = store.readCatalog().apiKeysByVendor["signed-relay"];

    expect(disk).not.toContain("ak-user-visible-once");
    expect(disk).not.toContain("sk-never-on-disk");
    expect(projected).toEqual([
      { name: "accessKey", hasValue: true },
      { name: "secretKey", hasValue: true },
    ]);
    expect(secrets.decryptCustomConfigRecord(record)).toEqual({
      accessKey: "ak-user-visible-once",
      secretKey: "sk-never-on-disk",
    });
    const exported = store.exportModelCatalogPackage();
    expect(JSON.stringify(exported)).not.toContain("ak-user-visible-once");
    expect(JSON.stringify(exported)).not.toContain("sk-never-on-disk");
  });

  it("defers v8 secret migration until an explicit custom-config write", async () => {
    safeStorageState.available = false;
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { signingKey: "retry-secret-42" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    expect(store.readCatalog().version).toBe(8);
    expect(fs.readFileSync(catalogFile(), "utf8")).toContain("retry-secret-42");
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();

    safeStorageState.available = true;
    expect(store.readCatalog().version).toBe(8);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();

    expect(
      store.upsertModelCatalogCustomCallConfig("signed-relay", [
        { name: "signingKey", keepFrom: "signingKey" },
      ]),
    ).toEqual([{ name: "signingKey", hasValue: true }]);
    const state = store.readCatalog();
    expect(state.version).toBe(CURRENT_CATALOG_VERSION);
    expect(safeStorageState.isEncryptionAvailable).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(catalogFile(), "utf8")).not.toContain("retry-secret-42");
    expect(secrets.decryptCustomConfigRecord(state.apiKeysByVendor["signed-relay"])).toEqual({
      signingKey: "retry-secret-42",
    });
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([{ name: "signingKey", hasValue: true }]);
  });

  it("leaves a v8 catalog byte-for-byte unchanged when encryption fails mid-migration", async () => {
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { first: "first-secret", second: "second-secret" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const before = fs.readFileSync(catalogFile(), "utf8");
    safeStorageState.encryptString
      .mockImplementationOnce(seal)
      .mockImplementationOnce(() => {
        throw new Error("simulated encryption failure");
      });
    const store = await import("./catalogStore");

    expect(() =>
      store.upsertModelCatalogCustomCallConfig("signed-relay", [
        { name: "first", keepFrom: "first" },
        { name: "second", keepFrom: "second" },
      ]),
    ).toThrow(/simulated encryption failure/);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });

  it("leaves a v8 catalog byte-for-byte unchanged when safeStorage is unavailable", async () => {
    safeStorageState.available = false;
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { signingKey: "unavailable-secret" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    expect(() =>
      store.upsertModelCatalogCustomCallConfig("signed-relay", [
        { name: "signingKey", keepFrom: "signingKey" },
      ]),
    ).toThrow(/安全存储不可用/);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });

  it("never includes v8 legacy customConfig values in renderer-facing catalog exports", async () => {
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { signingKey: "legacy-export-secret" }, label: "safe-meta" })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");

    const exported = JSON.stringify(store.exportModelCatalogPackage());
    expect(exported).not.toContain("legacy-export-secret");
    expect(exported).not.toContain("signingKey");
    expect(exported).toContain("safe-meta");
  });

  it("fails closed when safeStorage is unavailable and leaves the catalog unchanged", async () => {
    safeStorageState.available = false;
    writeCatalog({ version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    expect(() =>
      store.upsertModelCatalogCustomCallConfig("signed-relay", [{ name: "secretKey", value: "must-not-be-written" }]),
    ).toThrow(/安全存储不可用/);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });
});
