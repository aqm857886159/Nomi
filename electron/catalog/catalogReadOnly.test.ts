/**
 * P1·高版本 catalog 静默降级根因回归。
 *
 * 旧实现：migrateCatalogForward 对 `version > CURRENT` 只 console.warn 照常返回，
 * 随后任意 upsert 以「当前应用形状」writeCatalog 写回 —— 把更新版应用写入的新字段
 * 静默丢弃（降级），且用户无感。两个用户用不同版本的 Nomi 共享同一 catalog 文件
 * （iCloud/Dropbox 同步 settings 目录）时，老版会悄悄阉割新版的数据。
 *
 * 根治：磁盘版本高于本应用时进入**只读保护** —— 读仍按原样返回（不阻断使用），
 * 但任何写盘被拒绝（抛错），从源头杜绝降级，而不是修每个 upsert 的症状。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function catalogFilePath(): string {
  return path.join(mockedUserDataRoot, "model-catalog.json");
}

function writeRawCatalog(value: unknown): void {
  fs.writeFileSync(catalogFilePath(), JSON.stringify(value), "utf8");
}

function readRawCatalog(): { version?: number; vendors?: unknown[] } {
  return JSON.parse(fs.readFileSync(catalogFilePath(), "utf8"));
}

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-catalog-readonly-");
  vi.resetModules();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("catalog 高版本只读保护（拒绝降级写回）", () => {
  it("磁盘版本高于应用时，read 仍按原样返回且不重写文件、不丢未知字段", async () => {
    const future = {
      version: 99,
      vendors: [{ key: "future-vendor", name: "F", enabled: true, futureOnlyField: "keep-me", createdAt: "t", updatedAt: "t" }],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    };
    writeRawCatalog(future);

    const { readCatalog } = await import("./catalogStore");
    const state = readCatalog();
    // 读不降级版本号，未知字段留存。
    expect(state.version).toBe(99);
    expect((state.vendors[0] as Record<string, unknown>).futureOnlyField).toBe("keep-me");

    // 磁盘文件未被重写成低版本（读路径零写盘）。
    expect(readRawCatalog().version).toBe(99);
  });

  it("磁盘版本高于应用时，任何写操作被拒绝（抛错），磁盘文件不被降级", async () => {
    writeRawCatalog({ version: 99, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });

    const { upsertModelCatalogVendor } = await import("./catalogStore");
    expect(() =>
      upsertModelCatalogVendor({ key: "x", name: "X", enabled: true, authType: "bearer", baseUrlHint: "https://x" }),
    ).toThrow(/version|read-?only|只读|降级/i);

    // 写被拒后磁盘仍是高版本、且没有被塞进当前应用形状。
    const onDisk = readRawCatalog();
    expect(onDisk.version).toBe(99);
    expect(onDisk.vendors).toEqual([]);
  });

  it("等于当前版本时写盘照常工作（保护只在更高版本触发，不误伤正常路径）", async () => {
    const { CURRENT_CATALOG_VERSION } = await import("./types");
    writeRawCatalog({ version: CURRENT_CATALOG_VERSION, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });

    const { upsertModelCatalogVendor, listModelCatalogVendors } = await import("./catalogStore");
    expect(() =>
      upsertModelCatalogVendor({ key: "ok", name: "OK", enabled: true, authType: "bearer", baseUrlHint: "https://ok" }),
    ).not.toThrow();
    expect(listModelCatalogVendors().map((v) => v.key)).toContain("ok");
  });
});
