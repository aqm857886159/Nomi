/**
 * issue #831 的端到端目录不变量：同一个中转站的三条连接（同地址、不同 Key）**各自独立**。
 *
 * 这里走**真实的 catalogStore**（临时 userData 目录、真的写盘、真的重新读盘），不 mock 它：
 * 报告人期望里最后一条是「重启后仍保留上述独立关系」，而那句话只有重新读盘才验得到
 * （内存里对象还在，不等于盘上分得开）。
 */
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
    decryptString: (value: Buffer) => value.toString(),
  },
}));

const { defaultCatalog } = await import("./serviceCatalog");
const { readCatalog, mutateCatalog } = await import("./../catalog/catalogStore");
const { decryptApiKeyRecord } = await import("./../catalog/secrets");
const { resolveConnectionVendorKey } = await import("./../catalog/connectionVendorKey");
const { isVendorOfBuiltin } = await import("./../shared/builtinVendorIdentity");

const BASE_URL = "https://relay.example.test/v1";
const HOST_KEY = "relay-example-test";
const savedAt = "2026-09-22T00:00:00.000Z";

/** 报告人现场的三个计价分组。 */
const GROUPS = [
  { name: "满血组", apiKey: "key-full", modelKey: "seedance-2.0" },
  { name: "Mini tier", apiKey: "key-mini", modelKey: "seedance-2.0-mini" },
  { name: "Fast tier", apiKey: "key-fast", modelKey: "seedance-2.0-fast" },
];

function addConnection(group: (typeof GROUPS)[number]): string {
  const vendors = readCatalog().vendors;
  const vendorKey = resolveConnectionVendorKey({ baseUrl: BASE_URL, name: group.name, vendors });
  defaultCatalog.register({
    vendorKey,
    vendorName: group.name,
    baseUrl: BASE_URL,
    apiKey: group.apiKey,
    authType: "bearer",
    providerKind: "openai-compatible",
    models: [{ modelKey: group.modelKey, labelZh: group.modelKey, kind: "video" }],
    savedAt,
  });
  return vendorKey;
}

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-issue831-"));
});

afterEach(() => {
  fs.rmSync(userDataRoot, { recursive: true, force: true });
});

