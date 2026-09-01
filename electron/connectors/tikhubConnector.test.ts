import { describe, expect, it } from "vitest";
import {
  detectSharePlatform,
  extractShareUrl,
  extractPlayUrlFromAweme,
  resolveShareVideo,
  TIKHUB_CONNECTOR,
  TIKHUB_HOSTS,
  TikhubConnectorError,
} from "./tikhubConnector";

/**
 * 隔离选路层：resolve 类用例注入 fetchJson 桩，故也把 resolveHost 桩到主域（否则会走真实
 * tikhubRoute→读盘/探测）。双域名选路本身在 tikhubRoute.test.ts 单独锁。
 */
const routeToPrimary = { resolveHost: async () => "api.tikhub.io" };

// ---------------------------------------------------------------------------
// 合同测试：锁 TikHub OpenAPI 形状（一手 api.tikhub.io/openapi.json，openapi 3.1.0，
// checkedAt 2026-09-01）。**未做真实付费调用**——fetchJson 用注入的 fixture 桩。
// fixture 依「真实 ResponseModel 信封 + 端点 description 文档化的 data 字段」构造：
//   · fetch_video_high_quality_play_url → data.original_video_url（description 明写）
//   · fetch_one_video_by_share_url → 原始 aweme（内层字段 OpenAPI 未定型，取代表性形状）
// 真形状以交付后 TIKHUB_E2E=1 冒烟坐实（见 tikhubConnector.e2e）。
// ---------------------------------------------------------------------------

/** 真实 ResponseModel 信封（据 components.schemas.ResponseModel）。 */
function envelope(data: unknown, code = 200): Record<string, unknown> {
  return {
    code,
    request_id: "req-fixture",
    message: code === 200 ? "Request successful. This request will incur a charge." : "error",
    message_zh: code === 200 ? "请求成功，本次请求将被计费。" : "错误",
    data,
  };
}

describe("ConnectorDefinition 形态（§5.5）", () => {
  it("是 native-api / api-key / allowedOrigins 覆盖两候选域 / dataEgress 声明齐全", () => {
    expect(TIKHUB_CONNECTOR.kind).toBe("connector");
    expect(TIKHUB_CONNECTOR.transport).toBe("native-api");
    expect(TIKHUB_CONNECTOR.auth).toEqual({ kind: "api-key", secretOwner: "nomi-settings" });
    // 双域名全球化：allowedOrigins 覆盖主域 + 大陆加速域。
    expect(TIKHUB_CONNECTOR.network.allowedOrigins).toEqual([...TIKHUB_HOSTS]);
    expect([...TIKHUB_HOSTS]).toEqual(["api.tikhub.io", "api.tikhub.dev"]);
    expect(TIKHUB_CONNECTOR.dataEgress.categories).toContain("share-link");
    // 按次计费端点必须标 effect='spend'（接既有费用确认流）。
    expect(TIKHUB_CONNECTOR.tools.every((t) => t.effect === "spend")).toBe(true);
    // 高画质直链端点单价来自端点 description（$0.005）。
    const hq = TIKHUB_CONNECTOR.tools.find((t) => t.externalName === "fetch_video_high_quality_play_url");
    expect(hq?.unitPriceUsd).toBe(0.005);
  });
});

describe("平台识别 + URL 抽取", () => {
  it("从口令文本识别抖音/TikTok，识别不了返回 null", () => {
    expect(detectSharePlatform("7.88 复制打开抖音 https://v.douyin.com/e3x2fjE/")).toBe("douyin");
    expect(detectSharePlatform("https://www.tiktok.com/t/ZTFNEj8Hk/")).toBe("tiktok");
    expect(detectSharePlatform("https://youtube.com/watch?v=x")).toBeNull();
  });
  it("从长文本里抠出第一个 http URL，没有则原样返回", () => {
    expect(extractShareUrl("看看这个 https://v.douyin.com/abc/ 很赞")).toBe("https://v.douyin.com/abc/");
    expect(extractShareUrl("  纯口令没有链接  ")).toBe("纯口令没有链接");
  });
});

