import type {
  ArchetypeIntent,
  ArchetypeMode,
  ModelArchetype,
  ModelParameterControl,
} from "./types";
import type { VideoModelCandidate } from "./recommendation";
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
import { MINIMAX_H3_ARCHETYPE } from "./minimaxH3";
import { MINIMAX_H3_MAX_ARCHETYPE } from "./minimaxH3Max";
import { MINIMAX_H3_APIMART_ARCHETYPE } from "./minimaxH3Apimart";
import { MINIMAX_H3_REGENERATION_ARCHETYPE } from "./minimaxH3Regeneration";
import { OMNI_FLASH_EXT_ARCHETYPE } from "./omniFlashExt";
import { RUNNINGHUB_SEEDANCE_ARCHETYPE } from "./runninghubSeedance";
import { RUNNINGHUB_VIDEO_ARCHETYPES } from "./runninghubVideoArchetypes";
import { SEEDANCE_2_ARCHETYPE } from "./seedance";
import { SEEDANCE_2_5_ARCHETYPE } from "./seedance25";
import { SEEDANCE_2_5_APIMART_ARCHETYPE } from "./seedance25Apimart";
import { SEEDANCE_2_5_RUNWAY_ARCHETYPE } from "./seedance25Runway";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "./seedanceApimart";
import { SEEDANCE_VOLCENGINE_ARCHETYPE } from "./seedanceVolcengine";
import { SEEDANCE_VOLCENGINE_2_5_ARCHETYPE } from "./seedanceVolcengine25";
import { SORA_2_ARCHETYPE } from "./sora2";
import { VEO_3_1_ARCHETYPE } from "./veo31";
import { GEMINI_OMNI_11_ARCHETYPE } from "./geminiOmni11";
import { RUNWAY_GEN45_ARCHETYPE } from "./runwayGen45";
import { RUNWAY_GEN4_TURBO_ARCHETYPE } from "./runwayGen4Turbo";
import { VIDU_Q3_ARCHETYPE } from "./viduQ3";
import { WAN_2_7_ARCHETYPE } from "./wan27";
import { WAN_3_0_ARCHETYPE } from "./wan30";
import { WAN_3_0_APIMART_ARCHETYPE } from "./wan30Apimart";

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
  SORA_2_ARCHETYPE,
  VEO_3_1_ARCHETYPE,
  GEMINI_OMNI_11_ARCHETYPE,
  RUNWAY_GEN45_ARCHETYPE,
  RUNWAY_GEN4_TURBO_ARCHETYPE,
  KLING_3_ARCHETYPE,
  SEEDANCE_2_APIMART_ARCHETYPE,
  SEEDANCE_2_5_APIMART_ARCHETYPE,
  SEEDANCE_2_5_RUNWAY_ARCHETYPE,
  MINIMAX_H3_APIMART_ARCHETYPE,
  WAN_2_7_ARCHETYPE,
  WAN_3_0_ARCHETYPE,
  WAN_3_0_APIMART_ARCHETYPE,
  HAILUO_2_3_ARCHETYPE,
  OMNI_FLASH_EXT_ARCHETYPE,
  MINIMAX_H3_REGENERATION_ARCHETYPE,
  SEEDANCE_VOLCENGINE_ARCHETYPE,
  SEEDANCE_VOLCENGINE_2_5_ARCHETYPE,
  DREAMINA_SEEDANCE_ARCHETYPE,
  DREAMINA_MULTIFRAME_ARCHETYPE,
  RUNNINGHUB_SEEDANCE_ARCHETYPE,
  ...RUNNINGHUB_VIDEO_ARCHETYPES,
  AGNES_VIDEO_ARCHETYPE,
  AGNES_VIDEO_25_ARCHETYPE,
  AGNES_VIDEO_25_FLASH_ARCHETYPE,
];

