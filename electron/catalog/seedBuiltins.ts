// 内置模型种子：把策展模型按 curated 定义写进 catalog，而不是靠用户逐个 onboarding（评审 D2「混合：内置优先」）。
//
// 设计：纯函数 `applyBuiltinSeeds(state) → { state, changed }`，**幂等**且**存在即跳过/漂移自愈**。
//   - 用户已手动接过 / 改过这些记录，不会被覆盖（enabled/labelZh/createdAt = 用户所有，保留）；
//   - 代码所有字段（kind/archetypeId/create/query/statusMapping/taskKind）随代码演进强制对账，老装机自愈；
//   - 反复调用安全（runtime 在 catalog 载入后调用一次，changed 才落盘）。
// type-only 复用 runtime 的领域类型，避免第二份定义漂移（评审 P0-3/M1）。
//
// **多供应商泛化（2026-06-07，以 apimart 为核心变现通道）**：模型/mapping 的 insert+对账抽成
// reconcileModels/reconcileMappings 两个**供应商无关**的纯函数，kie 与 apimart 各调一遍同一套逻辑
// （P1：不开并行版）。GPT Image 2 的视频形状坏 mapping repair 是 kie 历史包袱，仍 kie 专属。

import type { CatalogState, HttpOperation, Mapping, Model, Vendor } from "./types";
// 身份与分档表住在隔壁（表随模型雷达增删，对账逻辑几乎不动 —— 两者变更理由不同）。
import { CANONICAL_MODEL_IDS, curatedCatalogLifecycle } from "./seedModelIdentity";
import {
  KIE_VENDOR_SEED,
  SEEDANCE_2_CREATE_OP,
  SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING,
  SEEDANCE_2_TEXT_TO_VIDEO_MAPPING,
  SEEDANCE_2_MODEL_SEED,
  SEEDANCE_2_QUERY_OP,
} from "./kieSeedance";
import { HAPPYHORSE_CREATE_OP, HAPPYHORSE_MAPPING, HAPPYHORSE_MODEL_SEED, HAPPYHORSE_QUERY_OP } from "./kieHappyhorse";
import {
  GPT_IMAGE_2_I2I_MAPPING,
  GPT_IMAGE_2_I2I_MODEL_SEED,
  GPT_IMAGE_2_T2I_MAPPING,
  GPT_IMAGE_2_T2I_MODEL_SEED,
  isBrokenKieImageMapping,
} from "./kieGptImage2";
import { SEEDREAM_EDIT_MAPPING, SEEDREAM_MODEL_SEED, SEEDREAM_T2I_MAPPING } from "./kieSeedream";
import { NANO_BANANA_EDIT_MAPPING, NANO_BANANA_MODEL_SEED, NANO_BANANA_T2I_MAPPING } from "./kieNanoBanana";
import { KIE_IMAGE_2026_QUERY, KIE_IMAGE_2026_STATUS, KIE_IMAGE_MODELS_2026 } from "./kieImages2026";
import { KLING_3_I2V_MAPPING, KLING_3_MODEL_SEED, KLING_3_T2V_MAPPING } from "./kieKling";
import { MINIMAX_H3_CREATE_OP, MINIMAX_H3_MAPPING, MINIMAX_H3_MODEL_SEED, MINIMAX_H3_QUERY_OP } from "./kieMiniMaxH3";
import {
  SEEDANCE_2_5_CREATE_OP,
  SEEDANCE_2_5_IMAGE_TO_VIDEO_MAPPING,
  SEEDANCE_2_5_MODEL_SEED,
  SEEDANCE_2_5_QUERY_OP,
  SEEDANCE_2_5_TEXT_TO_VIDEO_MAPPING,
} from "./kieSeedance25";
import {
  WAN_3_0_CREATE_OP,
  WAN_3_0_IMAGE_TO_VIDEO_MAPPING,
  WAN_3_0_MODEL_SEED,
  WAN_3_0_QUERY_OP,
  WAN_3_0_TEXT_TO_VIDEO_MAPPING,
} from "./kieWan30";
import { APIMART_VENDOR_SEED } from "./apimartVendor";
import { APIMART_IMAGE_MODELS, APIMART_IMAGE_QUERY, APIMART_IMAGE_STATUS } from "./apimartImages";
import { APIMART_VIDEO_MODELS, APIMART_VIDEO_QUERY, APIMART_VIDEO_STATUS } from "./apimartVideos";
import { APIMART_AUDIO_MODELS } from "./apimartAudios";
import { APIMART_TEXT_MAPPINGS, APIMART_TEXT_MODELS } from "./apimartTexts";
import { AGNES_VENDOR_SEED, AGNES_STATUS_MAPPING } from "./agnesVendor";
import { AGNES_IMAGE_MODELS } from "./agnesImages";
import { AGNES_VIDEO_MODELS } from "./agnesVideos";
import { AGNES_TEXT_MODELS } from "./agnesTexts";
import { MODELSCOPE_VENDOR_SEED } from "./modelscopeVendor";
import { MODELSCOPE_IMAGE_MODELS, MODELSCOPE_IMAGE_QUERY, MODELSCOPE_IMAGE_STATUS } from "./modelscopeImages";
import { MODELSCOPE_TEXT_MODELS } from "./modelscopeTexts";
import { VOLCENGINE_VENDOR_SEED, VOLCENGINE_SPEECH_VENDOR_SEED } from "./volcengineVendor";
import { BUILTIN_VENDOR_SEEDS, builtinVendorSeed, type VendorSeed } from "./builtinVendorSeeds";
import { DREAMINA_VENDOR_SEED } from "./dreaminaVendor";
import { DREAMINA_CURATED_MODELS, DREAMINA_CURATED_MAPPINGS } from "./dreaminaVideos";
import { DREAMINA_IMAGE_CURATED_MODELS, DREAMINA_IMAGE_CURATED_MAPPINGS } from "./dreaminaImages";
import { RUNNINGHUB_VENDOR_SEED, RUNNINGHUB_3D_CURATED_MODELS, RUNNINGHUB_3D_CURATED_MAPPINGS } from "./runninghub3d";
import { RUNNINGHUB_VIDEO_CURATED_MODELS, RUNNINGHUB_VIDEO_CURATED_MAPPINGS } from "./runninghubVideos";
import { RUNNINGHUB_IMAGE_CURATED_MODELS, RUNNINGHUB_IMAGE_CURATED_MAPPINGS } from "./runninghubImages";
import { COMFYUI_VENDOR_SEED, COMFYUI_CURATED_MODELS, COMFYUI_CURATED_MAPPINGS } from "./comfyuiLocal";
import { CODEX_LOCAL_VENDOR_SEED, CODEX_IMAGE_CURATED_MODELS, CODEX_IMAGE_CURATED_MAPPINGS } from "./codexImages";
import { VOLCENGINE_IMAGE_MODELS } from "./volcengineImages";
import { VOLCENGINE_AUDIO_MODELS } from "./volcengineAudios";
import { VOLCENGINE_SEEDANCE_QUERY_OP, VOLCENGINE_SEEDANCE_STATUS_MAPPING, VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";
import { modelHasPublishedExecution } from "../shared/modelPublication";
import { GEMINI_OMNI_11_MAPPINGS, GEMINI_OMNI_11_MODEL_SEED } from "./kieGeminiOmni11";
import { KIE_SUNO_MUSIC_MAPPINGS, KIE_SUNO_MUSIC_MODEL_SEED, KIE_SUNO_SFX_MAPPING, KIE_SUNO_SFX_MODEL_SEED } from "./kieSunoAudio";
import { MINIMAX_OFFICIAL_MODELS, MINIMAX_VENDOR_SEED } from "./minimaxOfficial";
import { ELEVENLABS_MODELS, ELEVENLABS_VENDOR_SEED } from "./elevenlabs";
import { MESHY_MODELS, MESHY_VENDOR_SEED } from "./meshyOfficial";
import { FAL_OFFICIAL_MODELS, FAL_VENDOR_SEED } from "./falOfficial";
import { RUNWAY_OFFICIAL_MODELS, RUNWAY_VENDOR_SEED } from "./runwayOfficial";

/** curated 模型/mapping 的内部类型（reconcile 两函数的输入）。 */
type CuratedModel = {
  modelKey: string;
  labelZh: string;
  kind: Model["kind"];
  archetypeId?: string;
  /** 代码所有的额外 meta（如 ComfyUI 长尾 workflow 的 parameters 动态控件）；与 archetypeId 合并进 meta。 */
  meta?: Record<string, unknown>;
  /** 按 token 计费的价目（USD / 每百万 token）。代码所有，随 seed 对账自愈。 */
  tokenPricing?: Model["tokenPricing"];
  /** 显式不按 token 计费。与 `tokenPricing` 互斥（`check:archetype-sources` 的价目段守着）。 */
  free?: true;
};
type CuratedMapping = {
  id: string;
  taskKind: Mapping["taskKind"];
  modelKey?: string;
  modeId?: string;
  name: string;
  create: HttpOperation;
  query?: HttpOperation;
  result?: HttpOperation;
  statusMapping?: Mapping["statusMapping"];
};

/** 稳定 id：按 (vendor, taskKind, model) 固定，便于幂等与排查。 */
const SEEDANCE_MAPPING_ID = "seed-kie-seedance2-image_to_video";
const SEEDANCE_T2V_MAPPING_ID = "seed-kie-seedance2-text_to_video";
const HAPPYHORSE_MAPPING_ID = "seed-kie-happyhorse-text_to_video";
const GPT_IMAGE_2_T2I_MAPPING_ID = "seed-kie-gpt-image-2-text_to_image";
const GPT_IMAGE_2_I2I_MAPPING_ID = "seed-kie-gpt-image-2-image_edit";
const SEEDREAM_T2I_MAPPING_ID = "seed-kie-seedream-text_to_image";
const SEEDREAM_EDIT_MAPPING_ID = "seed-kie-seedream-image_edit";
const NANO_BANANA_T2I_MAPPING_ID = "seed-kie-nano-banana-text_to_image";
const NANO_BANANA_EDIT_MAPPING_ID = "seed-kie-nano-banana-image_edit";
const KLING_3_T2V_MAPPING_ID = "seed-kie-kling-3-text_to_video";
const KLING_3_I2V_MAPPING_ID = "seed-kie-kling-3-image_to_video";
const MINIMAX_H3_MAPPING_ID = "seed-kie-minimax-h3-text_to_video";
const SEEDANCE_2_5_T2V_MAPPING_ID = "seed-kie-seedance2-5-text_to_video";
const SEEDANCE_2_5_I2V_MAPPING_ID = "seed-kie-seedance2-5-image_to_video";
const WAN_3_0_T2V_MAPPING_ID = "seed-kie-wan3-0-text_to_video";
const WAN_3_0_I2V_MAPPING_ID = "seed-kie-wan3-0-image_to_video";

/** kie 的 curated 内置模型（archetypeId = 能力档案指针，代码所有；enabled/labelZh = 用户所有）。 */
const KIE_CURATED_MODELS: CuratedModel[] = [
  { modelKey: SEEDANCE_2_MODEL_SEED.modelKey, labelZh: SEEDANCE_2_MODEL_SEED.labelZh, kind: SEEDANCE_2_MODEL_SEED.kind, archetypeId: "seedance-2" },
  { modelKey: HAPPYHORSE_MODEL_SEED.modelKey, labelZh: HAPPYHORSE_MODEL_SEED.labelZh, kind: HAPPYHORSE_MODEL_SEED.kind, archetypeId: "happyhorse" },
  { modelKey: GPT_IMAGE_2_T2I_MODEL_SEED.modelKey, labelZh: GPT_IMAGE_2_T2I_MODEL_SEED.labelZh, kind: GPT_IMAGE_2_T2I_MODEL_SEED.kind, archetypeId: "gpt-image-2" },
  { modelKey: GPT_IMAGE_2_I2I_MODEL_SEED.modelKey, labelZh: GPT_IMAGE_2_I2I_MODEL_SEED.labelZh, kind: GPT_IMAGE_2_I2I_MODEL_SEED.kind, archetypeId: "gpt-image-2" },
  { modelKey: SEEDREAM_MODEL_SEED.modelKey, labelZh: SEEDREAM_MODEL_SEED.labelZh, kind: SEEDREAM_MODEL_SEED.kind, archetypeId: "seedream" },
  { modelKey: NANO_BANANA_MODEL_SEED.modelKey, labelZh: NANO_BANANA_MODEL_SEED.labelZh, kind: NANO_BANANA_MODEL_SEED.kind, archetypeId: "nano-banana" },
  { modelKey: KLING_3_MODEL_SEED.modelKey, labelZh: KLING_3_MODEL_SEED.labelZh, kind: KLING_3_MODEL_SEED.kind, archetypeId: "kling-3.0" },
  { modelKey: MINIMAX_H3_MODEL_SEED.modelKey, labelZh: MINIMAX_H3_MODEL_SEED.labelZh, kind: MINIMAX_H3_MODEL_SEED.kind, archetypeId: "minimax-h3" },
  { modelKey: SEEDANCE_2_5_MODEL_SEED.modelKey, labelZh: SEEDANCE_2_5_MODEL_SEED.labelZh, kind: SEEDANCE_2_5_MODEL_SEED.kind, archetypeId: "seedance-2.5" },
  // Wan 3.0：catalog 只有 **1 行**（标准版）；高速版 wan/3-0-video-prime 由档案 variants 暴露
  // （契约逐项相同 → 变体而非第二行，见 wan30.ts 注释）。
  { modelKey: WAN_3_0_MODEL_SEED.modelKey, labelZh: WAN_3_0_MODEL_SEED.labelZh, kind: WAN_3_0_MODEL_SEED.kind, archetypeId: "wan-3.0" },
  // 2026-08 代图像（表驱动单源，见 kieImages2026）：Nano Banana 2 / 2 Lite、Seedream 5.0 Pro / Lite、FLUX.2 Pro。
  ...KIE_IMAGE_MODELS_2026.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "image" as const, archetypeId: m.archetypeId })),
  { ...GEMINI_OMNI_11_MODEL_SEED, archetypeId: "gemini-omni-1.1" },
  { ...KIE_SUNO_MUSIC_MODEL_SEED, archetypeId: "suno-v5.5" },
  { ...KIE_SUNO_SFX_MODEL_SEED, archetypeId: "suno-sfx-v5.5" },
];

