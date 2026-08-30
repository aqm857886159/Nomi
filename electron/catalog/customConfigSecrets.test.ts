import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_CATALOG_VERSION } from "./types";

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

  it("preserves hidden legacy customConfig when a public vendor DTO is written back", async () => {
    const signingKey = "hidden-round-trip-secret";
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { signingKey }, extraHeaders: { "x-tenant": "tenant-a" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");

    const publicDto = store.listModelCatalogVendors()[0];
    expect(publicDto.meta).toEqual({ extraHeaders: { "x-tenant": "tenant-a" } });
    store.upsertModelCatalogVendor({ ...publicDto, name: "Renamed relay" });

    const disk = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    expect(disk.version).toBe(8);
    expect(disk.vendors[0].name).toBe("Renamed relay");
    expect(disk.vendors[0].meta).toEqual({
      customConfig: { signingKey },
      extraHeaders: { "x-tenant": "tenant-a" },
    });
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([
      { name: "signingKey", hasValue: true },
    ]);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("preserves hidden legacy customConfig on ordinary vendor edits with meta omitted", async () => {
    const signingKey = "hidden-ordinary-edit-secret";
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { signingKey }, extraHeaders: { "x-tenant": "tenant-a" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");

    store.upsertModelCatalogVendor({
      key: "signed-relay",
      name: "Ordinary edit",
      enabled: false,
      baseUrlHint: "https://relay-edited.example/v1",
    });

    const disk = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    expect(disk.version).toBe(8);
    expect(disk.vendors[0]).toMatchObject({
      name: "Ordinary edit",
      enabled: false,
      baseUrlHint: "https://relay-edited.example/v1",
    });
    expect(disk.vendors[0].meta).toEqual({
      customConfig: { signingKey },
      extraHeaders: { "x-tenant": "tenant-a" },
    });
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([
      { name: "signingKey", hasValue: true },
    ]);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("encrypts an explicitly supplied vendor meta.customConfig instead of persisting plaintext", async () => {
    const signingKey = "direct-vendor-write-secret";
    writeCatalog({ version: 9, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
    const store = await import("./catalogStore");
    const secrets = await import("./secrets");

    const projected = store.upsertModelCatalogVendor({
      ...vendor(),
      meta: { customConfig: { signingKey }, extraHeaders: { "x-tenant": "tenant-a" } },
    });

    const disk = fs.readFileSync(catalogFile(), "utf8");
    const state = store.readCatalog();
    expect(disk).not.toContain(signingKey);
    expect(projected.meta).toEqual({ extraHeaders: { "x-tenant": "tenant-a" } });
    expect(state.vendors[0].meta).toEqual({ extraHeaders: { "x-tenant": "tenant-a" } });
    expect(secrets.decryptCustomConfigRecord(state.apiKeysByVendor["signed-relay"])).toEqual({ signingKey });
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

    expect(
      store.importModelCatalogPackage({
        vendors: [
          {
            vendor: publicVendor,
            apiKey: { customConfig: { newSecret } },
            models: [],
            mappings: [],
          },
        ],
      }),
    ).toEqual({ imported: { vendors: 1, models: 0, mappings: 0 }, errors: [] });

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
    expect(state.vendors[0].meta).toBeUndefined();
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
    expect(state.vendors.map((item) => item.meta)).toEqual([
      { label: "first-public" },
      { label: "second-public" },
    ]);
    expect(safeStorageState.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("stores new values as ciphertext and returns only masked names to the renderer", async () => {
    writeCatalog({ version: CURRENT_CATALOG_VERSION, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
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
    const exported = store.exportModelCatalogPackage({ includeApiKeys: true });
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

    const exported = JSON.stringify(store.exportModelCatalogPackage({ includeApiKeys: true }));
    expect(exported).not.toContain("legacy-export-secret");
    expect(exported).not.toContain("signingKey");
    expect(exported).toContain("safe-meta");
  });

  it("fails closed when safeStorage is unavailable and leaves the catalog unchanged", async () => {
    safeStorageState.available = false;
    writeCatalog({ version: CURRENT_CATALOG_VERSION, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    expect(() =>
      store.upsertModelCatalogCustomCallConfig("signed-relay", [{ name: "secretKey", value: "must-not-be-written" }]),
    ).toThrow(/安全存储不可用/);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });
});
