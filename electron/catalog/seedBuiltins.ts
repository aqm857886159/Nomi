// 内置模型种子：把主流模型（先 Seedance 2.0 首帧）按 curated 定义写进 catalog，
// 而不是靠用户逐个 onboarding（评审 D2「混合：内置优先」）。
//
// 设计：纯函数 `applyBuiltinSeeds(state) → { state, changed }`，**幂等**且**存在即跳过**
// （按 key 判断，不靠版本号硬塞）——这样：
//   - 用户已手动接过 kie / 改过这些记录，不会被覆盖；
//   - 反复调用安全（runtime 在 catalog 载入后调用一次，changed 才落盘）。
// type-only 复用 runtime 的领域类型，避免第二份定义漂移（评审 P0-3/M1）。

import type { CatalogState, HttpOperation, Mapping, Model, Vendor } from "./types";
import {
  KIE_VENDOR_SEED,
  SEEDANCE_2_CREATE_OP,
  SEEDANCE_2_FAST_MODEL_SEED,
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

/**
 * 所有 curated 内置模型的**单一真相源**（insert + 启动对账共用，和 mapping 同一套思路）。
 * archetypeId = 能力档案指针（渲染层据此套 UI/能力模板）——它和 kind 是**代码所有**，漂了会让模型套错能力，
 * 是和 mapping 一样的"持久副本漂移"根因，必须对账。enabled / labelZh(用户可能改名) / createdAt = 用户所有，保留。
 * GPT Image 2 暂无 archetype（图像档案路径未补，见缺口清单）——archetypeId 缺省即可，对账结构已就位。
 */
const CURATED_MODELS: { modelKey: string; labelZh: string; kind: Model["kind"]; archetypeId?: string }[] = [
  { modelKey: SEEDANCE_2_MODEL_SEED.modelKey, labelZh: SEEDANCE_2_MODEL_SEED.labelZh, kind: SEEDANCE_2_MODEL_SEED.kind, archetypeId: "seedance-2" },
  { modelKey: SEEDANCE_2_FAST_MODEL_SEED.modelKey, labelZh: SEEDANCE_2_FAST_MODEL_SEED.labelZh, kind: SEEDANCE_2_FAST_MODEL_SEED.kind, archetypeId: "seedance-2-fast" },
  { modelKey: HAPPYHORSE_MODEL_SEED.modelKey, labelZh: HAPPYHORSE_MODEL_SEED.labelZh, kind: HAPPYHORSE_MODEL_SEED.kind, archetypeId: "happyhorse" },
  // GPT Image 2：两个端点 model 都套同一份「GPT Image 2」档案（2 模式：文生图/图生图）。
  // archetypeId 经 model 对账自动写到老装机的这两条记录上（无需迁移）。
  { modelKey: GPT_IMAGE_2_T2I_MODEL_SEED.modelKey, labelZh: GPT_IMAGE_2_T2I_MODEL_SEED.labelZh, kind: GPT_IMAGE_2_T2I_MODEL_SEED.kind, archetypeId: "gpt-image-2" },
  { modelKey: GPT_IMAGE_2_I2I_MODEL_SEED.modelKey, labelZh: GPT_IMAGE_2_I2I_MODEL_SEED.labelZh, kind: GPT_IMAGE_2_I2I_MODEL_SEED.kind, archetypeId: "gpt-image-2" },
  // Seedream（字节）：全新接入，1 个伞模型 + 档案 2 模式（文生图/改图，per-mode enum）。无旧记录，无迁移。
  { modelKey: SEEDREAM_MODEL_SEED.modelKey, labelZh: SEEDREAM_MODEL_SEED.labelZh, kind: SEEDREAM_MODEL_SEED.kind, archetypeId: "seedream" },
  // Nano Banana（Google）：全新接入，伞模型 + 档案 2 模式（文生图/改图）。
  { modelKey: NANO_BANANA_MODEL_SEED.modelKey, labelZh: NANO_BANANA_MODEL_SEED.labelZh, kind: NANO_BANANA_MODEL_SEED.kind, archetypeId: "nano-banana" },
  // 可灵 3.0（最新）：伞模型 + 档案 2 模式（文生/图生视频）。与残留的旧 Kling generic mapping 靠 modelKey 区分。
  { modelKey: KLING_3_MODEL_SEED.modelKey, labelZh: KLING_3_MODEL_SEED.labelZh, kind: KLING_3_MODEL_SEED.kind, archetypeId: "kling-3.0" },
];

export function applyBuiltinSeeds(
  state: CatalogState,
  now: string,
): { state: CatalogState; changed: boolean } {
  const vendors = [...state.vendors];
  const models = [...state.models];
  const mappings = [...state.mappings];
  let changed = false;

  if (!vendors.some((v) => v.key === KIE_VENDOR_SEED.key)) {
    const vendor: Vendor = {
      key: KIE_VENDOR_SEED.key,
      name: KIE_VENDOR_SEED.name,
      enabled: true,
      baseUrlHint: KIE_VENDOR_SEED.baseUrl,
      authType: KIE_VENDOR_SEED.authType,
      authHeader: KIE_VENDOR_SEED.authHeader,
      createdAt: now,
      updatedAt: now,
    };
    vendors.push(vendor);
    changed = true;
  }

  // curated 内置模型：insert + 启动对账（单源 CURATED_MODELS 驱动，和 mapping 同一套——model 也是同一个"抽屉"，
  // 同样的"只插不更"会让 archetypeId 漂移、模型套错能力。代码所有：kind + meta.archetypeId；用户所有：enabled/labelZh/createdAt 保留）。
  for (const c of CURATED_MODELS) {
    const i = models.findIndex((m) => m.modelKey === c.modelKey && m.vendorKey === KIE_VENDOR_SEED.key);
    if (i < 0) {
      models.push({
        modelKey: c.modelKey,
        vendorKey: KIE_VENDOR_SEED.key,
        labelZh: c.labelZh,
        kind: c.kind,
        enabled: true,
        ...(c.archetypeId ? { meta: { archetypeId: c.archetypeId } } : {}),
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
      continue;
    }
    const ex = models[i];
    const exArch = (ex.meta as { archetypeId?: string } | undefined)?.archetypeId;
    const drift = ex.kind !== c.kind || (Boolean(c.archetypeId) && exArch !== c.archetypeId);
    if (drift) {
      models[i] = {
        ...ex,
        kind: c.kind,
        ...(c.archetypeId ? { meta: { ...(ex.meta || {}), archetypeId: c.archetypeId } } : {}),
        updatedAt: now,
      };
      changed = true;
    }
  }

  // 所有 curated mapping（Seedance / HappyHorse / GPT）的 insert + 对账统一由文件末尾的 CURATED_MAPPINGS 表驱动。
  // GPT Image 2 还**额外做 repair**：旧版本（用户 onboarding 抽错）留下的视频形状坏 mapping 会被替换——
  // 这不算「覆盖用户编辑」，是修我们自己该内置的坏记录（契约见 kieGptImage2.ts，直连实测确认）。

  // repair：把视频形状的坏 (kie, text_to_image) 替换成正确的 GPT Image 2 文生图契约。
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

  // ───────── 内置 curated mapping 的**单一真相源** + insert/对账（根因修复） ─────────
  // 根因：curated 的传输塑形（create/query/statusMapping）是**代码所有**（住 kieSeedance/kieHappyhorse/
  // kieGptImage2），但 seed 早先把它**拷贝**进持久化 catalog 且「存在即跳过、永不更新」——于是持久副本成了
  // 第二份真相源，代码一演进（如 Seedance 加 omni 的 reference_*_urls + generate_audio）旧装机就**静默漂移**，
  // 真实生成丢字段（实测：omni 参考图上传了却没进 createTask body）。
  // 修法：把所有 curated mapping 收进这张**唯一**的表，insert 与对账都从它来——
  //   · 缺失 → 插入（仅当该 (vendor,taskKind) 槽未被用户/onboarding 记录占用，保持原行为，不重复占槽）；
  //   · 已存在（按稳定 seed id）→ **强制对账**代码所有字段，让老装机自愈。
  // 所有权边界：create/query/statusMapping/taskKind = 代码所有（对账覆盖）；enabled/name/createdAt = 用户所有（保留）。
  // 加新 curated mapping = 这里加一行，自动覆盖「装新机」与「老机自愈」两条路——这个类的 bug 结构上不再复发。
  // modelKey：把 mapping 绑到特定模型，避免「同 vendor 同 taskKind 两个模型撞一个桶、第一个赢」。
  // HappyHorse 与（用户机器上可能残留的）Kling 都是 (kie, text_to_video) 但请求形状不同 → HappyHorse
  // 显式带 modelKey，selectTaskMapping 精确路由到它。Seedance（含 Fast 共用）/ GPT 仍是 generic（无 modelKey）。
  const CURATED_MAPPINGS: { id: string; taskKind: Mapping["taskKind"]; modelKey?: string; name: string; create: HttpOperation; query: HttpOperation; statusMapping?: Mapping["statusMapping"] }[] = [
    { id: SEEDANCE_MAPPING_ID, taskKind: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.taskKind, name: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.name, create: SEEDANCE_2_CREATE_OP, query: SEEDANCE_2_QUERY_OP },
    { id: HAPPYHORSE_MAPPING_ID, taskKind: HAPPYHORSE_MAPPING.taskKind, modelKey: HAPPYHORSE_MODEL_SEED.modelKey, name: HAPPYHORSE_MAPPING.name, create: HAPPYHORSE_CREATE_OP, query: HAPPYHORSE_QUERY_OP },
    { id: GPT_IMAGE_2_T2I_MAPPING_ID, taskKind: GPT_IMAGE_2_T2I_MAPPING.taskKind, name: GPT_IMAGE_2_T2I_MAPPING.name, create: GPT_IMAGE_2_T2I_MAPPING.create, query: GPT_IMAGE_2_T2I_MAPPING.query, statusMapping: GPT_IMAGE_2_T2I_MAPPING.statusMapping },
    { id: GPT_IMAGE_2_I2I_MAPPING_ID, taskKind: GPT_IMAGE_2_I2I_MAPPING.taskKind, name: GPT_IMAGE_2_I2I_MAPPING.name, create: GPT_IMAGE_2_I2I_MAPPING.create, query: GPT_IMAGE_2_I2I_MAPPING.query, statusMapping: GPT_IMAGE_2_I2I_MAPPING.statusMapping },
    // Seedream 与 GPT 同 (kie, text_to_image/image_edit) 桶 → 带 modelKey 精确路由，不撞（selectTaskMapping）。
    { id: SEEDREAM_T2I_MAPPING_ID, taskKind: SEEDREAM_T2I_MAPPING.taskKind, modelKey: SEEDREAM_T2I_MAPPING.modelKey, name: SEEDREAM_T2I_MAPPING.name, create: SEEDREAM_T2I_MAPPING.create, query: SEEDREAM_T2I_MAPPING.query, statusMapping: SEEDREAM_T2I_MAPPING.statusMapping },
    { id: SEEDREAM_EDIT_MAPPING_ID, taskKind: SEEDREAM_EDIT_MAPPING.taskKind, modelKey: SEEDREAM_EDIT_MAPPING.modelKey, name: SEEDREAM_EDIT_MAPPING.name, create: SEEDREAM_EDIT_MAPPING.create, query: SEEDREAM_EDIT_MAPPING.query, statusMapping: SEEDREAM_EDIT_MAPPING.statusMapping },
    { id: NANO_BANANA_T2I_MAPPING_ID, taskKind: NANO_BANANA_T2I_MAPPING.taskKind, modelKey: NANO_BANANA_T2I_MAPPING.modelKey, name: NANO_BANANA_T2I_MAPPING.name, create: NANO_BANANA_T2I_MAPPING.create, query: NANO_BANANA_T2I_MAPPING.query, statusMapping: NANO_BANANA_T2I_MAPPING.statusMapping },
    { id: NANO_BANANA_EDIT_MAPPING_ID, taskKind: NANO_BANANA_EDIT_MAPPING.taskKind, modelKey: NANO_BANANA_EDIT_MAPPING.modelKey, name: NANO_BANANA_EDIT_MAPPING.name, create: NANO_BANANA_EDIT_MAPPING.create, query: NANO_BANANA_EDIT_MAPPING.query, statusMapping: NANO_BANANA_EDIT_MAPPING.statusMapping },
    // Kling 不再带 statusMapping —— kie 动词已并入通用默认归一（responseParsing），与 Seedance/HappyHorse 一致。
    { id: KLING_3_T2V_MAPPING_ID, taskKind: KLING_3_T2V_MAPPING.taskKind, modelKey: KLING_3_T2V_MAPPING.modelKey, name: KLING_3_T2V_MAPPING.name, create: KLING_3_T2V_MAPPING.create, query: KLING_3_T2V_MAPPING.query },
    { id: KLING_3_I2V_MAPPING_ID, taskKind: KLING_3_I2V_MAPPING.taskKind, modelKey: KLING_3_I2V_MAPPING.modelKey, name: KLING_3_I2V_MAPPING.name, create: KLING_3_I2V_MAPPING.create, query: KLING_3_I2V_MAPPING.query },
  ];
  for (const c of CURATED_MAPPINGS) {
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
    // 还没有这条 curated 记录：仅当**同 (vendor, taskKind, modelKey) 身份**未被占用时插入。
    // 这样 HappyHorse(text_to_video, modelKey=happyhorse) 能与 Kling(text_to_video, generic) 共存；
    // generic 条目（Seedance/GPT）仍不与既有同桶 generic 记录重复（保持原行为）。
    if (mappings.some((m) => m.vendorKey === KIE_VENDOR_SEED.key && m.taskKind === c.taskKind && (m.modelKey || undefined) === (c.modelKey || undefined))) continue;
    mappings.push({
      id: c.id,
      vendorKey: KIE_VENDOR_SEED.key,
      taskKind: c.taskKind,
      ...(c.modelKey ? { modelKey: c.modelKey } : {}),
      name: c.name,
      enabled: true,
      create: c.create,
      query: c.query,
      statusMapping: c.statusMapping,
      createdAt: now,
      updatedAt: now,
    });
    changed = true;
  }

  if (!changed) return { state, changed: false };
  return { state: { ...state, vendors, models, mappings }, changed: true };
}
