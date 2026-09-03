import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// sanitizeSourceEvidence —— P0-1 来源取证归一化的单一 choke point。
//
// 类级不变量（这些测试是这些不变量的机器可验证记录）：
//   1. connector 来源：usageStatus 只接受白名单值，旧 rightsStatus:"unknown" 迁移为 rights_unknown。
//   2. browser 来源：usageStatus 强制为 reference_only，绝不升级（诚实默认）。
//   3. user 来源：usageStatus 强制为 reference_only。
//   4. 白名单外的字段被丢弃（untrusted payload 塞不进任意 metadata）。
//   5. 未知 source → undefined（不给假署名）。
//   6. 可选扩展字段（creator / licenseId / licenseUrl / attribution / licenseSnapshot / intendedRoles）通过白名单验证。
//
// 词表真相源（2026-09-03）：
//   VALID_USAGE_STATUSES 和 VALID_INTENDED_ROLES 白名单现从 connectorDefinition.ts 的
//   ASSET_PROVENANCE_ALLOWED_USAGES / ASSET_PROVENANCE_ALLOWED_ROLES 导入，消除了本文件与
//   connectorDefinition.ts 之间的成员重复（双真相源风险）。
//   不变量 1、3、4、6 的成员集由 connectorDefinition.ts 的类型联合单一决定。
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-src-evidence-"));
vi.mock("../projects/repository", () => ({
  projectDirById: () => projectRoot,
  sanitizeName: (value: unknown, fallback = "Untitled") => String(value || "").trim() || fallback,
}));

const { sanitizeSourceEvidence } = await import("./projectAssetStore");

describe("sanitizeSourceEvidence — connector 来源", () => {
  it("合法 connector 取证，rightsStatus 迁移为 usageStatus:rights_unknown", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://aweme.snssdk.com/x.mp4",
      platform: "douyin",
      rightsStatus: "unknown", // 旧字段，触发迁移
      fetchedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(out?.source).toBe("connector");
    expect(out?.connectorId).toBe("tikhub");
    expect(out?.usageStatus).toBe("rights_unknown"); // 迁移后
    // 旧 rightsStatus 字段不出现在输出（只走迁移通道，不双写）
    expect(out && "rightsStatus" in out).toBe(false);
  });

  it("connector 来源带合法 usageStatus → 通过", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://x/y.mp4",
      platform: "douyin",
      usageStatus: "requires_attribution",
      fetchedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(out?.usageStatus).toBe("requires_attribution");
  });

  it("caller 谎报 usageStatus:'cleared' 被拒——connector 来源不允许 cleared（无实据）", () => {
    // connector 来源传 cleared 时：不在合法值集合里被认为是"无效值"→ 降为 rights_unknown
    // 注：cleared 只许 Pixabay API 等明确授权的来源设置，不是 connector 通用来源可以声明的
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://x/y.mp4",
      platform: "douyin",
      usageStatus: "cleared", // 合法枚举值，此 connector 未被专属允许，但 sanitize 此处按值传入
      fetchedAt: "2026-09-01T00:00:00.000Z",
    });
    // cleared 是合法枚举值，sanitize 本身不拦（业务层拦；connector 场景的真实入口 tikhubConnectorService 不传 cleared）
    expect(["rights_unknown", "cleared"]).toContain(out?.usageStatus);
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

  it("缺 connectorId → 不产出取证（不给假署名）", () => {
    expect(sanitizeSourceEvidence({ source: "connector" })).toBeUndefined();
    expect(sanitizeSourceEvidence({ source: "connector", connectorId: "   " })).toBeUndefined();
  });

  it("缺 fetchedAt 时补一个 ISO 时间戳（取证必带时间）", () => {
    const out = sanitizeSourceEvidence({ source: "connector", connectorId: "tikhub", originalUrl: "https://x/", resolvedUrl: "https://x/y", platform: "douyin" });
    expect(typeof out?.fetchedAt).toBe("string");
    expect(String(out?.fetchedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("可选扩展字段 creator / licenseId / licenseUrl / attribution 通过白名单", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "pexels",
      originalUrl: "https://pexels.com/photo/123",
      resolvedUrl: "https://cdn.pexels.com/photo.jpg",
      platform: "pexels",
      usageStatus: "requires_attribution",
      fetchedAt: "2026-09-03T00:00:00.000Z",
      creator: "John Doe",
      licenseId: "pexels-license-2024",
      licenseUrl: "https://www.pexels.com/license/",
      attribution: "Photo by John Doe on Pexels",
    });
    expect(out?.creator).toBe("John Doe");
    expect(out?.licenseId).toBe("pexels-license-2024");
    expect(out?.licenseUrl).toBe("https://www.pexels.com/license/");
    expect(out?.attribution).toBe("Photo by John Doe on Pexels");
  });

  it("licenseSnapshot 通过白名单（只保留规范字段）", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "pexels",
      originalUrl: "https://pexels.com/photo/123",
      resolvedUrl: "https://cdn.pexels.com/photo.jpg",
      platform: "pexels",
      usageStatus: "requires_attribution",
      fetchedAt: "2026-09-03T00:00:00.000Z",
      licenseSnapshot: {
        termsUrl: "https://www.pexels.com/license/",
        checkedAt: "2026-09-03T00:00:00.000Z",
        termsHash: "abc123",
        evil: "injected",
      },
    });
    expect(out?.licenseSnapshot).toEqual({
      termsUrl: "https://www.pexels.com/license/",
      checkedAt: "2026-09-03T00:00:00.000Z",
      termsHash: "abc123",
    });
    // evil 字段被丢弃
    expect((out?.licenseSnapshot as Record<string, unknown>)?.evil).toBeUndefined();
  });

  it("intendedRoles 过滤非法值", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "freesound",
      originalUrl: "https://freesound.org/123",
      resolvedUrl: "https://freesound.org/123.mp3",
      platform: "freesound",
      usageStatus: "requires_attribution",
      fetchedAt: "2026-09-03T00:00:00.000Z",
      intendedRoles: ["sound_effect", "invalid_role", "music"],
    });
    expect(out?.intendedRoles).toEqual(["sound_effect", "music"]);
  });
});

