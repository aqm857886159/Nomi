import { describe, expect, it } from "vitest";
import {
  apimartSubIndexUrls,
  collectApimart,
  collectVendors,
  diffVendor,
  isCovered,
  normalizeToken,
  offlineFileName,
  parseApimart,
  parseKie,
  stripLocale,
} from "./model-radar";
import type { RadarEntry } from "./model-radar";

// 全部用内联样本，**不打网络**：雷达的解析逻辑要能在 CI 里回归，
// 而网络测试既慢又会因为对方改文档而随机翻红（那样门岗会被习惯性忽略）。
// 样本行的形状 100% 抄自 2026-08-27 实抓的 llms.txt。

const KIE_SAMPLE = [
  "# docs.kie.ai",
  "## Docs",
  "- [Market](https://docs.kie.ai/market/quickstart.md): ",
  "- Image    Models > Seedream [Seedream5.0 Pro - Text to Image](https://docs.kie.ai/market/seedream/5-pro-text-to-image.md): x",
  "- Video    Models > Wan [Wan 3.0 - Video](https://docs.kie.ai/market/wan/3-0-video.md): x",
  // 语言镜像：同一个模型的 /cn/ 复本，必须被去重掉，否则每个模型报两遍。
  "- Video    Models > Wan [Wan 3.0 - 生成视频](https://docs.kie.ai/cn/market/wan/3-0-video.md): x",
  "- Music Models > ElevenLabs [TTS Multilingual v2](https://docs.kie.ai/market/elevenlabs/text-to-speech-multilingual-v2.md): x",
  // chat 不在盯的类别里。
  "- Chat  Models > Claude [Claude Opus 5](https://docs.kie.ai/market/claude/claude-opus-5.md): x",
  // Suno 那 94 条全是端点文档、不在 /market/ 下——一条都不该进来。
  "- Suno API [Generate Music](https://docs.kie.ai/suno-api/generate-music.md): x",
  "- Suno API [Generate Music Callbacks](https://docs.kie.ai/suno-api/generate-music-callbacks.md): x",
  "- Veo3.1 API [Quickstart](https://docs.kie.ai/veo3-1-api/quickstart.md): x",
].join("\n");

const APIMART_SAMPLE = [
  "# APIMart",
  "- [APIMart Gateway](https://docs.apimart.ai/en/index.md): x",
  "- [Nano banana2 Image Generation](https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md): x",
  "- [Wan3.0 Video Generation](https://docs.apimart.ai/en/api-reference/videos/wan3.0-video/generation.md): x",
  "- [TTS](https://docs.apimart.ai/en/api-reference/audios/elevenlabs-tts/generation.md): x",
  // texts / tasks / account 不盯。
  "- [Models List Metadata API](https://docs.apimart.ai/en/api-reference/texts/models/list.md): x",
  "- [Task Status](https://docs.apimart.ai/en/api-reference/tasks/status.md): x",
].join("\n");

describe("归一", () => {
  it("normalizeToken 抹平大小写与分隔符（文档路径 flux2 ↔ 真实 id flux-2 的关键）", () => {
    expect(normalizeToken("flux2/pro-text-to-image")).toBe("flux2protexttoimage");
    expect(normalizeToken("flux-2/pro-text-to-image")).toBe("flux2protexttoimage");
    expect(normalizeToken("Seedream 5.0 Pro")).toBe("seedream50pro");
  });

  it("stripLocale 剥掉语言段", () => {
    expect(stripLocale("/cn/market/wan/3-0-video.md")).toBe("/market/wan/3-0-video.md");
    expect(stripLocale("/en/api-reference/images/x.md")).toBe("/api-reference/images/x.md");
    expect(stripLocale("/market/wan/3-0-video.md")).toBe("/market/wan/3-0-video.md");
  });
});

describe("kie 索引解析", () => {
  const entries = parseKie(KIE_SAMPLE);
  const slugs = entries.map((e) => e.slug);

  it("只收 /market/ 下的模型页（Suno/Veo 的端点文档一条都不进）", () => {
    // Suno 在真实索引里有 94 条端点文档；按分类收会是 94 条纯噪音。
    expect(slugs).not.toContain("generate-music");
    expect(entries.every((e) => e.url.includes("/market/"))).toBe(true);
    expect(slugs).not.toContain("quickstart");
  });

  it("分类取自面包屑（官方就是不规则空格 'Image    Models'，必须塌空白）", () => {
    const byslug = Object.fromEntries(entries.map((e) => [e.slug, e.category]));
    expect(byslug["seedream/5-pro-text-to-image"]).toBe("image");
    expect(byslug["wan/3-0-video"]).toBe("video");
    expect(byslug["elevenlabs/text-to-speech-multilingual-v2"]).toBe("audio");
  });

  it("chat 类别被排除（用户拍板不盯 LLM）", () => {
    expect(slugs).not.toContain("claude/claude-opus-5");
  });

  it("/cn/ 语言镜像被去重（否则每个模型报两遍）", () => {
    expect(slugs.filter((s) => s === "wan/3-0-video")).toHaveLength(1);
  });
});

