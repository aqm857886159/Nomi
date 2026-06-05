// 内置模型种子：把主流模型（先 Seedance 2.0 首帧）按 curated 定义写进 catalog，
// 而不是靠用户逐个 onboarding（评审 D2「混合：内置优先」）。
//
// 设计：纯函数 `applyBuiltinSeeds(state) → { state, changed }`，**幂等**且**存在即跳过**
// （按 key 判断，不靠版本号硬塞）——这样：
//   - 用户已手动接过 kie / 改过这些记录，不会被覆盖；
//   - 反复调用安全（runtime 在 catalog 载入后调用一次，changed 才落盘）。
// type-only 复用 runtime 的领域类型，避免第二份定义漂移（评审 P0-3/M1）。

import type { CatalogState, Mapping, Model, Vendor } from "./types";
import {
  KIE_VENDOR_SEED,
  SEEDANCE_2_CREATE_OP,
  SEEDANCE_2_FAST_MODEL_SEED,
  SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING,
  SEEDANCE_2_MODEL_SEED,
  SEEDANCE_2_QUERY_OP,
} from "./kieSeedance";
import { HAPPYHORSE_CREATE_OP, HAPPYHORSE_MAPPING, HAPPYHORSE_MODEL_SEED, HAPPYHORSE_QUERY_OP } from "./kieHappyhorse";

/** 稳定 id：按 (vendor, taskKind, model) 固定，便于幂等与排查。 */
const SEEDANCE_MAPPING_ID = "seed-kie-seedance2-image_to_video";
const HAPPYHORSE_MAPPING_ID = "seed-kie-happyhorse-text_to_video";

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

  if (
    !mappings.some(
      (mp) =>
        mp.vendorKey === KIE_VENDOR_SEED.key &&
        mp.taskKind === SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.taskKind,
    )
  ) {
    const mapping: Mapping = {
      id: SEEDANCE_MAPPING_ID,
      vendorKey: KIE_VENDOR_SEED.key,
      taskKind: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.taskKind,
      name: SEEDANCE_2_IMAGE_TO_VIDEO_MAPPING.name,
      enabled: true,
      create: SEEDANCE_2_CREATE_OP,
      query: SEEDANCE_2_QUERY_OP,
      createdAt: now,
      updatedAt: now,
    };
    mappings.push(mapping);
    changed = true;
  }

  // HappyHorse 1.0（C4）：同 kie vendor，4 模式合 1 条目 + 1 条 (kie, text_to_video) mapping。
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

  if (!mappings.some((mp) => mp.vendorKey === KIE_VENDOR_SEED.key && mp.taskKind === HAPPYHORSE_MAPPING.taskKind)) {
    mappings.push({
      id: HAPPYHORSE_MAPPING_ID,
      vendorKey: KIE_VENDOR_SEED.key,
      taskKind: HAPPYHORSE_MAPPING.taskKind,
      name: HAPPYHORSE_MAPPING.name,
      enabled: true,
      create: HAPPYHORSE_CREATE_OP,
      query: HAPPYHORSE_QUERY_OP,
      createdAt: now,
      updatedAt: now,
    });
    changed = true;
  }

  if (!changed) return { state, changed: false };
  return { state: { ...state, vendors, models, mappings }, changed: true };
}
