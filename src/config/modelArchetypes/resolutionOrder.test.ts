import { describe, it, expect } from "vitest";
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from "./index";
import { buildVideoModelCandidates, sourceBackedVideoProfiles } from "../../../electron/shared/videoCapabilities";

// 二期档案归一（2026-09-02）的结构保证：MODEL_ARCHETYPES 的 video 块改为从
// electron/shared/videoCapabilities/registry.ts 派生（唯一登记点），数组顺序因此从
// 「手列的历史顺序」变成 registry 声明序。三趟身份匹配（resolveBaseArchetype）
// 在同趟多命中时按数组顺序决胜——所以「顺序」本身是行为。本文件把**所有已知的跨档案同串**
// 的存量赢家逐个锁死：未来任何重排 / 新增档案 / 改 pattern 若翻转任一赢家，这里当场红，
// 而不是等用户手上「认错模型、参数全错」（z-image 事故的教训）。
//
// veo3.1 同串双身份修复（2026-09-02，行为变更独立立项）：裸 "veo3.1" 曾在渲染层解析到
// runway-video（历史手列序 + legacy pin 钉住）、在 registry 平局判据解析到 veo-3.1——同一个
// 串两个身份。语义正确身份 = veo-3.1（Google Veo 3.1：APIMart 官方 key 就是 veo3.1 族，
// 专属档案的报文形状 image_urls/generation_type 才是中转/裸 key 该走的契约；Runway 平台自己
// 的目录行显式 pin 了 archetypeId，从不走身份匹配）。pin 已删，两侧共用 registry 声明序，
// 「专属档案赢平台判别串」规则自此无例外；跨侧一致性由文末对拍测试永久锁住。

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
  // Runway 的 image/audio 档案仍是平台型的：它们把所住模型的判别串也列进 identifierPatterns
  // （sources 实证自 Runway OpenAPI discriminator）。凡与专属档案撞串，存量赢家 = 专属档案。
  //
  // ⚠️ video 侧已不在此列：2026-09-02「一模型一档案」把 Runway 十行 video 改挂各自**真模型**档案，
  // 平台档案 runway-video / runway-video-t2v 同 commit 删除。于是 seedance2 / hailuo3 / veo3.1 /
  // happyhorse_1_0 这些串不再有第二个声明者——撞串本身消失了，连同它的 LEGACY_RESOLUTION_ORDER_PINS
  // 一起清掉（PR #310 合同 residual_risks 第三条指明的处置）。下面只剩仍然真实存在的撞串。
  const LOCKED_WINNERS: Record<string, string> = {
    // ⚠️ image 侧同理已不在此列：2026-09-02 把 Runway 十行 image 也改挂各自**真模型**档案，
    // 平台档案 runway-image / runway-image-reference 同 commit 删除。`gen4_image_turbo`
    // 此后只有 runway-gen4-image-turbo 一个声明者，撞串本身消失（不再是「谁遮蔽谁」）。
    // 归属 runway-audio，专属音频档案赢
    eleven_text_to_sound_v2: "eleven-sfx-v2",
    eleven_v3: "eleven-v3",
    // 大小写归一后同串（apimart 官方 key 是 MiniMax-H3、kie 是 minimax-h3）：
    // 原大小写各自 tier-0 精确命中（顺序无关）；全大写落 tier-1 时 kie 档案在前。
    "MiniMax-H3": "minimax-h3-apimart",
    "minimax-h3": "minimax-h3",
    "MINIMAX-H3": "minimax-h3",
    // 末段撞串（vendor 前缀被剥掉后才相同，tier-2 决胜）
    "somevendor/z-image-turbo": "z-image-turbo", // vs modelscope-image（z-image 事故的原案）
    // 平台档案删除后，这两串各自只有一个声明者 —— 锁住「归到真模型档案」这个新现状。
    "somevendor/seedance2": "seedance-2",
    "somevendor/veo3.1": "veo-3.1",
    seedance2: "seedance-2",
    hailuo3: "minimax-h3",
    "veo3.1": "veo-3.1",
    happyhorse_1_0: "happyhorse",
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
  // video 侧的四条旧例外（seedance2 / hailuo3 / happyhorse_1_0 / veo3.1）已随平台档案 runway-video
  // 一起消失：这些串现在各自只有真模型档案一个声明者，pattern 自解析回自己，不再是「损失」。
  // image 侧的 gen4_image_turbo 同样已随平台档案 runway-image / runway-image-reference 消失。
  const KNOWN_LOSSES: Record<string, string> = {
    eleven_text_to_sound_v2: "eleven-sfx-v2", // owner runway-audio
    eleven_v3: "eleven-v3", // owner runway-audio
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

describe("同串双身份禁令：渲染层与 registry 平局判据对全语料逐串对拍", () => {
  // 这类分裂（"veo3.1" 事故）的病灶：两侧各持一份决胜逻辑，同一身份串两个赢家——推荐/规划层
  // （registry profileFor）许诺一个档案，UI/发送路（resolveArchetypeForModel）却按另一个档案发报文。
  // 不变量：对「全部档案 identifierPatterns + variant modelKey + legacyIds ×
  // {raw, lower, UPPER, models/ 前缀, 裸末段, vendor 前缀末段}」全语料，凡两侧都认领的串，
  // 赢家必须相同。认领面允许不同（registry 有 includes 宽容档给推荐兜底、渲染层刻意只认相等），
  // 但**身份判定不许分裂**。新增档案若引入新的同串且两侧赢家不同，这里当场红。
  const lastSegment = (s: string): string => {
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };

  const corpus = new Set<string>();
  for (const archetype of MODEL_ARCHETYPES) {
    const bases = [
      ...archetype.identifierPatterns,
      ...(archetype.variants ?? []).map((v) => v.modelKey),
      ...(archetype.legacyIds ?? []),
    ];
    for (const base of bases) {
      corpus.add(base);
      corpus.add(base.toLowerCase());
      corpus.add(base.toUpperCase());
      corpus.add(`models/${base}`);
      corpus.add(lastSegment(base));
      corpus.add(`somevendor/${lastSegment(base)}`);
    }
  }

  const registryResolve = (modelKey: string): string | null => {
    const [candidate] = buildVideoModelCandidates([{ provider: "probe", modelKey, label: modelKey }]);
    const id = candidate?.archetype?.id ?? null;
    return id && id.startsWith("catalog-video-") ? null : id; // unknown 兜底 = 不认领
  };

  it("两侧都认领的串赢家一致（diffs=0）", () => {
    const diffs: string[] = [];
    for (const identifier of corpus) {
      const rendererId = resolve(identifier);
      const registryId = registryResolve(identifier);
      if (rendererId && registryId && rendererId !== registryId) {
        diffs.push(`"${identifier}" renderer→${rendererId} registry→${registryId}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it('裸 "veo3.1" 两侧同判 veo-3.1（曾经的分裂原案，双向显式锁死）', () => {
    expect(resolve("veo3.1")).toBe("veo-3.1");
    expect(registryResolve("veo3.1")).toBe("veo-3.1");
  });
});
