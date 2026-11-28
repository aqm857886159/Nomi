import type {
  ArchetypeIntent,
  ArchetypeMode,
  ModelArchetype,
  ModelParameterControl,
} from "./types";
import type { ModelNameSource } from "../modelArchetypes/modelNameSource";
import { AGNES_VIDEO_ARCHETYPE } from "./agnesVideo";
import { AGNES_VIDEO_25_ARCHETYPE, AGNES_VIDEO_25_FLASH_ARCHETYPE } from "./agnesVideo25";
import { DREAMINA_MULTIFRAME_ARCHETYPE } from "./dreaminaMultiframe";
import { DREAMINA_SEEDANCE_ARCHETYPE } from "./dreaminaSeedance";
import { GROK_IMAGINE_1_5_VIDEO_ARCHETYPE } from "./grokImagine15Video";
import { HAILUO_2_3_ARCHETYPE } from "./hailuo23";
import { HAPPYHORSE_ARCHETYPE } from "./happyhorse";
import { HAPPYHORSE_1_1_ARCHETYPE } from "./happyhorse11";
import { KLING_3_ARCHETYPE } from "./kling";
import { KLING_3_TURBO_ARCHETYPE } from "./kling30Turbo";
import { KLING_4_ARCHETYPE } from "./kling4";
import { KLING_4_FLASH_ARCHETYPE } from "./kling4Flash";
import { GROK_IMAGINE_VIDEO_15_OFFICIAL_ARCHETYPE } from "./grokImagineVideoOfficial";
import { PIXVERSE_V6_ARCHETYPE, PIXVERSE_V6_MAX_ARCHETYPE } from "./pixverse6";
import { FLUX_3_VIDEO_ARCHETYPE, MUSE_VIDEO_EXT_ARCHETYPE } from "./museFluxVideo";
import { MINIMAX_H3_ARCHETYPE } from "./minimaxH3";
import { MINIMAX_H3_MAX_ARCHETYPE } from "./minimaxH3Max";
import { MINIMAX_H3_APIMART_ARCHETYPE } from "./minimaxH3Apimart";
import { MINIMAX_H3_REGENERATION_ARCHETYPE } from "./minimaxH3Regeneration";
import { HIGGSFIELD_DOP_ARCHETYPE } from "./higgsfieldDop";
import { OMNI_FLASH_EXT_ARCHETYPE } from "./omniFlashExt";
import { RUNNINGHUB_SEEDANCE_ARCHETYPE } from "./runninghubSeedance";
import { RUNNINGHUB_VIDEO_ARCHETYPES } from "./runninghubVideoArchetypes";
import { SEEDANCE_2_ARCHETYPE } from "./seedance";
import { SEEDANCE_2_5_ARCHETYPE } from "./seedance25";
import { SEEDANCE_2_5_APIMART_ARCHETYPE } from "./seedance25Apimart";
import { SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE } from "./seedance25ApimartSample";
import { SEEDANCE_2_5_RUNWAY_ARCHETYPE } from "./seedance25Runway";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "./seedanceApimart";
import { SEEDANCE_VOLCENGINE_ARCHETYPE } from "./seedanceVolcengine";
import { SEEDANCE_VOLCENGINE_2_5_ARCHETYPE } from "./seedanceVolcengine25";
import { VEO_3_1_ARCHETYPE } from "./veo31";
import { GEMINI_OMNI_11_ARCHETYPE } from "./geminiOmni11";
import { RUNWAY_GEN45_ARCHETYPE } from "./runwayGen45";
import { RUNWAY_GEN4_TURBO_ARCHETYPE } from "./runwayGen4Turbo";
import { VIDU_Q3_ARCHETYPE } from "./viduQ3";
import { WAN_2_7_ARCHETYPE } from "./wan27";
import { WAN_3_0_ARCHETYPE } from "./wan30";
import { WAN_3_0_APIMART_ARCHETYPE, WAN_3_0_PRIME_APIMART_ARCHETYPE } from "./wan30Apimart";
import { VEO_31_FAST_OFFICIAL_ARCHETYPE, VEO_31_QUALITY_OFFICIAL_ARCHETYPE } from "./veoOfficial";
import { VIDU_Q3_PRO_ARCHETYPE, VIDU_Q3_TURBO_ARCHETYPE, VIDU_Q4_PREVIEW_ARCHETYPE } from "./viduNew";
import { GEMINI_OMNI_12_FLASH_ARCHETYPE, GEMINI_OMNI_12_FLASH_EXT_ARCHETYPE } from "./geminiOmni12";

