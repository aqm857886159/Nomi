// 「新建节点默认用哪个模型」的用户偏好合同（2026-11-27 AutoModel 板拍板升至 schemaVersion 2）。
//
// 设计要点：
// 1. **按媒介收成 `image` / `video` 两项（SG-1）**：图片一行同时管文字出图与改图，
//    视频一行同时管文字出视频与图片出视频。任务层仍保留四类 `GenerationDefaultTaskKind`
//    供执行与规划层按模式校验发布资格（通过 `mediaKindForTaskKind` 映射到两项偏好）。
// 2. **身份必须是双段 `(vendorKey, modelKey)`**：两个中转站可能提供同名模型，只记 modelKey 会串台。
// 3. **缺席 = 自动（推荐梯队 + 本机可用连接 + 连败避让）**：不把当前推荐模型写死进盘，
//    避免目录升级推荐模型后老用户永远卡在旧值上。
// 4. **老用户旧 `schemaVersion: 1`（4 行 `byTaskKind`）不迁移（SG-3）**：读取旧版文件时不报错、
//    不猜冲突四键，直接归一为 `{ schemaVersion: 2, byKind: {} }` 回到「自动」。

/** 两类可设默认模型的生成媒介（设置 › AI 策略 2 行）。 */
export const GENERATION_DEFAULT_MEDIA_KINDS = ["image", "video"] as const;

export type GenerationDefaultMediaKind = (typeof GENERATION_DEFAULT_MEDIA_KINDS)[number];

/** 四类生成任务（与渲染侧 / 主进程规划层 TaskKind 一一对应）。 */
export const GENERATION_DEFAULT_TASK_KINDS = [
  "text_to_image",
  "image_edit",
  "text_to_video",
  "image_to_video",
] as const;

export type GenerationDefaultTaskKind = (typeof GENERATION_DEFAULT_TASK_KINDS)[number];

export const TASK_KINDS_BY_MEDIA: Readonly<
  Record<GenerationDefaultMediaKind, readonly [GenerationDefaultTaskKind, GenerationDefaultTaskKind]>
> = {
  image: ["text_to_image", "image_edit"],
  video: ["text_to_video", "image_to_video"],
};

export function mediaKindForTaskKind(taskKind: GenerationDefaultTaskKind): GenerationDefaultMediaKind {
  return taskKind === "text_to_image" || taskKind === "image_edit" ? "image" : "video";
}

/**
 * 一条默认模型选择。两段都必填且非空——少任何一段都不构成唯一可解析的模型身份，
 * 与其存半条不如当没设置（回退到自动，行为可预期）。
 */
export type GenerationModelDefault = {
  vendorKey: string;
  modelKey: string;
};

export type GenerationModelDefaults = {
  schemaVersion: 2;
  /** 只放用户显式设过的媒介类型；缺席 = 该类走「自动」。 */
  byKind: Partial<Record<GenerationDefaultMediaKind, GenerationModelDefault>>;
};

export const DEFAULT_GENERATION_MODEL_DEFAULTS: GenerationModelDefaults = {
  schemaVersion: 2,
  byKind: {},
};

/**
 * 单段 key 长度上限。防写坏保护：这份设置每次启动读进内存，真实的 vendor/model key 都是短标识符。
 */
export const GENERATION_MODEL_KEY_MAX_LENGTH = 200;

const MEDIA_KIND_SET = new Set<string>(GENERATION_DEFAULT_MEDIA_KINDS);
const TASK_KIND_SET = new Set<string>(GENERATION_DEFAULT_TASK_KINDS);

export function isGenerationDefaultMediaKind(value: unknown): value is GenerationDefaultMediaKind {
  return typeof value === "string" && MEDIA_KIND_SET.has(value);
}

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
 * 清洗一份可能来自旧版本 / 被手改过 / 被写坏的设置文件。
 * - SG-3：非 `schemaVersion: 2`（含老用户的 `schemaVersion: 1` 四行 `byTaskKind`）一律不迁移，
 *   安全返回 `{ schemaVersion: 2, byKind: {} }` 回到「自动」。
 * - 丢弃：未知媒介类型、形状不对的条目、两段 key 缺任何一段的条目。
 */
export function normalizeGenerationModelDefaults(value: unknown): GenerationModelDefaults {
  const raw = record(value);
  if (raw.schemaVersion !== 2) {
    return { schemaVersion: 2, byKind: {} };
  }
  const rawByKind = record(raw.byKind);
  const byKind: Partial<Record<GenerationDefaultMediaKind, GenerationModelDefault>> = {};
  for (const [mediaKind, entry] of Object.entries(rawByKind)) {
    if (!isGenerationDefaultMediaKind(mediaKind)) continue;
    const item = record(entry);
    const vendorKey = keySegment(item.vendorKey);
    const modelKey = keySegment(item.modelKey);
    if (!vendorKey || !modelKey) continue;
    byKind[mediaKind] = { vendorKey, modelKey };
  }
  return { schemaVersion: 2, byKind };
}

/** 双段身份的稳定字符串形式，供 Map/Set 去重与比对使用。 */
export function generationModelDefaultId(value: GenerationModelDefault): string {
  return `${value.vendorKey}:${value.modelKey}`;
}