/** kie 的 curated mapping（单源；create/query/statusMapping = 代码所有，强制对账）。 */
const KIE_CURATED_MAPPINGS: CuratedMapping[] = [
  { id: SEEDANCE_MAPPING_ID, taskKind: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.taskKind, name: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.name, create: SEEDANCE_2_CREATE_OP, query: SEEDANCE_2_QUERY_OP },
  // 文生视频（2026-06-30 补：kie 文档实证 Seedance 支持纯 prompt 出片，此前漏接 → 无文生视频 tab）。复用同 create/query op。
  { id: SEEDANCE_T2V_MAPPING_ID, taskKind: SEEDANCE_2_TEXT_TO_VIDEO_MAPPING.taskKind, name: SEEDANCE_2_TEXT_TO_VIDEO_MAPPING.name, create: SEEDANCE_2_CREATE_OP, query: SEEDANCE_2_QUERY_OP },
  { id: HAPPYHORSE_MAPPING_ID, taskKind: HAPPYHORSE_MAPPING.taskKind, modelKey: HAPPYHORSE_MODEL_SEED.modelKey, name: HAPPYHORSE_MAPPING.name, create: HAPPYHORSE_CREATE_OP, query: HAPPYHORSE_QUERY_OP },
  { id: GPT_IMAGE_2_T2I_MAPPING_ID, taskKind: GPT_IMAGE_2_T2I_MAPPING.taskKind, name: GPT_IMAGE_2_T2I_MAPPING.name, create: GPT_IMAGE_2_T2I_MAPPING.create, query: GPT_IMAGE_2_T2I_MAPPING.query, statusMapping: GPT_IMAGE_2_T2I_MAPPING.statusMapping },
  { id: GPT_IMAGE_2_I2I_MAPPING_ID, taskKind: GPT_IMAGE_2_I2I_MAPPING.taskKind, name: GPT_IMAGE_2_I2I_MAPPING.name, create: GPT_IMAGE_2_I2I_MAPPING.create, query: GPT_IMAGE_2_I2I_MAPPING.query, statusMapping: GPT_IMAGE_2_I2I_MAPPING.statusMapping },
  { id: SEEDREAM_T2I_MAPPING_ID, taskKind: SEEDREAM_T2I_MAPPING.taskKind, modelKey: SEEDREAM_T2I_MAPPING.modelKey, name: SEEDREAM_T2I_MAPPING.name, create: SEEDREAM_T2I_MAPPING.create, query: SEEDREAM_T2I_MAPPING.query, statusMapping: SEEDREAM_T2I_MAPPING.statusMapping },
  { id: SEEDREAM_EDIT_MAPPING_ID, taskKind: SEEDREAM_EDIT_MAPPING.taskKind, modelKey: SEEDREAM_EDIT_MAPPING.modelKey, name: SEEDREAM_EDIT_MAPPING.name, create: SEEDREAM_EDIT_MAPPING.create, query: SEEDREAM_EDIT_MAPPING.query, statusMapping: SEEDREAM_EDIT_MAPPING.statusMapping },
  { id: NANO_BANANA_T2I_MAPPING_ID, taskKind: NANO_BANANA_T2I_MAPPING.taskKind, modelKey: NANO_BANANA_T2I_MAPPING.modelKey, name: NANO_BANANA_T2I_MAPPING.name, create: NANO_BANANA_T2I_MAPPING.create, query: NANO_BANANA_T2I_MAPPING.query, statusMapping: NANO_BANANA_T2I_MAPPING.statusMapping },
  { id: NANO_BANANA_EDIT_MAPPING_ID, taskKind: NANO_BANANA_EDIT_MAPPING.taskKind, modelKey: NANO_BANANA_EDIT_MAPPING.modelKey, name: NANO_BANANA_EDIT_MAPPING.name, create: NANO_BANANA_EDIT_MAPPING.create, query: NANO_BANANA_EDIT_MAPPING.query, statusMapping: NANO_BANANA_EDIT_MAPPING.statusMapping },
  { id: KLING_3_T2V_MAPPING_ID, taskKind: KLING_3_T2V_MAPPING.taskKind, modelKey: KLING_3_T2V_MAPPING.modelKey, name: KLING_3_T2V_MAPPING.name, create: KLING_3_T2V_MAPPING.create, query: KLING_3_T2V_MAPPING.query },
  { id: KLING_3_I2V_MAPPING_ID, taskKind: KLING_3_I2V_MAPPING.taskKind, modelKey: KLING_3_I2V_MAPPING.modelKey, name: KLING_3_I2V_MAPPING.name, create: KLING_3_I2V_MAPPING.create, query: KLING_3_I2V_MAPPING.query },
  { id: MINIMAX_H3_MAPPING_ID, taskKind: MINIMAX_H3_MAPPING.taskKind, modelKey: MINIMAX_H3_MAPPING.modelKey, name: MINIMAX_H3_MAPPING.name, create: MINIMAX_H3_CREATE_OP, query: MINIMAX_H3_QUERY_OP },
  { id: SEEDANCE_2_5_T2V_MAPPING_ID, taskKind: SEEDANCE_2_5_TEXT_TO_VIDEO_MAPPING.taskKind, modelKey: SEEDANCE_2_5_TEXT_TO_VIDEO_MAPPING.modelKey, name: SEEDANCE_2_5_TEXT_TO_VIDEO_MAPPING.name, create: SEEDANCE_2_5_CREATE_OP, query: SEEDANCE_2_5_QUERY_OP },
  { id: SEEDANCE_2_5_I2V_MAPPING_ID, taskKind: SEEDANCE_2_5_IMAGE_TO_VIDEO_MAPPING.taskKind, modelKey: SEEDANCE_2_5_IMAGE_TO_VIDEO_MAPPING.modelKey, name: SEEDANCE_2_5_IMAGE_TO_VIDEO_MAPPING.name, create: SEEDANCE_2_5_CREATE_OP, query: SEEDANCE_2_5_QUERY_OP },
  { id: WAN_3_0_T2V_MAPPING_ID, taskKind: WAN_3_0_TEXT_TO_VIDEO_MAPPING.taskKind, modelKey: WAN_3_0_TEXT_TO_VIDEO_MAPPING.modelKey, name: WAN_3_0_TEXT_TO_VIDEO_MAPPING.name, create: WAN_3_0_CREATE_OP, query: WAN_3_0_QUERY_OP },
  { id: WAN_3_0_I2V_MAPPING_ID, taskKind: WAN_3_0_IMAGE_TO_VIDEO_MAPPING.taskKind, modelKey: WAN_3_0_IMAGE_TO_VIDEO_MAPPING.modelKey, name: WAN_3_0_IMAGE_TO_VIDEO_MAPPING.name, create: WAN_3_0_CREATE_OP, query: WAN_3_0_QUERY_OP },
  // 2026-08 代图像：每个模型 t2i + edit 两条，共用 kie 全家桶的轮询与状态归一。
  // modelKey 精确路由（同 vendor 同 taskKind 多模型不撞，见 selectTaskMapping）。
  ...KIE_IMAGE_MODELS_2026.flatMap((m) =>
    m.mappings.map((mp) => ({
      id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name,
      create: mp.create, query: KIE_IMAGE_2026_QUERY, statusMapping: KIE_IMAGE_2026_STATUS,
    })),
  ),
  ...GEMINI_OMNI_11_MAPPINGS,
  ...KIE_SUNO_MUSIC_MAPPINGS,
  KIE_SUNO_SFX_MAPPING,
];

