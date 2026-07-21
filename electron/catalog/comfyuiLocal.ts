// 本地 ComfyUI 接入（A 线：当生成后端，窄·稳）。plan：docs/plan/2026-07-04-local-comfyui-provider.md
//
// 为什么能几乎只写数据：Nomi 生成侧声明驱动——一个 vendor + 一条 Mapping{create,query}（带 {{}} 模板的
// HttpOperation）即跑通「提交→轮询→取产物」，runtime/状态机/缓存/素材本地化/付费守卫全通用（P4）。
// ComfyUI 官方原生 HTTP（社区 MCP/插件底层都走它，非凭记忆——实查 artokun/comfyui-mcp、RH_OpenAPI）：
//   提交 POST /prompt        body {prompt:<API 格式工作流图>, client_id}         → {prompt_id, number}
//   轮询 GET  /history/{id}   → { "<prompt_id>": { status:{status_str}, outputs:{ "<node>":{images:[{filename,subfolder,type}]} } } }
//   取图 GET  /view?filename=..&subfolder=..&type=..
//
// 两处点路径 response_mapping 直接读不了，故用通用「命名响应变换」钩子（electron/tasks/responseTransforms.ts）
// 把 /history 归一成稳定 { image_url }：① 顶层键是动态 prompt_id（unwrap 单键）；② 取图要从
// filename+subfolder+type 拼 baseUrl/view URL。变换住本文件、runtime 只按名查表（不含 ComfyUI 分支）。
//
// 无鉴权本地服务：authType 'none'（生成门槛 modelCatalogCache/catalogStore 早已「authType none + enabled 即可执行」，
// 不要 key）；vendor 默认 enabled:false —— 99% 用户不跑本地 ComfyUI，开箱不该多一堆会失败的 workflow（污染防护），
// 用户在「可接入」显式启用。
//
// 参数键刻意用 comfy_* 前缀（非 width/height/seed/steps/cfg/negative_prompt）：taskTemplateParams 会把这些
// 标准键从 request 顶层字段**重新派生**、headless 下顶层为空会把它们清成 undefined → workflow 图里该数字节点
// 丢键报错（实查 taskParams.ts:78-84）。用 comfy_* 走 `...extras` 直通、不被派生覆盖。
import { COMFYUI_VENDOR_KEY, type HttpOperation } from "./types";
import { registerResponseTransform, type ResponseTransformFn } from "../tasks/responseTransforms";

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ComfyUI 执行出错时从 status.messages 抽人话（形如 [["execution_error",{exception_message}], ...]）。 */
function comfyuiErrorMessage(status: Record<string, unknown>): string {
  const messages = Array.isArray(status.messages) ? status.messages : [];
  for (const m of messages) {
    if (Array.isArray(m) && m[0] === "execution_error" && isRec(m[1])) {
      const detail = m[1] as Record<string, unknown>;
      if (typeof detail.exception_message === "string" && detail.exception_message.trim()) {
        return `ComfyUI 执行失败：${detail.exception_message}`;
      }
    }
  }
  return "ComfyUI 执行失败（检查 checkpoint 文件名 / 工作流节点是否齐全）";
}

