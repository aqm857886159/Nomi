import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataRoot = "";

vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

const now = "2026-09-05T00:00:00.000Z";

function seedPersistedFailure(): void {
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify({
    version: 12,
    vendors: [{
      key: "relay",
      name: "Relay",
      enabled: false,
      baseUrlHint: "http://127.0.0.1:43123/v1",
      authType: "bearer",
      providerKind: "openai-compatible",
      createdAt: now,
      updatedAt: now,
    }],
    models: [{
      vendorKey: "relay",
      modelKey: "image-v1",
      labelZh: "Image V1",
      kind: "image",
      enabled: false,
      meta: { adapter: {
        state: "failed",
        runId: "failed-run",
        modes: [{ taskKind: "text_to_image", state: "failed", error: "old validation error" }],
        updatedAt: now,
      } },
      createdAt: now,
      updatedAt: now,
    }],
    mappings: [],
    apiKeysByVendor: {
      relay: {
        vendorKey: "relay",
        apiKey: Buffer.from("old-key").toString("base64"),
        enc: "safeStorage",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    },
  }), "utf8");
  fs.writeFileSync(path.join(userDataRoot, "provider-adapters.json"), JSON.stringify({
    version: 1,
    revision: 1,
    runs: [{
      id: "failed-run",
      vendorKey: "relay",
      vendorName: "Relay",
      connectionFingerprint: "old",
      selectedModelKeys: ["image-v1"],
      stage: "failed",
      repairAttempt: 0,
      models: [{ modelKey: "image-v1", labelZh: "Image V1", kind: "image", modes: [] }],
      sourceUrls: [],
      createdAt: now,
      updatedAt: now,
    }],
    revisions: [{ id: "revision-old", vendorKey: "relay", digest: "old", draft: { provider: {}, sources: [], models: [] }, verifiedModes: [] }],
  }), "utf8");
}

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-vendor-validation-persist-"));
  seedPersistedFailure();
  vi.resetModules();
});

afterEach(() => fs.rmSync(userDataRoot, { recursive: true, force: true }));

describe("vendor validation persistence invalidation", () => {
  it("clears the failed catalog projection and durable run when the saved API is removed", async () => {
    const store = await import("./catalogStore");

    store.clearModelCatalogVendorApiKey("relay");

    const reopened = store.readCatalog();
    expect(reopened.models[0]?.meta).toMatchObject({ adapter: { state: "unverified" } });
    expect((reopened.models[0]?.meta as { adapter?: { runId?: string; modes?: unknown[] } }).adapter?.runId).toBeUndefined();
    expect((reopened.models[0]?.meta as { adapter?: { modes?: unknown[] } }).adapter?.modes).toBeUndefined();
    const adapterStore = new (await import("../providerAdapter/store")).ProviderAdapterStore(
      path.join(userDataRoot, "provider-adapters.json"),
    );
    expect(adapterStore.listRuns()).toEqual([]);
    expect(new (await import("../providerAdapter/store")).ProviderAdapterStore(
      path.join(userDataRoot, "provider-adapters.json"),
    ).snapshot().revisions).toEqual([]);
  });

  it("invalidates the same failure when the connection scope is corrected", async () => {
    const store = await import("./catalogStore");

    store.upsertModelCatalogVendor({ key: "relay", baseUrlHint: "http://127.0.0.1:43124/v1" });

    expect(store.readCatalog().models[0]?.meta).toMatchObject({ adapter: { state: "unverified" } });
    expect(new (await import("../providerAdapter/store")).ProviderAdapterStore(
      path.join(userDataRoot, "provider-adapters.json"),
    ).listRuns()).toEqual([]);
  });
});