/** apimart 的 curated 模型 + mapping，从单源 APIMART_IMAGE_MODELS / APIMART_VIDEO_MODELS 派生。 */
const APIMART_CURATED_MODELS: CuratedModel[] = [
  // 文本大脑（创作助手 / 拆镜头主控）：无 archetype / 无 mapping，走 buildLanguageModelForVendor 直连 chat。
  // meta 透传：能读图的（gemini-3.5-flash）靠 meta.supportsImageInput 被 chooseTextModel 选中，
  // 不靠 VISION_MODEL_RE 猜名字（显式声明优先，见 ai/agentUserContent.ts:33）。
  ...APIMART_TEXT_MODELS.map((m) => ({
    modelKey: m.modelKey,
    labelZh: m.labelZh,
    kind: "text" as const,
    ...(m.meta ? { meta: m.meta } : {}),
    ...(m.tokenPricing ? { tokenPricing: m.tokenPricing } : {}),
    ...(m.free ? { free: m.free } : {}),
  })),
  ...APIMART_IMAGE_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "image" as const, archetypeId: m.archetypeId })),
  ...APIMART_VIDEO_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "video" as const, archetypeId: m.archetypeId })),
  ...APIMART_AUDIO_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: m.kind, archetypeId: m.archetypeId })),
];
const APIMART_CURATED_MAPPINGS: CuratedMapping[] = [
  ...APIMART_TEXT_MAPPINGS.map((mp) => ({
    id: mp.id, taskKind: mp.taskKind, modelKey: mp.modelKey, name: mp.name,
    create: mp.create, query: mp.query, statusMapping: mp.statusMapping,
  })),
  ...APIMART_IMAGE_MODELS.flatMap((m) =>
    m.mappings.map((mp) => ({
      id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name,
      create: mp.create, query: APIMART_IMAGE_QUERY, statusMapping: APIMART_IMAGE_STATUS,
    })),
  ),
  ...APIMART_VIDEO_MODELS.flatMap((m) =>
    m.mappings.map((mp) => ({
      id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name,
      create: mp.create, query: APIMART_VIDEO_QUERY, statusMapping: APIMART_VIDEO_STATUS,
    })),
  ),
  // 音频同步族：无 query / 无 statusMapping（响应即结果，runtime 第四路收口）。
  ...APIMART_AUDIO_MODELS.flatMap((m) =>
    m.mappings.map((mp) => ({
      id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name, create: mp.create,
      query: mp.query, statusMapping: mp.statusMapping,
    })),
  ),
];

