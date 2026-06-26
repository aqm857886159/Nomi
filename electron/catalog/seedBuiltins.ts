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
import {
  KIE_VENDOR_SEED,
  SEEDANCE_2_CREATE_OP,
  SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING,
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
import { KLING_3_I2V_MAPPING, KLING_3_MODEL_SEED, KLING_3_T2V_MAPPING } from "./kieKling";
import { APIMART_VENDOR_SEED } from "./apimartVendor";
import { APIMART_IMAGE_MODELS, APIMART_IMAGE_QUERY, APIMART_IMAGE_STATUS } from "./apimartImages";
import { APIMART_VIDEO_MODELS, APIMART_VIDEO_QUERY, APIMART_VIDEO_STATUS } from "./apimartVideos";
import { APIMART_AUDIO_MODELS } from "./apimartAudios";
import { APIMART_TEXT_MODELS } from "./apimartTexts";
import { MODELSCOPE_VENDOR_SEED } from "./modelscopeVendor";
import { MODELSCOPE_IMAGE_MODELS, MODELSCOPE_IMAGE_QUERY, MODELSCOPE_IMAGE_STATUS } from "./modelscopeImages";
import { MODELSCOPE_TEXT_MODELS } from "./modelscopeTexts";
import { VOLCENGINE_VENDOR_SEED, VOLCENGINE_SPEECH_VENDOR_SEED } from "./volcengineVendor";
import { DREAMINA_VENDOR_SEED } from "./dreaminaVendor";
import { DREAMINA_CURATED_MODELS, DREAMINA_CURATED_MAPPINGS } from "./dreaminaVideos";
import { DREAMINA_IMAGE_CURATED_MODELS, DREAMINA_IMAGE_CURATED_MAPPINGS } from "./dreaminaImages";
import { VOLCENGINE_IMAGE_MODELS } from "./volcengineImages";
import { VOLCENGINE_AUDIO_MODELS } from "./volcengineAudios";
import { VOLCENGINE_SEEDANCE_QUERY_OP, VOLCENGINE_SEEDANCE_STATUS_MAPPING, VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";

/** curated 模型/mapping 的内部类型（reconcile 两函数的输入）。 */
type CuratedModel = { modelKey: string; labelZh: string; kind: Model["kind"]; archetypeId?: string };
type CuratedMapping = {
  id: string;
  taskKind: Mapping["taskKind"];
  modelKey?: string;
  name: string;
  create: HttpOperation;
  query?: HttpOperation;
  statusMapping?: Mapping["statusMapping"];
};

/** 稳定 id：按 (vendor, taskKind, model) 固定，便于幂等与排查。 */
const SEEDANCE_MAPPING_ID = "seed-kie-seedance2-image_to_video";
const HAPPYHORSE_MAPPING_ID = "seed-kie-happyhorse-text_to_video";
const GPT_IMAGE_2_T2I_MAPPING_ID = "seed-kie-gpt-image-2-text_to_image";
const GPT_IMAGE_2_I2I_MAPPING_ID = "seed-kie-gpt-image-2-image_edit";
const SEEDREAM_T2I_MAPPING_ID = "seed-kie-seedream-text_to_image";
const SEEDREAM_EDIT_MAPPING_ID = "seed-kie-seedream-image_edit";
const NANO_BANANA_T2I_MAPPING_ID = "seed-kie-nano-banana-text_to_image";
const NANO_BANANA_EDIT_MAPPING_ID = "seed-kie-nano-banana-image_edit";
const KLING_3_T2V_MAPPING_ID = "seed-kie-kling-3-text_to_video";
const KLING_3_I2V_MAPPING_ID = "seed-kie-kling-3-image_to_video";

/** kie 的 curated 内置模型（archetypeId = 能力档案指针，代码所有；enabled/labelZh = 用户所有）。 */
const KIE_CURATED_MODELS: CuratedModel[] = [
  { modelKey: SEEDANCE_2_MODEL_SEED.modelKey, labelZh: SEEDANCE_2_MODEL_SEED.labelZh, kind: SEEDANCE_2_MODEL_SEED.kind, archetypeId: "seedance-2" },
  { modelKey: HAPPYHORSE_MODEL_SEED.modelKey, labelZh: HAPPYHORSE_MODEL_SEED.labelZh, kind: HAPPYHORSE_MODEL_SEED.kind, archetypeId: "happyhorse" },
  { modelKey: GPT_IMAGE_2_T2I_MODEL_SEED.modelKey, labelZh: GPT_IMAGE_2_T2I_MODEL_SEED.labelZh, kind: GPT_IMAGE_2_T2I_MODEL_SEED.kind, archetypeId: "gpt-image-2" },
  { modelKey: GPT_IMAGE_2_I2I_MODEL_SEED.modelKey, labelZh: GPT_IMAGE_2_I2I_MODEL_SEED.labelZh, kind: GPT_IMAGE_2_I2I_MODEL_SEED.kind, archetypeId: "gpt-image-2" },
  { modelKey: SEEDREAM_MODEL_SEED.modelKey, labelZh: SEEDREAM_MODEL_SEED.labelZh, kind: SEEDREAM_MODEL_SEED.kind, archetypeId: "seedream" },
  { modelKey: NANO_BANANA_MODEL_SEED.modelKey, labelZh: NANO_BANANA_MODEL_SEED.labelZh, kind: NANO_BANANA_MODEL_SEED.kind, archetypeId: "nano-banana" },
  { modelKey: KLING_3_MODEL_SEED.modelKey, labelZh: KLING_3_MODEL_SEED.labelZh, kind: KLING_3_MODEL_SEED.kind, archetypeId: "kling-3.0" },
];

/** kie 的 curated mapping（单源；create/query/statusMapping = 代码所有，强制对账）。 */
const KIE_CURATED_MAPPINGS: CuratedMapping[] = [
  { id: SEEDANCE_MAPPING_ID, taskKind: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.taskKind, name: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.name, create: SEEDANCE_2_CREATE_OP, query: SEEDANCE_2_QUERY_OP },
  { id: HAPPYHORSE_MAPPING_ID, taskKind: HAPPYHORSE_MAPPING.taskKind, modelKey: HAPPYHORSE_MODEL_SEED.modelKey, name: HAPPYHORSE_MAPPING.name, create: HAPPYHORSE_CREATE_OP, query: HAPPYHORSE_QUERY_OP },
  { id: GPT_IMAGE_2_T2I_MAPPING_ID, taskKind: GPT_IMAGE_2_T2I_MAPPING.taskKind, name: GPT_IMAGE_2_T2I_MAPPING.name, create: GPT_IMAGE_2_T2I_MAPPING.create, query: GPT_IMAGE_2_T2I_MAPPING.query, statusMapping: GPT_IMAGE_2_T2I_MAPPING.statusMapping },
  { id: GPT_IMAGE_2_I2I_MAPPING_ID, taskKind: GPT_IMAGE_2_I2I_MAPPING.taskKind, name: GPT_IMAGE_2_I2I_MAPPING.name, create: GPT_IMAGE_2_I2I_MAPPING.create, query: GPT_IMAGE_2_I2I_MAPPING.query, statusMapping: GPT_IMAGE_2_I2I_MAPPING.statusMapping },
  { id: SEEDREAM_T2I_MAPPING_ID, taskKind: SEEDREAM_T2I_MAPPING.taskKind, modelKey: SEEDREAM_T2I_MAPPING.modelKey, name: SEEDREAM_T2I_MAPPING.name, create: SEEDREAM_T2I_MAPPING.create, query: SEEDREAM_T2I_MAPPING.query, statusMapping: SEEDREAM_T2I_MAPPING.statusMapping },
  { id: SEEDREAM_EDIT_MAPPING_ID, taskKind: SEEDREAM_EDIT_MAPPING.taskKind, modelKey: SEEDREAM_EDIT_MAPPING.modelKey, name: SEEDREAM_EDIT_MAPPING.name, create: SEEDREAM_EDIT_MAPPING.create, query: SEEDREAM_EDIT_MAPPING.query, statusMapping: SEEDREAM_EDIT_MAPPING.statusMapping },
  { id: NANO_BANANA_T2I_MAPPING_ID, taskKind: NANO_BANANA_T2I_MAPPING.taskKind, modelKey: NANO_BANANA_T2I_MAPPING.modelKey, name: NANO_BANANA_T2I_MAPPING.name, create: NANO_BANANA_T2I_MAPPING.create, query: NANO_BANANA_T2I_MAPPING.query, statusMapping: NANO_BANANA_T2I_MAPPING.statusMapping },
  { id: NANO_BANANA_EDIT_MAPPING_ID, taskKind: NANO_BANANA_EDIT_MAPPING.taskKind, modelKey: NANO_BANANA_EDIT_MAPPING.modelKey, name: NANO_BANANA_EDIT_MAPPING.name, create: NANO_BANANA_EDIT_MAPPING.create, query: NANO_BANANA_EDIT_MAPPING.query, statusMapping: NANO_BANANA_EDIT_MAPPING.statusMapping },
  { id: KLING_3_T2V_MAPPING_ID, taskKind: KLING_3_T2V_MAPPING.taskKind, modelKey: KLING_3_T2V_MAPPING.modelKey, name: KLING_3_T2V_MAPPING.name, create: KLING_3_T2V_MAPPING.create, query: KLING_3_T2V_MAPPING.query },
  { id: KLING_3_I2V_MAPPING_ID, taskKind: KLING_3_I2V_MAPPING.taskKind, modelKey: KLING_3_I2V_MAPPING.modelKey, name: KLING_3_I2V_MAPPING.name, create: KLING_3_I2V_MAPPING.create, query: KLING_3_I2V_MAPPING.query },
];

/** apimart 的 curated 模型 + mapping，从单源 APIMART_IMAGE_MODELS / APIMART_VIDEO_MODELS 派生。 */
const APIMART_CURATED_MODELS: CuratedModel[] = [
  // 文本大脑（创作助手 / 拆镜头主控）：无 archetype / 无 mapping，走 buildLanguageModelForVendor 直连 chat。
  ...APIMART_TEXT_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "text" as const })),
  ...APIMART_IMAGE_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "image" as const, archetypeId: m.archetypeId })),
  ...APIMART_VIDEO_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "video" as const, archetypeId: m.archetypeId })),
  ...APIMART_AUDIO_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: m.kind, archetypeId: m.archetypeId })),
];
const APIMART_CURATED_MAPPINGS: CuratedMapping[] = [
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
    })),
  ),
];

