import type { HttpOperation, ProfileKind } from "./types";
import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";

/** fal.ai official queue API (OpenAPI snapshots fetched 2026-08-30). */
export const FAL_VENDOR_SEED = {
  key: "fal",
  name: "fal.ai",
  baseUrl: "https://queue.fal.run",
  authType: "bearer" as const,
  authHeader: "Authorization",
};

const FAL_HEADERS = { Authorization: "Key {{user_api_key}}", "Content-Type": "application/json" };
const FAL_STATUS = { queued: ["IN_QUEUE"], running: ["IN_PROGRESS"], succeeded: ["COMPLETED"], failed: ["FAILED", "CANCELED", "CANCELLED"] };

type Body = Record<string, unknown>;
type FalMapping = { id: string; modelKey: string; modeId: string; taskKind: ProfileKind; name: string; create: HttpOperation; query: HttpOperation; result: HttpOperation; statusMapping: Record<string, string[]> };
type FalModel = { modelKey: string; labelZh: string; kind: "image" | "video" | "audio" | "model3d"; archetypeId: string; mappings: FalMapping[] };

function normalizeFalKlingV3Body(body: unknown, _context?: RequestTransformContext): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const input = body as Record<string, unknown>;
  const images = Array.isArray(input.image_urls)
    ? input.image_urls.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
    : [];
  delete input.image_urls;
  if (images.length) input.start_image_url = images[0];
  if (images.length > 1) input.end_image_url = images[1];
  return input;
}

registerRequestTransform("fal-kling-v3-image-slots", normalizeFalKlingV3Body, (body) => { normalizeFalKlingV3Body(body); });

/**
 * fal 的 queue **提交**用完整子路径端点（`owner/app[/sub/path]`），但**状态/结果**只挂在
 * `owner/app`（app 根，前两段）上——深子路径的 status/result URL 会 405。
 *
 * ⚠️ **官方文档与实际网关行为不一致，此处以实测为准（诚实标注）**：
 *   docs.fal.ai 的 Async/Queue 页（2026-09-01 抓 https://docs.fal.ai/model-endpoints/queue，页面 JS 渲染，
 *   CDP 取文）示例用 `fal-ai/flux/schnell`，明示提交响应回的
 *     `status_url = https://queue.fal.run/fal-ai/flux/schnell/requests/{id}/status`（result 为 `.../requests/{id}/response`），
 *   即文档说「status/result **保留完整端点路径**」。但**真发实测证伪**——fal 网关自己就把 app 路径收敛到前两段：
 *   2026-09-01 用真 key 对 3 个端点提交后读回 `status_url`（提交即取消，见 /tmp/fal-queue-probe.mjs）：
 *     `bytedance/seedance-2.5/text-to-video` → 回 `bytedance/seedance-2.5/requests/{id}/status`(202)；完整路径 GET 405
 *     `fal-ai/kling-video/v3/pro/text-to-video` → 回 `fal-ai/kling-video/…`(202)；完整路径 405
 *     `fal-ai/flux/schnell`（**即文档那个例子**）→ 回 `fal-ai/flux/…`(202)；文档写的 `fal-ai/flux/schnell/…` 反而 405
 *   （result 端点回的是**裸** `.../requests/{id}`，无 `/response` 后缀——故下方 result path 不拼 `/response`，
 *    job 未完成时该裸路径返 400=结果未就绪、不是 405，证明端点对。）
 *   结论：文档此点已陈旧（还印 flux/schnell 全路径），fal 现役网关一律按前两段。以前 query/result 直接拼完整端点
 *   → 凡端点 > 2 段（Seedance 2.5 / Kling V3 Pro / Gemini Omni / H3-Max / Seedream 5 Pro）轮询恒 405、永远拿不到
 *   状态（BUG-2）。loopback 测试用 `pathname.includes("/requests/")` 宽松匹配，遮住了这个漂移，本地看不出。
 */
function falAppRoot(endpoint: string): string {
  const segments = endpoint.split("/").filter(Boolean);
  return segments.slice(0, 2).join("/");
}