/** Agnes AI 公开模型 curated 种子；实际调用权限和费用由账户决定。文本(无 mapping，直连 chat)；
 *  图片：同步 create(无 query)；视频：异步 create→poll(query 参数版轮询，见 agnesVendor)。 */
const AGNES_CURATED_MODELS: CuratedModel[] = [
  ...AGNES_TEXT_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "text" as const, meta: m.meta, tokenPricing: m.tokenPricing })),
  ...AGNES_IMAGE_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "image" as const, archetypeId: m.archetypeId })),
  ...AGNES_VIDEO_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "video" as const, archetypeId: m.archetypeId })),
];
const AGNES_CURATED_MAPPINGS: CuratedMapping[] = [
  // 图片同步族：无 query / 无 statusMapping（create 响应即结果，runtime 取 data.0.url）。
  ...AGNES_IMAGE_MODELS.flatMap((m) =>
    m.mappings.map((mp) => ({ id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name, create: mp.create })),
  ),
  // 视频异步族：模型声明自己的 query；2.5 必须带 model_name。
  ...AGNES_VIDEO_MODELS.flatMap((m) =>
    m.mappings.map((mp) => ({
      id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name,
      create: mp.create, query: m.query, statusMapping: AGNES_STATUS_MAPPING,
    })),
  ),
];

/** 魔搭社区（官方原生）curated 模型 + mapping。图片：async create→poll；文本：免费 LLM(无 mapping，直连 chat)。 */
const MODELSCOPE_CURATED_MODELS: CuratedModel[] = [
  // 免费文本大脑（Qwen3 系，真实验证 chat+tool_use 双通）：补 Issue #9，给没付费用户免费大脑。
  ...MODELSCOPE_TEXT_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "text" as const, free: m.free })),
  ...MODELSCOPE_IMAGE_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "image" as const, archetypeId: m.archetypeId })),
];
const MODELSCOPE_CURATED_MAPPINGS: CuratedMapping[] = MODELSCOPE_IMAGE_MODELS.flatMap((m) =>
  m.mappings.map((mp) => ({
    id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name,
    create: mp.create, query: MODELSCOPE_IMAGE_QUERY, statusMapping: MODELSCOPE_IMAGE_STATUS,
  })),
);

