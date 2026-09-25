// 目录读缓存（2026-09-25 画布跟手）：盘上字节没变就不再重新解析、解密；
// 但缓存不许改变任何可见行为——调用方就地改返回值、别处改了文件、钥匙串先锁后开，三种情形都要和无缓存时一样。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keychain = vi.hoisted(() => ({ unlocked: true, decrypts: 0 }));

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => {
      keychain.decrypts += 1;
      if (!keychain.unlocked) throw new Error("keychain locked");
      return value.toString();
    },
  },
}));

let root = "";
const catalogFile = (): string => path.join(root, "model-catalog.json");

async function seededStore() {
  const store = await import("./catalogStore");
  store.upsertModelCatalogVendor({ key: "acme", name: "Acme" });
  store.upsertModelCatalogVendorApiKey("acme", { apiKey: "sk-test-acme" });
  return store;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-cache-"));
  process.env.NOMI_SETTINGS_DIR = root;
  keychain.unlocked = true;
  keychain.decrypts = 0;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.NOMI_SETTINGS_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("catalog read cache", () => {
  it("does not decrypt again while the file bytes are unchanged", async () => {
    const store = await seededStore();
    expect(store.readCatalog().vendors[0]?.hasApiKey).toBe(true);
    const decryptsAfterFirstRead = keychain.decrypts;

    store.readCatalog();
    store.readCatalog();

    expect(keychain.decrypts).toBe(decryptsAfterFirstRead);
  });

  it("hands out copies, so a caller mutating its result cannot leak into the next read", async () => {
    const store = await seededStore();
    store.readCatalog(); // 填缓存
    const hit = store.readCatalog(); // 命中缓存的那一份
    hit.vendors[0]!.name = "mutated in place";

    expect(store.readCatalog().vendors[0]?.name).toBe("Acme");
  });

  it("sees a change written to the file by anyone else", async () => {
    const store = await seededStore();
    store.readCatalog();
    const onDisk = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    onDisk.vendors[0].name = "Edited elsewhere";
    fs.writeFileSync(catalogFile(), JSON.stringify(onDisk), "utf8");

    expect(store.readCatalog().vendors[0]?.name).toBe("Edited elsewhere");
  });

  it("never caches a locked keychain: unlocking shows the key on the next read", async () => {
    const store = await seededStore();
    keychain.unlocked = false;
    // 换一份字节，确保这次读不是命中解锁时留下的缓存。
    const onDisk = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    onDisk.vendors[0].name = "Acme (locked read)";
    fs.writeFileSync(catalogFile(), JSON.stringify(onDisk), "utf8");
    expect(store.readCatalog().vendors[0]?.hasApiKey).toBe(false);

    keychain.unlocked = true;

    expect(store.readCatalog().vendors[0]?.hasApiKey).toBe(true);
  });
});