function queueOperations(endpoint: string, body: Body, assetPath: string): { create: HttpOperation; query: HttpOperation; result: HttpOperation } {
  const root = `/${endpoint}`;
  const statusRoot = `/${falAppRoot(endpoint)}`;
  return {
    create: { method: "POST", path: root, headers: FAL_HEADERS, body, response_mapping: { task_id: "request_id", status: "status" }, provider_meta_mapping: { task_id: "request_id" } },
    query: { method: "GET", path: `${statusRoot}/requests/{{providerMeta.task_id}}/status`, headers: { Authorization: "Key {{user_api_key}}" }, response_mapping: { task_id: "request_id", status: "status" } },
    result: { method: "GET", path: `${statusRoot}/requests/{{providerMeta.task_id}}`, headers: { Authorization: "Key {{user_api_key}}" }, response_mapping: { assets: assetPath } },
  };
}

function mapping(modelKey: string, taskKind: ProfileKind, modeId: string, name: string, endpoint: string, body: Body, assetPath: string): FalMapping {
  const ops = queueOperations(endpoint, body, assetPath);
  return { id: `seed-fal-${endpoint.replace(/[^a-z0-9]+/gi, "-")}-${modeId}`, modelKey, modeId, taskKind, name, ...ops, statusMapping: FAL_STATUS };
}

function withCreateOptions(entry: FalMapping, options: Pick<HttpOperation, "paramMap" | "request_transform">): FalMapping {
  return { ...entry, create: { ...entry.create, ...options } };
}

const p = (key: string) => `{{request.params.${key}}}`;

