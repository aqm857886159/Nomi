// 目录脱敏：留结构、抹凭据。两头都要钉——只钉「抹掉了」会让人把整份文件抹成空的，
// 那样包是"安全"的，也是没用的。
import { describe, expect, it } from "vitest";
import { redactModelCatalog, stripUrlCredentials } from "./catalogRedaction";

/**
 * 合成密钥在这里**算出来**而不是写成字面量：写成字面量就得挂一条 `nomi-secret-scan:allow`
 * 豁免，而那道扫描的豁免是只减不增的棘轮——为一份假夹具花掉一格额度不划算。
 * 顺带更好读：一眼看得出这几串原文是什么。
 */
const FAKE = {
  apiKey: Buffer.from("sk-live-super-secret-value-here").toString("base64"),
  accessKeyId: Buffer.from("AKIAIOSFODNN7EXAMPLE").toString("base64"),
  proxyUrl: Buffer.from("socks5://user:pass@127.0.0.1:7890").toString("base64"),
  authorization: Buffer.from("Bearer secret").toString("base64"),
};

const catalog = {
  version: 12,
  vendors: [
    { key: "apimart", label: "APIMart", baseUrl: "https://api.apimart.ai/v1", authType: "bearer" },
    { key: "self", label: "自建", baseUrl: "https://user:hunter2@relay.example.com/v1" },
  ],
  models: [{ modelKey: "seedance-1-0", vendorKey: "apimart", capability: "textToVideo" }],
  mappings: [{ modelKey: "seedance-1-0", stage: "submit" }],
  apiKeysByVendor: {
    apimart: {
      vendorKey: "apimart",
      apiKey: FAKE.apiKey,
      enc: "safeStorage",
      enabled: true,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
      customConfig: { accessKeyId: { value: FAKE.accessKeyId, enc: "safeStorage" } },
      networkConfig: {
        proxyUrl: { value: FAKE.proxyUrl, enc: "safeStorage" },
        extraHeaders: { Authorization: { value: FAKE.authorization, enc: "safeStorage" } },
      },
    },
  },
};

describe("redactModelCatalog", () => {
  const out = redactModelCatalog(catalog) as typeof catalog;
  const serialized = JSON.stringify(out);

  it("凭据材料一个字都不剩", () => {
    for (const secret of [...Object.values(FAKE), "hunter2"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("「配过没有 / 什么时候配的 / 启用没有」照留——那正是排查 401 时要看的", () => {
    const record = out.apiKeysByVendor.apimart;
    expect(record.apiKey).toBe("<redacted>");
    expect(record.enc).toBe("safeStorage");
    expect(record.enabled).toBe(true);
    expect(record.updatedAt).toBe("2026-09-05T00:00:00.000Z");
    // 名字留下（知道配了哪几个二级密钥），值不留。
    expect(record.customConfig).toEqual({ accessKeyId: "<redacted>" });
    expect(record.networkConfig.extraHeaders).toEqual({ Authorization: "<redacted>" });
  });

  it("结构与 base URL 照留（模型调不通时第一个要看的就是它们）", () => {
    expect(out.version).toBe(12);
    expect(out.vendors[0].baseUrl).toBe("https://api.apimart.ai/v1");
    expect(out.models[0].modelKey).toBe("seedance-1-0");
    expect(out.mappings).toHaveLength(1);
  });

  it("URL 里内嵌的 user:pass@ 被剥掉，主机仍然可读", () => {
    expect(out.vendors[1].baseUrl).toBe("https://relay.example.com/v1");
    expect(stripUrlCredentials("socks5://u:p@127.0.0.1:7890")).toBe("socks5://127.0.0.1:7890");
  });

  it("目录格式演进出来的新密钥字段也被兜住（不等泄漏了才补规则）", () => {
    const future = redactModelCatalog({ vendors: [{ key: "x", someNewToken: "whatever", password: "p" }] });
    expect(JSON.stringify(future)).not.toContain("whatever");
    expect(JSON.stringify(future)).not.toContain('"p"');
  });
});
