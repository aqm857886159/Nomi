// 「模型目录不许被静默弄丢」的行为测试（批次 E，2026-09-21）。
//
// 复现的是用户报的那次事故：装了 0.21、再装回旧版 → 设置页空白、「所有模型配置都没了」。
// 根因两条（scratchpad `rootcause-config-loss-on-reinstall.md`）：
//   · 读失败（解析错 / 文件被锁）→ `readCatalog()` 把空目录原子写回覆盖用户文件；
//   · 盘上版本比应用新 → 只读 IPC 顺带的写被拒 → 抛错 → 渲染层裸 catch 置空。
// 这里全部用真实文件系统跑，断言「原始字节逐字节不变」——被覆盖过的文件也还在，只看存在与否证不了事。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

let root = "";
const catalogFile = (): string => path.join(root, "model-catalog.json");
const siblings = (pattern: RegExp): string[] => fs.readdirSync(root).filter((name) => pattern.test(name));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-loss-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", root);
  vi.resetModules();
});

afterEach(() => {
  vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("a catalog that cannot be read is never overwritten", () => {
  it("keeps a corrupt catalog byte for byte, writes nothing back, and says why", async () => {
    const original = '{"version":13,"vendors":[{"key":"higgsfield"}],"models":[  // 半个文件';
    fs.writeFileSync(catalogFile(), original, "utf8");
    const store = await import("./catalogStore");

    expect(store.readCatalog().vendors).toEqual([]); // 本次以空态运行

    expect(fs.existsSync(catalogFile())).toBe(false); // 旧代码在这里写了 defaultCatalog()
    const kept = siblings(/^model-catalog\.broken-.*\.json$/);
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, kept[0]), "utf8")).toBe(original);

    const status = store.modelCatalogReadOnlyStatus();
    expect(status?.reason).toBe("unreadable_file");
    expect(status && "quarantinedPath" in status ? status.quarantinedPath : null).toBe(path.join(root, kept[0]));
  });

  it("refuses to write over a catalog it could not open, and does not move it", async () => {
    // 目录顶替文件 = 可移植的 EISDIR，对应 Windows 上杀软/索引器持锁的 EPERM/EBUSY。
    fs.mkdirSync(catalogFile());
    const store = await import("./catalogStore");

    expect(store.readCatalog().models).toEqual([]);
    expect(siblings(/broken/)).toEqual([]);
    expect(fs.statSync(catalogFile()).isDirectory()).toBe(true);
    expect(() => store.upsertModelCatalogVendor({ key: "mine", name: "Mine" })).toThrow(/CATALOG_UNREADABLE_READ_ONLY/);
    expect(() => store.ensureBuiltinModelSeeds()).not.toThrow(); // 只读 IPC 不许因为写不进去就炸
  });
});

describe("a catalog written by a newer app stays readable and untouched", () => {
  it("reads it, reports read-only with both versions, reseeds nothing, and changes no byte", async () => {
    const { CURRENT_CATALOG_VERSION } = await import("./types");
    const future = {
      version: CURRENT_CATALOG_VERSION + 4,
      vendors: [{ key: "higgsfield", name: "Higgsfield", authType: "bearer", enabled: true, createdAt: "a", updatedAt: "a" }],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
      somethingOnlyTheNewAppKnows: true,
    };
    const bytes = `${JSON.stringify(future, null, 2)}\n`;
    fs.writeFileSync(catalogFile(), bytes, "utf8");
    const store = await import("./catalogStore");

    // 用户的配置读得出来——不是空的。这正是事故里「配置没了」其实没丢的那一半。
    expect(store.listModelCatalogVendors().map((vendor) => vendor.key)).toEqual(["higgsfield"]);

    store.ensureBuiltinModelSeeds();
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(bytes);

    expect(store.modelCatalogReadOnlyStatus()).toEqual({
      reason: "newer_on_disk",
      diskVersion: CURRENT_CATALOG_VERSION + 4,
      appVersion: CURRENT_CATALOG_VERSION,
    });
    expect(() => store.upsertModelCatalogVendor({ key: "mine", name: "Mine" })).toThrow(/read-only/);
  });
});

describe("a forward migration leaves the pre-migration file behind", () => {
  it("snapshots model-catalog.v<old>.bak.json with the exact bytes the old app can still read", async () => {
    const { CURRENT_CATALOG_VERSION } = await import("./types");
    const legacy = {
      version: CURRENT_CATALOG_VERSION - 1,
      vendors: [{ key: "mine", name: "Mine", authType: "bearer", enabled: true, createdAt: "a", updatedAt: "a" }],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    };
    const bytes = `${JSON.stringify(legacy, null, 2)}\n`;
    fs.writeFileSync(catalogFile(), bytes, "utf8");
    const store = await import("./catalogStore");

    store.readCatalog();

    const snapshot = path.join(root, `model-catalog.v${CURRENT_CATALOG_VERSION - 1}.bak.json`);
    expect(fs.existsSync(snapshot)).toBe(true);
    expect(fs.readFileSync(snapshot, "utf8")).toBe(bytes);
    expect(JSON.parse(fs.readFileSync(snapshot, "utf8")).vendors[0].key).toBe("mine");
  });
});