export const FAL_OFFICIAL_MODELS: FalModel[] = [
  {
    modelKey: "fal-ai/nano-banana-2", labelZh: "Nano Banana 2 · fal", kind: "image", archetypeId: "nano-banana-2",
    mappings: [
      mapping("fal-ai/nano-banana-2", "text_to_image", "t2i", "Nano Banana 2 · 文生图", "fal-ai/nano-banana-2", { prompt: "{{request.prompt}}", num_images: p("num_images"), seed: p("seed"), aspect_ratio: p("aspect_ratio"), resolution: p("resolution"), output_format: p("output_format") }, "images[*]"),
      mapping("fal-ai/nano-banana-2", "image_edit", "edit", "Nano Banana 2 · 改图", "fal-ai/nano-banana-2/edit", { prompt: "{{request.prompt}}", image_urls: p("image_urls"), num_images: p("num_images"), seed: p("seed"), aspect_ratio: p("aspect_ratio"), resolution: p("resolution"), output_format: p("output_format") }, "images[*]"),
    ],
  },
  {
    modelKey: "openai/gpt-image-2", labelZh: "GPT Image 2 · fal", kind: "image", archetypeId: "gpt-image-2",
    mappings: [
      withCreateOptions(mapping("openai/gpt-image-2", "text_to_image", "t2i", "GPT Image 2 · 文生图", "openai/gpt-image-2", { prompt: "{{request.prompt}}", image_size: p("image_size"), background: p("background"), quality: p("quality"), num_images: p("num_images"), output_format: p("output_format") }, "images[*]"), { paramMap: { rules: [{ wire: "image_size", fromMany: ["aspect_ratio", "resolution"], transform: "ratioResToFalImageSize" }] } }),
      // modeId 必须是**接收档案自己的 mode.id**：gpt-image-2 档案声明 t2i / i2i（"edit" 是
      // nano-banana-2 / seedream 档案的写法，不是这个档案的）。曾写 "edit" → selectTaskMapping
      // 在 i2i 上永远取不到本条，模式栏把「改图」静默藏掉（2026-09-03 check:orphan-cables 实测）。
      withCreateOptions(mapping("openai/gpt-image-2", "image_edit", "i2i", "GPT Image 2 · 改图", "openai/gpt-image-2/edit", { prompt: "{{request.prompt}}", image_urls: p("image_urls"), image_size: p("image_size"), background: p("background"), quality: p("quality"), num_images: p("num_images"), output_format: p("output_format"), mask_url: p("mask_url") }, "images[*]"), { paramMap: { rules: [{ wire: "image_size", fromMany: ["aspect_ratio", "resolution"], transform: "ratioResToFalImageSize" }] } }),
    ],
  },
  {
    modelKey: "bytedance/seedream/v5/pro", labelZh: "Seedream 5.0 Pro · fal", kind: "image", archetypeId: "seedream-5-pro",
    mappings: [
      withCreateOptions(mapping("bytedance/seedream/v5/pro", "text_to_image", "t2i", "Seedream 5.0 Pro · 文生图", "bytedance/seedream/v5/pro/text-to-image", { prompt: "{{request.prompt}}", image_size: p("image_size"), num_images: p("num_images"), output_format: p("output_format"), enable_safety_checker: p("enable_safety_checker") }, "images[*]"), { paramMap: { drops: ["size", "resolution"], rules: [] } }),
      withCreateOptions(mapping("bytedance/seedream/v5/pro", "image_edit", "edit", "Seedream 5.0 Pro · 改图", "bytedance/seedream/v5/pro/edit", { prompt: "{{request.prompt}}", image_urls: p("image_urls"), image_size: p("image_size"), num_images: p("num_images"), output_format: p("output_format"), enable_safety_checker: p("enable_safety_checker") }, "images[*]"), { paramMap: { drops: ["size", "resolution"], rules: [] } }),
    ],
  },
  {
    modelKey: "minimax/h3-max", labelZh: "MiniMax H3-Max · fal", kind: "video", archetypeId: "minimax-h3-max",
    mappings: [
      mapping("minimax/h3-max", "text_to_video", "t2v", "MiniMax H3-Max · 文生视频", "minimax/h3-max/text-to-video", { prompt: "{{request.prompt}}", duration: p("duration"), resolution: p("resolution"), seed: p("seed"), aspect_ratio: p("aspect_ratio"), enable_safety_checker: p("enable_safety_checker"), prompt_expansion_mode: p("prompt_expansion_mode") }, "video.url"),
      mapping("minimax/h3-max", "image_to_video", "i2v", "MiniMax H3-Max · 图生视频", "minimax/h3-max/image-to-video", { prompt: "{{request.prompt}}", image_url: p("image_url"), end_image_url: p("end_image_url"), duration: p("duration"), resolution: p("resolution"), seed: p("seed"), enable_safety_checker: p("enable_safety_checker"), prompt_expansion_mode: p("prompt_expansion_mode") }, "video.url"),
    ],
  },
  {
    modelKey: "bytedance/seedance-2.5", labelZh: "Seedance 2.5 · fal", kind: "video", archetypeId: "seedance-2.5",
    mappings: [
      withCreateOptions(mapping("bytedance/seedance-2.5", "text_to_video", "t2v", "Seedance 2.5 · 文生视频", "bytedance/seedance-2.5/text-to-video", { prompt: "{{request.prompt}}", resolution: p("resolution"), duration: p("duration"), aspect_ratio: p("aspect_ratio"), generate_audio: p("generate_audio"), bitrate_mode: p("bitrate_mode"), end_user_id: p("end_user_id") }, "video.url"), { paramMap: { drops: ["return_last_frame"], rules: [] } }),
      // 档案 `seedance-2.5` 的 first / firstlast / omni 三个图模式，在 fal 上落到**两个不同端点**
      // （image-to-video 与 reference-to-video）。此前只有一条 `modeId:"i2v"`，三个模式全靠
      // selectTaskMapping 的单候选回落借它——U1 收紧后暴露为「无 mapping」。这里按官方 schema
      // 逐字段补齐各模式**自己的**线缆，modeId 与档案模式 id 严格同名，杜绝再被借用。
      //
      // 官方来源（2026-09-02 抓，逐字段对账）：
      //   image-to-video     https://fal.ai/models/bytedance/seedance-2.5/image-to-video/api
      //     prompt(必填) · image_url(必填,首帧) · end_image_url(选,尾帧) · resolution=720p ·
      //     duration=auto · aspect_ratio=auto · generate_audio=true · bitrate_mode=standard · end_user_id
      //   reference-to-video https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api
      //     prompt(必填) · image_urls≤30 · video_urls≤10 · audio_urls≤10（跨模态合计≤50）· 其余同上
      //
      // **wire 键 ← canonical 键的桥接走 body 模板本身，不写 paramMap 改名规则**：模板取值
      // `{{request.params.first_frame_url}}` 已经是「读 canonical、落 wire 位」，值经 ...extras 直达
      // （types.ts:445「改名/identity 透传不必写」）。再加一条 `{wire:"image_url",from:"first_frame_url"}`
      // 是同一件事的第二份真相，删掉它测试逐字节不变（已用变异实验验证）——按 P1 不留并行实现。
      withCreateOptions(mapping("bytedance/seedance-2.5", "image_to_video", "first", "Seedance 2.5 · 首帧", "bytedance/seedance-2.5/image-to-video", { prompt: "{{request.prompt}}", image_url: p("first_frame_url"), resolution: p("resolution"), duration: p("duration"), aspect_ratio: p("aspect_ratio"), generate_audio: p("generate_audio"), bitrate_mode: p("bitrate_mode"), end_user_id: p("end_user_id") }, "video.url"), { paramMap: { drops: ["return_last_frame"], rules: [] } }),
      withCreateOptions(mapping("bytedance/seedance-2.5", "image_to_video", "firstlast", "Seedance 2.5 · 首尾帧", "bytedance/seedance-2.5/image-to-video", { prompt: "{{request.prompt}}", image_url: p("first_frame_url"), end_image_url: p("last_frame_url"), resolution: p("resolution"), duration: p("duration"), aspect_ratio: p("aspect_ratio"), generate_audio: p("generate_audio"), bitrate_mode: p("bitrate_mode"), end_user_id: p("end_user_id") }, "video.url"), { paramMap: { drops: ["return_last_frame"], rules: [] } }),
      withCreateOptions(mapping("bytedance/seedance-2.5", "image_to_video", "omni", "Seedance 2.5 · 全能参考", "bytedance/seedance-2.5/reference-to-video", { prompt: "{{request.prompt}}", image_urls: p("reference_image_urls"), video_urls: p("reference_video_urls"), audio_urls: p("reference_audio_urls"), resolution: p("resolution"), duration: p("duration"), aspect_ratio: p("aspect_ratio"), generate_audio: p("generate_audio"), bitrate_mode: p("bitrate_mode"), end_user_id: p("end_user_id") }, "video.url"), { paramMap: { drops: ["return_last_frame"], rules: [] } }),
    ],
  },
  {
    modelKey: "fal-ai/kling-video/v3/pro", labelZh: "Kling V3 Pro · fal", kind: "video", archetypeId: "kling-3.0",
    mappings: [
      withCreateOptions(mapping("fal-ai/kling-video/v3/pro", "text_to_video", "t2v", "Kling V3 Pro · 文生视频", "fal-ai/kling-video/v3/pro/text-to-video", { prompt: "{{request.prompt}}", duration: p("duration"), generate_audio: p("generate_audio"), shot_type: p("shot_type"), aspect_ratio: p("aspect_ratio"), negative_prompt: p("negative_prompt"), cfg_scale: p("cfg_scale") }, "video.url"), { paramMap: { drops: ["mode", "sound"], rules: [] } }),
      withCreateOptions(mapping("fal-ai/kling-video/v3/pro", "image_to_video", "i2v", "Kling V3 Pro · 图生视频", "fal-ai/kling-video/v3/pro/image-to-video", { prompt: "{{request.prompt}}", image_urls: p("image_urls"), duration: p("duration"), generate_audio: p("generate_audio"), shot_type: p("shot_type"), aspect_ratio: p("aspect_ratio"), negative_prompt: p("negative_prompt"), cfg_scale: p("cfg_scale") }, "video.url"), { request_transform: "fal-kling-v3-image-slots", paramMap: { drops: ["mode", "sound"], rules: [] } }),
    ],
  },
  {
    modelKey: "google/gemini-omni-flash/v1.1", labelZh: "Gemini Omni Flash 1.1 · fal", kind: "video", archetypeId: "gemini-omni-1.1",
    mappings: [
      withCreateOptions(mapping("google/gemini-omni-flash/v1.1", "text_to_video", "t2v", "Gemini Omni 1.1 · 文生视频", "google/gemini-omni-flash/v1.1/text-to-video", { prompt: "{{request.prompt}}", aspect_ratio: p("aspect_ratio"), resolution: p("resolution"), duration: p("duration") }, "video.url"), { paramMap: { drops: ["seed"], rules: [] } }),
      withCreateOptions(mapping("google/gemini-omni-flash/v1.1", "image_to_video", "reference", "Gemini Omni 1.1 · 参考生视频", "google/gemini-omni-flash/v1.1/reference-to-video", { prompt: "{{request.prompt}}", image_urls: p("image_urls"), reference_video_urls: p("reference_video_urls"), aspect_ratio: p("aspect_ratio"), resolution: p("resolution"), duration: p("duration") }, "video.url"), { paramMap: { drops: ["seed"], rules: [] } }),
      // 档案 `gemini-omni-1.1` 的 firstlast（首帧必填 + 尾帧可选）此前无自己的 mapping，靠单候选
      // 回落借了上面 `modeId:"reference"` 那条——borrow 之后尾帧根本没有落点（reference 端点没有
      // 尾帧键），「首尾帧」实为「单参考图」。fal 有**独立的** image-to-video 端点正好表达这件事。
      //
      // 官方来源（2026-09-02 抓 https://fal.ai/models/google/gemini-omni-flash/v1.1/image-to-video/api）：
      //   prompt(必填) · image_url(必填,"URL of the first frame to animate") ·
      //   end_image_url(选,"interpolated into the optional end image") ·
      //   aspect_ratio=16:9(16:9|9:16) · resolution=720p(360p|720p|1080p|4k) · duration=8(整数)
      //   —— 无 image_urls / reference_video_urls / first_frame_url / last_frame_url。
      // 档案该模式的槽已显式声明 inputKey first_frame_url / last_frame_url；body 模板直接读这两个
      // canonical 键并落在 fal 的 image_url / end_image_url 位上，无需再写 paramMap 改名（同上）。
      withCreateOptions(mapping("google/gemini-omni-flash/v1.1", "image_to_video", "firstlast", "Gemini Omni 1.1 · 首尾帧", "google/gemini-omni-flash/v1.1/image-to-video", { prompt: "{{request.prompt}}", image_url: p("first_frame_url"), end_image_url: p("last_frame_url"), aspect_ratio: p("aspect_ratio"), resolution: p("resolution"), duration: p("duration") }, "video.url"), { paramMap: { drops: ["seed"], rules: [] } }),
    ],
  },
  {
    modelKey: "minimax/music-3", labelZh: "MiniMax Music 3 · fal", kind: "audio", archetypeId: "minimax-music-3",
    mappings: [mapping("minimax/music-3", "text_to_audio", "music", "MiniMax Music 3 · 音乐生成", "minimax/music-3", { prompt: "{{request.prompt}}", lyrics: p("lyrics"), duration: p("duration"), seed: p("seed"), num_inference_steps: p("num_inference_steps"), guidance_scale: p("guidance_scale") }, "audio.url")],
  },
  {
    modelKey: "fal-ai/elevenlabs/sound-effects/v2", labelZh: "Eleven Sound Effects v2 · fal", kind: "audio", archetypeId: "eleven-sfx-v2",
    mappings: [mapping("fal-ai/elevenlabs/sound-effects/v2", "text_to_audio", "sfx", "Eleven Sound Effects v2 · fal", "fal-ai/elevenlabs/sound-effects/v2", { text: "{{request.prompt}}", duration_seconds: p("duration_seconds"), prompt_influence: p("prompt_influence"), output_format: p("output_format"), loop: p("loop") }, "audio.url")],
  },
  {
    modelKey: "hitem3d/hi3d/v3.0", labelZh: "Hi3D v3.0 · fal", kind: "model3d", archetypeId: "hitem3d",
    mappings: [withCreateOptions(mapping("hitem3d/hi3d/v3.0", "image_to_3d", "image", "Hi3D v3.0 · 图生 3D", "hitem3d/hi3d/v3.0/image-to-3d", { model: p("model"), resolution: p("resolution"), enable_texture: p("enable_texture"), enable_pbr: p("enable_pbr"), face_count: p("face_count"), export_format: p("export_format"), enable_safety_checker: p("enable_safety_checker"), image_url: p("image_url"), shading: p("shading") }, "model_mesh.url"), { paramMap: { drops: ["requestType", "face"], rules: [] } })],
  },
];

export const FAL_OFFICIAL_ENDPOINT_COUNT = FAL_OFFICIAL_MODELS.reduce((count, model) => count + model.mappings.length, 0);