/**
 * The catalog is the user's source of truth for which models actually exist.
 * This deliberately contains no catalog-store or Electron imports so the same
 * resolver can be used by GUI and headless planning tests.
 */
export type VideoCatalogModel = {
  provider: string;
  modelKey: string;
  label: string;
  archetypeId?: string;
  parameterControls?: readonly ModelParameterControl[];
  /** 这一行接不接受档案的型号名（缺省 = 问本进程的查询口），见 modelArchetypes/modelNameSource.ts。 */
  modelNameSource?: ModelNameSource;
};

export function videoArchetypeIdFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const value = (meta as { archetypeId?: unknown }).archetypeId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const SOURCE_BACKED_PROFILES: readonly ModelArchetype[] = [
  SEEDANCE_2_ARCHETYPE,
  SEEDANCE_2_5_ARCHETYPE,
  MINIMAX_H3_ARCHETYPE,
  MINIMAX_H3_MAX_ARCHETYPE,
  HAPPYHORSE_ARCHETYPE,
  VIDU_Q3_ARCHETYPE,
  KLING_3_TURBO_ARCHETYPE,
  HAPPYHORSE_1_1_ARCHETYPE,
  GROK_IMAGINE_1_5_VIDEO_ARCHETYPE,
  VEO_3_1_ARCHETYPE,
  GEMINI_OMNI_11_ARCHETYPE,
  RUNWAY_GEN45_ARCHETYPE,
  RUNWAY_GEN4_TURBO_ARCHETYPE,
  KLING_3_ARCHETYPE,
  SEEDANCE_2_APIMART_ARCHETYPE,
  SEEDANCE_2_5_APIMART_ARCHETYPE,
  SEEDANCE_2_5_APIMART_SAMPLE_ARCHETYPE,
  SEEDANCE_2_5_RUNWAY_ARCHETYPE,
  MINIMAX_H3_APIMART_ARCHETYPE,
  WAN_2_7_ARCHETYPE,
  WAN_3_0_ARCHETYPE,
  WAN_3_0_APIMART_ARCHETYPE,
  HAILUO_2_3_ARCHETYPE,
  OMNI_FLASH_EXT_ARCHETYPE,
  MINIMAX_H3_REGENERATION_ARCHETYPE,
  HIGGSFIELD_DOP_ARCHETYPE,
  SEEDANCE_VOLCENGINE_ARCHETYPE,
  SEEDANCE_VOLCENGINE_2_5_ARCHETYPE,
  DREAMINA_SEEDANCE_ARCHETYPE,
  DREAMINA_MULTIFRAME_ARCHETYPE,
  RUNNINGHUB_SEEDANCE_ARCHETYPE,
  ...RUNNINGHUB_VIDEO_ARCHETYPES,
  AGNES_VIDEO_ARCHETYPE,
  AGNES_VIDEO_25_ARCHETYPE,
  AGNES_VIDEO_25_FLASH_ARCHETYPE,
  KLING_4_ARCHETYPE,
  KLING_4_FLASH_ARCHETYPE,
  GROK_IMAGINE_VIDEO_15_OFFICIAL_ARCHETYPE,
  PIXVERSE_V6_ARCHETYPE,
  PIXVERSE_V6_MAX_ARCHETYPE,
  FLUX_3_VIDEO_ARCHETYPE,
  MUSE_VIDEO_EXT_ARCHETYPE,
  WAN_3_0_PRIME_APIMART_ARCHETYPE,
  VEO_31_FAST_OFFICIAL_ARCHETYPE,
  VEO_31_QUALITY_OFFICIAL_ARCHETYPE,
  VIDU_Q3_PRO_ARCHETYPE,
  VIDU_Q3_TURBO_ARCHETYPE,
  VIDU_Q4_PREVIEW_ARCHETYPE,
  GEMINI_OMNI_12_FLASH_ARCHETYPE,
  GEMINI_OMNI_12_FLASH_EXT_ARCHETYPE,
];

