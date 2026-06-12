// 配方与溯源(harness S4-1):一份数据三用(总方案 §7.5)——
// provenance 给人看(N20 复现)、NormalizedRecipe 给机器比(S8 指纹)、事件给审计(N21)。
// 纯函数零依赖;P2 修根因:provenance 此前只有 fallback 路径写、profile 主路径漏写,
// 两条路径从此共用本模块(单一真相)。
import type { Model, Vendor } from "../catalog/types";

/** 与 runtime.TaskResult["provenance"] 结构兼容(该类型为 runtime 私有,这里结构化对齐)。 */
export type TaskProvenance = {
  provider?: string;
  modelKey?: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  params?: Record<string, unknown>;
  vendorRequestId?: string;
  timestamp: number;
};

/** 生成请求里决定产物的字段(结构对齐 runtime.TaskRequest 的子集,避免循环依赖)。 */
export type RecipeRequestFields = {
  kind: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number | null;
  height?: number | null;
  steps?: number | null;
  cfgScale?: number | null;
  extras?: Record<string, unknown> | null;
};

export type NormalizedRecipe = {
  vendorKey: string;
  modelKey: string;
  mappingId?: string;
  kind: string;
  prompt: string;
  seed?: number;
  /** 键已排序;剔除 projectId/nodeId 等路由字段(它们不影响生成产物,进指纹会假漂)。 */
  params: Record<string, unknown>;
};

// forceRerun 是缓存控制旗标(S8 强制重跑),不影响生成产物——进指纹会假漂。
const ROUTING_EXTRA_KEYS = new Set(["projectId", "nodeId", "forceRerun"]);

function sortedParams(request: RecipeRequestFields): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    ...(request.width != null ? { width: request.width } : {}),
    ...(request.height != null ? { height: request.height } : {}),
    ...(request.steps != null ? { steps: request.steps } : {}),
    ...(request.cfgScale != null ? { cfgScale: request.cfgScale } : {}),
  };
  for (const [key, value] of Object.entries(request.extras || {})) {
    if (!ROUTING_EXTRA_KEYS.has(key) && value != null) raw[key] = value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort()) out[key] = raw[key];
  return out;
}

export function buildNormalizedRecipe(input: {
  vendor: Vendor;
  model: Model;
  mappingId?: string;
  request: RecipeRequestFields;
}): NormalizedRecipe {
  return {
    vendorKey: input.vendor.key,
    modelKey: input.model.modelAlias || input.model.modelKey,
    ...(input.mappingId ? { mappingId: input.mappingId } : {}),
    kind: input.request.kind,
    prompt: input.request.prompt,
    ...(typeof input.request.seed === "number" ? { seed: input.request.seed } : {}),
    params: sortedParams(input.request),
  };
}

/** E11 复现溯源——profile 与 fallback 两条路径共用(修主路径漏写根因)。 */
export function buildTaskProvenance(input: {
  vendor: Vendor;
  model: Model;
  request: RecipeRequestFields;
  vendorRequestId: string;
}): TaskProvenance {
  const { request } = input;
  return {
    provider: input.vendor.key,
    modelKey: input.model.modelAlias || input.model.modelKey,
    prompt: request.prompt,
    ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
    ...(typeof request.seed === "number" ? { seed: request.seed } : {}),
    params: {
      ...(request.width != null ? { width: request.width } : {}),
      ...(request.height != null ? { height: request.height } : {}),
      ...(request.steps != null ? { steps: request.steps } : {}),
      ...(request.cfgScale != null ? { cfgScale: request.cfgScale } : {}),
      ...(request.extras ? { extras: request.extras } : {}),
    },
    vendorRequestId: input.vendorRequestId,
    timestamp: Date.now(),
  };
}