/** 火山 Seedream 图片（同步）+ Seedance 视频（异步）curated 模型 + mapping。 */
const VOLCENGINE_CURATED_MODELS: CuratedModel[] = [
  ...VOLCENGINE_IMAGE_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "image" as const, archetypeId: m.archetypeId })),
  ...VOLCENGINE_VIDEO_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "video" as const, archetypeId: m.archetypeId })),
];
const VOLCENGINE_CURATED_MAPPINGS: CuratedMapping[] = [
  ...VOLCENGINE_IMAGE_MODELS.flatMap((m) =>
    m.mappings.map((mp) => ({
      id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name, create: mp.create,
    })),
  ),
  ...VOLCENGINE_VIDEO_MODELS.flatMap((m) =>
    m.mappings.map((mp) => ({
      id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name,
      create: mp.create, query: VOLCENGINE_SEEDANCE_QUERY_OP, statusMapping: VOLCENGINE_SEEDANCE_STATUS_MAPPING,
    })),
  ),
];

/** 火山豆包语音 curated 模型 + mapping（同步族；NDJSON 解码由 audioTaskRunner 按 create.audioResponse 走）。 */
const VOLCENGINE_SPEECH_CURATED_MODELS: CuratedModel[] = VOLCENGINE_AUDIO_MODELS.map((m) => ({
  modelKey: m.modelKey, labelZh: m.labelZh, kind: m.kind, archetypeId: m.archetypeId,
}));
const VOLCENGINE_SPEECH_CURATED_MAPPINGS: CuratedMapping[] = VOLCENGINE_AUDIO_MODELS.flatMap((m) =>
  m.mappings.map((mp) => ({
    id: mp.id, taskKind: mp.taskKind, modelKey: m.modelKey, name: mp.name, create: mp.create,
  })),
);

const officialCuratedModels = <T extends CuratedModel & { mappings: unknown }>(models: readonly T[]): CuratedModel[] =>
  models.map(({ modelKey, labelZh, kind, archetypeId, meta }) => ({ modelKey, labelZh, kind, archetypeId, meta }));

const officialCuratedMappings = <T extends { modelKey: string; mappings: readonly CuratedMapping[] }>(
  models: readonly T[],
): CuratedMapping[] => models.flatMap((model) =>
  model.mappings.map((mapping) => ({ ...mapping, modelKey: model.modelKey })),
);

const MINIMAX_OFFICIAL_CURATED_MODELS = officialCuratedModels(MINIMAX_OFFICIAL_MODELS);
const MINIMAX_OFFICIAL_CURATED_MAPPINGS = officialCuratedMappings(MINIMAX_OFFICIAL_MODELS);
const ELEVENLABS_CURATED_MODELS = officialCuratedModels(ELEVENLABS_MODELS);
const ELEVENLABS_CURATED_MAPPINGS = officialCuratedMappings(ELEVENLABS_MODELS);
const MESHY_CURATED_MODELS = officialCuratedModels(MESHY_MODELS);
const MESHY_CURATED_MAPPINGS = officialCuratedMappings(MESHY_MODELS);
const FAL_CURATED_MODELS = officialCuratedModels(FAL_OFFICIAL_MODELS);
const FAL_CURATED_MAPPINGS = officialCuratedMappings(FAL_OFFICIAL_MODELS);
const RUNWAY_CURATED_MODELS = officialCuratedModels(RUNWAY_OFFICIAL_MODELS);
const RUNWAY_CURATED_MAPPINGS = officialCuratedMappings(RUNWAY_OFFICIAL_MODELS);

/**
 * **curated 执行契约登记表 —— 单一真相源**（2026-09-10）。
 *
 * 在此之前，「这家有哪些代码拥有的模型 / mapping」以**两份手抄清单**的形式存在
 * （applyBuiltinSeeds 里 18 行 reconcileModels + 18 行 reconcileMappings），
 * 而「这家能不能凭 key 发布」是第三份、写死成 `vendorKey !== apimart` 的白名单。
 * 三份描述同一件事就一定会漂：新接一家只加了播种那两行，发布判据不认它，
 * 于是「填了 key 模型却全消失」——2026-09-10 用户反馈的正是这个（18 家里 17 家中招）。
 *
 * 收成这一张表之后：播种走它，发布判据也走它，加一家只加一行，判据自动跟上（P1）。
 * 表的顺序 = 原播种顺序，装机行为逐字不变。
 */
const CURATED_VENDOR_CONTRACTS: readonly { vendorKey: string; models: CuratedModel[]; mappings: CuratedMapping[] }[] = [
  { vendorKey: KIE_VENDOR_SEED.key, models: KIE_CURATED_MODELS, mappings: KIE_CURATED_MAPPINGS },
  { vendorKey: APIMART_VENDOR_SEED.key, models: APIMART_CURATED_MODELS, mappings: APIMART_CURATED_MAPPINGS },
  { vendorKey: AGNES_VENDOR_SEED.key, models: AGNES_CURATED_MODELS, mappings: AGNES_CURATED_MAPPINGS },
  { vendorKey: MODELSCOPE_VENDOR_SEED.key, models: MODELSCOPE_CURATED_MODELS, mappings: MODELSCOPE_CURATED_MAPPINGS },
  { vendorKey: VOLCENGINE_VENDOR_SEED.key, models: VOLCENGINE_CURATED_MODELS, mappings: VOLCENGINE_CURATED_MAPPINGS },
  { vendorKey: VOLCENGINE_SPEECH_VENDOR_SEED.key, models: VOLCENGINE_SPEECH_CURATED_MODELS, mappings: VOLCENGINE_SPEECH_CURATED_MAPPINGS },
  { vendorKey: DREAMINA_VENDOR_SEED.key, models: DREAMINA_CURATED_MODELS, mappings: DREAMINA_CURATED_MAPPINGS },
  { vendorKey: DREAMINA_VENDOR_SEED.key, models: DREAMINA_IMAGE_CURATED_MODELS, mappings: DREAMINA_IMAGE_CURATED_MAPPINGS },
  { vendorKey: RUNNINGHUB_VENDOR_SEED.key, models: RUNNINGHUB_3D_CURATED_MODELS, mappings: RUNNINGHUB_3D_CURATED_MAPPINGS },
  { vendorKey: RUNNINGHUB_VENDOR_SEED.key, models: RUNNINGHUB_VIDEO_CURATED_MODELS, mappings: RUNNINGHUB_VIDEO_CURATED_MAPPINGS },
  { vendorKey: RUNNINGHUB_VENDOR_SEED.key, models: RUNNINGHUB_IMAGE_CURATED_MODELS, mappings: RUNNINGHUB_IMAGE_CURATED_MAPPINGS },
  { vendorKey: COMFYUI_VENDOR_SEED.key, models: COMFYUI_CURATED_MODELS, mappings: COMFYUI_CURATED_MAPPINGS },
  { vendorKey: CODEX_LOCAL_VENDOR_SEED.key, models: CODEX_IMAGE_CURATED_MODELS, mappings: CODEX_IMAGE_CURATED_MAPPINGS },
  { vendorKey: MINIMAX_VENDOR_SEED.key, models: MINIMAX_OFFICIAL_CURATED_MODELS, mappings: MINIMAX_OFFICIAL_CURATED_MAPPINGS },
  { vendorKey: ELEVENLABS_VENDOR_SEED.key, models: ELEVENLABS_CURATED_MODELS, mappings: ELEVENLABS_CURATED_MAPPINGS },
  { vendorKey: MESHY_VENDOR_SEED.key, models: MESHY_CURATED_MODELS, mappings: MESHY_CURATED_MAPPINGS },
  { vendorKey: FAL_VENDOR_SEED.key, models: FAL_CURATED_MODELS, mappings: FAL_CURATED_MAPPINGS },
  { vendorKey: RUNWAY_VENDOR_SEED.key, models: RUNWAY_CURATED_MODELS, mappings: RUNWAY_CURATED_MAPPINGS },
];

