import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeStorageState = vi.hoisted(() => ({ available: true }));
let mockedUserDataRoot = "";
const tempRoots: string[] = [];

function seal(value: string): Buffer {
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
    isEncryptionAvailable: () => safeStorageState.available,
    encryptString: seal,
    decryptString: unseal,
  },
}));

const catalogFile = () => path.join(mockedUserDataRoot, "model-catalog.json");
const timestamp = "2026-08-16T00:00:00.000Z";

function vendor(meta?: Record<string, unknown>) {
  return {
    key: "signed-relay",
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
  vi.resetModules();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("custom-call custom config secure persistence", () => {
  it("migrates v8 plaintext plus a legacy API key without losing either credential", async () => {
    const apiKey = "legacy-api-key-42";
    const signingKey = "secondary-secret-42";
    writeCatalog({
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
    });

    const store = await import("./catalogStore");
    const secrets = await import("./secrets");
    const state = store.readCatalog();
    const disk = fs.readFileSync(catalogFile(), "utf8");
    const record = state.apiKeysByVendor["signed-relay"];

    expect(state.version).toBe(9);
    expect(disk).not.toContain(apiKey);
    expect(disk).not.toContain(signingKey);
    expect(disk).not.toContain("cn-beijing");
    expect(state.vendors[0].meta).toBeUndefined();
    expect(secrets.decryptApiKeyRecord(record)).toBe(apiKey);
    expect(secrets.decryptCustomConfigRecord(record)).toEqual({ signingKey, region: "cn-beijing" });
    expect(store.listModelCatalogVendors()[0].meta).toBeUndefined();
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([
      { name: "region", hasValue: true },
      { name: "signingKey", hasValue: true },
    ]);
  });

  it("stores new values as ciphertext and returns only masked names to the renderer", async () => {
    writeCatalog({ version: 9, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
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

  it("retries a deferred v8 migration when safeStorage becomes available in the same session", async () => {
    safeStorageState.available = false;
    writeCatalog({
      version: 8,
      vendors: [vendor({ customConfig: { signingKey: "retry-secret-42" } })],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    });
    const store = await import("./catalogStore");

    expect(store.readCatalog().version).toBe(8);
    expect(fs.readFileSync(catalogFile(), "utf8")).toContain("retry-secret-42");

    safeStorageState.available = true;
    expect(store.readCatalog().version).toBe(9);
    expect(fs.readFileSync(catalogFile(), "utf8")).not.toContain("retry-secret-42");
    expect(store.listModelCatalogCustomCallConfig("signed-relay")).toEqual([{ name: "signingKey", hasValue: true }]);
  });

  it("fails closed when safeStorage is unavailable and leaves the catalog unchanged", async () => {
    safeStorageState.available = false;
    writeCatalog({ version: 9, vendors: [vendor()], models: [], mappings: [], apiKeysByVendor: {} });
    const before = fs.readFileSync(catalogFile(), "utf8");
    const store = await import("./catalogStore");

    expect(() =>
      store.upsertModelCatalogCustomCallConfig("signed-relay", [{ name: "secretKey", value: "must-not-be-written" }]),
    ).toThrow(/安全存储不可用/);
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });
});
