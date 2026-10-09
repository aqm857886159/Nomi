// 配置导出/导入的三条硬约束（批次 E 第 8 项，2026-09-21；用户：「配置导入导出发版前做」）。
//
//   ① 导出包里**没有任何密钥材料**——明文不许，safeStorage 密文也不许；
//   ② 导入是**合并不是覆盖**：本机已经有同一条时默认保留本机那份，并把冲突列给用户看；
//   ③ 导入走的就是手动保存那一扇写入门，所以写前自动把上一版轮转成 model-catalog.bak.json。
//
// ① 为什么连密文都不要：换机器/换用户账户必然解不开，而解不开时长得跟「key 填错了」一模一样
// （memory「key 对却 401」那条坑）——等于交付一个会说谎的文件。
// ② 为什么默认保留：导入最常见的两个场景是「新机器上恢复」（本机空、零冲突、全量进来）和
// 「补上我缺的那几家」。默认覆盖就会在用户只想补一家时安静改掉他调好的另一家——那又是一次
// 「我的配置自己变了」，正是这条 lane 在根治的东西。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeStorageState = { available: true };
vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^sealed:/, ""),
  },
}));

let root = "";
const catalogFile = (): string => path.join(root, "model-catalog.json");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-portability-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", root);
  safeStorageState.available = true;
  vi.resetModules();
});

afterEach(() => {
  vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

const SECRET = "sk-this-must-never-leave-the-box";

async function storeWithOneConfiguredVendor(): Promise<typeof import("./catalogStore")> {
  const store = await import("./catalogStore");
  store.upsertModelCatalogVendor({ key: "relay", name: "My Relay", authType: "bearer", enabled: true, baseUrlHint: "https://relay.test/v1" });
  store.upsertModelCatalogVendorApiKey("relay", { apiKey: SECRET, enabled: true });
  store.upsertModelCatalogModel({ vendorKey: "relay", modelKey: "my-image", labelZh: "我的图像模型", kind: "image", enabled: true });
  return store;
}

describe("an exported config carries the structure and never the credentials", () => {
  it("contains no key material at all — not the plaintext, not the ciphertext, not the record", async () => {
    const store = await storeWithOneConfiguredVendor();

    const exported = store.exportModelCatalogPackage();
    const text = JSON.stringify(exported);

    // 用户手配一晚上的那部分必须完整带走。
    expect(exported.vendors.map((bundle) => bundle.vendor.key)).toEqual(["relay"]);
    expect(exported.vendors[0].models.map((model) => model.modelKey)).toEqual(["my-image"]);
    expect(exported.vendors[0].vendor.baseUrlHint).toBe("https://relay.test/v1");

    // 凭据那部分一个字节都不许在里面——明文不许，密文也不许。
    const ciphertext = Buffer.from(`sealed:${SECRET}`, "utf8").toString("base64");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(ciphertext);
    expect(text).not.toContain("apiKeysByVendor");
    expect(exported.vendors[0]).not.toHaveProperty("apiKey");
    // 阳性对照：盘上确实存着那份密文——「导出里扫不到」不是因为压根没存过。
    expect(fs.readFileSync(catalogFile(), "utf8")).toContain(ciphertext);
  });
});

describe("importing merges instead of overwriting", () => {
  it("keeps what the box already has, reports every conflict, and still brings in what is new", async () => {
    const store = await storeWithOneConfiguredVendor();

    const result = store.importModelCatalogPackage({
      version: "desktop-local-v1",
      exportedAt: new Date().toISOString(),
      vendors: [
        {
          // 同一个 vendorKey，但名字与地址都不一样：默认不许它改掉用户本机这一份。
          vendor: { key: "relay", name: "Someone Else's Relay", authType: "bearer", enabled: true, baseUrlHint: "https://other.test/v1" },
          apiKey: { apiKey: "sk-from-the-package", enabled: true },
          models: [
            { vendorKey: "relay", modelKey: "my-image", labelZh: "被覆盖的名字", kind: "image", enabled: true },
            { vendorKey: "relay", modelKey: "brand-new-video", labelZh: "新来的视频模型", kind: "video", enabled: true },
          ],
          mappings: [],
        },
      ],
    });

    expect(result.imported).toEqual({ vendors: 0, models: 1, mappings: 0 });
    expect(result.kept).toEqual({ vendors: 1, models: 1, mappings: 0 });
    expect(result.conflicts).toEqual([
      { kind: "vendor", vendorKey: "relay" },
      { kind: "model", vendorKey: "relay", modelKey: "my-image" },
    ]);
    expect(result.errors).toEqual([]);

    const state = store.readCatalog();
    expect(state.vendors.find((vendor) => vendor.key === "relay")?.name).toBe("My Relay");
    expect(state.vendors.find((vendor) => vendor.key === "relay")?.baseUrlHint).toBe("https://relay.test/v1");
    expect(state.models.find((model) => model.modelKey === "my-image")?.labelZh).toBe("我的图像模型");
    expect(state.models.map((model) => model.modelKey).sort()).toEqual(["brand-new-video", "my-image"]);
    // 本机已经存好的 key 绝不被一次导入换掉——那是最难重建、也最不该被替换的东西。
    expect(fs.readFileSync(catalogFile(), "utf8")).not.toContain("sk-from-the-package");
  });

  it("rotates the pre-import catalog into model-catalog.bak.json, so an import is always undoable", async () => {
    const store = await storeWithOneConfiguredVendor();
    const before = fs.readFileSync(catalogFile(), "utf8");

    store.importModelCatalogPackage({
      vendors: [{ vendor: { key: "another", name: "Another", authType: "none", enabled: true }, models: [], mappings: [] }],
    });

    expect(fs.readFileSync(path.join(root, "model-catalog.bak.json"), "utf8")).toBe(before);
    expect(store.readCatalog().vendors.map((vendor) => vendor.key).sort()).toEqual(["another", "relay"]);
  });

  it("refuses a package from a newer Nomi in plain words, and changes nothing", async () => {
    const store = await storeWithOneConfiguredVendor();
    const before = fs.readFileSync(catalogFile(), "utf8");

    const result = store.importModelCatalogPackage({
      version: "desktop-local-v2",
      exportedAt: new Date().toISOString(),
      vendors: [{ vendor: { key: "from-the-future", name: "Future", authType: "none", enabled: true }, models: [], mappings: [] }],
    });

    expect(result.imported).toEqual({ vendors: 0, models: 0, mappings: 0 });
    expect(result.errors).toHaveLength(1);
    // 说人话：不是 "Invalid literal value"，而是「请先升级 Nomi」+「你现在的配置一个字都没动」。
    expect(result.errors[0]).toContain("desktop-local-v2");
    expect(result.errors[0]).toContain("升级");
    expect(result.errors[0]).toContain("一个字都没动");
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });

  it("replaces only when the user explicitly asked for it", async () => {
    const store = await storeWithOneConfiguredVendor();

    const result = store.importModelCatalogPackage(
      {
        vendors: [
          {
            vendor: { key: "relay", name: "Someone Else's Relay", authType: "bearer", enabled: true, baseUrlHint: "https://other.test/v1" },
            models: [],
            mappings: [],
          },
        ],
      },
      { conflictPolicy: "replace" },
    );

    expect(result.imported).toEqual({ vendors: 1, models: 0, mappings: 0 });
    expect(result.conflicts).toEqual([{ kind: "vendor", vendorKey: "relay" }]);
    expect(store.readCatalog().vendors.find((vendor) => vendor.key === "relay")?.baseUrlHint).toBe("https://other.test/v1");
  });
});