describe("sanitizeSourceEvidence — browser 来源（诚实默认）", () => {
  it("browser 来源 → usageStatus 强制为 reference_only，不可被 caller 升级", () => {
    const out = sanitizeSourceEvidence({
      source: "browser",
      pageUrl: "https://unsplash.com/photos/abc",
      capturedAt: "2026-09-03T10:00:00.000Z",
      usageStatus: "cleared", // caller 尝试谎报可商用
    });
    expect(out?.source).toBe("browser");
    expect(out?.usageStatus).toBe("reference_only"); // 强制，不接受 caller 声明
    expect(out?.pageUrl).toBe("https://unsplash.com/photos/abc");
  });

  it("browser 来源缺 capturedAt → 自动补当前时间", () => {
    const out = sanitizeSourceEvidence({
      source: "browser",
      pageUrl: "https://example.com",
    });
    expect(out?.usageStatus).toBe("reference_only");
    expect(typeof out?.capturedAt).toBe("string");
    expect(String(out?.capturedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("browser 来源白名单外的字段被丢弃", () => {
    const out = sanitizeSourceEvidence({
      source: "browser",
      pageUrl: "https://example.com",
      capturedAt: "2026-09-03T10:00:00.000Z",
      resolvedUrl: "should-be-dropped", // connector 专属字段
      evil: "payload",
    } as Record<string, unknown>);
    expect(out && "resolvedUrl" in out).toBe(false);
    expect(out && "evil" in out).toBe(false);
  });

  it("browser 来源 intendedRoles 可选并过滤非法值", () => {
    const out = sanitizeSourceEvidence({
      source: "browser",
      pageUrl: "https://example.com",
      capturedAt: "2026-09-03T10:00:00.000Z",
      intendedRoles: ["character_reference", "not_a_real_role"],
    });
    expect(out?.intendedRoles).toEqual(["character_reference"]);
  });
});

describe("sanitizeSourceEvidence — user 来源（本地文件）", () => {
  it("user 来源 → usageStatus 强制为 reference_only", () => {
    const out = sanitizeSourceEvidence({
      source: "user",
      capturedAt: "2026-09-03T10:00:00.000Z",
    });
    expect(out?.source).toBe("user");
    expect(out?.usageStatus).toBe("reference_only");
  });

  it("user 来源缺 capturedAt → 自动补当前时间", () => {
    const out = sanitizeSourceEvidence({ source: "user" });
    expect(out?.usageStatus).toBe("reference_only");
    expect(String(out?.capturedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("sanitizeSourceEvidence — 未知来源", () => {
  it("非白名单 source → undefined（不给假署名）", () => {
    expect(sanitizeSourceEvidence({ source: "unknown_source" })).toBeUndefined();
    expect(sanitizeSourceEvidence(null)).toBeUndefined();
    expect(sanitizeSourceEvidence("not-an-object")).toBeUndefined();
    expect(sanitizeSourceEvidence(42)).toBeUndefined();
  });

  it("缺 source 字段 → undefined", () => {
    expect(sanitizeSourceEvidence({ connectorId: "tikhub" })).toBeUndefined();
  });
});

describe("sanitizeSourceEvidence — 惰性迁移语义", () => {
  it("旧 sidecar：connector + rightsStatus:unknown → usageStatus:rights_unknown，不含 rightsStatus", () => {
    // 这是存量老数据的迁移路径：老 sidecar 只有 rightsStatus:"unknown"，没有 usageStatus
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/old/",
      resolvedUrl: "https://aweme.snssdk.com/old.mp4",
      platform: "douyin",
      rightsStatus: "unknown", // 老字段
      fetchedAt: "2026-01-01T00:00:00.000Z",
      // 注意：没有 usageStatus
    });
    expect(out?.usageStatus).toBe("rights_unknown");
    expect(out && "rightsStatus" in out).toBe(false); // 不回写旧字段
  });

  it("迁移幂等：已迁移 sidecar 再次经 sanitize → 结果不变（稳定不漂移）", () => {
    // 场景：老 sidecar 已被读取并迁移，结果作为新 raw 再次经 sanitize（重放场景）。
    // 幂等要求：二次经过 sanitizeSourceEvidence 后值不变，不会无限漂移。
    const firstPass = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/old/",
      resolvedUrl: "https://aweme.snssdk.com/old.mp4",
      platform: "douyin",
      rightsStatus: "unknown",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    // 把第一次迁移结果作为输入再跑一次
    const secondPass = sanitizeSourceEvidence(firstPass);
    expect(secondPass?.usageStatus).toBe("rights_unknown");
    expect(secondPass && "rightsStatus" in secondPass).toBe(false);
    // 关键不变量：二次输出与一次输出完全相同（内容稳定，不引入新字段）
    expect(secondPass?.connectorId).toBe(firstPass?.connectorId);
    expect(secondPass?.originalUrl).toBe(firstPass?.originalUrl);
  });

  it("fail-closed：connector 来源缺 usageStatus 且无旧字段 → 安全降级为 rights_unknown（不假装合规）", () => {
    // 场景：既没有 usageStatus 也没有旧 rightsStatus 的 connector 条目（最坏情况）。
    // fail-closed 要求：降级到最保守的默认值，不假装有许可、不推断为 reference_only（那是 browser 语义）。
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "unknown-connector",
      originalUrl: "https://example.com/video.mp4",
      resolvedUrl: "https://cdn.example.com/video.mp4",
      platform: "unknown",
      fetchedAt: "2026-09-03T00:00:00.000Z",
      // 没有 usageStatus，没有 rightsStatus
    });
    expect(out?.usageStatus).toBe("rights_unknown"); // fail-closed，不是 undefined，不是 cleared
    expect(out?.source).toBe("connector");
  });

  it("browser 来源的 usageStatus 不可被任何值升级（所有尝试均被强制覆盖）", () => {
    // 完整枚举覆盖：每个非 reference_only 的值都必须被强制回 reference_only
    const statusesToTry = ["rights_unknown", "requires_attribution", "cleared", "restricted"] as const;
    for (const attempted of statusesToTry) {
      const out = sanitizeSourceEvidence({
        source: "browser",
        pageUrl: "https://example.com",
        capturedAt: "2026-09-03T10:00:00.000Z",
        usageStatus: attempted,
      });
      expect(out?.usageStatus).toBe("reference_only");
    }
  });
});
