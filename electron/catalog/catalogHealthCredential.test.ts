import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => {
      const plain = value.toString();
      if (plain === "LOCKED") throw new Error("locked credential");
      return plain;
    },
  },
}));

import { getModelCatalogHealth } from "./catalogStore";
import { CURRENT_CATALOG_VERSION, type CatalogState } from "./types";

const now = "2026-08-28T00:00:00.000Z";

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-health-"));
});

afterEach(() => {
  fs.rmSync(userDataRoot, { recursive: true, force: true });
});

describe("model catalog health credential readiness", () => {
  it("counts and executes only apiKeyDecryptStatus=ok records and reports migration/locked issue codes", () => {
    const vendorKeys = ["secure", "legacy", "locked"];
    const state: CatalogState = {
      version: CURRENT_CATALOG_VERSION,
      vendors: vendorKeys.map((key) => ({
        key,
        name: key,
        enabled: true,
        baseUrlHint: `https://${key}.example.test/v1`,
        authType: "bearer",
        createdAt: now,
        updatedAt: now,
      })),
      models: vendorKeys.map((vendorKey) => ({
        vendorKey,
        modelKey: `${vendorKey}-image`,
        labelZh: vendorKey,
        kind: "image",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })),
      mappings: vendorKeys.map((vendorKey) => ({
        id: `${vendorKey}-mapping`, vendorKey, modelKey: `${vendorKey}-image`, taskKind: "text_to_image",
        name: vendorKey, enabled: true, create: { method: "POST", path: "/images" }, createdAt: now, updatedAt: now,
      })),
      apiKeysByVendor: {
        secure: { vendorKey: "secure", apiKey: Buffer.from("SAFE").toString("base64"), enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now },
        legacy: { vendorKey: "legacy", apiKey: "SENTINEL-PLAIN", enc: "plain", enabled: true, createdAt: now, updatedAt: now },
        locked: { vendorKey: "locked", apiKey: Buffer.from("LOCKED").toString("base64"), enc: "safeStorage", enabled: true, createdAt: now, updatedAt: now },
      },
    };
    fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const health = getModelCatalogHealth() as {
      ok: boolean;
      counts: { enabledApiKeys: number };
      byKind: Array<{ kind: string; executableModels: number }>;
      issues: Array<{ code: string; vendorKey?: string }>;
    };

    expect(health.counts.enabledApiKeys).toBe(1);
    expect(health.byKind.find((entry) => entry.kind === "image")?.executableModels).toBe(1);
    expect(health.ok).toBe(false);
    expect(health.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "vendor_api_key_needs_resave", vendorKey: "legacy" }),
      expect.objectContaining({ code: "vendor_api_key_locked", vendorKey: "locked" }),
    ]));
    expect(JSON.stringify([health, errorSpy.mock.calls])).not.toContain("SENTINEL-PLAIN");
    errorSpy.mockRestore();
  });
});
