import { describe, expect, it, vi } from "vitest";

// 可控的 safeStorage mock：可用；encrypt/decrypt 互为逆（identity 编码，便于断言往返）；
// 对哨兵明文 "FAIL" 在解密时抛错，用来覆盖解密失败分支。
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, "utf8"),
    decryptString: (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (s === "FAIL") throw new Error("decrypt failed");
      return s;
    },
  },
}));

// 主进程诊断输出已收口到 electron/logging/logger（打包后 console.* 没人接住，见
// docs/fixes/2026-09-06-main-process-logs-into-the-void.root-cause.json）。
// 这里改断言那个出口而不是 console：断言从「有人往终端喷了点什么」升级成
// 「哪个模块、什么事件、带哪些字段」，比原来更能说明问题。
const logged = vi.hoisted(() => [] as { level: string; scope: string; event: string; rest: unknown[] }[])
vi.mock("../logging/logger", () => {
  const record = (level: string) => (scope: string, event: string, ...rest: unknown[]) => {
    logged.push({ level, scope, event, rest })
  }
  return {
    logInfo: record("info"),
    logWarn: record("warn"),
    logError: record("error"),
    logDevDetail: () => undefined,
    logVendorCall: () => undefined,
    installMainLogger: () => undefined,
    currentLogFile: () => "",
  }
})

import { apiKeyDecryptStatus, decryptApiKeyRecord, isSafeStorageAvailable, makeApiKeyRecordFromPlain } from "./secrets";

describe("isSafeStorageAvailable", () => {
  it("reports availability from safeStorage", () => {
    expect(isSafeStorageAvailable()).toBe(true);
  });
});

describe("makeApiKeyRecordFromPlain + decryptApiKeyRecord round-trip", () => {
  it("encrypts to base64 with enc=safeStorage and decrypts back to plaintext", () => {
    const rec = makeApiKeyRecordFromPlain("sk-secret", "openai", true, "c1", "u1");
    expect(rec.enc).toBe("safeStorage");
    expect(rec.vendorKey).toBe("openai");
    expect(rec.enabled).toBe(true);
    expect(rec.apiKey).not.toBe("sk-secret"); // 不是明文
    expect(rec.apiKey).toBe(Buffer.from("sk-secret", "utf8").toString("base64"));
    expect(decryptApiKeyRecord(rec)).toBe("sk-secret");
  });
});

describe("decryptApiKeyRecord branches", () => {
  it("recognizes legacy plaintext for migration status but never resolves it for execution", () => {
    const sentinel = "SENTINEL-LEGACY-PLAIN-SECRET";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const enc of ["plain", undefined] as const) {
      const record = { vendorKey: "v", apiKey: sentinel, enc, enabled: true, createdAt: "c", updatedAt: "u" };
      expect(apiKeyDecryptStatus(record)).toBe("needs_resave");
      expect(decryptApiKeyRecord(record)).toBe("");
    }
    expect(JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls])).not.toContain(sentinel);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("returns '' for missing record or empty key", () => {
    expect(decryptApiKeyRecord(undefined)).toBe("");
    expect(decryptApiKeyRecord({ vendorKey: "v", apiKey: "", enabled: true, createdAt: "c", updatedAt: "u" })).toBe("");
  });

  it("returns '' (not throw) when a safeStorage value fails to decrypt", () => {
    logged.length = 0;
    const corrupted = {
      vendorKey: "v",
      apiKey: Buffer.from("FAIL", "utf8").toString("base64"),
      enc: "safeStorage" as const,
      enabled: true,
      createdAt: "c",
      updatedAt: "u",
    };
    expect(decryptApiKeyRecord(corrupted)).toBe("");
    expect(logged).toEqual([
      { level: "error", scope: "catalog", event: "api-key-decrypt-failed", rest: [expect.any(Error), { vendor: "v" }] },
    ]);
  });
});

describe("apiKeyDecryptStatus — credential readiness（ok / missing / locked / needs_resave）", () => {
  it("无记录 / 空 key 材料 → missing", () => {
    expect(apiKeyDecryptStatus(undefined)).toBe("missing");
    expect(apiKeyDecryptStatus({ vendorKey: "v", apiKey: "", enabled: true, createdAt: "c", updatedAt: "u" })).toBe("missing");
  });
  it("safeStorage 密文解得开非空 → ok", () => {
    const rec = makeApiKeyRecordFromPlain("sk-secret", "openai", true, "c", "u");
    expect(apiKeyDecryptStatus(rec)).toBe("ok");
  });
  it("safeStorage 密文在但解不开（身份不匹配）→ locked，绝不误报 missing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const locked = {
      vendorKey: "volcengine",
      apiKey: Buffer.from("FAIL", "utf8").toString("base64"),
      enc: "safeStorage" as const,
      enabled: true,
      createdAt: "c",
      updatedAt: "u",
    };
    expect(apiKeyDecryptStatus(locked)).toBe("locked");
    spy.mockRestore();
  });
  it("plain / legacy 非空明文 → needs_resave，而不是可用于新认证的 ok", () => {
    expect(apiKeyDecryptStatus({ vendorKey: "v", apiKey: "raw", enc: "plain", enabled: true, createdAt: "c", updatedAt: "u" })).toBe("needs_resave");
    expect(apiKeyDecryptStatus({ vendorKey: "v", apiKey: "legacy", enabled: true, createdAt: "c", updatedAt: "u" })).toBe("needs_resave");
  });
});
