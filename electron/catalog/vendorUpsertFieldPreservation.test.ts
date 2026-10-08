/**
 * 「保存一次连接就静默丢字段」的整类回归锁（P2/R21，2026-09-18）。
 *
 * 用户镜头：接好一家供应商（Nomi 记住了「这家怎么传参考图」= `assetIngestion`，
 * 以及「Authorization 前缀写什么词」= `authScheme`），过几天回设置页**只改个名字**按保存——
 * 那一刻这两条声明被静默抹掉，界面零提示。下次挂参考图生成：图出来了但参考图没被用上，
 * 或 Higgsfield 直接 401。因果隔了几天 + 一次看似无关的操作，用户永远连不起来。
 *
 * 类根因：`applyVendorUpsert` / `applyMappingUpsert` 按名字**逐个搬字段**重建记录，
 * 没列举的字段保存后消失，且没有任何类型/门岗能拦。修法见 catalogStore.ts 的
 * `UpsertDraft<T>`：整份覆盖 + 每个字段一条显式裁决，`-?` 让「加字段忘了改这里」编译不过。
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

import {
  listModelCatalogMappings,
  listModelCatalogVendors,
  upsertModelCatalogMapping,
  upsertModelCatalogVendor,
} from "./catalogStore";
import type { Mapping, Vendor } from "./types";

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function readVendor(key: string): Vendor | undefined {
  return listModelCatalogVendors().find((vendor) => vendor.key === key);
}

/**
 * 一份带 Vendor **全部**字段的样本。`satisfies Required<Vendor>` = 编译期穷尽闸：
 * 给 Vendor 加新字段而不在这里补一项 → 这个文件编译不过（与 credentialConfigFields.test.ts 同一手法）。
 * 于是「新字段有没有被 upsert 保住」永远有人在问。
 */
const FULL_VENDOR = {
  key: "acme-relay",
  name: "Acme 中转",
  enabled: true,
  hasApiKey: false,
  credentialVerificationPending: false,
  credentialMaterialSaved: false,
  credentialBinding: { origin: "https://relay.acme.example", authType: "bearer", authHeader: "X-Acme-Key", authScheme: "Key", authQueryParam: "token", confirmedAt: "2026-09-01T00:00:00.000Z" },
  baseUrlHint: "https://relay.acme.example/v1",
  authType: "bearer",
  authHeader: "X-Acme-Key",
  authScheme: "Key",
  authQueryParam: "token",
  providerKind: "openai-compatible",
  network: { proxyEnabled: true },
  assetIngestion: { strategy: "upload-multipart", endpoint: "https://relay.acme.example/v1/files", urlPath: "url", accepts: ["image"] },
  meta: { adapter: "acme" },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} satisfies Required<Vendor>;

/**
 * 由服务端/读路径派生、**不该**在 vendor 记录里落盘的字段。写成常量而不是散在断言里：
 * 将来有人想把某个字段挪进/挪出这份名单，必须在这里显式改，改不动就说明它该被保住。
 */
const DERIVED_NOT_PERSISTED: ReadonlyArray<keyof Vendor> = ["hasApiKey", "credentialMaterialSaved", "credentialVerificationPending", "updatedAt"];

describe("vendor upsert 不丢字段（整类）", () => {
  beforeEach(() => {
    mockedUserDataRoot = makeTempDir("vendor-upsert-preserve-");
  });
  afterEach(() => {
    for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("报告用例：改个名字保存后 assetIngestion 仍在", () => {
    upsertModelCatalogVendor({
      key: "acme-relay",
      name: "Acme 中转",
      baseUrlHint: "https://relay.acme.example/v1",
      authType: "bearer",
      assetIngestion: FULL_VENDOR.assetIngestion,
    });
    expect(readVendor("acme-relay")?.assetIngestion).toEqual(FULL_VENDOR.assetIngestion);

    // 用户回设置页只改名字（界面提交的就是这样一份不带能力声明的载荷）
    upsertModelCatalogVendor({ key: "acme-relay", name: "Acme 中转（自建）" });

    expect(readVendor("acme-relay")?.name).toBe("Acme 中转（自建）");
    expect(readVendor("acme-relay")?.assetIngestion).toEqual(FULL_VENDOR.assetIngestion);
  });

  it("同类：改名保存后 authScheme 仍在（Higgsfield 的 `Authorization: Key` 不许退回 Bearer）", () => {
    upsertModelCatalogVendor({ key: "higgs-like", name: "H", baseUrlHint: "https://h.example", authType: "bearer", authScheme: "Key" });
    upsertModelCatalogVendor({ key: "higgs-like", name: "H 改名" });
    expect(readVendor("higgs-like")?.authScheme).toBe("Key");
  });

  it("类边界：Vendor 的每个可落盘字段都活过一次「只改名字」的保存", () => {
    // 绑定来自已存记录，不能用普通 upsert payload 伪造（绑定的写门是保存密钥）。
    fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify({
      version: 13, vendors: [FULL_VENDOR], models: [], mappings: [], apiKeysByVendor: {},
    }));
    upsertModelCatalogVendor({ key: FULL_VENDOR.key, name: "只改名字" });

    const saved = readVendor(FULL_VENDOR.key);
    expect(saved).toBeDefined();
    const dropped = (Object.keys(FULL_VENDOR) as Array<keyof Vendor>).filter(
      (field) => !DERIVED_NOT_PERSISTED.includes(field) && field !== "name" && saved?.[field] === undefined,
    );
    expect(dropped).toEqual([]);
  });

  it("同类入口：mapping upsert 不丢 delivery / abandon（导入的传输契约）", () => {
    upsertModelCatalogVendor({ key: "acme-relay", name: "Acme", baseUrlHint: "https://relay.acme.example/v1" });
    const create = { method: "POST", path: "/images" };
    upsertModelCatalogMapping({
      vendorKey: "acme-relay",
      taskKind: "text_to_image",
      name: "acme t2i",
      create,
      delivery: "synchronous" satisfies Mapping["delivery"],
      abandon: { via: "poll-to-completion" } satisfies Mapping["abandon"],
    });
    const before = listModelCatalogMappings().find((m) => m.vendorKey === "acme-relay");
    expect(before?.delivery).toBe("synchronous");

    upsertModelCatalogMapping({ id: before?.id, vendorKey: "acme-relay", taskKind: "text_to_image", name: "acme t2i 改名", create });
    const after = listModelCatalogMappings().find((m) => m.vendorKey === "acme-relay");
    expect(after?.name).toBe("acme t2i 改名");
    expect(after?.delivery).toBe("synchronous");
    expect(after?.abandon).toEqual({ via: "poll-to-completion" });
  });
});
