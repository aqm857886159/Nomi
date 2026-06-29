import type { ModelParameterControl } from "../modelCatalogMeta";
import { SEEDANCE_2_ARCHETYPE } from "./seedance";
import { HUNYUAN3D_ARCHETYPE } from "./hunyuan3d";
import { HITEM3D_ARCHETYPE } from "./hitem3d";
import { MESHY6_ARCHETYPE } from "./meshy6";
import { RUNNINGHUB_SEEDANCE_ARCHETYPE } from "./runninghubSeedance";
import { RUNNINGHUB_VIDEO_ARCHETYPES } from "./runninghubVideoArchetypes";
import { RUNNINGHUB_IMAGE_ARCHETYPES } from "./runninghubImageArchetypes";
import { HAPPYHORSE_ARCHETYPE } from "./happyhorse";
import { GPT_IMAGE_2_ARCHETYPE } from "./gptImage2";
import { SEEDREAM_ARCHETYPE } from "./seedream";
import { NANO_BANANA_ARCHETYPE } from "./nanoBanana";
import { KLING_3_ARCHETYPE } from "./kling";
import { QWEN_IMAGE_ARCHETYPE } from "./qwenImage";
import { IMAGEN_4_ARCHETYPE } from "./imagen4";
import { Z_IMAGE_ARCHETYPE } from "./zImage";
import { SORA_2_ARCHETYPE } from "./sora2";
import { VEO_3_1_ARCHETYPE } from "./veo31";
import { WAN_2_7_ARCHETYPE } from "./wan27";
import { HAILUO_2_3_ARCHETYPE } from "./hailuo23";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "./seedanceApimart";
import { OMNI_FLASH_EXT_ARCHETYPE } from "./omniFlashExt";
import { AUDIO_ARCHETYPE } from "./audioArchetype";
import { DOUBAO_TTS_ARCHETYPE } from "./doubaoTtsArchetype";
import { SEED_TTS_ARCHETYPE } from "./seedTtsArchetype";
import { MODELSCOPE_IMAGE_ARCHETYPE, MODELSCOPE_IMAGE_EDIT_ARCHETYPE } from "./modelscopeImage";
import { SEEDREAM_VOLCENGINE_ARCHETYPE } from "./seedreamVolcengine";
import { SEEDANCE_VOLCENGINE_ARCHETYPE } from "./seedanceVolcengine";
import { DREAMINA_SEEDANCE_ARCHETYPE } from "./dreaminaSeedance";
import { DREAMINA_IMAGE_ARCHETYPE } from "./dreaminaImage";
import { DREAMINA_UPSCALE_ARCHETYPE } from "./dreaminaUpscale";
import { DREAMINA_MULTIFRAME_ARCHETYPE } from "./dreaminaMultiframe";
import { AGNES_IMAGE_ARCHETYPE } from "./agnesImage";
import { AGNES_VIDEO_ARCHETYPE } from "./agnesVideo";
import type { ModelArchetype } from "./types";

export type { ModelArchetype, ArchetypeMode, ArchetypeReferenceSlot, ArchetypeReferenceSlotKind, ArchetypeIntent, ModelArchetypeVariant } from "./types";

/** 内置档案注册表。新模型族在这里登记一条。 */
export const MODEL_ARCHETYPES: readonly ModelArchetype[] = [SEEDANCE_2_ARCHETYPE, HAPPYHORSE_ARCHETYPE, GPT_IMAGE_2_ARCHETYPE, SEEDREAM_ARCHETYPE, NANO_BANANA_ARCHETYPE, KLING_3_ARCHETYPE, QWEN_IMAGE_ARCHETYPE, IMAGEN_4_ARCHETYPE, Z_IMAGE_ARCHETYPE, SORA_2_ARCHETYPE, VEO_3_1_ARCHETYPE, WAN_2_7_ARCHETYPE, HAILUO_2_3_ARCHETYPE, SEEDANCE_2_APIMART_ARCHETYPE, OMNI_FLASH_EXT_ARCHETYPE, AUDIO_ARCHETYPE, DOUBAO_TTS_ARCHETYPE, SEED_TTS_ARCHETYPE, MODELSCOPE_IMAGE_ARCHETYPE, MODELSCOPE_IMAGE_EDIT_ARCHETYPE, SEEDREAM_VOLCENGINE_ARCHETYPE, SEEDANCE_VOLCENGINE_ARCHETYPE, DREAMINA_SEEDANCE_ARCHETYPE, DREAMINA_IMAGE_ARCHETYPE, DREAMINA_UPSCALE_ARCHETYPE, DREAMINA_MULTIFRAME_ARCHETYPE, HUNYUAN3D_ARCHETYPE, HITEM3D_ARCHETYPE, MESHY6_ARCHETYPE, RUNNINGHUB_SEEDANCE_ARCHETYPE, ...RUNNINGHUB_VIDEO_ARCHETYPES, ...RUNNINGHUB_IMAGE_ARCHETYPES, AGNES_IMAGE_ARCHETYPE, AGNES_VIDEO_ARCHETYPE];

/** 按 id 取档案。 */
export function getArchetypeById(id: string | null | undefined): ModelArchetype | null {
  if (!id) return null;
  return MODEL_ARCHETYPES.find((a) => a.id === id) || null;
}

/** 归一模型标识：去掉 "models/" 前缀、trim、小写。 */
function normalizeIdentifier(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const noPrefix = raw.startsWith("models/") ? raw.slice("models/".length) : raw;
  return noPrefix.toLowerCase();
}