/** 从 image 产物项拼 /view 完整 URL（baseUrl 缺省回落默认端口）。 */
function buildViewUrl(baseUrl: string, img: Record<string, unknown>): string {
  const base = (baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
  const qs = new URLSearchParams({
    filename: String(img.filename ?? ""),
    subfolder: typeof img.subfolder === "string" ? img.subfolder : "",
    type: typeof img.type === "string" ? img.type : "output",
  }).toString();
  return `${base}/view?${qs}`;
}

type ComfyAssetKind = "image" | "video";

// 落盘扩展名集合（实查内置 SaveImage/SaveAnimatedWEBP/SaveAnimatedPNG、VHS_VideoCombine、原生 SaveVideo、
// 社区 save-image-extended[AVIF/WebP/JPEG]，docs.comfy.org + 各节点源 2026-07）——放宽到含 heic/jxl/ts/flv 等
// 少见但真实会出现的格式，减少「出了图却不认」的漏拉。
const IMAGE_EXTENSIONS = new Set([
  "apng", "avif", "bmp", "gif", "heic", "heif", "ico", "jfif", "jpeg", "jpg", "jxl",
  "png", "svg", "tga", "tif", "tiff", "webp",
]);
const VIDEO_EXTENSIONS = new Set([
  "3gp", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "ogv", "ts", "webm",
]);
// 中间产物 / 非可预览文件：即便带完整 {filename,subfolder,type} 三元组也不当产物拉
// （SaveLatent 同样出 /view 三元组，靠这条挡住，别把 latent/权重/文本误当图）。
const NON_MEDIA_EXTENSIONS = new Set([
  "latent", "safetensors", "ckpt", "pt", "pth", "bin", "gguf", "onnx", "pkl",
  "json", "txt", "yaml", "yml", "csv", "npy", "npz",
]);
const VIEW_FOLDER_TYPES = new Set(["output", "temp", "input"]);

function hasFilename(value: unknown): value is Record<string, unknown> {
  return isRec(value) && typeof value.filename === "string" && value.filename.trim().length > 0;
}

function assetExtension(asset: Record<string, unknown>): string {
  const filename = String(asset.filename || "").split(/[?#]/, 1)[0];
  return filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
}

/**
 * 判一个产物项是图还是视频，判不了返 null（跳过）。判据按「可信度」排序、不写死节点名（P4 通用）：
 *   ① 文件扩展名（最可信——.mp4 就是视频，管它挂在哪个键下；治「视频挂在非 gifs/videos 键 → 被键名误判成图 →
 *      视频路读 video_url 读空 → 一直轮询到超时」）；② 已知中间产物扩展名 → 跳过（挡 latent/权重/文本）；
 *   ③ format/mime；④ 父键名兜底（images/preview→图，gifs/videos→视频）；
 *   ⑤ 最后「不漏」兜底：带完整 ComfyUI /view 三元组（filename+subfolder+type∈output/temp/input）但仍判不出的
 *      未知扩展名 → 当图拉（②已挡掉中间产物，剩下极可能是我们没枚举的新图片格式；代价：未知**视频**格式会被
 *      当图 → 视频路仍漏，属可接受的保守取舍）。
 */
function kindFromAsset(asset: Record<string, unknown>, parentKey: string): ComfyAssetKind | null {
  const extension = assetExtension(asset);
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (NON_MEDIA_EXTENSIONS.has(extension)) return null;

  const format = [asset.format, asset.mime_type, asset.mimeType, asset.content_type]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (format.includes("video/")) return "video";
  if (format.includes("image/")) return "image";

  const key = parentKey.toLowerCase();
  if (key === "images" || key === "image" || key.includes("preview")) return "image";
  if (key === "gifs" || key === "videos" || key === "video") return "video";

  const hasViewTriple = typeof asset.subfolder === "string" && typeof asset.type === "string" && VIEW_FOLDER_TYPES.has(asset.type);
  if (hasViewTriple && extension.length > 0) return "image";
  return null;
}

/**
 * 递归扫描节点输出、按结构特征（不写死节点名）识别第一张图 + 第一个视频。判类型交给 kindFromAsset
 * （扩展名→中间产物挡→mime→键名→/view 三元组兜底）；这样兼容 result/files/saved_files/output 等任意
 * 自定义保存节点的键名，同时不会把 latent/checkpoint 误当成可预览产物。标准键（gifs/videos/images）先访问，
 * 只是为了同节点同时出「预览图 + 最终视频」时选对，不影响自定义键的识别。
 */
function findOutputAssets(outputs: Record<string, unknown>): { image: Record<string, unknown> | null; video: Record<string, unknown> | null } {
  let image: Record<string, unknown> | null = null;
  let video: Record<string, unknown> | null = null;
  const seen = new Set<unknown>();

  const visit = (value: unknown, parentKey = ""): void => {
    if (image && video) return;
    if ((isRec(value) || Array.isArray(value)) && seen.has(value)) return;
    if (isRec(value) || Array.isArray(value)) seen.add(value);

    if (hasFilename(value)) {
      const kind = kindFromAsset(value, parentKey);
      if (kind === "image" && !image) image = value;
      if (kind === "video" && !video) video = value;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parentKey);
      return;
    }
    if (!isRec(value)) return;

    // 标准键优先，避免同一节点同时带预览图和最终视频时选错。
    for (const key of ["gifs", "videos", "images"]) {
      if (key in value) visit(value[key], key);
    }
    for (const [key, nested] of Object.entries(value)) {
      if (key === "gifs" || key === "videos" || key === "images") continue;
      visit(nested, key);
    }
  };

  visit(outputs);
  return { image, video };
}

/** 找到真正的 history entry，兼容动态 prompt_id、多顶层字段以及 data/history/result 包装。 */
function findHistoryEntry(response: Record<string, unknown>): Record<string, unknown> | null {
  if (isRec(response.outputs) || isRec(response.status)) return response;

  const seen = new Set<unknown>();
  const candidates: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      for (const item of value) visit(item);
      return;
    }
    if (!isRec(value) || seen.has(value)) return;
    seen.add(value);
    if (isRec(value.outputs) || isRec(value.status)) candidates.push(value);
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(response);
  return candidates.find((entry) => isRec(entry.outputs)) ?? candidates[0] ?? null;
}

/**
 * ComfyUI /history/{id} 响应归一（命名变换 "comfyui-history"）。三态：
 *   · 成功：outputs 里第一个产物 → { image_url } 和/或 { video_url }（runtime 拿到 assetUrl 即判 succeeded）；
 *       视频键是 gifs/videos（VHS_VideoCombine 历史命名：mp4/webm 也落 gifs；原生 SaveVideo 可能落 videos，
 *       实查 Kosinkadink/ComfyUI-VideoHelperSuite + docs.comfy.org 2026-07），图片键 images。两者可同时出
 *       （视频 + 预览帧）→ 各出各的 key，让 mapping 的 response_mapping 各取所需（图片路读 image_url、视频路读 video_url）。
 *   · 失败：status.status_str==="error" → { error }（runtime → failed，fail fast 不空转到超时）；
 *   · 未完成：空 {} / outputs 未出现 / 明确 completed:false 且无可识别产物 → 原样返回（继续轮询）；
 *   · 完成但无文件：返回 { error }，提示工作流补保存输出节点，避免一直轮询到超时。
 * 纯函数（导出供单测），注册为副作用（seedBuiltins 于启动期 import 本文件 → 任务触发时表已就绪）。
 */
export const comfyuiHistoryTransform: ResponseTransformFn = (response, { baseUrl }) => {
  if (!isRec(response)) return response;
  // 空 {} = 任务未进 history；非空响应则递归定位真正的 prompt history entry。
  const entry = findHistoryEntry(response);
  if (!entry) return response;

  const status = isRec(entry.status) ? entry.status : null;
  if (status && status.status_str === "error") {
    return { error: comfyuiErrorMessage(status) };
  }

  const outputs = isRec(entry.outputs) ? entry.outputs : null;
  if (!outputs) return response; // outputs 未出现 → 未完成
  const { video, image } = findOutputAssets(outputs);
  if (!video && !image) {
    const statusText = typeof status?.status_str === "string" ? status.status_str.toLowerCase() : "";
    const explicitlyIncomplete = status?.completed === false;
    const completed = status?.completed === true || (!explicitlyIncomplete && ["success", "completed", "complete"].includes(statusText));
    if (completed) {
      return { error: "ComfyUI 已生成完成，但工作流没有返回可下载的图片或视频文件（请检查输出节点是否保存文件）" };
    }
    return response;
  }
  return {
    ...(video ? { video_url: buildViewUrl(baseUrl, video) } : {}),
    ...(image ? { image_url: buildViewUrl(baseUrl, image) } : {}),
  };
};

registerResponseTransform("comfyui-history", comfyuiHistoryTransform);

// ─────────────────────────────────────────────────────────────────────────────
// 供应商种子（无鉴权本地服务，默认关）
// ─────────────────────────────────────────────────────────────────────────────
export const COMFYUI_VENDOR_SEED = {
  key: COMFYUI_VENDOR_KEY,
  name: "本地 ComfyUI",
  baseUrl: "http://127.0.0.1:8188",
  authType: "none" as const,
  authHeader: null,
  enabled: false, // 默认关：用户在「可接入」显式启用（无 key，污染防护）
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 文生图预置 workflow（ComfyUI 官方默认图，API 格式）+ 动态参数控件
// ─────────────────────────────────────────────────────────────────────────────
// meta.parameters 控件（parseModelParameterControls 消费）。default 走 UI 路；同表派生 create.defaultParams
// 走 headless/MCP 路（单一真相源，不各写一份漂移）。prompt 走标准 {{request.prompt}} 槽、不在此表。
const TXT2IMG_PARAMETERS = [
  { key: "ckpt_name", label: "模型权重（checkpoint 文件名）", type: "text", default: "v1-5-pruned-emaonly.safetensors", placeholder: "你 ComfyUI/models/checkpoints 目录里的文件名" },
  { key: "comfy_width", label: "宽度", type: "number", default: 512, min: 64, max: 2048, step: 64 },
  { key: "comfy_height", label: "高度", type: "number", default: 512, min: 64, max: 2048, step: 64 },
  { key: "comfy_steps", label: "采样步数", type: "number", default: 20, min: 1, max: 100, step: 1 },
  { key: "comfy_cfg", label: "CFG 提示词强度", type: "number", default: 7, min: 1, max: 20, step: 0.5 },
  {
    key: "comfy_sampler", label: "采样器", type: "select", default: "euler",
    options: ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_sde", "ddim", "uni_pc"],
  },
  { key: "comfy_seed", label: "随机种子", type: "number", default: 156680208700286 },
  { key: "comfy_negative", label: "负向提示词", type: "text", default: "", placeholder: "不想出现的内容（可留空）" },
] as const;

/** 从参数表派生 headless 兜底默认值（单一真相源：与 UI 控件 default 同表，避免两处漂移）。 */
const TXT2IMG_DEFAULT_PARAMS: Record<string, unknown> = Object.fromEntries(
  TXT2IMG_PARAMETERS.map((p) => [p.key, p.default]),
);

// ComfyUI 官方默认文生图工作流（API 格式，节点 inputs 里埋 {{}}——renderTemplateValue 完全递归、深层注入；
// 精确 {{expr}} 返回原始值故数字保持数字）。节点连线 ["4",0] 无 {{}} → 原样不动。
const TXT2IMG_GRAPH = {
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: "{{request.params.comfy_seed}}",
      steps: "{{request.params.comfy_steps}}",
      cfg: "{{request.params.comfy_cfg}}",
      sampler_name: "{{request.params.comfy_sampler}}",
      scheduler: "normal",
      denoise: 1,
      model: ["4", 0],
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["5", 0],
    },
  },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{request.params.ckpt_name}}" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: "{{request.params.comfy_width}}", height: "{{request.params.comfy_height}}", batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "{{request.prompt}}", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "{{request.params.comfy_negative}}", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "Nomi", images: ["8", 0] } },
};