/**
 * **退役的 curated 记录（变体合并迁移，2026-06-16）**：Seedance 一族原是 4 个独立 catalog 行
 * （标准/fast/face/fast-face），合并成 1 行后，老装机里残留 3 个变体模型 + 6 条 mapping 成孤儿
 * （reconcile 只 insert/update 不删）→ picker 仍显示 4 项。这里**精确按我们当初种的 seed id / modelKey**
 * 把它们删掉（不碰用户自建/改名的记录：模型按 (vendorKey, modelKey) 命中、mapping 按 seed- 前缀的稳定 id）。
 * 节点侧的旧 modelKey 由 renderer 的 normalizeArchetypeVariantMeta 归一成 基 modelKey + variantId（正交，互不依赖）。
 */
const RETIRED_APIMART_VIDEO_MODEL_KEYS: readonly string[] = [
  "doubao-seedance-2.0-fast",
  "doubao-seedance-2.0-face",
  "doubao-seedance-2.0-fast-face",
];
// KIE Seedance 标准/Fast 合并成 1 行 + 2 变体（2026-06-16）→ 老装机里残留的 fast catalog 行成孤儿，删掉。
// 无孤儿 mapping（标准/fast 共用 SEEDANCE_MAPPING_ID，body 改 {{request.params.model}} 由 reconcileMappings 自愈）。
const RETIRED_KIE_VIDEO_MODEL_KEYS: readonly string[] = [
  "bytedance/seedance-2-fast",
];
/**
 * apimart Imagen 4 退役（2026-07-30 用户拍板）：上游 Google **确定性** 404
 * `Requested entity was not found.`（直连探针两次实锤，`credits_cost: 0` 不计费），而它在图片模型里
 * 排第一位 = 新装机自动默认必撞、开箱即死。apimart 侧并未下架（仍挂在 274 个在售模型列表里），
 * 只能我们这边摘。
 *
 * ⚠️ 与 APIMART_CURATED_MODELS 互斥：curated 里必须**同时**删掉该条，否则 reconcileModels 每次启动
 * 又插回来、和这里的 prune 来回抖。上游修好要恢复的话：curated 加回 + 删掉这两条，一次 commit。
 */
const RETIRED_APIMART_IMAGE_MODEL_KEYS: readonly string[] = ["imagen-4.0-apimart"];
const RETIRED_APIMART_IMAGE_MAPPING_IDS: readonly string[] = ["seed-apimart-imagen-4-text_to_image"];
// 退役的 apimart 文本模型（与 APIMART_TEXT_MODELS 互斥，curated 必须同删，否则启动时插回来来回抖）：
// `deepseek-v3.1-250821` 早期误种；`deepseek-v3.2-think` 2026-09-06 实测退役（仍列在目录里但调用 400 ——
// 教训同 imagen-4.0-apimart：目录列表不是可用性证据）。证据与回归见 apimartTextMigration.test.ts。
const RETIRED_APIMART_TEXT_MODEL_KEYS: readonly string[] = ["deepseek-v3.1-250821", "deepseek-v3.2-think"];

const RETIRED_APIMART_VIDEO_MAPPING_IDS: readonly string[] = [
  "seed-apimart-seedance-2-apimart-fast-text_to_video",
  "seed-apimart-seedance-2-apimart-fast-image_to_video",
  "seed-apimart-seedance-2-apimart-face-text_to_video",
  "seed-apimart-seedance-2-apimart-face-image_to_video",
  "seed-apimart-seedance-2-apimart-fast-face-text_to_video",
  "seed-apimart-seedance-2-apimart-fast-face-image_to_video",
];

/** 删退役 curated 模型（按 vendorKey+modelKey 精确命中我们种的行）。返回是否变更。 */
function pruneRetiredModels(models: Model[], vendorKey: string, retiredKeys: readonly string[]): boolean {
  let changed = false;
  for (let i = models.length - 1; i >= 0; i -= 1) {
    if (models[i].vendorKey === vendorKey && retiredKeys.includes(models[i].modelKey)) {
      models.splice(i, 1);
      changed = true;
    }
  }
  return changed;
}

/** 删退役 curated mapping（按稳定 seed id 精确命中；用户自建 mapping id 不在表里，不受影响）。返回是否变更。 */
function pruneRetiredMappings(mappings: Mapping[], retiredIds: readonly string[]): boolean {
  let changed = false;
  for (let i = mappings.length - 1; i >= 0; i -= 1) {
    if (retiredIds.includes(mappings[i].id)) {
      mappings.splice(i, 1);
      changed = true;
    }
  }
  return changed;
}

/** 供应商种子（裸 baseUrl + bearer）。存在即跳过（用户配置不覆盖）；仅对账代码声明的旧官方 host。
 *  多数种子默认 enabled:true；无鉴权本地后端（ComfyUI）带 `enabled:false` → 默认关、用户显式启用（污染防护）。 */
function seedVendor(vendors: Vendor[], seed: VendorSeed, now: string): boolean {
  const existingIndex = vendors.findIndex((v) => v.key === seed.key);
  if (existingIndex >= 0) {
    const existing = vendors[existingIndex];
    // 只迁移仍指向我们旧默认值的记录。用户改成自建中转/代理时，绝不能因为升级而覆盖。
    if (seed.legacyBaseUrls?.includes(String(existing.baseUrlHint ?? ""))) {
      vendors[existingIndex] = { ...existing, baseUrlHint: seed.baseUrl, updatedAt: now };
      return true;
    }
    return false;
  }
  const enabled = seed.enabled === false ? false : true;
  vendors.push({
    key: seed.key, name: seed.name, enabled,
    baseUrlHint: seed.baseUrl, authType: seed.authType, authHeader: seed.authHeader,
    // 本地素材吞入声明（仅 Replicate 等声明了 assetIngestion 的 vendor 带；resolveAssetIngestionWithFallback 据此把本地图传文件 API）。
    ...(seed.assetIngestion ? { assetIngestion: seed.assetIngestion } : {}),
    createdAt: now, updatedAt: now,
  });
  return true;
}

