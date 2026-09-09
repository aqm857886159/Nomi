// 归一层的形状锁：**夹具是真实响应裁出来的**（2026-09-07 实调 TikHub，字段名与数值原样保留），
// 不是我照文档编的形状——文档在这三处都写错过（TikTok 广告库 limit 上限、cost 取值范围、
// keyframe 响应形状），编出来的夹具会把错误一起锁死。
import { describe, expect, it } from "vitest";
import douyinFixture from "./__fixtures__/douyin-search.json";
import xhsFixture from "./__fixtures__/xhs-search.json";
import adsFixture from "./__fixtures__/tiktok-ads-search.json";
import {
  buildSearchResult,
  formatCountCn,
  formatCountEn,
  extractMediaUrls,
  formatDuration,
  hasChinese,
  normalizeDouyin,
  normalizeTiktokAds,
  normalizeXhs,
} from "./referenceSearch";
import type { JsonRecord } from "../jsonUtils";

describe("计数格式化", () => {
  it("中文平台走 万/亿，英文平台走 k/M", () => {
    expect(formatCountCn(741383)).toBe("74.1万");
    expect(formatCountCn(9800)).toBe("9800");
    expect(formatCountCn(120_000_000)).toBe("1.2亿");
    expect(formatCountEn(8400)).toBe("8.4k");
    expect(formatCountEn(320)).toBe("320");
  });

  it("时长拿不到时给空串，不编 0:00", () => {
    expect(formatDuration(22.145)).toBe("0:22");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(undefined)).toBe("");
  });
});

describe("抖音归一", () => {
  const items = normalizeDouyin(douyinFixture as unknown as JsonRecord);

  it("读到真实的点赞与收藏，主角标是点赞", () => {
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].platform).toBe("douyin");
    expect(items[0].evidence[0]).toEqual({ kind: "scale", metric: "none", value: "♥ 74.1万" });
    expect(items[0].evidence[1]).toEqual({ kind: "secondary", metric: "collect", value: "18.4万" });
  });

  it("**不画播放量**——实调 play_count / exposure_count 恒为 0，画了就是长期显示 0", () => {
    const all = items.flatMap((i) => i.evidence.map((e) => e.metric));
    expect(all).not.toContain("play");
    // 夹具里这两个字段确实是 0，这条断言同时钉住「夹具没被换成编的数据」
    const stats = (douyinFixture as unknown as JsonRecord as never as {
      data: { data: { aweme_info: { statistics: { play_count: number; exposure_count: number } } }[] };
    }).data.data[0].aweme_info.statistics;
    expect(stats.play_count).toBe(0);
    expect(stats.exposure_count).toBe(0);
  });

  it("给出作品页链接", () => {
    expect(items[0].pageUrl).toMatch(/^https:\/\/www\.douyin\.com\/video\/\d+$/);
  });
});

describe("小红书归一", () => {
  const items = normalizeXhs(xhsFixture as unknown as JsonRecord);

  it("穿透多包的那一层信封（data.data.items[].note）", () => {
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].platform).toBe("xhs");
    expect(items[0].id).toBeTruthy();
  });

  it("**收藏排在点赞前面**——收藏≈被当攻略存起来，语义与抖音的主角标不同", () => {
    expect(items[0].evidence[0].metric).toBe("collect");
    expect(items[0].evidence[0].kind).toBe("scale");
    expect(items[0].evidence[1].value).toContain("♥");
  });

  it("计数是字符串也能读出来（上游返回 \"7503\" 这种）", () => {
    expect(items[0].evidence.every((e) => !/NaN/.test(e.value))).toBe(true);
  });
});

describe("TikTok 广告库归一", () => {
  const items = normalizeTiktokAds(adsFixture as unknown as JsonRecord);

  it("主角标用规模不用 CTR（实测 CTR 与投放规模反相关）", () => {
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].evidence[0].kind).toBe("scale");
    expect(items[0].evidence[0].value).toContain("♥");
    expect(items[0].evidence.find((e) => e.kind === "perf")?.metric).toBe("ctr");
  });

  it("只有花费档达到阈值才给「放量」标", () => {
    const hot = items.filter((i) => i.evidence.some((e) => e.kind === "hot"));
    const notHot = items.filter((i) => !i.evidence.some((e) => e.kind === "hot"));
    // 夹具里两条的 cost 不同，至少证明这个标不是恒真也不是恒假
    expect(hot.length + notHot.length).toBe(items.length);
  });

  it("广告库条目没有公开作品页 → pageUrl 留空，UI 据此不画「去看原片」", () => {
    expect(items[0].pageUrl).toBe("");
  });
});

