import { describe, expect, it } from "vitest";
import { MODEL_ARCHETYPES, getArchetypeById, specializeArchetypeForVariant, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import type { ModelParameterControl } from "../shared/videoCapabilities/types";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";

// 防线：每个 APIMart 图片 / 视频型号的参数面板，默认值必须在声明的选项里，选项必须是官方取值的子集。
// 官方取值是手抄的（不从档案里推）：出处是 APIMart 官方文档页（2026-11-07 取），
// 原文快照 /Users/aoqimin/Nomi-coord/tmp/R-apimart-agent-tools/llms-full.txt 里同名页面（GPT Image 2.6 在 6285-6340 行附近）。
// 档案把官方取值抄错一档（比如质量默认值写成官方没有的 ultra）、或多声明一档官方不认的值，这里当场红。
// 写法是「类」级：下面循环所有已声明的 APIMart 型号，不为任何一个型号写特例；表里缺这个型号的官方取值，也红。

type Official = Record<string, readonly (string | number)[] | { min: number; max: number }>;

const RATIOS_7 = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
// Flux 3 图片：aspect_ratio 与 size 兼容字段取值相同（官方页 flux-3-image / flux-3-image-klein）。
const FLUX3_RATIOS = ["21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1", "4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21", "auto"];
const FLUX3_RES = ["768sq", "1k", "1.5k", "2k", "4k"];
// GPT Image 2.6：size 15 档比例 + auto（官方页 gpt-image-2.6/generation）。
const GPT26_SIZES = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"];
const GPT26: Official = {
  size: GPT26_SIZES,
  resolution: ["1k", "2k", "4k"],
  quality: ["low", "medium", "high", "xhigh", "max", "auto"],
  background: ["transparent", "opaque", "auto"],
};
// Nano Banana 2.1：官方 14 档比例（官方页 gemini-nano-banana-2.1，auto 或不传由模型决定）。
const NB21: Official = {
  size: ["auto", "1:4", "4:1", "1:8", "8:1", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
  resolution: ["1k", "2k", "4k"],
};
// Nano Banana Lite：10 档比例；只出 1K，传别的档会被静默降到 1K——所以档案有意不声明清晰度控件
// （官方页 gemini-3.1-flash/generation-lite）。期望表里不写 resolution：档案一旦长出这个控件，下面的检查就会红。
const NBL: Official = {
  size: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "5:4", "4:5", "21:9"],
};
// 视频里「自动」比例经 omitAuto 不发出，不算官方取值之外。
const VIDEO_RATIOS_AUTO = [...RATIOS_7, "auto"];
const VEO_OFFICIAL: Official = { aspect_ratio: ["16:9", "9:16"], resolution: ["720p", "1080p", "4k"], duration: [4, 6, 8] };
const VIDU_Q3_PRO: Official = {
  aspect_ratio: ["16:9", "9:16", "4:3", "3:4", "1:1"],
  resolution: ["540p", "720p", "1080p"],
  duration: { min: 1, max: 16 },
};
const OMNI12: Official = { aspect_ratio: ["16:9", "9:16", "auto"], resolution: ["360p", "720p", "1080p", "4k"], duration: { min: 3, max: 15 } };

/** archetypeId → 官方取值（控件 key → 取值集合或数值范围；布尔开关不在表里）。 */
export const OFFICIAL_VALUES: Record<string, Official> = {
  // ── 图片 ──
  "gpt-image-2.6-flare": GPT26,
  "gpt-image-2.6-sunburst": GPT26,
  "gemini-nano-banana-2.1": NB21,
  "gemini-nano-banana-2.1-ext": NB21,
  "gemini-3.1-flash-lite-image": NBL,
  "gemini-3.1-flash-lite-image-ext": NBL,
  "flux-3-image": { aspect_ratio: FLUX3_RATIOS, resolution: FLUX3_RES },
  "flux-3-image-klein": { aspect_ratio: FLUX3_RATIOS, resolution: FLUX3_RES, steps: { min: 1, max: 16 }, seed: { min: 0, max: 4294967295 }, output_format: ["jpeg", "png", "jpg"] },
  // Grok Imagine 图片 2.0 官方通道：aspect_ratio 13 档 + auto，resolution 1k / 2k，quality low / medium（带图不发）。
  "grok-imagine-image-2.0-official": {
    aspect_ratio: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "auto"],
    resolution: ["1k", "2k"],
    quality: ["low", "medium"],
  },
  "hy-image-v3.5-preview": {
    size: ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    resolution: ["1k", "2k", "4k"],
  },
  // Muse：七档比例；官方明说不要发 auto（档案里的「自动」经 omitAuto 整键不发）。
  "muse-image-ext": { aspect_ratio: VIDEO_RATIOS_AUTO },
  // 万相图像 2.7：size 是比例，resolution 1K / 2K（Pro 文生另有 4K）。
  "wan2.7-image": { size: RATIOS_7, resolution: ["1k", "2k"] },
  "wan2.7-image-pro": { size: RATIOS_7, resolution: ["1k", "2k", "4k"] },
  // ── 视频 ──
  "kling-v4": { aspect_ratio: ["16:9", "9:16", "1:1", "21:9", "auto"], resolution: ["720p", "1080p"], duration: { min: 3, max: 30 } },
  "grok-imagine-video-1.5-official": { aspect_ratio: VIDEO_RATIOS_AUTO, resolution: ["480p", "720p", "1080p"], duration: { min: 1, max: 15 } },
  "pixverse-v6": {
    size: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"],
    resolution: ["360p", "540p", "720p", "1080p"],
    duration: { min: 1, max: 15 },
  },
  "pixverse-v6-max": {
    aspect_ratio: ["16:9", "9:16", "4:3", "3:4", "1:1", "2:3", "3:2", "21:9"],
    resolution: ["360p", "540p", "720p", "1080p"],
    duration: { min: 1, max: 15 },
  },
  // Muse 视频：时长约 10 秒、720p、有声都由供应商固定，档案只声明可选比例；这些控件一旦被声明，表里没有就红。
  "muse-video-ext": { aspect_ratio: VIDEO_RATIOS_AUTO },
  "flux-3-video": {
    aspect_ratio: ["21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"],
    resolution: ["hd", "fhd", "720p", "1080p"],
    duration: { min: 5, max: 20 },
  },
  "wan-3.0-prime-apimart": {
    size: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"],
    resolution: ["480p", "720p", "1080p"],
    duration: { min: 2, max: 30 },
  },
  "veo3.1-fast-official": VEO_OFFICIAL,
  "veo3.1-quality-official": VEO_OFFICIAL,
  "viduq3-pro": VIDU_Q3_PRO,
  "viduq3-turbo": VIDU_Q3_PRO,
  "viduq4-preview": {
    aspect_ratio: ["16:9", "9:16", "4:3", "3:4", "1:1"],
    resolution: ["540p", "720p", "1080p", "2k", "4k"],
    duration: { min: 3, max: 16 },
  },
  "gemini-omni-1.2-flash": OMNI12,
  "gemini-omni-1.2-flash-ext": OMNI12,
};

