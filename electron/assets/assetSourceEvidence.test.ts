import { describe, expect, it } from "vitest";
import { finalizeAssetMeta, reconcileReuse } from "./assetSourceEvidence";

// 素材来源的唯一判定（assetSourceEvidence.ts）：finalizeAssetMeta 是写 sidecar 前的唯一一道，
// sanitizeSourceEvidence 是它私有的来源清洗；这里经 finalizeAssetMeta 测清洗结果。
//
// 类级不变量（这些测试是这些不变量的机器可验证记录）：
//   1. connector 来源：usageStatus 只接受白名单值，缺省 rights_unknown。
//   2. browser 来源：usageStatus 强制为 reference_only，绝不升级（诚实默认）。
//   3. user 来源：usageStatus 强制为 reference_only。
//   4. 白名单外的字段被丢弃（untrusted payload 塞不进任意 metadata）。
//   5. 未知 source → 不落 sourceEvidence（不给假署名）。
//   6. 可选扩展字段（creator / licenseId / licenseUrl / attribution / licenseSnapshot / intendedRoles）通过白名单验证。
//   7. 幂等：已经清洗过的 meta 再过一遍结果不变（复制 / 移动时不重盖时间、不漂移）。
//
// 词表真相源：白名单从 connectorDefinition.ts 的 ASSET_PROVENANCE_ALLOWED_USAGES / ASSET_PROVENANCE_ALLOWED_ROLES 导入。
const sanitizeSourceEvidence = (raw: unknown): Record<string, unknown> | undefined =>
  finalizeAssetMeta({ kind: "upload", sourceEvidence: raw as never }).sourceEvidence as Record<string, unknown> | undefined;