/** 魔搭社区（官方原生）curated 模型 + mapping。图片：async create→poll；文本：免费 LLM(无 mapping，直连 chat)。 */
const MODELSCOPE_CURATED_MODELS: CuratedModel[] = [
  // 免费文本大脑（Qwen3 系，真实验证 chat+tool_use 双通）：补 Issue #9，给没付费用户免费大脑。
  ...MODELSCOPE_TEXT_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "text" as const })),
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

/**
 * **退役的 curated 记录（变体合并迁移，2026-06-16）**：Seedance 一族原是 4 个独立 catalog 行
 * （标准/fast/face/fast-face），合并成 1 行 + 4 变体后，老装机里残留 3 个变体模型 + 6 条 mapping 成孤儿
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

/** 供应商种子（裸 baseUrl + bearer）。存在即跳过（用户配置不覆盖）。返回是否变更。 */
function seedVendor(vendors: Vendor[], seed: typeof KIE_VENDOR_SEED | typeof APIMART_VENDOR_SEED | typeof MODELSCOPE_VENDOR_SEED | typeof VOLCENGINE_VENDOR_SEED | typeof VOLCENGINE_SPEECH_VENDOR_SEED | typeof DREAMINA_VENDOR_SEED, now: string): boolean {
  if (vendors.some((v) => v.key === seed.key)) return false;
  vendors.push({
    key: seed.key, name: seed.name, enabled: true,
    baseUrlHint: seed.baseUrl, authType: seed.authType, authHeader: seed.authHeader,
    createdAt: now, updatedAt: now,
  });
  return true;
}