/**
 * 某供应商的 curated 模型 insert + 启动对账（供应商无关）。代码所有：kind + meta.archetypeId（漂移强制对账，
 * 否则模型套错能力）；用户所有：enabled/labelZh/createdAt 保留。返回是否变更。
 */
function reconcileModels(models: Model[], vendorKey: string, curated: CuratedModel[], now: string, suppressed: CatalogState["suppressedBuiltinModels"]): boolean {
  let changed = false;
  for (const c of curated) {
    if (suppressed?.some((row) => row.vendorKey === vendorKey && row.modelKey === c.modelKey)) continue;
    const canonicalId = CANONICAL_MODEL_IDS[c.modelKey];
    // 代码所有的 meta = archetypeId（能力档案指针）+ canonicalModelId（跨家去重键）+ c.meta 合并。
    const curatedMeta: Record<string, unknown> = {
      ...(c.archetypeId ? { archetypeId: c.archetypeId } : {}),
      ...(canonicalId ? { canonicalModelId: canonicalId } : {}),
      ...(c.meta || {}),
      catalogLifecycle: curatedCatalogLifecycle(c.modelKey),
    };
    // 价目是**代码所有**的事实（和 kind / archetypeId 同级），不是用户配置：官网调价后老装机
    // 必须跟着自愈，否则面板上会长期印一个过期金额，而过期金额比没有金额更难发现。
    const curatedPricing = {
      ...(c.tokenPricing ? { tokenPricing: c.tokenPricing } : {}),
      ...(c.free ? { free: c.free } : {}),
    } as Pick<Model, "tokenPricing" | "free">;
    const i = models.findIndex((m) => m.modelKey === c.modelKey && m.vendorKey === vendorKey);
    if (i < 0) {
      models.push({
        modelKey: c.modelKey, vendorKey, labelZh: c.labelZh, kind: c.kind, enabled: true,
        ...(Object.keys(curatedMeta).length > 0 ? { meta: curatedMeta } : {}),
        ...curatedPricing,
        createdAt: now, updatedAt: now,
      });
      changed = true;
      continue;
    }
    const ex = models[i];
    const exMeta = (ex.meta || {}) as Record<string, unknown>;
    // Compare every code-owned capability, including supportsImageInput added to existing text rows.
    // Unrelated user metadata is not compared or removed.
    const metaDrift = Object.entries(curatedMeta).some(([key, value]) => JSON.stringify(exMeta[key]) !== JSON.stringify(value));
    // 撤价（curated 不再声明）也算漂移：留着一份没人维护的旧价目就是留一个会说谎的数字。
    const pricingDrift = JSON.stringify(ex.tokenPricing) !== JSON.stringify(c.tokenPricing)
      || JSON.stringify(ex.free) !== JSON.stringify(c.free);
    const drift = ex.kind !== c.kind || metaDrift || pricingDrift;
    if (drift) {
      const nextMeta = { ...exMeta, ...curatedMeta };
      const { tokenPricing: _stalePricing, free: _staleFree, ...rest } = ex;
      models[i] = {
        ...rest, kind: c.kind,
        ...(Object.keys(nextMeta).length > 0 ? { meta: nextMeta } : {}),
        ...curatedPricing,
        updatedAt: now,
      };
      changed = true;
    }
  }
  return changed;
}

/**
 * 某供应商的 curated mapping insert + 对账（供应商无关，根因修复见原注释）。
 *   · 已存在（按稳定 seed id）→ 强制对账 create/query/result/statusMapping/taskKind/modelKey/modeId（代码所有），老装机自愈；
 *   · 缺失 → 仅当同 (vendor, taskKind, modelKey, modeId) 身份未被用户/onboarding 记录占用时插入（不重复占槽）。
 * name/enabled/createdAt = 用户所有，保留。返回是否变更。
 */
function reconcileMappings(mappings: Mapping[], vendorKey: string, curated: CuratedMapping[], now: string): boolean {
  let changed = false;
  for (const c of curated) {
    const i = mappings.findIndex((m) => m.id === c.id);
    if (i >= 0) {
      const ex = mappings[i];
      const drift =
        ex.taskKind !== c.taskKind ||
        (ex.modelKey || undefined) !== (c.modelKey || undefined) ||
        (ex.modeId || undefined) !== (c.modeId || undefined) ||
        JSON.stringify(ex.create) !== JSON.stringify(c.create) ||
        JSON.stringify(ex.query) !== JSON.stringify(c.query) ||
        JSON.stringify(ex.result) !== JSON.stringify(c.result) ||
        JSON.stringify(ex.statusMapping) !== JSON.stringify(c.statusMapping);
      if (drift) {
        mappings[i] = { ...ex, taskKind: c.taskKind, modelKey: c.modelKey, modeId: c.modeId, name: ex.name ?? c.name, create: c.create, query: c.query, result: c.result, statusMapping: c.statusMapping, updatedAt: now };
        changed = true;
      }
      continue;
    }
    if (mappings.some((m) => m.vendorKey === vendorKey && m.taskKind === c.taskKind && (m.modelKey || undefined) === (c.modelKey || undefined) && (m.modeId || undefined) === (c.modeId || undefined))) continue;
    mappings.push({
      id: c.id, vendorKey, taskKind: c.taskKind,
      ...(c.modelKey ? { modelKey: c.modelKey } : {}),
      ...(c.modeId ? { modeId: c.modeId } : {}),
      name: c.name, enabled: true, create: c.create, query: c.query, result: c.result, statusMapping: c.statusMapping,
      createdAt: now, updatedAt: now,
    });
    changed = true;
  }
  return changed;
}

