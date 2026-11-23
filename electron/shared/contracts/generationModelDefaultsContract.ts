// 「新建卡片默认模型」的用户偏好（用户 2026-08-18 拍板样张后实现）。
//
// 解决的摩擦：新建一张卡时，渲染侧是「从池子里挑第一个健康的模型」——不分任务类型。
// 于是习惯用某个模型做视频的人，每开一张新卡都要重选一次，纯重复劳动。
//
// 设计要点：
// 1. **身份必须是双段 `(vendorKey, modelKey)`**。两个中转站完全可能提供同名模型
//    （`seedream-4.0` 在 Kie.ai 和 APIMart 都有）——只记 modelKey 会串台：
//    用户选的是 A 家的，落到卡片上变成 B 家的，账单和结果都不对。
// 2. **缺席 = 自动选择**。不写默认值进盘：某一类没设置就是没设置，走原有的健康挑选策略。
//    写一份「默认的默认」进文件会产生第二真相源，以后改挑选策略时老用户永远卡在旧值上。
// 3. 清洗只做**格式**校验，不校验模型是否还存在——设置文件不该知道目录的死活。
//    「设了但模型已被删/禁用」由渲染侧在应用时回退到健康挑选（见 generationModelDefaults.ts）。

/** 四类可以设默认模型的生成任务。与渲染侧 TaskKind 的同名成员一一对应。 */
export const GENERATION_DEFAULT_TASK_KINDS = [
  "text_to_image",
  "image_edit",
  "text_to_video",
  "image_to_video",
] as const;

export type GenerationDefaultTaskKind = (typeof GENERATION_DEFAULT_TASK_KINDS)[number];

/**
 * 一条默认模型选择。两段都必填且非空——少任何一段都不构成一个可解析的模型身份，
 * 与其存半条不如当没设置（回退到自动选择，行为可预期）。
 */
export type GenerationModelDefault = {
  vendorKey: string;
  modelKey: string;
};

export type GenerationModelDefaults = {
  schemaVersion: 1;
  /** 只放用户显式设过的任务类型；缺席 = 该类走「自动选择」。 */
  byTaskKind: Partial<Record<GenerationDefaultTaskKind, GenerationModelDefault>>;
};

export const DEFAULT_GENERATION_MODEL_DEFAULTS: GenerationModelDefaults = {
  schemaVersion: 1,
  byTaskKind: {},
};

/**
 * 单段 key 长度上限。不是产品限制，是防写坏：这份设置每次启动都要读进内存，
 * 没有上限时一个循环写入的 bug 就能把它撑爆。真实的 vendor/model key 都是短标识符。
 */
export const GENERATION_MODEL_KEY_MAX_LENGTH = 200;

const TASK_KIND_SET = new Set<string>(GENERATION_DEFAULT_TASK_KINDS);

export function isGenerationDefaultTaskKind(value: unknown): value is GenerationDefaultTaskKind {
  return typeof value === "string" && TASK_KIND_SET.has(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 取一段合法 key：必须是去空白后非空的字符串，且不超长。拿不到就返回 null（整条作废）。 */
function keySegment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > GENERATION_MODEL_KEY_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * 清洗一份可能来自旧版本 / 被手改过 / 被降级写坏的设置文件。
 * 丢弃：未知任务类型、形状不对的条目、两段 key 缺任何一段的条目。
 * 不做的事：不校验模型是否还在目录里（设置层不该知道目录死活，那是渲染侧应用时的事）。
 */
export function normalizeGenerationModelDefaults(value: unknown): GenerationModelDefaults {
  const raw = record(value);
  const rawByTaskKind = record(raw.byTaskKind);
  const byTaskKind: Partial<Record<GenerationDefaultTaskKind, GenerationModelDefault>> = {};
  for (const [taskKind, entry] of Object.entries(rawByTaskKind)) {
    if (!isGenerationDefaultTaskKind(taskKind)) continue;
    const item = record(entry);
    const vendorKey = keySegment(item.vendorKey);
    const modelKey = keySegment(item.modelKey);
    // 半条身份没有意义：解析不出唯一模型，落到卡片上必然是错的那一个。
    if (!vendorKey || !modelKey) continue;
    byTaskKind[taskKind] = { vendorKey, modelKey };
  }
  return { schemaVersion: 1, byTaskKind };
}

/** 双段身份的稳定字符串形式，供 Map/Set 去重与比对使用。 */
export function generationModelDefaultId(value: GenerationModelDefault): string {
  return `${value.vendorKey}:${value.modelKey}`;
}
