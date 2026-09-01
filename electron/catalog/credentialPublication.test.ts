/**
 * P2·结构预防回归：「写入停用凭据 ⇒ 该 vendor 退出已发布投影」住在 store 最内层
 * （applyApiKeyUpsert → depublishVendorForDisabledCredential），因此每一个凭据写入方都继承它。
 * 旧实现只守在渲染层 upsertRendererCatalogVendorApiKey：主进程写入方全部绕过，且那版是两次独立落盘。
 * 本文件按「写入方」逐个证明继承关系，并证明认证 promote 一族（一律写 enabled:true）行为不变。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vendor } from "./types";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];
const SEEDED_AT = "2026-01-01T00:00:00.000Z";

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

vi.mock("../ai/antigravityConnection", () => ({
  antigravityConnection: { canEnable: () => false, hasPassed: () => false },
}));

function seedCatalog(relayOverrides: Record<string, unknown> = {}): void {
  const base = { authType: "bearer", providerKind: "openai-compatible", createdAt: SEEDED_AT, updatedAt: SEEDED_AT };
  fs.writeFileSync(
    path.join(mockedUserDataRoot, "model-catalog.json"),
    JSON.stringify({
      version: 3,
      vendors: [
        {
          key: "relay",
          name: "Relay",
          enabled: true,
          baseUrlHint: "https://relay.test",
          meta: { adapter: { state: "verified", modes: [] }, houseNote: "keep-me" },
          ...base,
          ...relayOverrides,
        },
        { key: "other", name: "Other", enabled: true, ...base },
      ],
      models: [],
      mappings: [],
      apiKeysByVendor: {},
    }),
    "utf8",
  );
}

function vendorRow(state: { vendors: Vendor[] }, key = "relay"): Vendor {
  const vendor = state.vendors.find((item) => item.key === key);
  if (!vendor) throw new Error(`${key} vendor missing`);
  return vendor;
}

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cred-publication-"));
  tempRoots.push(mockedUserDataRoot);
  seedCatalog();
  vi.resetModules();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("凭据写入方继承「停用凭据 ⇒ vendor 退出发布投影」", () => {
  it("单条写入（渲染层 IPC 走的这条）落盘即同步 de-publish，且只动目标 vendor 的 enabled", async () => {
    const store = await import("./catalogStore");
    store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay", enabled: false });

    // 重新读盘（readCatalog 每次真读文件）：证明不变量与凭据写入是同一次落盘的结果。
    const persisted = store.readCatalog();
    expect(persisted.apiKeysByVendor.relay.enabled).toBe(false);
    // 只翻 enabled/updatedAt：name/meta/连接域字段原样保留（旧实现走 applyVendorUpsert 会把 meta 削成 {adapter}）。
    expect(vendorRow(persisted)).toMatchObject({
      enabled: false,
      name: "Relay",
      baseUrlHint: "https://relay.test",
      providerKind: "openai-compatible",
      createdAt: SEEDED_AT,
      meta: { adapter: { state: "verified", modes: [] }, houseNote: "keep-me" },
    });
    expect(vendorRow(persisted, "other").enabled).toBe(true);
  });

  it("mutateCatalog 事务（主进程写入方走的这条）同样继承", async () => {
    const store = await import("./catalogStore");
    // 一个「未来的主进程写入方」：只写停用凭据，完全不碰 vendor。
    store.mutateCatalog((tx) => tx.upsertApiKey("relay", { apiKey: "sk-relay", enabled: false }));

    expect(vendorRow(store.readCatalog()).enabled).toBe(false);
  });

  it("整包导入携带停用凭据时也不会留下「vendor 已发布 + 凭据停用」的错位", async () => {
    const store = await import("./catalogStore");
    const result = store.importModelCatalogPackage({
      vendors: [
        {
          vendor: { key: "relay", name: "Relay", enabled: true, authType: "bearer" },
          apiKey: { apiKey: "sk-relay", enabled: false },
          models: [],
          mappings: [],
        },
      ],
    }) as { errors: string[] };

    expect(result.errors).toEqual([]);
    expect(vendorRow(store.readCatalog()).enabled).toBe(false);
  });

  it("vendor 本就停用时不重写它（无 updatedAt 抖动）", async () => {
    seedCatalog({ enabled: false });
    const store = await import("./catalogStore");
    store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay", enabled: false });

    expect(vendorRow(store.readCatalog()).updatedAt).toBe(SEEDED_AT);
  });
});

describe("认证 promote 一族行为不变（构造上不触发，无需逃生口）", () => {
  it("凭据写 enabled:true（或省略，默认 true）时 vendor 保持已发布且不被重写", async () => {
    const store = await import("./catalogStore");
    store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay", enabled: true });
    expect(vendorRow(store.readCatalog())).toMatchObject({ enabled: true, updatedAt: SEEDED_AT });

    store.upsertModelCatalogVendorApiKey("relay", { apiKey: "sk-relay" });
    const persisted = store.readCatalog();
    expect(persisted.apiKeysByVendor.relay.enabled).toBe(true);
    expect(vendorRow(persisted)).toMatchObject({ enabled: true, updatedAt: SEEDED_AT });
  });

  it("promote 形状的事务（先发布 vendor、再写 enabled:true 凭据）终态仍是已发布", async () => {
    seedCatalog({ enabled: false }); // 必须先于 store import：readCatalog 首次读盘即定型
    const store = await import("./catalogStore");
    store.mutateCatalog((tx) => {
      tx.upsertVendor({ key: "relay", name: "Relay", enabled: true, authType: "bearer" });
      tx.upsertApiKey("relay", { apiKey: "sk-relay", enabled: true });
    });

    const persisted = store.readCatalog();
    expect(vendorRow(persisted).enabled).toBe(true);
    expect(persisted.apiKeysByVendor.relay.enabled).toBe(true);
  });
});
