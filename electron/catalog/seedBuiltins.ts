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

/** 稳定 id：按 (vendor, taskKind, model) 固定，便于幂等与排查。 */
const SEEDANCE_MAPPING_ID = "seed-kie-seedance2-image_to_video";
const HAPPYHORSE_MAPPING_ID = "seed-kie-happyhorse-text_to_video";
const GPT_IMAGE_2_T2I_MAPPING_ID = "seed-kie-gpt-image-2-text_to_image";
const GPT_IMAGE_2_I2I_MAPPING_ID = "seed-kie-gpt-image-2-image_edit";

/** 模型 meta：指向内置档案（渲染层据此套 UI 模板，见档案层）。 */
const SEEDANCE_MODEL_META = { archetypeId: "seedance-2" };
const SEEDANCE_FAST_MODEL_META = { archetypeId: "seedance-2-fast" };
const HAPPYHORSE_MODEL_META = { archetypeId: "happyhorse" };

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

  if (
    !models.some(
      (m) => m.modelKey === SEEDANCE_2_MODEL_SEED.modelKey && m.vendorKey === KIE_VENDOR_SEED.key,
    )
  ) {
    const model: Model = {
      modelKey: SEEDANCE_2_MODEL_SEED.modelKey,
      vendorKey: KIE_VENDOR_SEED.key,
      labelZh: SEEDANCE_2_MODEL_SEED.labelZh,
      kind: SEEDANCE_2_MODEL_SEED.kind,
      enabled: true,
      meta: SEEDANCE_MODEL_META,
      createdAt: now,
      updatedAt: now,
    };
    models.push(model);
    changed = true;
  }

  // Seedance 2.0 Fast：同族扩展，只多 1 行 model（复用 Seedance 的 image_to_video mapping）。
  if (!models.some((m) => m.modelKey === SEEDANCE_2_FAST_MODEL_SEED.modelKey && m.vendorKey === KIE_VENDOR_SEED.key)) {
    models.push({
      modelKey: SEEDANCE_2_FAST_MODEL_SEED.modelKey,
      vendorKey: KIE_VENDOR_SEED.key,
      labelZh: SEEDANCE_2_FAST_MODEL_SEED.labelZh,
      kind: SEEDANCE_2_FAST_MODEL_SEED.kind,
      enabled: true,
      meta: SEEDANCE_FAST_MODEL_META,
      createdAt: now,
      updatedAt: now,
    });
    changed = true;
  }

  // 所有 curated mapping（Seedance / HappyHorse / GPT）的 insert + 对账统一由文件末尾的 CURATED_MAPPINGS 表驱动。

  // HappyHorse 1.0（C4）：同 kie vendor，4 模式合 1 条目（mapping 见末尾统一表）。
  if (!models.some((m) => m.modelKey === HAPPYHORSE_MODEL_SEED.modelKey && m.vendorKey === KIE_VENDOR_SEED.key)) {
    models.push({
      modelKey: HAPPYHORSE_MODEL_SEED.modelKey,
      vendorKey: KIE_VENDOR_SEED.key,
      labelZh: HAPPYHORSE_MODEL_SEED.labelZh,
      kind: HAPPYHORSE_MODEL_SEED.kind,
      enabled: true,
      meta: HAPPYHORSE_MODEL_META,
      createdAt: now,
      updatedAt: now,
    });
    changed = true;
  }

  // GPT Image 2（图像，2026-06-06）：t2i + i2i 两个模型（mapping 见末尾统一表 + 下面的 repair）。
  // 契约见 kieGptImage2.ts（直连实测确认）。**额外做 repair**：旧版本（用户 onboarding 抽错）留下的
  // 视频形状坏 mapping 会被替换——这不算「覆盖用户编辑」，是修我们自己该内置的坏记录。
  for (const seed of [GPT_IMAGE_2_T2I_MODEL_SEED, GPT_IMAGE_2_I2I_MODEL_SEED]) {
    if (!models.some((m) => m.modelKey === seed.modelKey && m.vendorKey === KIE_VENDOR_SEED.key)) {
      models.push({
        modelKey: seed.modelKey,
        vendorKey: KIE_VENDOR_SEED.key,
        labelZh: seed.labelZh,
        kind: seed.kind,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }
  }

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
  const CURATED_MAPPINGS: { id: string; taskKind: Mapping["taskKind"]; name: string; create: HttpOperation; query: HttpOperation; statusMapping?: Mapping["statusMapping"] }[] = [
    { id: SEEDANCE_MAPPING_ID, taskKind: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.taskKind, name: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.name, create: SEEDANCE_2_CREATE_OP, query: SEEDANCE_2_QUERY_OP },
    { id: HAPPYHORSE_MAPPING_ID, taskKind: HAPPYHORSE_MAPPING.taskKind, name: HAPPYHORSE_MAPPING.name, create: HAPPYHORSE_CREATE_OP, query: HAPPYHORSE_QUERY_OP },
    { id: GPT_IMAGE_2_T2I_MAPPING_ID, taskKind: GPT_IMAGE_2_T2I_MAPPING.taskKind, name: GPT_IMAGE_2_T2I_MAPPING.name, create: GPT_IMAGE_2_T2I_MAPPING.create, query: GPT_IMAGE_2_T2I_MAPPING.query, statusMapping: GPT_IMAGE_2_T2I_MAPPING.statusMapping },
    { id: GPT_IMAGE_2_I2I_MAPPING_ID, taskKind: GPT_IMAGE_2_I2I_MAPPING.taskKind, name: GPT_IMAGE_2_I2I_MAPPING.name, create: GPT_IMAGE_2_I2I_MAPPING.create, query: GPT_IMAGE_2_I2I_MAPPING.query, statusMapping: GPT_IMAGE_2_I2I_MAPPING.statusMapping },
  ];
  for (const c of CURATED_MAPPINGS) {
    const i = mappings.findIndex((m) => m.id === c.id);
    if (i >= 0) {
      const ex = mappings[i];
      const drift =
        ex.taskKind !== c.taskKind ||
        JSON.stringify(ex.create) !== JSON.stringify(c.create) ||
        JSON.stringify(ex.query) !== JSON.stringify(c.query) ||
        JSON.stringify(ex.statusMapping) !== JSON.stringify(c.statusMapping);
      if (drift) {
        mappings[i] = { ...ex, taskKind: c.taskKind, name: ex.name ?? c.name, create: c.create, query: c.query, statusMapping: c.statusMapping, updatedAt: now };
        changed = true;
      }
      continue;
    }
    // 还没有这条 curated 记录：仅当该 (vendor, taskKind) 槽未被占用时插入（GPT repair 修过的记录、
    // 或 Kling 占用的 text_to_video 槽都不被重复，保持既有行为）。
    if (mappings.some((m) => m.vendorKey === KIE_VENDOR_SEED.key && m.taskKind === c.taskKind)) continue;
    mappings.push({
      id: c.id,
      vendorKey: KIE_VENDOR_SEED.key,
      taskKind: c.taskKind,
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