/**
 * 某供应商的 curated 模型 insert + 启动对账（供应商无关）。代码所有：kind + meta.archetypeId（漂移强制对账，
 * 否则模型套错能力）；用户所有：enabled/labelZh/createdAt 保留。返回是否变更。
 */
function reconcileModels(models: Model[], vendorKey: string, curated: CuratedModel[], now: string): boolean {
  let changed = false;
  for (const c of curated) {
    const i = models.findIndex((m) => m.modelKey === c.modelKey && m.vendorKey === vendorKey);
    if (i < 0) {
      models.push({
        modelKey: c.modelKey, vendorKey, labelZh: c.labelZh, kind: c.kind, enabled: true,
        ...(c.archetypeId ? { meta: { archetypeId: c.archetypeId } } : {}),
        createdAt: now, updatedAt: now,
      });
      changed = true;
      continue;
    }
    const ex = models[i];
    const exArch = (ex.meta as { archetypeId?: string } | undefined)?.archetypeId;
    const drift = ex.kind !== c.kind || (Boolean(c.archetypeId) && exArch !== c.archetypeId);
    if (drift) {
      models[i] = {
        ...ex, kind: c.kind,
        ...(c.archetypeId ? { meta: { ...(ex.meta || {}), archetypeId: c.archetypeId } } : {}),
        updatedAt: now,
      };
      changed = true;
    }
  }
  return changed;
}