/**
 * A loose substring hit must not let a **lower version** capture a **higher version** key.
 * The 10k substring tier is weighted by pattern length, so `bytedance/seedance-2` (20 chars)
 * outscored `seedance-2.5` (12) on the key `bytedance/seedance-2.5` — the resolver handed a
 * 2.5 model the 2.0 profile. The renderer has no substring tier and got this right, so the
 * two resolvers disagreed on exactly this family.
 *
 * Rule: when the pattern already **ends in a digit**, it is version-terminated; a key that
 * continues that version (`.5`, `-5`, `_5`, `5`) is a *different* model, not this one.
 * A pattern that does not end in a digit (`happyhorse`) is a family name, so a version suffix
 * (`happyhorse_1_0`) still belongs to it — that hit stays valid.
 */
function substringHitIsVersionSafe(normalizedKey: string, candidate: string): boolean {
  if (!/[0-9]$/.test(candidate)) return true; // family-name pattern: version suffixes still belong to it
  const at = normalizedKey.indexOf(candidate);
  const rest = normalizedKey.slice(at + candidate.length);
  return !/^[.\-_]?[0-9]/.test(rest);
}

/** 与渲染层 rawIdentifier 同规则（trim + 去 "models/" 前缀）：归一化必须两侧一致，
 * 否则同一身份串会在渲染层（精确趟命中）与这里（掉进忽略大小写的 includes 档）得出不同赢家
 * （2026-09-02 实例："models/MiniMax-H3" 曾在这里丢掉大小写信号、认成 kie 档案）。 */
function stripModelsPrefix(value: string): string {
  const raw = value.trim();
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function modelProfileMatchScore(modelKey: string, profile: ModelArchetype): number {
  const raw = stripModelsPrefix(modelKey);
  const normalized = raw.toLowerCase();
  return profile.identifierPatterns.reduce((best, pattern) => {
    const rawPattern = pattern.trim();
    const candidate = rawPattern.toLowerCase();
    if (!candidate) return best;
    if (raw === rawPattern) return Math.max(best, 30_000 + rawPattern.length);
    if (normalized === candidate) return Math.max(best, 20_000 + candidate.length);
    if (normalized.includes(candidate) && substringHitIsVersionSafe(normalized, candidate)) {
      return Math.max(best, 10_000 + candidate.length);
    }
    return best;
  }, 0);
}

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
function unknownVideoArchetype(model: VideoCatalogModel): ModelArchetype {
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

function profileFor(model: VideoCatalogModel): ModelArchetype {
  const exact = model.archetypeId
    ? SOURCE_BACKED_PROFILES.find((profile) => profile.id === model.archetypeId)
    : undefined;
  if (exact) return exact;
  const ranked = SOURCE_BACKED_PROFILES
    .map((profile) => ({ profile, score: modelProfileMatchScore(model.modelKey, profile) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.profile ?? unknownVideoArchetype(model);
}

function specializeForProvider(archetype: ModelArchetype, provider: string): ModelArchetype {
  if (!archetype.modes.some((mode) => mode.vendorParams?.[provider])) return archetype;
  return {
    ...archetype,
    modes: archetype.modes.map((mode) => {
      const params = mode.vendorParams?.[provider];
      return params ? { ...mode, params } : mode;
    }),
  };
}

function variantFor(model: VideoCatalogModel, archetype: ModelArchetype): string | undefined {
  return archetype.variants?.find((variant) => variant.modelKey === model.modelKey)
    ?.id ?? archetype.defaultVariantId;
}

/**
 * Resolve the current catalog into recommendation candidates. The returned
 * list changes when the user changes provider/model; no provider-name branch
 * or fixed candidate list is required by the recommender.
 */
export function buildVideoModelCandidates(models: readonly VideoCatalogModel[]): VideoModelCandidate[] {
  return models
    .filter((model) => model.provider.trim() && model.modelKey.trim())
    .map((model) => {
      const archetype = specializeForProvider(profileFor(model), model.provider);
      return {
        provider: model.provider,
        modelKey: model.modelKey,
        label: model.label || model.modelKey,
        archetype,
        ...(variantFor(model, archetype) ? { variantId: variantFor(model, archetype) } : {}),
        ...(archetype.variants?.length ? {
          variantChoices: archetype.variants.map((variant) => ({ id: variant.id, label: variant.label, modelKey: variant.modelKey })),
        } : {}),
      };
    });
}

export function sourceBackedVideoProfiles(): readonly ModelArchetype[] {
  return SOURCE_BACKED_PROFILES;
}
