import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
let decryptShouldFail = false;
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => {
      if (decryptShouldFail) throw new Error("keychain record is unavailable");
      return value.toString();
    },
  },
}));

const NOW = "2026-08-09T00:00:00.000Z";

function writeCatalog(): void {
  fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify({
    version: 8,
    vendors: [{
      key: "code-newcli-com",
      name: "code-newcli-com",
      enabled: true,
      authType: "bearer",
      createdAt: NOW,
      updatedAt: NOW,
    }],
    models: [{
      modelKey: "gpt-image-2",
      vendorKey: "code-newcli-com",
      labelZh: "GPT Image 2",
      kind: "image",
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    mappings: [],
    apiKeysByVendor: {
      "code-newcli-com": {
        vendorKey: "code-newcli-com",
        apiKey: Buffer.from("usable-key").toString("base64"),
        enc: "safeStorage",
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
  }), "utf8");
}

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-key-availability-"));
  tempRoots.push(mockedUserDataRoot);
  decryptShouldFail = false;
  vi.resetModules();
  writeCatalog();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("catalog API key availability", () => {
  it("marks a vendor connected only when the encrypted key can be decrypted", async () => {
    const { readCatalog } = await import("./catalogStore");
    expect(readCatalog().vendors[0]?.hasApiKey).toBe(true);
  });

  it("marks an undecryptable key unavailable before task routing", async () => {
    decryptShouldFail = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getModelCatalogHealth, readCatalog } = await import("./catalogStore");

    expect(readCatalog().vendors[0]?.hasApiKey).toBe(false);
    expect(getModelCatalogHealth()).toMatchObject({
      counts: { enabledApiKeys: 0 },
      byKind: expect.arrayContaining([{ kind: "image", enabledModels: 1, executableModels: 0 }]),
      issues: expect.arrayContaining([expect.objectContaining({
        code: "vendor_api_key_missing",
        vendorKey: "code-newcli-com",
      })]),
    });
    errorSpy.mockRestore();
  });
});
