// apimart 视频模型的 curated 传输配方（6 个高频视频模型，单源）。契约见
// docs/plan/2026-06-07-apimart-curated-onboarding.md 附录 A（R5 抓 + Sora 2 已真 mp4 验证）；
// VEO 3.1 的别名/范围归一参考 R6 对标（Infinite-Canvas 的 apimart_veo31_* helper）。
//
// apimart 视频创建是扁平 body：POST /v1/videos/generations { model, prompt, <按模型不同的字段> }
//   → { code:200, data:[{ status:"submitted", task_id }] }。轮询/结果与图片同构（已验证视频结果
//   在 data.result.videos[0].url[0]，url 是嵌套数组）→ 共用 apimartVendor 的 APIMART_VIDEO_QUERY_OP。
//
// 字段名分歧（这正是每条 mapping 各自翻译的原因）：
//   比例：aspect_ratio(sora/veo/kling) · size(seedance/wan) · 无(hailuo)
//   清晰度：resolution(多数) · mode(kling)
//   图生视频：image_urls 数组(多数) · first_frame_image 字符串(hailuo)
//   音频：audio(kling) · generate_audio(seedance)

import type { HttpOperation, ProfileKind } from "./types";
import { APIMART_CREATE_TASK_ID_PATH, APIMART_STATUS_MAPPING, APIMART_VIDEO_QUERY_OP } from "./apimartVendor";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

function videoCreateOp(bodyFields: Record<string, unknown>): HttpOperation {
  return {
    method: "POST",
    path: "/v1/videos/generations",
    headers: CREATE_HEADERS,
    body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", ...bodyFields },
    response_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
    provider_meta_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
  };
}

// 通用 snake 参数引用（值取自档案控件/槽，键 = 各模型 apimart 字段名）。
const ASPECT = "{{request.params.aspect_ratio}}";
const SIZE = "{{request.params.size}}";
const RESOLUTION = "{{request.params.resolution}}";
const DURATION = "{{request.params.duration}}";
const MODE = "{{request.params.mode}}";
const AUDIO = "{{request.params.audio}}";
const GEN_AUDIO = "{{request.params.generate_audio}}";
const IMAGE_URLS = "{{request.params.image_urls}}"; // image_ref 槽 inputKey=image_urls
const FIRST_FRAME_IMAGE = "{{request.params.first_frame_image}}"; // hailuo first_frame 槽 inputKey=first_frame_image

export type ApimartVideoModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

function videoModel(p: {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  t2vBody: Record<string, unknown>;
  i2vBody?: Record<string, unknown>;
}): ApimartVideoModel {
  const mappings: ApimartVideoModel["mappings"] = [
    { id: `seed-apimart-${p.archetypeId}-text_to_video`, taskKind: "text_to_video", name: `${p.labelZh} · 文生视频`, create: videoCreateOp(p.t2vBody) },
  ];
  if (p.i2vBody) {
    mappings.push({ id: `seed-apimart-${p.archetypeId}-image_to_video`, taskKind: "image_to_video", name: `${p.labelZh} · 图生视频`, create: videoCreateOp(p.i2vBody) });
  }
  return { modelKey: p.modelKey, labelZh: p.labelZh, archetypeId: p.archetypeId, mappings };
}

/** 6 个 apimart 视频模型（单源）。 */
export const APIMART_VIDEO_MODELS: ApimartVideoModel[] = [
  videoModel({
    modelKey: "sora-2", labelZh: "Sora 2", archetypeId: "sora-2",
    t2vBody: { aspect_ratio: ASPECT, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS }, // i2v 时 aspect 由图自动决定
  }),
  videoModel({
    modelKey: "veo3.1-fast", labelZh: "Veo 3.1", archetypeId: "veo-3.1",
    t2vBody: { aspect_ratio: ASPECT, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS },
  }),
  // Kling v3：共享 kie 的 kling-3.0 档案（i2v 结构对齐：image_urls 数组槽）+ apimart vendorParams。
  videoModel({
    modelKey: "kling-v3", labelZh: "可灵 v3", archetypeId: "kling-3.0",
    t2vBody: { mode: MODE, duration: DURATION, aspect_ratio: ASPECT, audio: AUDIO },
    i2vBody: { mode: MODE, duration: DURATION, image_urls: IMAGE_URLS, audio: AUDIO },
  }),
  // Seedance 2.0：独立 apimart 档案（i2v 用 image_urls 数组，与 kie 的 first/last/omni 结构不同）。
  videoModel({
    modelKey: "doubao-seedance-2.0", labelZh: "Seedance 2.0", archetypeId: "seedance-2-apimart",
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, generate_audio: GEN_AUDIO },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS, generate_audio: GEN_AUDIO },
  }),
  videoModel({
    modelKey: "wan2.7", labelZh: "Wan 2.7", archetypeId: "wan-2.7",
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS },
  }),
  // Hailuo 2.3：无 aspect_ratio；图生视频用 first_frame_image（字符串，非数组）。
  videoModel({
    modelKey: "MiniMax-Hailuo-2.3", labelZh: "Hailuo 2.3", archetypeId: "hailuo-2.3",
    t2vBody: { resolution: RESOLUTION, duration: DURATION },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, first_frame_image: FIRST_FRAME_IMAGE },
  }),
  // Omni-Flash-Ext：Omni 类，比例字段用 size（与 aspect_ratio 同义）；参考图融合 image_urls（1 或 3 张）。
  videoModel({
    modelKey: "Omni-Flash-Ext", labelZh: "Omni-Flash-Ext", archetypeId: "omni-flash-ext",
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS },
  }),
];

export const APIMART_VIDEO_QUERY = APIMART_VIDEO_QUERY_OP;
export const APIMART_VIDEO_STATUS = APIMART_STATUS_MAPPING;