describe("同一 Base URL 下的三条独立连接（issue #831）", () => {
  it("三条连接各自有 key、名字、模型；第一条保持 host key（零迁移）", () => {
    const keys = GROUPS.map(addConnection);

    expect(keys[0]).toBe(HOST_KEY);
    expect(keys[1]).toBe(`${HOST_KEY}--mini-tier`);
    expect(keys[2]).toBe(`${HOST_KEY}--fast-tier`);
    expect(new Set(keys).size).toBe(3);

    const state = readCatalog();
    for (const [index, group] of GROUPS.entries()) {
      const vendor = state.vendors.find((row) => row.key === keys[index]);
      expect(vendor, `${group.name} 这条连接应当存在`).toBeTruthy();
      expect(vendor?.name).toBe(group.name);
      expect(vendor?.baseUrlHint).toBe(BASE_URL);
      // 凭据按连接分桶，且互不相同。
      expect(decryptApiKeyRecord(state.apiKeysByVendor[keys[index]])).toBe(group.apiKey);
      // 模型归属独立。
      const owned = state.models.filter((model) => model.vendorKey === keys[index]);
      expect(owned.map((model) => model.modelKey)).toEqual([group.modelKey]);
    }
  });

  it("第二条连接不覆盖第一条的名字与 Key（报告人现场）", () => {
    addConnection(GROUPS[0]);
    const before = readCatalog();
    addConnection(GROUPS[1]);
    const after = readCatalog();

    const firstBefore = before.vendors.find((row) => row.key === HOST_KEY);
    const firstAfter = after.vendors.find((row) => row.key === HOST_KEY);
    expect(firstAfter?.name).toBe("满血组");
    expect(firstAfter?.name).toBe(firstBefore?.name);
    expect(decryptApiKeyRecord(after.apiKeysByVendor[HOST_KEY])).toBe("key-full");
    // 第一条连接的模型仍挂在它自己名下（不会被新分组的 Key 带跑）。
    expect(after.models.filter((model) => model.vendorKey === HOST_KEY).map((m) => m.modelKey))
      .toEqual(["seedance-2.0"]);
  });

  it("兄弟连接登记 root，因此仍被认成同一家（而不是陌生的自定义家）", () => {
    const keys = GROUPS.map(addConnection);
    const state = readCatalog();
    const sibling = state.vendors.find((row) => row.key === keys[1]);
    expect(sibling?.meta).toMatchObject({ adapterCandidateRootVendorKey: HOST_KEY });
    // 但它**不是**替换候选：没有 source，就不会被 planStagedVendorIdentity 当成待淘汰的行。
    expect(sibling?.meta).not.toHaveProperty("adapterCandidateSourceVendorKey");
    expect(isVendorOfBuiltin(state.vendors, keys[1], HOST_KEY)).toBe(true);
  });

  it("删掉中间那条，另外两条纹丝不动", () => {
    const keys = GROUPS.map(addConnection);
    mutateCatalog((tx) => tx.deleteVendor(keys[1]));

    const state = readCatalog();
    expect(state.vendors.some((row) => row.key === keys[1])).toBe(false);
    expect(state.apiKeysByVendor[keys[1]]).toBeUndefined();
    for (const index of [0, 2]) {
      const vendor = state.vendors.find((row) => row.key === keys[index]);
      expect(vendor?.name).toBe(GROUPS[index].name);
      expect(decryptApiKeyRecord(state.apiKeysByVendor[keys[index]])).toBe(GROUPS[index].apiKey);
      expect(state.models.filter((model) => model.vendorKey === keys[index]).map((m) => m.modelKey))
        .toEqual([GROUPS[index].modelKey]);
    }
  });

  it("重启（重新读盘）后三条关系仍然成立", async () => {
    const keys = GROUPS.map(addConnection);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(userDataRoot, "model-catalog.json"), "utf8"),
    ) as { vendors: Array<{ key: string; name: string }> };
    // 盘上就是三行，不是内存里凑出来的。
    for (const [index, key] of keys.entries()) {
      const row = onDisk.vendors.find((vendor) => vendor.key === key);
      expect(row?.name).toBe(GROUPS[index].name);
    }

    vi.resetModules();
    const fresh = await import("./../catalog/catalogStore");
    const secrets = await import("./../catalog/secrets");
    const state = fresh.readCatalog();
    for (const [index, key] of keys.entries()) {
      expect(state.vendors.find((row) => row.key === key)?.name).toBe(GROUPS[index].name);
      expect(secrets.decryptApiKeyRecord(state.apiKeysByVendor[key])).toBe(GROUPS[index].apiKey);
    }
  });

  it("只含 host key 的旧目录：读入 → 写回，vendor 行字节级不变（零迁移证据）", () => {
    addConnection(GROUPS[0]);
    const catalogPath = path.join(userDataRoot, "model-catalog.json");
    const before = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as Record<string, unknown>;

    // 一次无关写入（碰另一张表），逼目录整体重新序列化。
    mutateCatalog((tx) => tx.upsertVendor({
      key: "unrelated-vendor",
      name: "unrelated",
      enabled: false,
    }));

    const after = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as Record<string, unknown>;
    const pick = (state: Record<string, unknown>) => {
      const row = (state.vendors as Array<Record<string, unknown>>).find((v) => v.key === HOST_KEY)!;
      // 身份/血统/连接参数这几格才是「迁移」会动的东西；`hasApiKey`、
      // `credentialVerificationPending`、`credentialMaterialSaved` 是凭据投影，每次写盘都会重算，与本改动无关，
      // 把它们算进来会让这条断言测的是别的东西（假红）。
      const {
        hasApiKey: _hasApiKey,
        credentialVerificationPending: _pending,
        credentialMaterialSaved: _materialSaved,
        ...identity
      } = row;
      return identity;
    };
    expect(JSON.stringify(pick(after))).toBe(JSON.stringify(pick(before)));
    expect(JSON.stringify(after.apiKeysByVendor)).toContain(HOST_KEY);
    // 存量那行**没有**被盖上新血统键（root 只写给兄弟连接）。
    expect(JSON.stringify(pick(before))).not.toContain("adapterCandidateRootVendorKey");
    expect(JSON.stringify(pick(after))).not.toContain("adapterCandidateRootVendorKey");
  });
});
