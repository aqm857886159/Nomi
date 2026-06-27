// Replicate 供应商接入 —— 图片「元素拆解」(qwen-image-layered) 的后端地基。
// 对标 Lovart「Edit Elements」：一张图 → N 张可独立编辑的 RGBA 图层。Replicate 是唯一现成可商用、
// 实测可达的托管端点（fal 同款；本机跑不动 57GB 模型）。见 docs/research/2026-06-27-lovart-element-decomposition-research.md。
//
// 与众不同点：**多输出**（一次返回 N 张图层 URL），不套现有单结果 runtime —— 故下一阶段走独立
// decompose IPC 消费本文件的纯 codec（CTO 评审定稿，docs/plan/2026-06-28-element-decomposition-feature.md §3.1）。
// 本文件只放：① 供应商种子（key/鉴权/本地图吞入声明）② 纯 codec（请求构造 + 多输出解析），均可裸测。
//
// API 形状（实查 + 真生成实测固化，2026-06-28，非凭记忆）：
//   提交 POST https://api.replicate.com/v1/models/qwen/qwen-image-layered/predictions
//        header Authorization: Bearer <key>，可带 "Prefer: wait" 同步阻塞（实测 9-13s 出）
//        body { input: { image, num_layers, description:"auto", output_format:"png", go_fast } }
//   响应 { status:"succeeded"|..., output: string[] }（output 即 N 张图层直链，index0=背景，下→上）
//   本地图吞入：POST /v1/files（multipart, field "content"）→ 取 urls.get 当可达 URL 喂模型（实测通）。
import type { AssetIngestion } from "./types";

/** Replicate 供应商种子（裸 baseUrl 到 /v1 + bearer + 文件 API 吞本地图）。 */
export const REPLICATE_VENDOR_SEED = {
  key: "replicate",
  name: "Replicate",
  baseUrl: "https://api.replicate.com/v1",
  authType: "bearer" as const,
  authHeader: "Authorization",
  /** 本地素材（nomi-local://）→ 传 Replicate 文件 API 拿可达 URL（multipart field "content"，取 urls.get）。 */
  assetIngestion: {
    strategy: "upload-multipart",
    endpoint: "https://api.replicate.com/v1/files",
    fileField: "content",
    urlPath: "urls.get",
    authType: "bearer",
    accepts: ["image"],
  } as AssetIngestion,
} as const;

/** 拆解模型（Replicate 官方模型，无版本号，按 owner/name 调）。 */
export const REPLICATE_DECOMPOSE_MODEL = "qwen/qwen-image-layered";

/** 拆解提交端点（官方模型 predictions 路径，相对 baseUrl）。 */
export const REPLICATE_DECOMPOSE_PREDICTIONS_PATH = `/models/${REPLICATE_DECOMPOSE_MODEL}/predictions`;

/** 层数边界（实测：低于 2 无意义；高于 8 过度切分；多人需 6-8 才分得开，见研究 §3.7）。 */
export const DECOMPOSE_LAYERS_MIN = 2;
export const DECOMPOSE_LAYERS_MAX = 8;
export const DECOMPOSE_LAYERS_DEFAULT = 6;

export function clampDecomposeLayers(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DECOMPOSE_LAYERS_DEFAULT;
  return Math.max(DECOMPOSE_LAYERS_MIN, Math.min(DECOMPOSE_LAYERS_MAX, n));
}

/** 纯函数：构造 Replicate 拆解请求 body（codec，可裸测）。imageUrl 须为 vendor 可达的公网/文件 URL。 */
export function buildDecomposeInput(imageUrl: string, numLayers?: number): {
  input: { image: string; num_layers: number; description: string; output_format: string; go_fast: boolean };
} {
  return {
    input: {
      image: imageUrl,
      num_layers: clampDecomposeLayers(numLayers),
      description: "auto",
      output_format: "png",
      go_fast: true,
    },
  };
}

/** 纯函数：从 Replicate 预测响应解析出 N 张图层 URL（codec，可裸测）。output 可能是 string 或 string[]。 */
export function parseDecomposeOutput(output: unknown): string[] {
  if (typeof output === "string") return output.trim() ? [output] : [];
  if (Array.isArray(output)) return output.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  return [];
}