describe("apimart 索引解析", () => {
  const entries = parseApimart(APIMART_SAMPLE);
  const slugs = entries.map((e) => e.slug);

  it("按 URL 桶分类，slug 取模型段（剥掉 /generation）", () => {
    expect(slugs).toContain("gemini-3.1-flash");
    expect(slugs).toContain("wan3.0-video");
    expect(entries.find((e) => e.slug === "wan3.0-video")?.category).toBe("video");
    expect(entries.find((e) => e.slug === "elevenlabs-tts")?.category).toBe("audio");
  });

  it("texts / tasks / 首页不进", () => {
    expect(slugs.some((s) => s.includes("models"))).toBe(false);
    expect(slugs.some((s) => s.includes("status"))).toBe(false);
  });
});

describe("覆盖判定 isCovered（三级判据 + 长度闸）", () => {
  const coverage = new Set(
    ["nanobanana2", "gemini31flashimagepreview", "flux2protexttoimage", "wan30video", "doubaoseedance20260128"].map(
      (t) => t,
    ),
  );

  it("全等命中", () => {
    expect(isCovered("wan30video", coverage)).toBe(true);
  });

  it("末段全等命中（页名带厂商命名空间：google/nanobanana2 ↔ id nano-banana-2）", () => {
    expect(isCovered("google/nanobanana2", coverage)).toBe(true);
  });

  it("包含关系命中（页名是家族、id 带后缀：gemini-3.1-flash ↔ …-image-preview）", () => {
    expect(isCovered("gemini-3.1-flash", coverage)).toBe(true);
  });

  it("真缺口不被吞（同族但不同型号要报出来）", () => {
    expect(isCovered("flux2/flex-text-to-image", coverage)).toBe(false);
    expect(isCovered("bytedance/seedance-1-5-pro", coverage)).toBe(false);
  });

  it("长度闸生效：短 slug 不许靠包含把整族吃掉", () => {
    // 没有这道闸，"wan"(3 字) 会命中 wan30video，于是所有 wan 系缺口被静默吞掉。
    expect(isCovered("wan", coverage)).toBe(false);
    expect(isCovered("x", coverage)).toBe(false);
  });
});

describe("差分 diffVendor", () => {
  const e = (slug: string): RadarEntry => ({
    vendor: "kie",
    category: "video",
    slug,
    title: slug,
    url: `https://docs.kie.ai/market/${slug}.md`,
  });

  it("首次建基线不把整册报成新增（那是噪音不是信号）", () => {
    const d = diffVendor("kie", [e("a-model"), e("b-model")], null, new Set());
    expect(d.added).toEqual([]);
    expect(d.total).toBe(2);
  });

  it("新增/下架各归各位", () => {
    const prev = [e("a-model"), e("gone-model")];
    const d = diffVendor("kie", [e("a-model"), e("fresh-model")], prev, new Set());
    expect(d.added.map((x) => x.slug)).toEqual(["fresh-model"]);
    expect(d.removed.map((x) => x.slug)).toEqual(["gone-model"]);
  });

  it("下架也要报——我们可能还在种一个已下线的模型", () => {
    const d = diffVendor("kie", [], [e("retired")], new Set());
    expect(d.removed.map((x) => x.slug)).toEqual(["retired"]);
  });

  it("uncovered 走 isCovered，不是裸全等", () => {
    const d = diffVendor("kie", [e("google/nanobanana2")], [], new Set(["nanobanana2"]));
    expect(d.uncovered).toEqual([]);
  });
});

// —— 2026-08-31 apimart 改版：根 llms.txt 变成「索引的索引」，模型页全部移入 /_llms/en/api-manual.md ——
// 样本行的形状 100% 抄自 2026-08-31 实抓的根索引（71 行里抽有代表性的几类）。
const APIMART_ROOT_20260831 = [
  "# APIMart",
  "",
  "- [API Manual (144 pages)](https://docs.apimart.ai/_llms/en/api-manual.md): Documentation for API Manual.",
  "",
  "## Integrations",
  "",
  "- [Using APIMart in ChatBox](https://docs.apimart.ai/en/integrations/chat/chatbox.md): Detailed guide on how to configure and use APIMart API service in ChatBox desktop client.",
  "- [Quick Start](https://docs.apimart.ai/en/quickstart.md): Quickly start using our API services",
  "",
  "## Indexes",
  "",
  "- [English / API Manual (144 pages)](https://docs.apimart.ai/_llms/en/api-manual.md): Documentation for English / API Manual.",
  "- [Chinese (163 pages)](https://docs.apimart.ai/_llms/cn.md): Documentation for Chinese.",
  "- [Chinese / API 手册 (144 pages)](https://docs.apimart.ai/_llms/cn/api.md): Documentation for Chinese / API 手册.",
  "- [Japanese (163 pages)](https://docs.apimart.ai/_llms/ja.md): Documentation for Japanese.",
].join("\n");