const declared = [...APIMART_IMAGE_MODELS, ...APIMART_VIDEO_MODELS];

/** 一个档案在 APIMart 上能出现的全部控件：每个变体 × APIMart 供应商分层 × 每个模式。 */
function apimartControls(archetypeId: string): Array<{ where: string; control: ModelParameterControl }> {
  const base = getArchetypeById(archetypeId);
  if (!base) throw new Error(`archetype ${archetypeId} missing`);
  const variants: Array<string | undefined> = base.variants?.length ? base.variants.map((variant) => variant.id) : [undefined];
  const rows: Array<{ where: string; control: ModelParameterControl }> = [];
  for (const variantId of variants) {
    const archetype = variantId ? specializeArchetypeForVariant(base, variantId) : base;
    for (const mode of specializeArchetypeForVendor(archetype, "apimart").modes) {
      for (const control of mode.params ?? []) rows.push({ where: `${archetypeId}${variantId ? `@${variantId}` : ""}/${mode.id}/${control.key}`, control });
    }
  }
  return rows;
}

const norm = (value: unknown) => String(value).trim().toLowerCase();

describe("APIMart 图片 / 视频型号：控件默认值在选项里，选项在官方取值内", () => {
  const archetypeIds = [...new Set(declared.map((model) => model.archetypeId).filter((id): id is string => Boolean(id)))];

  it("类级：每个已声明型号的每个选项控件，默认值都在声明的选项里（没有悬空默认）", () => {
    for (const id of archetypeIds) {
      for (const { where, control } of apimartControls(id)) {
        if (control.defaultValue === undefined || control.options.length === 0) continue;
        const values = control.options.map((option) => norm(option.value));
        expect(values, `${where} 默认值 ${String(control.defaultValue)} 不在选项里`).toContain(norm(control.defaultValue));
      }
    }
  });

  for (const [archetypeId, official] of Object.entries(OFFICIAL_VALUES)) {
    it(`${archetypeId}：选项与默认值是手抄官方取值的子集`, () => {
      expect(archetypeIds, `${archetypeId} 必须是已声明的 APIMart 档案`).toContain(archetypeId);
      const seenKeys = new Set<string>();
      for (const { where, control } of apimartControls(archetypeId)) {
        if (control.type === "boolean" || control.type === "text" || control.type === "image-url") continue;
        // 没有选项、也没有数值范围的自由输入（种子之类）没有「取值范围」可越界。
        if (control.options.length === 0 && typeof control.min !== "number" && typeof control.max !== "number") continue;
        const allowed = official[control.key];
        expect(allowed, `${where}：期望表里没有这个控件的官方取值，请照官方页补（并写出处）`).toBeTruthy();
        seenKeys.add(control.key);
        const inRange = (value: unknown): boolean => {
          if (Array.isArray(allowed)) return (allowed as readonly (string | number)[]).map(norm).includes(norm(value));
          const range = allowed as { min: number; max: number };
          return Number(value) >= range.min && Number(value) <= range.max;
        };
        for (const option of control.options) expect(inRange(option.value), `${where} 选项 ${String(option.value)} 不在官方取值里`).toBe(true);
        if (control.defaultValue !== undefined) expect(inRange(control.defaultValue), `${where} 默认值 ${String(control.defaultValue)} 不在官方取值里`).toBe(true);
        if (control.options.length === 0 && typeof control.min === "number" && typeof control.max === "number" && !Array.isArray(allowed)) {
          const range = allowed as { min: number; max: number };
          expect(control.min, `${where} 下限`).toBeGreaterThanOrEqual(range.min);
          expect(control.max, `${where} 上限`).toBeLessThanOrEqual(range.max);
        }
      }
      // 期望表里写了的控件，档案里必须真有（防止表里留着过期条目、或档案把这个控件删了没人发现）。
      for (const key of Object.keys(official)) expect(seenKeys.has(key), `${archetypeId} 期望表里的 ${key} 在档案里找不到`).toBe(true);
    });
  }

  it("类级：2026-11-07 新核过官方页的 APIMart 档案，都必须在期望表里（新增型号漏登官方取值就红）", () => {
    const fresh = MODEL_ARCHETYPES.filter((archetype) =>
      archetypeIds.includes(archetype.id) && (archetype.sources ?? []).some((source) => source.vendorKey === "apimart" && source.checkedAt >= "2026-11-07"));
    const missing = fresh.map((archetype) => archetype.id).filter((id) => !(id in OFFICIAL_VALUES));
    expect(missing, `这些档案核过官方页但期望表没有它们的官方取值：${missing.join(", ")}`).toEqual([]);
  });
});
