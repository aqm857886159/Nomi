import type { ModelParameterControl } from "../modelCatalogMeta";
// Video archetypes are defined in electron/shared/videoCapabilities (canonical home,
// shared with main-process planning). The renderer takes the whole video set from that
// single barrel's registry (sourceBackedVideoProfiles) instead of naming each profile —
// adding a video model touches the electron side only (profile file + registry line);
// this file does not change (二期档案归一：清双登记，35 个 video 档案不再手列第二份).
import { sourceBackedVideoProfiles } from "../../../electron/shared/videoCapabilities";
import { HUNYUAN3D_ARCHETYPE } from "./hunyuan3d";
import { HITEM3D_ARCHETYPE } from "./hitem3d";
import { MESHY6_ARCHETYPE } from "./meshy6";
import { RUNNINGHUB_IMAGE_ARCHETYPES } from "./runninghubImageArchetypes";
import { GPT_IMAGE_2_ARCHETYPE } from "./gptImage2";
import { SEEDREAM_ARCHETYPE } from "./seedream";
import { NANO_BANANA_ARCHETYPE } from "./nanoBanana";
import { NANO_BANANA_2_ARCHETYPE, NANO_BANANA_2_LITE_ARCHETYPE } from "./nanoBanana2";
import { KIE_SEEDREAM_5_LITE_ARCHETYPE, KIE_SEEDREAM_5_PRO_ARCHETYPE } from "./kieSeedream5";
import { FLUX_2_PRO_ARCHETYPE } from "./flux2Pro";
import { QWEN_IMAGE_ARCHETYPE } from "./qwenImage";
import { QWEN_IMAGE_3_ARCHETYPE } from "./qwenImage3";
import { IMAGEN_4_ARCHETYPE } from "./imagen4";
import { Z_IMAGE_ARCHETYPE } from "./zImage";
import { SEEDREAM_5_PRO_ARCHETYPE } from "./seedream5Pro";
import { AUDIO_ARCHETYPE } from "./audioArchetype";
import { DOUBAO_TTS_ARCHETYPE } from "./doubaoTtsArchetype";
import { SEED_TTS_ARCHETYPE } from "./seedTtsArchetype";
import { MODELSCOPE_IMAGE_ARCHETYPE, MODELSCOPE_IMAGE_EDIT_ARCHETYPE } from "./modelscopeImage";
import { SEEDREAM_VOLCENGINE_ARCHETYPE } from "./seedreamVolcengine";
import { SEEDREAM_VOLCENGINE_5_PRO_ARCHETYPE } from "./seedreamVolcengine5Pro";
import { DREAMINA_IMAGE_ARCHETYPE } from "./dreaminaImage";
import { DREAMINA_UPSCALE_ARCHETYPE } from "./dreaminaUpscale";
import { AGNES_IMAGE_ARCHETYPE, AGNES_IMAGE_21_ARCHETYPE } from "./agnesImage";
import { ANTIGRAVITY_IMAGE_ARCHETYPE } from "./antigravityImage";
import { CODEX_IMAGEGEN_ARCHETYPE } from "./codexImagegen";
import { SUNO_V55_ARCHETYPE, SUNO_SFX_V55_ARCHETYPE } from "./sunoAudio";
import { LYRIA_35_ARCHETYPE } from "./lyria35";
import { MINIMAX_SPEECH_28_ARCHETYPE } from "./minimaxSpeech28";
import { ELEVEN_MUSIC_V2_ARCHETYPE, ELEVEN_SCRIBE_V2_ARCHETYPE, ELEVEN_SFX_V2_ARCHETYPE, ELEVEN_V3_ARCHETYPE } from "./elevenAudio";
import { MESHY_7_ARCHETYPE } from "./meshy7";
import { MINIMAX_MUSIC_3_ARCHETYPE } from "./minimaxMusic3";
import { RUNWAY_IMAGE_ARCHETYPE, RUNWAY_IMAGE_REFERENCE_ARCHETYPE } from "./runwayImage";
import { RUNWAY_AUDIO_ARCHETYPE } from "./runwayAudio";
import type { ModelArchetype } from "./types";
import { customCapabilityArchetypeForModel } from "./customCapabilityContract";

export type { ModelArchetype, ArchetypeMode, ArchetypeReferenceSlot, ArchetypeReferenceSlotKind, ArchetypeExpressionChannel, ArchetypeIntent, ArchetypeTransportTaskKind, ModelArchetypeVariant } from "./types";
export { recommendVideoGeneration } from "../../../electron/shared/videoCapabilities";
export type {
  VideoGenerationRecommendation,
  VideoGenerationRecommendationInput,
  VideoGenerationRecommendationResult,
  VideoModelCandidate,
  VideoReferenceInput,
} from "../../../electron/shared/videoCapabilities";
export {
  CUSTOM_CAPABILITY_CONTRACT_META_KEY,
  CUSTOM_CAPABILITY_CONTRACT_VERSION,
  normalizeCustomCapabilityContract,
  parseCustomCapabilityContract,
  replaceCustomCapabilityContractMeta,
} from "./customCapabilityContract";
export type { CustomCapabilityContractV1, CustomCapabilityModeV1 } from "./customCapabilityContract";

