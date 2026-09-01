import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// sanitizeSourceEvidence 是 connector 摄取媒体的取证归一化单一 choke point（R21 契约
// docs/fixes/2026-09-01-tikhub-connector-ingest-boundary.root-cause.json 的 prevention 边界）。
// 类级不变量：任何 caller 供的 source evidence，rightsStatus 恒被钉死 'unknown'——绝不推断可商用；
// 字段白名单——untrusted payload 塞不进任意 metadata。
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-src-evidence-"));
vi.mock("../projects/repository", () => ({
  projectDirById: () => projectRoot,
  sanitizeName: (value: unknown, fallback = "Untitled") => String(value || "").trim() || fallback,
}));

const { sanitizeSourceEvidence } = await import("./projectAssetStore");

describe("sanitizeSourceEvidence — 类级取证边界", () => {
  it("保留合法 connector 取证，rightsStatus 钉死 'unknown'", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://aweme.snssdk.com/x.mp4",
      platform: "douyin",
      rightsStatus: "unknown",
      fetchedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(out).toEqual({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://aweme.snssdk.com/x.mp4",
      platform: "douyin",
      rightsStatus: "unknown",
      fetchedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("caller 谎报 rightsStatus:'commercial' 被强制降级为 'unknown'（绝不推断可商用）", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://x/y.mp4",
      platform: "douyin",
      rightsStatus: "commercial",
      fetchedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(out?.rightsStatus).toBe("unknown");
  });

  it("白名单外的字段被丢弃（untrusted payload 塞不进任意 metadata）", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://x/y.mp4",
      platform: "douyin",
      rightsStatus: "unknown",
      fetchedAt: "2026-09-01T00:00:00.000Z",
      certificationEvidence: { sha256: "forged" },
      kind: "generated",
      evil: "payload",
    } as Record<string, unknown>);
    expect(out && "certificationEvidence" in out).toBe(false);
    expect(out && "kind" in out).toBe(false);
    expect(out && "evil" in out).toBe(false);
  });

  it("非 connector 来源 / 缺 connectorId → 不产出取证（不给假署名）", () => {
    expect(sanitizeSourceEvidence({ source: "user", connectorId: "tikhub" })).toBeUndefined();
    expect(sanitizeSourceEvidence({ source: "connector" })).toBeUndefined();
    expect(sanitizeSourceEvidence(null)).toBeUndefined();
    expect(sanitizeSourceEvidence("not-an-object")).toBeUndefined();
  });

  it("缺 fetchedAt 时补一个 ISO 时间戳（取证必带时间）", () => {
    const out = sanitizeSourceEvidence({ source: "connector", connectorId: "tikhub" as string, originalUrl: "https://x/", resolvedUrl: "https://x/y", platform: "douyin" });
    expect(typeof out?.fetchedAt).toBe("string");
    expect(String(out?.fetchedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