describe("apimart 两级索引（2026-08-31 改版）", () => {
  it("改版根索引本身 0 条模型页——当天整轮翻车的直接机制，必须走失败隔离而不是「没新模型」", () => {
    expect(parseApimart(APIMART_ROOT_20260831)).toEqual([]);
  });

  it("apimartSubIndexUrls 只挑英文份 /_llms/ 子索引并去重（根里列了两遍），9 个语言镜像一个不跟", () => {
    expect(apimartSubIndexUrls(APIMART_ROOT_20260831)).toEqual(["https://docs.apimart.ai/_llms/en/api-manual.md"]);
  });

  it("collectApimart 跟进英文子索引拿到模型页；语言镜像不抓", async () => {
    const fetched: string[] = [];
    const entries = await collectApimart(async (url) => {
      fetched.push(url);
      if (url === "https://docs.apimart.ai/llms.txt") return APIMART_ROOT_20260831;
      if (url === "https://docs.apimart.ai/_llms/en/api-manual.md") return APIMART_SAMPLE;
      throw new Error(`不该抓 ${url}`);
    });
    expect(fetched).toEqual([
      "https://docs.apimart.ai/llms.txt",
      "https://docs.apimart.ai/_llms/en/api-manual.md",
    ]);
    expect(entries.map((e) => e.slug)).toContain("gemini-3.1-flash");
    expect(entries.find((e) => e.slug === "wan3.0-video")?.category).toBe("video");
  });

  it("旧扁平结构同一算法照收（根直接列模型页 → 一次抓取，无子索引可跟）", async () => {
    const fetched: string[] = [];
    const entries = await collectApimart(async (url) => {
      fetched.push(url);
      return APIMART_SAMPLE;
    });
    expect(fetched).toHaveLength(1);
    expect(entries.map((e) => e.slug)).toContain("gemini-3.1-flash");
  });

  it("索引跟进有界：链条超上限红着报，不无界爬", async () => {
    await expect(
      collectApimart(async (url) => {
        // 每个索引都再指向下一个新的英文子索引，构造无穷链。
        const n = Number(/chain-(\d+)/.exec(url)?.[1] ?? 0) + 1;
        return `- [next](https://docs.apimart.ai/_llms/en/chain-${n}.md): x`;
      }),
    ).rejects.toThrow(/超过/);
  });
});

describe("供应商级失败隔离 collectVendors（类级不变量：单家失败不打死整轮）", () => {
  const okEntry: RadarEntry = {
    vendor: "ok",
    category: "video",
    slug: "fine-model",
    title: "fine",
    url: "https://x.example/fine.md",
  };

  it("单家抛错 → 该家进 failures，其余照常出结果（2026-08-31 kie 被 apimart 陪葬的回归）", async () => {
    const { entries, failures } = await collectVendors(
      {
        boom: {
          collect: async () => {
            throw new Error("索引结构又变了");
          },
        },
        ok: { collect: async () => [okEntry] },
      },
      async () => "",
    );
    expect(entries.ok).toEqual([okEntry]);
    expect(entries.boom).toBeUndefined();
    expect(failures).toEqual([{ vendor: "boom", error: "索引结构又变了" }]);
  });

  it("解析 0 条 = 该家「没查成」（不是「没有新模型」），别家不受影响", async () => {
    const { entries, failures } = await collectVendors(
      {
        empty: { collect: async () => [] },
        ok: { collect: async () => [okEntry] },
      },
      async () => "",
    );
    expect(entries.ok).toEqual([okEntry]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.vendor).toBe("empty");
    expect(failures[0]?.error).toContain("0 条");
  });
});

describe("离线样本命名", () => {
  it("URL 派生文件名：host+path 压平（两级索引要能放多份样本）", () => {
    expect(offlineFileName("https://docs.kie.ai/llms.txt")).toBe("docs.kie.ai_llms.txt");
    expect(offlineFileName("https://docs.apimart.ai/_llms/en/api-manual.md")).toBe(
      "docs.apimart.ai__llms_en_api-manual.md",
    );
  });
});