/**
 * 内置档案注册表。登记处按 kind 分家（一功能一个家）：
 * - video → electron/shared/videoCapabilities/registry.ts 的 SOURCE_BACKED_PROFILES（唯一登记点，
 *   渲染层整块派生，不再手列第二份——接一个 video 模型只碰 electron 侧：档案文件 + registry 一行）；
 * - image / audio / 3D → 本文件下方的非 video 列表登记一条。
 * 顺序即三趟身份匹配的同趟决胜顺序（见 resolveBaseArchetype）；video 块的顺序就是 registry
 * 声明序——渲染层与 registry 平局判据共用同一份决胜序，同一身份串两侧永远同一个赢家
 * （2026-09-02 修复 "veo3.1" 同串双身份后不再有任何 legacy pin）。跨档案同串的赢家由
 * resolutionOrder.test.ts 锁死，重排/新增若翻转任何赢家该测试即红。
 */
export const MODEL_ARCHETYPES: readonly ModelArchetype[] = [
  ...sourceBackedVideoProfiles(),
  MINIMAX_MUSIC_3_ARCHETYPE, MINIMAX_SPEECH_28_ARCHETYPE, ELEVEN_V3_ARCHETYPE, ELEVEN_MUSIC_V2_ARCHETYPE, ELEVEN_SFX_V2_ARCHETYPE, ELEVEN_SCRIBE_V2_ARCHETYPE, MESHY_7_ARCHETYPE, RUNWAY_IMAGE_REFERENCE_ARCHETYPE, RUNWAY_IMAGE_ARCHETYPE, RUNWAY_AUDIO_ARCHETYPE, GPT_IMAGE_2_ARCHETYPE, SEEDREAM_ARCHETYPE, KIE_SEEDREAM_5_PRO_ARCHETYPE, KIE_SEEDREAM_5_LITE_ARCHETYPE, NANO_BANANA_2_ARCHETYPE, NANO_BANANA_2_LITE_ARCHETYPE, NANO_BANANA_ARCHETYPE, FLUX_2_PRO_ARCHETYPE, QWEN_IMAGE_3_ARCHETYPE, QWEN_IMAGE_ARCHETYPE, IMAGEN_4_ARCHETYPE, Z_IMAGE_ARCHETYPE, SEEDREAM_5_PRO_ARCHETYPE, AUDIO_ARCHETYPE, SUNO_V55_ARCHETYPE, SUNO_SFX_V55_ARCHETYPE, LYRIA_35_ARCHETYPE, DOUBAO_TTS_ARCHETYPE, SEED_TTS_ARCHETYPE, MODELSCOPE_IMAGE_ARCHETYPE, MODELSCOPE_IMAGE_EDIT_ARCHETYPE, SEEDREAM_VOLCENGINE_ARCHETYPE, SEEDREAM_VOLCENGINE_5_PRO_ARCHETYPE, DREAMINA_IMAGE_ARCHETYPE, DREAMINA_UPSCALE_ARCHETYPE, CODEX_IMAGEGEN_ARCHETYPE, ANTIGRAVITY_IMAGE_ARCHETYPE, HUNYUAN3D_ARCHETYPE, HITEM3D_ARCHETYPE, MESHY6_ARCHETYPE, ...RUNNINGHUB_IMAGE_ARCHETYPES, AGNES_IMAGE_ARCHETYPE, AGNES_IMAGE_21_ARCHETYPE,
];

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