describe("resolveShareVideo — 抖音（首选高画质端点）", () => {
  it("构造 share_url+region=CN 参数，取 data.original_video_url", async () => {
    const calls: Array<{ path: string; query: Record<string, string> }> = [];
    const resolved = await resolveShareVideo(
      "复制打开抖音 https://v.douyin.com/e3x2fjE/",
      "key-abc",
      {
        ...routeToPrimary,
        fetchJson: async (path, query) => {
          calls.push({ path, query });
          return envelope({ video_id: "123", original_video_url: "https://aweme.snssdk.com/hq.mp4" });
        },
      },
    );
    expect(resolved.platform).toBe("douyin");
    expect(resolved.playUrl).toBe("https://aweme.snssdk.com/hq.mp4");
    expect(resolved.videoId).toBe("123");
    expect(resolved.unitPriceUsd).toBe(0.005);
    // 首选端点 + 参数构造正确（share_url 抠出、region=CN 拿国内 CDN）。
    expect(calls[0].path).toBe("/api/v1/douyin/web/fetch_video_high_quality_play_url");
    expect(calls[0].query).toEqual({ share_url: "https://v.douyin.com/e3x2fjE/", region: "CN" });
  });

  it("高画质端点无直链时兜底 fetch_one_video_by_share_url 抽 aweme", async () => {
    const paths: string[] = [];
    const resolved = await resolveShareVideo("https://v.douyin.com/e3x2fjE/", "key", {
      ...routeToPrimary,
      fetchJson: async (path) => {
        paths.push(path);
        if (path.includes("high_quality_play_url")) return envelope({ original_video_url: "" });
        return envelope({
          aweme_detail: {
            aweme_id: "999",
            video: { play_addr: { url_list: ["https://aweme.snssdk.com/fallback.mp4"] } },
          },
        });
      },
    });
    expect(paths).toEqual([
      "/api/v1/douyin/web/fetch_video_high_quality_play_url",
      "/api/v1/douyin/web/fetch_one_video_by_share_url",
    ]);
    expect(resolved.playUrl).toBe("https://aweme.snssdk.com/fallback.mp4");
    expect(resolved.videoId).toBe("999");
  });
});

describe("resolveShareVideo — TikTok（share_url → aweme）", () => {
  it("构造 share_url 参数命中 tiktok 端点并抽直链", async () => {
    const calls: Array<{ path: string; query: Record<string, string> }> = [];
    const resolved = await resolveShareVideo("https://www.tiktok.com/t/ZTFNEj8Hk/", "key", {
      ...routeToPrimary,
      fetchJson: async (path, query) => {
        calls.push({ path, query });
        return envelope({
          aweme_detail: { video: { download_addr: { url_list: ["https://v16.tiktok.com/nowm.mp4"] } } },
        });
      },
    });
    expect(calls[0].path).toBe("/api/v1/tiktok/app/v3/fetch_one_video_by_share_url");
    expect(calls[0].query).toEqual({ share_url: "https://www.tiktok.com/t/ZTFNEj8Hk/" });
    expect(resolved.playUrl).toBe("https://v16.tiktok.com/nowm.mp4");
  });
});

describe("extractPlayUrlFromAweme — 防御式多候选路径", () => {
  it("依次尝试 aweme_detail / 裸 video / aweme_list / play_addr|download_addr", () => {
    expect(
      extractPlayUrlFromAweme({ video: { play_addr: { url_list: ["https://a/x.mp4"] } } }),
    ).toBe("https://a/x.mp4");
    expect(
      extractPlayUrlFromAweme({ aweme_list: [{ video: { download_addr: { url_list: ["https://b/y.mp4"] } } }] }),
    ).toBe("https://b/y.mp4");
    // 只认 http(s)，跳过相对/空/非串。
    expect(extractPlayUrlFromAweme({ video: { play_addr: { url_list: ["//no-scheme", "", 42, "https://c/z.mp4"] } } })).toBe(
      "https://c/z.mp4",
    );
    expect(extractPlayUrlFromAweme({})).toBe("");
    expect(extractPlayUrlFromAweme(null)).toBe("");
  });
});

describe("错误分类（三段式失败态的 kind 源）", () => {
  it("没 key = missing-key（不发请求）", async () => {
    await expect(resolveShareVideo("https://v.douyin.com/x/", "")).rejects.toMatchObject({
      kind: "missing-key",
    });
  });
  it("非抖音/TikTok 链接 = unsupported-platform", async () => {
    await expect(resolveShareVideo("https://youtube.com/watch?v=x", "key")).rejects.toMatchObject({
      kind: "unsupported-platform",
    });
  });
  it("解析到作品但无直链 = no-play-url", async () => {
    await expect(
      resolveShareVideo("https://www.tiktok.com/t/x/", "key", {
        ...routeToPrimary,
        fetchJson: async () => envelope({ aweme_detail: { desc: "image post" } }),
      }),
    ).rejects.toMatchObject({ kind: "no-play-url" });
  });
  it("connector 业务错（401→auth）不切域、原样冒泡", async () => {
    // auth 不是线路层问题：不该触发 failover（切域没意义），原样冒泡。
    let failoverCalls = 0;
    await expect(
      resolveShareVideo("https://www.tiktok.com/t/x/", "key", {
        ...routeToPrimary,
        failover: async () => {
          failoverCalls += 1;
          return null;
        },
        fetchJson: async () => {
          throw new TikhubConnectorError("auth", "invalid key", 401);
        },
      }),
    ).rejects.toMatchObject({ kind: "auth", status: 401 });
    expect(failoverCalls).toBe(0);
  });
});
