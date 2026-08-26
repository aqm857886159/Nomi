// 配方与溯源(harness S4-1):一份数据三用(总方案 §7.5)——
// provenance 给人看(N20 复现)、NormalizedRecipe 给机器比(S8 指纹)、事件给审计(N21)。
// 纯函数;P2 修根因:provenance 此前只有 fallback 路径写、profile 主路径漏写,
// 两条路径从此共用本模块(单一真相)。
import crypto from "node:crypto";
import { classifyAssetValue, humanSize, inlineAssetByteLength, inlineAssetMime } from "../catalog/assetValueScheme";
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

/**
 * 内联素材（`data:` URI）在**记账面**上的替身。
 *
 * 记账面 = 指纹(S8) / 溯源(E11) / 事件日志(S4-1) —— 它们要的是「这次用的是哪份素材」这个**身份**，
 * 不是素材本身。而 extras 里的一个 data: URI 动辄几 MB，原样带进去有三处实伤：
 *   ① 溯源随 node.result.provenance **写进 project.json**，每生成一次多躺一份 base64，永不回收；
 *   ② 溯源面板是 `JSON.stringify(params, null, 2)` 直接铺进 <pre> —— 几 MB 就是一次界面级卡死；
 *   ③ 指纹要把整个 extras 先 JSON.stringify 再 sha256，白扛一遍几 MB 的字符串搬运。
 * （事件日志那侧已有结构保证：eventLogRepository 的 MAX_FIELD_BYTES 会把超限字段整条丢掉，
 *   见那里 2026-08-20「九宫格卡半小时」的注释。这里换成摘要后，它记到的反而是有用的身份。）
 *
 * 摘要必须是**内容身份**（sha256 整串）：指纹缓存拿它当「同配方」判据，弱哈希碰撞 = 秒回一张
 * 别人的图，还看不出来。同字节恒同摘要（缓存命中不丢）、异字节恒异摘要（不串图）。
 */
export function inlineAssetDigest(value: string): string {
  const sha = crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `nomi-inline-asset:sha256-${sha};${inlineAssetMime(value)};${humanSize(inlineAssetByteLength(value))}`;
}

/** 递归把结构里的内联素材换成摘要(返回新结构,不改原对象)。非内联值一律原样。 */
export function digestInlineAssets<T>(value: T): T {
  if (classifyAssetValue(value) === "inline-data") return inlineAssetDigest(value as string) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => digestInlineAssets(item)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = digestInlineAssets(item);
    return out as unknown as T;
  }
  return value;
}

function sortedParams(request: RecipeRequestFields): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    ...(request.width != null ? { width: request.width } : {}),
    ...(request.height != null ? { height: request.height } : {}),
    ...(request.steps != null ? { steps: request.steps } : {}),
    ...(request.cfgScale != null ? { cfgScale: request.cfgScale } : {}),
  };
  for (const [key, value] of Object.entries(request.extras || {})) {
    if (!ROUTING_EXTRA_KEYS.has(key) && value != null) raw[key] = digestInlineAssets(value);
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
      // 内联素材换摘要：溯源要随 project.json 永久落盘、还要整段铺进溯源面板（见 inlineAssetDigest）。
      ...(request.extras ? { extras: digestInlineAssets(request.extras) } : {}),
    },
    vendorRequestId: input.vendorRequestId,
    timestamp: Date.now(),
  };
}