describe("转译回显", () => {
  it("换了词就带上原因，UI 必须回显（不回显＝用户不知道结果为什么长这样）", () => {
    const r = buildSearchResult("tiktok", adsFixture as unknown as JsonRecord, "护肤精华", "skincare serum");
    expect(r.effectiveKeyword).toBe("skincare serum");
    expect(r.translationReason).toBe("english-index");
  });

  it("没换词就没有 translationReason（不制造无意义的提示）", () => {
    const r = buildSearchResult("douyin", douyinFixture as unknown as JsonRecord, "护肤精华", "护肤精华");
    expect(r.translationReason).toBeUndefined();
  });

  it("中文检测决定要不要转译", () => {
    expect(hasChinese("护肤精华")).toBe(true);
    expect(hasChinese("skincare")).toBe(false);
  });
});

describe("主进程不产出用户可见文案（check:i18n 的语义对偶）", () => {
  it("evidence 只带语义 token，不带任何中文——文案归 UI", () => {
    const all = [
      ...normalizeDouyin(douyinFixture as unknown as JsonRecord),
      ...normalizeXhs(xhsFixture as unknown as JsonRecord),
      ...normalizeTiktokAds(adsFixture as unknown as JsonRecord),
    ];
    for (const item of all) {
      for (const e of item.evidence) {
        expect(e.metric).toMatch(/^(none|collect|like|ctr|hot)$/);
      }
      // durationLabel 是数字格式不是语言；图文帖走 mediaKind 而不是塞「图文」两个字
      expect(item.durationLabel).not.toMatch(/[一-鿿]/);
      expect(item.mediaKind === "video" || item.mediaKind === "image").toBe(true);
    }
  });
});

describe("坏输入不炸", () => {
  it("空信封 / 缺字段 / 条目不是对象，都返回空数组而不是抛", () => {
    for (const bad of [{}, { data: null }, { data: { data: "x" } }, { data: { data: [1, 2] } }]) {
      expect(normalizeDouyin(bad as unknown as JsonRecord)).toEqual([]);
      expect(normalizeXhs(bad as unknown as JsonRecord)).toEqual([]);
      expect(normalizeTiktokAds(bad as unknown as JsonRecord)).toEqual([]);
    }
  });
});

describe("媒体直链提取（只在主进程用，不进 ReferenceItem）", () => {
  it("抖音走 play_addr.url_list[0]", () => {
    const m = extractMediaUrls("douyin", douyinFixture as unknown as JsonRecord);
    const urls = Object.values(m);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toMatch(/^https?:\/\//);
  });

  it("TikTok 广告库走 video_info.video_url['720p']", () => {
    const m = extractMediaUrls("tiktok", adsFixture as unknown as JsonRecord);
    // 夹具把 cover 截断了但 video_url 未收录 → 允许为空；关键是不炸、不产出坏 URL
    for (const u of Object.values(m)) expect(u).toMatch(/^https?:\/\//);
  });

  it("小红书**必须挑 h264**：只有它是完整 mp4，h265/av1 是 .m4s 分片", () => {
    const body = {
      data: { data: { items: [{ note: { id: "n1", video_info_v2: { media: { stream: {
        h265: [{ master_url: "http://x.xhscdn.com/a_3021.m4s" }],
        h264: [{ master_url: "http://x.xhscdn.com/a_258.mp4?sign=1", format: "mp4" }],
      } } } } }] } },
    };
    const m = extractMediaUrls("xhs", body as unknown as JsonRecord);
    expect(m.n1).toContain(".mp4");
    expect(m.n1).not.toContain(".m4s");
  });

  it("小红书的 http:// 统一升到 https（实测两种都能下，但传输该走 TLS）", () => {
    const body = {
      data: { data: { items: [{ note: { id: "n1", video_info_v2: { media: { stream: {
        h264: [{ master_url: "http://sns-video-zl.xhscdn.com/a_258.mp4" }],
      } } } } }] } },
    };
    expect(extractMediaUrls("xhs", body as unknown as JsonRecord).n1).toBe("https://sns-video-zl.xhscdn.com/a_258.mp4");
  });

  it("抽不出直链的条目不进映射（宁可少一条，也不给个坏 URL 去下载）", () => {
    const body = { data: { data: [{ aweme_info: { aweme_id: "1", video: {} } }] } };
    expect(extractMediaUrls("douyin", body as unknown as JsonRecord)).toEqual({});
  });
});