function controlsFor(model: VideoCatalogModel): ModelParameterControl[] {
  return (model.parameterControls ?? []).map((control) => ({
    ...control,
    options: control.options.map((option) => ({ ...option })),
  }));
}

function unknownExpressionMode(input: {
  id: string;
  intent: ArchetypeIntent;
  vendorTerm: string;
  hint: string;
  slots: ArchetypeMode["slots"];
  promptRequired: boolean;
  transportTaskKind: NonNullable<ArchetypeMode["transportTaskKind"]>;
  params: ModelParameterControl[];
}): ArchetypeMode {
  return {
    ...input,
    expressionChannels: [{ signal: "camera_motion", via: "prompt", status: "unknown" }],
  };
}

/**
 * Conservative profile for a catalog model that has no source-backed profile.
 * It keeps the model usable for the common text/image paths while refusing to
 * invent first/last-frame, omni, motion-reference or native camera support.
 */
export function unknownVideoArchetype(model: VideoCatalogModel): ModelArchetype {
  const params = controlsFor(model);
  return {
    id: `catalog-video-${model.provider}-${model.modelKey}`,
    family: "unknown",
    label: model.label,
    kind: "video",
    defaultModeId: "t2v",
    transportTaskKind: "text_to_video",
    identifierPatterns: [model.modelKey],
    modes: [
      unknownExpressionMode({
        id: "t2v",
        intent: "text",
        vendorTerm: "文生视频",
        hint: "当前模型目录声明的视频生成入口；高级参考能力尚未对账",
        slots: [],
        promptRequired: true,
        transportTaskKind: "text_to_video",
        params,
      }),
      unknownExpressionMode({
        id: "i2v",
        intent: "single",
        vendorTerm: "图生视频",
        hint: "单张参考图驱动；其他参考角色尚未对账",
        slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 1, inputKey: "image_urls" }],
        promptRequired: true,
        transportTaskKind: "image_to_video",
        params,
      }),
    ],
  };
}

/**
 * 一个**模式 id**（`t2v` / `i2v` / `omni` / `firstlast` …）决定了它的任务种类吗？
 *
 * 决定得了：逐档案扫过全部 `modes`，同一个 id 在全仓从来没有映到两个不同的 `transportTaskKind`
 * （有的档案不声明，那就是它的默认，不算分歧）。这个函数**扫出来**这件事，不手抄一张表——
 * 上游新增一个档案、给同一个 id 换了种类，它会当场返回 undefined 而不是给出一个过期答案。
 *
 * 为什么要它（2026-09-22）：模型写了 `modeId: "i2v"` 却没写 `taskKind` 时，我们按提示词**猜**了一个
 * `text_to_video`，然后拿自己猜的那个去和模型**明说**的模式比对，再把冲突算在模型头上
 * （run2 A3/A6 三次，错误正文是「this shot asks for text_to_video」——而模型一个字都没这么说）。
 * 两个字段是同一件事实的两种写法，能 derive 就不该让模型两个都填。
 */
export function transportTaskKindForModeId(modeId: string): string | undefined {
  const wanted = modeId.trim().toLowerCase();
  if (!wanted) return undefined;
  const kinds = new Set<string>();
  for (const archetype of SOURCE_BACKED_PROFILES) {
    for (const mode of archetype.modes ?? []) {
      if (mode.id.trim().toLowerCase() !== wanted) continue;
      const declared = mode.transportTaskKind?.trim();
      if (declared) kinds.add(declared);
    }
  }
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

export function sourceBackedVideoProfiles(): readonly ModelArchetype[] {
  return SOURCE_BACKED_PROFILES;
}