/** 取标识的末段（去掉 vendor 前缀，如 "bytedance/seedance-2" → "seedance-2"）。 */
function lastSegment(identifier: string): string {
  const idx = identifier.lastIndexOf("/");
  return idx >= 0 ? identifier.slice(idx + 1) : identifier;
}

function identifierMatchesPattern(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  if (!id || !pat) return false;
  // 整串相等，或「去掉 vendor 前缀后的末段」相等 —— 故 seedance-2 不会误命中 seedance-2-fast。
  return id === pat || lastSegment(id) === lastSegment(pat);
}

export type ArchetypeModelLike = {
  modelKey?: string | null;
  modelAlias?: string | null;
  /** B 档案分层：按供应商特化 params（见 specializeArchetypeForVendor）。缺省=不特化（向后兼容）。 */
  vendorKey?: string | null;
  meta?: unknown;
};

function readArchetypeIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as { archetypeId?: unknown }).archetypeId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 解析一个 catalog 模型对应的档案 —— **供应商无关**，这是「换任意供应商也能用模板」的核心。
 * 顺序：
 *   1. meta.archetypeId 显式指定（我们 seed 的模型 / 已识别并落库的）→ 直接取。
 *   2. 否则按模型身份（modelKey / 别名）匹配 identifierPatterns —— 任何人经任何供应商接入
 *      同一个模型都会命中，不依赖 kie。
 *   3. 都不中 → null（渲染层走「通用」回退，按接入文档原样展示，不藏能力）。
 */
export function resolveArchetypeForModel(model: ArchetypeModelLike | null | undefined): ModelArchetype | null {
  if (!model) return null;
  const base = resolveBaseArchetype(model);
  return base ? specializeArchetypeForVendor(base, model.vendorKey) : null;
}

/** 解析「基础」档案（供应商无关，未特化）：显式 archetypeId 优先，否则按身份匹配 pattern。 */
function resolveBaseArchetype(model: ArchetypeModelLike): ModelArchetype | null {
  const explicit = getArchetypeById(readArchetypeIdFromMeta(model.meta));
  if (explicit) return explicit;
  const identifiers = [model.modelKey, model.modelAlias].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  for (const archetype of MODEL_ARCHETYPES) {
    for (const identifier of identifiers) {
      if (archetype.identifierPatterns.some((pattern) => identifierMatchesPattern(identifier, pattern))) {
        return archetype;
      }
    }
  }
  return null;
}

/**
 * B 档案分层（用户拍板 2026-06-07）：把档案的 modes.params 替换成该供应商的覆盖版（mode.vendorParams[vendorKey]）。
 * 身份/能力形状（id/family/label/modes 结构/slots）不变——只 params 这层分供应商（P4）。
 * 无 vendorKey、或没有任何模式为该供应商声明 vendorParams → 原样返回（绝大多数情况，零开销）。
 */
export function specializeArchetypeForVendor(archetype: ModelArchetype, vendorKey: string | null | undefined): ModelArchetype {
  const key = typeof vendorKey === "string" ? vendorKey.trim() : "";
  if (!key) return archetype;
  if (!archetype.modes.some((m) => m.vendorParams && m.vendorParams[key])) return archetype;
  return {
    ...archetype,
    modes: archetype.modes.map((m) => {
      const vp = m.vendorParams?.[key];
      return vp ? { ...m, params: vp } : m;
    }),
  };
}

/**
 * **变体特化（A 变体轴的运行时叠加）**：把档案各 mode 的 params 按选中变体的 paramOverrides 收窄
 * （如 Seedance fast 变体的 resolution 仅 480/720）。仿 specializeArchetypeForVendor —— 身份/能力形状
 * （id/family/label/modes 结构/slots）不变，只 params 这层按变体叠加。无 variants、变体无 paramOverrides、
 * 或变体不存在 → 原样返回（零开销）。**纯函数**，渲染读取点与构造层共用，保证 UI 选项收窄与发送一致。
 */
export function specializeArchetypeForVariant(archetype: ModelArchetype, variantId: string | null | undefined): ModelArchetype {
  if (!archetype.variants || archetype.variants.length === 0) return archetype;
  const targetId = typeof variantId === "string" && variantId.trim() ? variantId.trim() : archetype.defaultVariantId;
  const variant = archetype.variants.find((v) => v.id === targetId);
  const overrides = variant?.paramOverrides;
  if (!overrides) return archetype;
  return {
    ...archetype,
    modes: archetype.modes.map((m) => {
      const fn = overrides[m.id];
      return fn ? { ...m, params: fn(m.params) } : m;
    }),
  };
}

/**
 * 认得的模型 → 该档案默认模式的参数控件（ModelParameterControl[]，复用现有控件类型）；
 * 认不出 → null（调用方走现有 flat 解析）。供 model-options 适配层把它注入到 option.meta，
 * 让现有渲染路径不变就能渲染档案控件。**供应商无关**（resolveArchetypeForModel 只看模型身份）。
 */
export function archetypeParameterControls(model: ArchetypeModelLike | null | undefined): ModelParameterControl[] | null {
  const archetype = resolveArchetypeForModel(model);
  if (!archetype) return null;
  // 默认变体特化（variants 档案的默认变体可能收窄某 mode 的参数，如 Seedance 标准变体不收窄、fast 收窄）。
  const specialized = specializeArchetypeForVariant(archetype, archetype.defaultVariantId);
  const mode = specialized.modes.find((m) => m.id === specialized.defaultModeId) ?? specialized.modes[0];
  return mode ? mode.params : null;
}