describe("sanitizeSourceEvidence — connector 来源", () => {
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

  it("connector 来源的 cleared 原样落盘：能交 connector 来源的只有主进程调用方（渲染层载荷不读）", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://x/y.mp4",
      platform: "douyin",
      usageStatus: "cleared",
      fetchedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(out?.usageStatus).toBe("cleared");
  });

  it("connector 来源 usageStatus 不在白名单 → rights_unknown", () => {
    const out = sanitizeSourceEvidence({ source: "connector", connectorId: "tikhub", usageStatus: "public_domain_trust_me" });
    expect(out?.usageStatus).toBe("rights_unknown");
  });

  it("白名单外的字段被丢弃（untrusted payload 塞不进任意 metadata）", () => {
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "tikhub",
      originalUrl: "https://v.douyin.com/abc/",
      resolvedUrl: "https://x/y.mp4",
      platform: "douyin",
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
  it("非白名单 source → 不落 sourceEvidence（不给假署名）", () => {
    expect(finalizeAssetMeta({ kind: "upload", sourceEvidence: { source: "unknown_source" } })).toEqual({ kind: "upload" });
    expect(sanitizeSourceEvidence({ source: "unknown_source" })).toBeUndefined();
    expect(sanitizeSourceEvidence(null)).toBeUndefined();
    expect(sanitizeSourceEvidence("not-an-object")).toBeUndefined();
    expect(sanitizeSourceEvidence(42)).toBeUndefined();
  });

  it("缺 source 字段 → undefined", () => {
    expect(sanitizeSourceEvidence({ connectorId: "tikhub" })).toBeUndefined();
  });
});

describe("sanitizeSourceEvidence — 缺省与降级", () => {
  it("fail-closed：connector 来源缺 usageStatus → 安全降级为 rights_unknown（不假装合规）", () => {
    // 场景：没有 usageStatus 的 connector 条目（最坏情况）。
    // fail-closed 要求：降级到最保守的默认值，不假装有许可、不推断为 reference_only（那是 browser 语义）。
    const out = sanitizeSourceEvidence({
      source: "connector",
      connectorId: "unknown-connector",
      originalUrl: "https://example.com/video.mp4",
      resolvedUrl: "https://cdn.example.com/video.mp4",
      platform: "unknown",
      fetchedAt: "2026-09-03T00:00:00.000Z",
      // 没有 usageStatus
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

describe("finalizeAssetMeta — 写 sidecar 前的唯一一道", () => {
  // 隐私不变量（M0 捕捞评审定案）：capture 族 sidecar 的 originalUrl 恒 null——
  // 否则 48h 信任窗会把用户浏览的网页 URL 当参考发给生成商。
  it("nulls originalUrl for browser-capture family regardless of input", () => {
    expect(finalizeAssetMeta({ kind: "browser-capture", originalUrl: "https://evil.example/x.png" })).toEqual({
      kind: "browser-capture",
      originalUrl: null,
    });
    expect(finalizeAssetMeta({ kind: "browser-upload", originalUrl: "https://a/b.png", pageUrl: "https://a" })).toEqual({
      kind: "browser-upload",
      originalUrl: null,
      pageUrl: "https://a",
    });
  });

  it("leaves provider/generated meta untouched (trust-window by design)", () => {
    const meta = { kind: "generated", originalUrl: "https://vendor.example/tmp.png" };
    expect(finalizeAssetMeta(meta)).toBe(meta);
  });

  it("入口只交事实：浏览器 {source, pageUrl} 落成带时间、恒 reference_only 的来源", () => {
    const out = finalizeAssetMeta({ kind: "browser-capture", originalUrl: "https://cdn/x.png", sourceEvidence: { source: "browser", pageUrl: "https://page/" } });
    expect(out).toMatchObject({ kind: "browser-capture", originalUrl: null, sourceEvidence: { source: "browser", pageUrl: "https://page/", usageStatus: "reference_only" } });
    expect(String((out.sourceEvidence as Record<string, unknown>).capturedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("幂等：已清洗的 meta 再过一遍结果完全相同（复制 / 移动不重盖时间、不漂移）", () => {
    for (const raw of [
      { kind: "upload", sourceEvidence: { source: "user" } },
      { kind: "browser-capture", originalUrl: "https://cdn/x.png", sourceEvidence: { source: "browser", pageUrl: "https://page/", usageStatus: "cleared" } },
      { kind: "reference", sourceEvidence: { source: "connector", connectorId: "tikhub", originalUrl: "https://share/", platform: "douyin", intendedRoles: ["music", "nope"] } },
      { kind: "upload", sourceEvidence: { source: "nope" } },
    ]) {
      const once = finalizeAssetMeta(raw);
      expect(finalizeAssetMeta(once)).toEqual(once);
    }
  });
});

describe("reconcileReuse — 同一份字节再进来时能不能复用旧记录", () => {
  const user = { source: "user", capturedAt: "2026-11-01T00:00:00.000Z", usageStatus: "reference_only" };
  const connector = { source: "connector", connectorId: "tikhub", originalUrl: "https://share/", resolvedUrl: "", platform: "douyin", usageStatus: "cleared", fetchedAt: "2026-11-01T00:00:00.000Z" };

  it("这次没带来源 → 原样复用，不改旧记录", () => {
    expect(reconcileReuse({ kind: "upload", sourceEvidence: user }, { kind: "upload" })).toEqual({ reuse: true });
  });

  it("同一个来源（只差时间）→ 原样复用，不重盖时间", () => {
    expect(reconcileReuse({ kind: "upload", sourceEvidence: user }, { kind: "upload", sourceEvidence: { ...user, capturedAt: "2026-11-20T00:00:00.000Z" } })).toEqual({ reuse: true });
  });

  it("旧记录没有来源（老版本导入）→ 复用并补上这次的来源", () => {
    expect(reconcileReuse({ kind: "upload" }, { kind: "upload", sourceEvidence: user })).toEqual({ reuse: true, fill: user });
  });

  it("来源不同 → 不复用：补来源抬不高旧记录的 usageStatus", () => {
    expect(reconcileReuse({ kind: "upload", sourceEvidence: user }, { kind: "upload", sourceEvidence: connector })).toEqual({ reuse: false });
    expect(reconcileReuse({ kind: "upload", sourceEvidence: connector }, { kind: "upload", sourceEvidence: user })).toEqual({ reuse: false });
  });
});