const TXT2IMG_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/prompt",
  headers: { "Content-Type": "application/json" },
  body: { prompt: TXT2IMG_GRAPH, client_id: "nomi" },
  response_mapping: { task_id: "prompt_id" }, // /prompt 返 {prompt_id} → providerMeta.task_id
  defaultParams: TXT2IMG_DEFAULT_PARAMS,
};

const TXT2IMG_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/history/{{providerMeta.task_id}}", // op.path 经 renderTemplateValue 渲染（requestPipeline.ts:262）
  response_transform: "comfyui-history", // /history 归一成 { image_url } | { error } | 原样
  response_mapping: { image_url: "image_url", error_message: "error" },
};

export const COMFYUI_CURATED_MODELS = [
  { modelKey: "comfyui-txt2img", labelZh: "本地 · 文生图", kind: "image" as const, meta: { parameters: TXT2IMG_PARAMETERS } },
];

export const COMFYUI_CURATED_MAPPINGS = [
  {
    id: "seed-comfyui-local-txt2img-text_to_image",
    taskKind: "text_to_image" as const,
    modelKey: "comfyui-txt2img",
    name: "本地 ComfyUI · 文生图",
    create: TXT2IMG_CREATE_OP,
    query: TXT2IMG_QUERY_OP,
  },
];