/** 去掉 models/ 前缀但保留原始大小写；APIMart/KIE 的同名模型靠大小写区分官方 key。 */
function rawIdentifier(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

/** 取标识的末段（去掉 vendor 前缀，如 "bytedance/seedance-2" → "seedance-2"）。 */
function lastSegment(identifier: string): string {
  const idx = identifier.lastIndexOf("/");
  return idx >= 0 ? identifier.slice(idx + 1) : identifier;
}

/**
 * 匹配分两档，**精确整串永远优先于末段**（见 resolveBaseArchetype 的两趟解析）。
 * 只认相等、不认前缀：故 seedance-2 不会误命中 seedance-2-fast。
 * ⚠️ 规则与 electron/catalog/archetypeIdentity 逐字对齐，改一处必改两处。
 */
function matchesExact(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && id === pat;
}

function matchesCaseExact(identifier: string, pattern: string): boolean {
  const id = rawIdentifier(identifier);
  const pat = rawIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && id === pat;
}

/** 去掉 vendor 前缀后末段相等（"bytedance/seedance-2" ↔ "seedance-2"）。 */
function matchesLastSegment(identifier: string, pattern: string): boolean {
  const id = normalizeIdentifier(identifier);
  const pat = normalizeIdentifier(pattern);
  return Boolean(id) && Boolean(pat) && lastSegment(id) === lastSegment(pat);
}

export type ArchetypeModelLike = {
  modelKey?: string | null;
  modelAlias?: string | null;
  /**
   * 模型所属供应商 —— **必传**（值可为 null=未知）。B 档案分层按它特化 params
   * （见 specializeArchetypeForVendor）。必传是结构保证：曾有 5 个调用点漏传 →
   * 发送路拿到的是未特化档案、与 UI 侧（传了 vendor）分裂；类型层逼所有调用点显式表态。
   * 注意：vendor **不改变**解析结果（供应商无关识别是设计特性——seed-tts/中转 Seedance
   * 等档案就是给任意中转用的）；中转与内置家的传输差异由「标准参考面永远在场」不变量吸收
   * （见 catalogTaskActions.buildReferenceExtras / electron referenceInputParams，2026-07-24）。
   */
  vendorKey: string | null | undefined;
  meta?: unknown;
};

function readArchetypeIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const record = meta as { archetypeId?: unknown; archetype?: unknown };
  // catalog 模型行使用 meta.archetypeId；画布节点持久化使用 meta.archetype.id。
  // 两者必须由同一个解析入口识别，否则会出现「连线侧已切改图，发送侧却认不出档案」的分裂。
  const direct = record.archetypeId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = record.archetype;
  if (nested && typeof nested === "object") {
    const id = (nested as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

/**
 * 解析一个 catalog 模型对应的档案 —— **供应商无关**，这是「换任意供应商也能用模板」的核心。
 * 顺序：
 *   1. meta.archetypeId（catalog 模型）或 meta.archetype.id（画布节点）显式指定 → 直接取。
 *   2. 否则按模型身份（modelKey / 别名）匹配 identifierPatterns —— 任何人经任何供应商接入
 *      同一个模型都会命中，不依赖 kie。
 *   3. 都不中 → null（渲染层走「通用」回退，按接入文档原样展示，不藏能力）。
 * 传输侧前提（2026-07-24 修正）：档案投影**叠加**在标准参考面之上、不得独占参考通道——
 * 自定义中转的模板只认标准键（reference_images/chat_image_parts/image_url），吞掉它们会让
 * 中转上撞档案名的模型改图不带图（群反馈根因）。该不变量钉在 buildReferenceExtras +
 * referenceInputParams，两处测试锁死；本函数保持纯识别、不做 vendor 门。
 */
export function resolveArchetypeForModel(model: ArchetypeModelLike | null | undefined): ModelArchetype | null {
  if (!model) return null;
  const base = resolveBaseArchetype(model);
  return base ? specializeArchetypeForVendor(base, model.vendorKey) : null;
}

/** 解析「基础」档案（供应商无关，未特化）：显式 archetypeId 优先，否则按身份匹配 pattern。 */
function resolveBaseArchetype(model: ArchetypeModelLike): ModelArchetype | null {
  // A valid user-authored capability contract is the most explicit source of truth. It is
  // deliberately parsed before curated identity matching; invalid/unknown versions are inert
  // and fall through to the existing curated resolution path.
  const custom = customCapabilityArchetypeForModel(model);
  if (custom) return custom;
  const explicit = getArchetypeById(readArchetypeIdFromMeta(model.meta));
  const identifiers = [model.modelKey, model.modelAlias].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (explicit) {
    // A formerly shared profile may split by model version. Migrate only a declared
    // legacy ID with matching model identity; other explicit/user profiles keep priority.
    const migrated = MODEL_ARCHETYPES.find((candidate) => candidate.legacyIds?.includes(explicit.id)
      && identifiers.some((identifier) => candidate.identifierPatterns.some((pattern) => matchesLastSegment(identifier, pattern))));
    return migrated ?? explicit;
  }
  // **三趟**：先保留官方 key 的大小写做精确命中，再做大小写不敏感的整串命中，最后才找末段。
  // APIMart 的 `MiniMax-H3` 与 KIE 的 `minimax-h3` 归一后同名，但实际是两条不同线缆；
  // 先看原始 key 才不会让一个供应商的档案抢走另一个供应商的报文契约。单趟会让结果取决于档案声明顺序
  // （实测「Tongyi-MAI/Z-Image-Turbo」被排在前面的 z-image-turbo 档案靠末段抢走 = 认错模型、参数全错）。
  for (const match of [matchesCaseExact, matchesExact, matchesLastSegment]) {
    for (const archetype of MODEL_ARCHETYPES) {
      for (const identifier of identifiers) {
        if (archetype.identifierPatterns.some((pattern) => match(identifier, pattern))) return archetype;
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
  const requestedId = typeof variantId === "string" && variantId.trim() ? variantId.trim() : archetype.defaultVariantId;
  const targetId = (requestedId && archetype.variantIdAliases?.[requestedId]) || requestedId;
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
