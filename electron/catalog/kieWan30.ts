// Wan 3.0 经 kie.ai 的 curated 传输契约。契约逐项对账自 kie 官方文档（2026-08-26 核对）：
//   docs.kie.ai/market/wan/3-0-video.md + docs.kie.ai/market/wan/3-0-video-prime.md
//
// 两个 model id（标准 wan/3-0-video、高速 wan/3-0-video-prime）**字段表逐项相同**，故：
//   - catalog 只有 **1 行**（wan/3-0-video），高速版由档案 variants 暴露（wan30.ts）；
//   - body 的 model 取 {{request.params.model}}（= 档案当前变体的 modelKey），同 Seedance/Hailuo 变体通道。
//
// 一条 body 覆盖四模式（文生 / 首帧 / 首尾帧 / 全能参考）：模板引擎对值为 undefined 的键整键丢弃，
// 渲染层已按当前模式把别的模式的参考键投影掉（M2 互斥）——首/尾帧与 reference_* 官方硬互斥，
// 靠模式划分保证，不需要运行时校验。
//
// baseUrl 约定同 kieSeedance25.ts：vendor.baseUrl 裸 "https://api.kie.ai"，path 带完整 /api/v1。

import type { HttpOperation, ProfileKind } from "./types";

/** Wan 3.0 模型种子（catalog 基础行 = 标准版；高速版走档案 variant）。 */
export const WAN_3_0_MODEL_SEED = {
  modelKey: "wan/3-0-video",
  labelZh: "Wan 3.0",
  kind: "video" as const,
} as const;

/** 高速变体的 model id —— 与档案 variants[prime].modelKey 必须一致（契约锁测试断言）。 */
export const WAN_3_0_PRIME_MODEL_KEY = "wan/3-0-video-prime";

/**
 * createTask 操作。参数**全部嵌在 input 下**（kie job API 形状）。
 * first_frame_url / last_frame_url 是裸字符串 URL（文档 schema 标 object 是生成器产物，
 * 正文示例是字符串）→ 槽不加 asArray。
 */
export const WAN_3_0_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    // 有变体 → params.model = 档案当前变体的 modelKey（wan/3-0-video 或 wan/3-0-video-prime）。
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      first_frame_url: "{{request.params.first_frame_url}}",
      last_frame_url: "{{request.params.last_frame_url}}",
      // 全能参考三族（官方上限 10 / 5 / 5），与首尾帧互斥。
      reference_image_urls: "{{request.params.reference_image_urls}}",
      reference_video_urls: "{{request.params.reference_video_urls}}",
      reference_audio_urls: "{{request.params.reference_audio_urls}}",
      resolution: "{{request.params.resolution}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      duration: "{{request.params.duration}}",
      audio: "{{request.params.audio}}",
      seed: "{{request.params.seed}}",
    },
  },
};

/** 轮询：沿用已端到端验证过的 kie job 端点（与 Seedance 2.5 / HappyHorse / H3 同，recordInfo）。
 *  data.resultJson 是 JSON 字符串，既有 followPath 机制已能穿进去取 resultUrls[0]（不另造机制）。 */
export const WAN_3_0_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v1/jobs/recordInfo",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  query: { taskId: "{{providerMeta.task_id}}" },
  response_mapping: {
    task_id: "data.taskId",
    status: "data.state",
    video_url: "data.resultJson.resultUrls.0",
    error_message: "data.failMsg",
  },
};

/** (kie, image_to_video) mapping —— 首帧 / 首尾帧 / 全能参考三模式共用。 */
export const WAN_3_0_IMAGE_TO_VIDEO_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_to_video" as ProfileKind,
  modelKey: WAN_3_0_MODEL_SEED.modelKey,
  name: "Wan 3.0 · 首帧/首尾帧/全能参考",
  create: WAN_3_0_CREATE_OP,
  query: WAN_3_0_QUERY_OP,
};

/** (kie, text_to_video) mapping —— 文生视频（纯 prompt）。 */
export const WAN_3_0_TEXT_TO_VIDEO_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_video" as ProfileKind,
  modelKey: WAN_3_0_MODEL_SEED.modelKey,
  name: "Wan 3.0 · 文生视频",
  create: WAN_3_0_CREATE_OP,
  query: WAN_3_0_QUERY_OP,
};