/**
 * 某供应商的 curated mapping insert + 对账（供应商无关，根因修复见原注释）。
 *   · 已存在（按稳定 seed id）→ 强制对账 create/query/statusMapping/taskKind/modelKey（代码所有），老装机自愈；
 *   · 缺失 → 仅当同 (vendor, taskKind, modelKey) 身份未被用户/onboarding 记录占用时插入（不重复占槽）。
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
        JSON.stringify(ex.create) !== JSON.stringify(c.create) ||
        JSON.stringify(ex.query) !== JSON.stringify(c.query) ||
        JSON.stringify(ex.statusMapping) !== JSON.stringify(c.statusMapping);
      if (drift) {
        mappings[i] = { ...ex, taskKind: c.taskKind, modelKey: c.modelKey, name: ex.name ?? c.name, create: c.create, query: c.query, statusMapping: c.statusMapping, updatedAt: now };
        changed = true;
      }
      continue;
    }
    if (mappings.some((m) => m.vendorKey === vendorKey && m.taskKind === c.taskKind && (m.modelKey || undefined) === (c.modelKey || undefined))) continue;
    mappings.push({
      id: c.id, vendorKey, taskKind: c.taskKind,
      ...(c.modelKey ? { modelKey: c.modelKey } : {}),
      name: c.name, enabled: true, create: c.create, query: c.query, statusMapping: c.statusMapping,
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

  // 供应商：kie + apimart（apimart 为核心变现通道）。
  if (seedVendor(vendors, KIE_VENDOR_SEED, now)) changed = true;
  if (seedVendor(vendors, APIMART_VENDOR_SEED, now)) changed = true;
  if (seedVendor(vendors, MODELSCOPE_VENDOR_SEED, now)) changed = true;
  if (seedVendor(vendors, VOLCENGINE_VENDOR_SEED, now)) changed = true;
  if (seedVendor(vendors, VOLCENGINE_SPEECH_VENDOR_SEED, now)) changed = true;
  if (seedVendor(vendors, DREAMINA_VENDOR_SEED, now)) changed = true;

  // 退役 curated 记录清理（变体合并迁移：删 Seedance 旧变体模型 + mapping 孤儿，picker 收成 1 项）。
  if (pruneRetiredModels(models, APIMART_VENDOR_SEED.key, RETIRED_APIMART_VIDEO_MODEL_KEYS)) changed = true;
  if (pruneRetiredMappings(mappings, RETIRED_APIMART_VIDEO_MAPPING_IDS)) changed = true;
  if (pruneRetiredModels(models, KIE_VENDOR_SEED.key, RETIRED_KIE_VIDEO_MODEL_KEYS)) changed = true;

  // 模型 insert + 对账（两家各跑同一套逻辑）。
  if (reconcileModels(models, KIE_VENDOR_SEED.key, KIE_CURATED_MODELS, now)) changed = true;
  if (reconcileModels(models, APIMART_VENDOR_SEED.key, APIMART_CURATED_MODELS, now)) changed = true;
  if (reconcileModels(models, MODELSCOPE_VENDOR_SEED.key, MODELSCOPE_CURATED_MODELS, now)) changed = true;
  if (reconcileModels(models, VOLCENGINE_VENDOR_SEED.key, VOLCENGINE_CURATED_MODELS, now)) changed = true;
  if (reconcileModels(models, VOLCENGINE_SPEECH_VENDOR_SEED.key, VOLCENGINE_SPEECH_CURATED_MODELS, now)) changed = true;
  if (reconcileModels(models, DREAMINA_VENDOR_SEED.key, DREAMINA_CURATED_MODELS, now)) changed = true;
  if (reconcileModels(models, DREAMINA_VENDOR_SEED.key, DREAMINA_IMAGE_CURATED_MODELS, now)) changed = true;

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
  if (reconcileMappings(mappings, KIE_VENDOR_SEED.key, KIE_CURATED_MAPPINGS, now)) changed = true;
  if (reconcileMappings(mappings, APIMART_VENDOR_SEED.key, APIMART_CURATED_MAPPINGS, now)) changed = true;
  if (reconcileMappings(mappings, MODELSCOPE_VENDOR_SEED.key, MODELSCOPE_CURATED_MAPPINGS, now)) changed = true;
  if (reconcileMappings(mappings, VOLCENGINE_VENDOR_SEED.key, VOLCENGINE_CURATED_MAPPINGS, now)) changed = true;
  if (reconcileMappings(mappings, VOLCENGINE_SPEECH_VENDOR_SEED.key, VOLCENGINE_SPEECH_CURATED_MAPPINGS, now)) changed = true;
  if (reconcileMappings(mappings, DREAMINA_VENDOR_SEED.key, DREAMINA_CURATED_MAPPINGS, now)) changed = true;
  if (reconcileMappings(mappings, DREAMINA_VENDOR_SEED.key, DREAMINA_IMAGE_CURATED_MAPPINGS, now)) changed = true;

  if (!changed) return { state, changed: false };
  return { state: { ...state, vendors, models, mappings }, changed: true };
}
