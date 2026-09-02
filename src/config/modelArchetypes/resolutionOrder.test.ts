import { describe, it, expect } from "vitest";
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from "./index";
import { buildVideoModelCandidates, sourceBackedVideoProfiles } from "../../../electron/shared/videoCapabilities";

// 二期档案归一（2026-09-02）的结构保证：MODEL_ARCHETYPES 的 video 块改为从
// electron/shared/videoCapabilities/registry.ts 派生（唯一登记点），数组顺序就是 registry
// 声明序。三趟身份匹配（resolveBaseArchetype）在同趟多命中时按数组顺序决胜——所以「顺序」
// 本身是行为。本文件把**所有已知的跨档案同串**的赢家逐个锁死：未来任何重排 / 新增档案 /
// 改 pattern 若翻转任一赢家，这里当场红，而不是等用户手上「认错模型、参数全错」
// （z-image 事故的教训）。
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

describe("跨档案同串的赢家（同趟多命中的顺序决胜，逐条锁死）", () => {
  // Runway 是平台型供应商：它的 video/audio/image 档案把所住模型的判别串也列进了
  // identifierPatterns（sources 实证自 Runway OpenAPI discriminator）。凡与专属档案撞串，
  // 赢家 = 专属档案（seedance2/hailuo3/veo3.1/eleven_v3…），无例外：平台档案只是判别串的
  // 宿主，专属档案才携带该模型的真实能力面与报文契约；Runway 自家目录行显式 pin archetypeId，
  // 不依赖这里。（"veo3.1" 曾是唯一反向例外=渲染层认 runway-video，2026-09-02 已纠正到 veo-3.1
  // 并删除 legacy pin——它与 registry 平局判据的赢家自此一致。）
  const LOCKED_WINNERS: Record<string, string> = {
    // pattern 归属 runway-video，专属档案赢
    seedance2: "seedance-2",
    hailuo3: "minimax-h3",
    "veo3.1": "veo-3.1",
    // Runway 家族内的遮蔽（前者档案先声明）
    happyhorse_1_0: "runway-video",
    gen4_image_turbo: "runway-image-reference",
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
    "somevendor/seedance2": "seedance-2", // vs runway-video
    "somevendor/veo3.1": "veo-3.1", // 专属档案在末段趟同样赢
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
    "veo3.1": "veo-3.1", // owner runway-video（平台判别串让位专属档案，与其余各行同一条规则）
    happyhorse_1_0: "runway-video", // owner runway-video-t2v
    gen4_image_turbo: "runway-image-reference", // owner runway-image
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
