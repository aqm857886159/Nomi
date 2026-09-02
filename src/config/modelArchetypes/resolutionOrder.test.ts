import { describe, it, expect } from "vitest";
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from "./index";
import { sourceBackedVideoProfiles } from "../../../electron/shared/videoCapabilities";

// 二期档案归一（2026-09-02）的结构保证：MODEL_ARCHETYPES 的 video 块改为从
// electron/shared/videoCapabilities/registry.ts 派生（唯一登记点），数组顺序因此从
// 「手列的历史顺序」变成「registry 顺序 + legacy pin」。三趟身份匹配（resolveBaseArchetype）
// 在同趟多命中时按数组顺序决胜——所以「顺序」本身是行为。本文件把**所有已知的跨档案同串**
// 的存量赢家逐个锁死：未来任何重排 / 新增档案 / 改 pattern 若翻转任一赢家，这里当场红，
// 而不是等用户手上「认错模型、参数全错」（z-image 事故的教训）。
//
// 语料来源：搬迁探针对全 pattern 语料（raw/lower/upper/models 前缀/末段变形，1042 条）
// 在新旧两序上逐一对比，赢家全部一致；同趟多命中点（顺序敏感点）沉淀为下面两张表。

const resolve = (modelKey: string) => resolveArchetypeForModel({ modelKey, vendorKey: null })?.id ?? null;

describe("MODEL_ARCHETYPES 派生构造（video 单一登记点）", () => {
  it("video 子集与 registry 完全同集（引用级）——接 video 模型只登记在 registry 一处", () => {
    const registry = new Set(sourceBackedVideoProfiles());
    const videos = MODEL_ARCHETYPES.filter((a) => a.kind === "video");
    expect(videos.length).toBe(registry.size);
    for (const v of videos) expect(registry.has(v)).toBe(true);
  });

  it("档案 id 全局唯一（getArchetypeById 与生成器按 id 键取，顺序无关的前提）", () => {
    const ids = MODEL_ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("跨档案同串的存量赢家（同趟多命中的顺序决胜，逐条锁死）", () => {
  // Runway 是平台型供应商：它的 video/audio/image 档案把所住模型的判别串也列进了
  // identifierPatterns（sources 实证自 Runway OpenAPI discriminator）。凡与专属档案撞串，
  // 存量赢家 = 专属档案（seedance2/hailuo3/eleven_v3…）——唯一例外是 veo3.1（见下）。
  const LOCKED_WINNERS: Record<string, string> = {
    // pattern 归属 runway-video，专属档案赢
    seedance2: "seedance-2",
    hailuo3: "minimax-h3",
    // Runway 家族内的遮蔽（前者档案先声明）
    happyhorse_1_0: "runway-video",
    gen4_image_turbo: "runway-image-reference",
    // 归属 runway-audio，专属音频档案赢
    eleven_text_to_sound_v2: "eleven-sfx-v2",
    eleven_v3: "eleven-v3",
    // ⚠️ 唯一反向例外："veo3.1" 同为 Runway 平台判别串与 Veo 家族键，渲染层存量赢家是
    // runway-video（由 index.ts 的 LEGACY_RESOLUTION_ORDER_PINS 钉住）。注意 registry 侧
    // （profileFor 平局判据）对同一串的赢家是 veo-3.1 —— 两侧分裂是**存量问题**，
    // 修它属行为变更须单独立项；在那之前本行锁住渲染层现状，防止静默漂移。
    "veo3.1": "runway-video",
    // 大小写归一后同串（apimart 官方 key 是 MiniMax-H3、kie 是 minimax-h3）：
    // 原大小写各自 tier-0 精确命中（顺序无关）；全大写落 tier-1 时 kie 档案在前。
    "MiniMax-H3": "minimax-h3-apimart",
    "minimax-h3": "minimax-h3",
    "MINIMAX-H3": "minimax-h3",
    // 末段撞串（vendor 前缀被剥掉后才相同，tier-2 决胜）
    "somevendor/z-image-turbo": "z-image-turbo", // vs modelscope-image（z-image 事故的原案）
    "somevendor/seedance2": "seedance-2", // vs runway-video
    "somevendor/veo3.1": "runway-video", // pin 在末段趟同样成立
    // minimax-h3 与 happyhorse 各自声明了 <family>/text-to-video 形态的 key，末段同串
    "text-to-video": "minimax-h3",
    "image-to-video": "minimax-h3",
  };

  for (const [identifier, winnerId] of Object.entries(LOCKED_WINNERS)) {
    it(`"${identifier}" → ${winnerId}`, () => {
      expect(resolve(identifier)).toBe(winnerId);
    });
  }
});

describe("pattern 自解析不变量（除已登记例外，每个 pattern 解析回自己的档案）", () => {
  // 例外 = 上面锁过赢家的跨档案同串：owner ≠ 赢家 的全部现存条目。新增档案若把别人的
  // pattern 抢走（新的同串且自己没赢），这里会红——逼着新档案作者显式处理撞串而不是静默吞。
  const KNOWN_LOSSES: Record<string, string> = {
    seedance2: "seedance-2", // owner runway-video
    hailuo3: "minimax-h3", // owner runway-video
    happyhorse_1_0: "runway-video", // owner runway-video-t2v
    gen4_image_turbo: "runway-image-reference", // owner runway-image
    eleven_text_to_sound_v2: "eleven-sfx-v2", // owner runway-audio
    eleven_v3: "eleven-v3", // owner runway-audio
    "veo3.1": "runway-video", // owner veo-3.1（legacy pin，见上）
  };

  it("全目录逐 pattern 扫描", () => {
    const violations: string[] = [];
    for (const archetype of MODEL_ARCHETYPES) {
      for (const pattern of archetype.identifierPatterns) {
        const winner = resolve(pattern);
        const expected = KNOWN_LOSSES[pattern] ?? archetype.id;
        if (winner !== expected) {
          violations.push(`"${pattern}" (owner ${archetype.id}) → ${winner}，期望 ${expected}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