export function applyBuiltinSeeds(state: CatalogState, now: string): { state: CatalogState; changed: boolean } {
  const vendors = [...state.vendors];
  const models = [...state.models];
  const mappings = [...state.mappings];
  let changed = false;

  // 供应商：清单住在 builtinVendorSeeds.ts（单一真相源，deriveVendorKeyFromBaseUrl 的
  // 「已知 host → 内置 vendorKey」别名表由同一份清单派生，不另抄一份）。
  for (const seed of BUILTIN_VENDOR_SEEDS) {
    if (seedVendor(vendors, seed, now)) changed = true;
  }

  // 退役 curated 记录清理（变体合并迁移：删 Seedance 旧变体模型 + mapping 孤儿，picker 收成 1 项）。
  if (pruneRetiredModels(models, APIMART_VENDOR_SEED.key, RETIRED_APIMART_VIDEO_MODEL_KEYS)) changed = true;
  if (pruneRetiredMappings(mappings, RETIRED_APIMART_VIDEO_MAPPING_IDS)) changed = true;
  // 上游确定性挂掉的模型下线（Imagen 4）——对老装机同样生效：种子不碰 enabled（那是用户数据），
  // 只有走 prune 才摘得掉已经落在用户 catalog 里的那条。
  if (pruneRetiredModels(models, APIMART_VENDOR_SEED.key, RETIRED_APIMART_IMAGE_MODEL_KEYS)) changed = true;
  if (pruneRetiredMappings(mappings, RETIRED_APIMART_IMAGE_MAPPING_IDS)) changed = true;
  // Explicit one-time migration: keep user configuration, including manual re-enabling afterwards.
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    if (model.vendorKey === APIMART_VENDOR_SEED.key && RETIRED_APIMART_TEXT_MODEL_KEYS.includes(model.modelKey) && model.unlisted === undefined) {
      models[index] = { ...model, enabled: false, unlisted: true, meta: { ...(model.meta as Record<string, unknown> || {}), catalogLifecycle: "legacy" }, updatedAt: now };
      changed = true;
    }
  }
  if (pruneRetiredModels(models, KIE_VENDOR_SEED.key, RETIRED_KIE_VIDEO_MODEL_KEYS)) changed = true;

  // 模型 insert + 对账（两家各跑同一套逻辑）。
  for (const contract of CURATED_VENDOR_CONTRACTS) {
    if (reconcileModels(models, contract.vendorKey, contract.models, now, state.suppressedBuiltinModels)) changed = true;
  }

  // kie 历史包袱 repair：把视频形状的坏 (kie, text_to_image) 替换成正确的 GPT Image 2 文生图契约
  // （旧 onboarding 抽错留下的；契约见 kieGptImage2.ts 直连实测确认）。apimart 无此历史，不需要。
  for (let i = 0; i < mappings.length; i += 1) {
    if (isBrokenKieImageMapping(mappings[i])) {
      mappings[i] = {
        ...mappings[i],
        name: GPT_IMAGE_2_T2I_MAPPING.name,
        create: GPT_IMAGE_2_T2I_MAPPING.create,
        query: GPT_IMAGE_2_T2I_MAPPING.query,
        statusMapping: GPT_IMAGE_2_T2I_MAPPING.statusMapping,
        updatedAt: now,
      };
      changed = true;
    }
  }

  // mapping insert + 对账（两家各跑同一套逻辑）。
  for (const contract of CURATED_VENDOR_CONTRACTS) {
    if (reconcileMappings(mappings, contract.vendorKey, contract.mappings, now)) changed = true;
  }

  if (!changed) return { state, changed: false };
  return { state: { ...state, vendors, models, mappings }, changed: true };
}

/**
 * 这家在当前 catalog 里，是否仍指向**代码拥有的**执行契约。
 *
 * 判据用在凭据发布与 provider 两个边界上，所以后来的一次 catalog 编辑（改了 create/query、
 * 删了 mapping、被认证适配器接管）都会让它 fail-closed。渲染层自己建/改出来的行故意不算数：
 * 一条启用但无 adapter 的 mapping 否则会对旧发布助手装成「已发布」。
 *
 * 2026-09-10：判据从 `vendorKey !== apimart` 的硬编码白名单改为**登记表驱动**
 * （CURATED_VENDOR_CONTRACTS）。旧写法让 18 家里的另外 17 家永远返回 false，于是它们填完 key
 * 就被 de-publish 且再也回不来——用户反馈「写入 key 没有像以前一样一次性打开所有模型」的类根因。
 * 见 docs/fixes/2026-09-10-vendor-key-publish-class.root-cause.json。
 */
export function hasBuiltinCuratedExecution(state: CatalogState, vendorKey: string): boolean {
  const seed = builtinVendorSeed(vendorKey);
  if (!seed) return false;
  // 执行契约住在主进程专用路径（多输出的 Replicate 元素拆解）——它没有 mapping，但同样是
  // 代码拥有且实测固化的契约。为它编一条没人消费的 mapping 才是不诚实的那条路。
  if (seed.bespokeExecution) return true;
  const contracts = CURATED_VENDOR_CONTRACTS.filter((contract) => contract.vendorKey === vendorKey);
  if (contracts.length === 0) return false;
  const curatedModelByKey = new Map(contracts.flatMap((contract) => contract.models).map((model) => [model.modelKey, model] as const));
  const curatedMappingsById = new Map(contracts.flatMap((contract) => contract.mappings).map((mapping) => [mapping.id, mapping] as const));
  const models = state.models.filter((model) => model.vendorKey === vendorKey && model.enabled);
  for (const model of models) {
    const curated = curatedModelByKey.get(model.modelKey);
    if (!curated || model.kind !== curated.kind) continue;
    const meta = model.meta && typeof model.meta === "object" && !Array.isArray(model.meta)
      ? model.meta as Record<string, unknown>
      : {};
    if (curated.archetypeId && meta.archetypeId !== curated.archetypeId) continue;
    if (curated.meta && Object.entries(curated.meta).some(([key, value]) => JSON.stringify(meta[key]) !== JSON.stringify(value))) continue;

    // This predicate gates the media GenerationProvider. Text models are
    // consumed by the separate language-model path and must not make a
    // catalog with all image/video mappings removed look generation-ready.
    // 现役 curated 家全都至少出一个媒体模型，所以这里不为「只出文本的家」预留分支：
    // 真出现那么一家时，装配期不变量 (b) 会当场红，由那次改动的作者显式决定怎么算（P1：不写投机路径）。
    if (model.kind === "text") continue;
    // For media models, require exactly one intact code-owned mapping
    // (duplicate IDs are ambiguous and fail closed).
    const candidates = [...curatedMappingsById.values()].filter((mapping) =>
      mapping.modelKey === model.modelKey && mapping.taskKind !== "chat" && mapping.taskKind !== "prompt_refine",
    );
    for (const curatedMapping of candidates) {
      const actuals = state.mappings.filter((mapping) => mapping.id === curatedMapping.id);
      if (actuals.length !== 1) continue;
      const actual = actuals[0];
      if (!actual.enabled || actual.vendorKey !== vendorKey || actual.modelKey !== curatedMapping.modelKey
        || actual.taskKind !== curatedMapping.taskKind
        || JSON.stringify(actual.create) !== JSON.stringify(curatedMapping.create)
        || JSON.stringify(actual.query) !== JSON.stringify(curatedMapping.query)
        || JSON.stringify(actual.statusMapping) !== JSON.stringify(curatedMapping.statusMapping)) continue;
      if (modelHasPublishedExecution(model, { mappings: state.mappings })) return true;
    }
  }
  return false;
}
