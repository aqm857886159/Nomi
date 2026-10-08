import { describe, expect, it, vi } from "vitest";

// A disabled TikHub key must not be decrypted and must not reach the network. Real secrets.ts,
// real service; only the keychain, the catalog read and the outbound resolver are stand-ins.
const decryptString = vi.hoisted(() => vi.fn((buf: Buffer) => buf.toString("utf8")));
const resolveShareVideo = vi.hoisted(() => vi.fn());
const searchReferences = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s, "utf8"), decryptString },
}));
vi.mock("../logging/logger", () => ({ logInfo: () => undefined, logWarn: () => undefined, logError: () => undefined, logDevDetail: () => undefined }));
vi.mock("./tikhubConnector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tikhubConnector")>()),
  resolveShareVideo,
  searchReferences,
}));
vi.mock("../assets/projectAssetStore", () => ({ importRemoteAsset: vi.fn() }));
vi.mock("../catalog/catalogStore", () => ({
  readCatalog: () => ({
    apiKeysByVendor: {
      tikhub: { vendorKey: "tikhub", apiKey: Buffer.from("sk-disabled", "utf8").toString("base64"), enc: "safeStorage", enabled: false, createdAt: "c", updatedAt: "u" },
    },
  }),
  upsertModelCatalogVendorApiKey: vi.fn(),
  clearModelCatalogVendorApiKey: vi.fn(),
}));

import { resolveTikhubShareUrl, importTikhubShareUrl } from "./tikhubConnectorService";

describe("TikHub consumers honour the enabled gate", () => {
  it("a disabled key is not decrypted and nothing is probed", async () => {
    await expect(resolveTikhubShareUrl({ shareUrl: "https://v.douyin.com/x/" })).rejects.toMatchObject({ kind: "missing-key" });
    await expect(importTikhubShareUrl({ projectId: "p1", shareUrl: "https://v.douyin.com/x/" })).rejects.toMatchObject({ kind: "missing-key" });
    expect(decryptString).not.toHaveBeenCalled();
    expect(resolveShareVideo).not.toHaveBeenCalled();
    expect(searchReferences).not.toHaveBeenCalled();
  });
});
