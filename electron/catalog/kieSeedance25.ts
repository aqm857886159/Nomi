// Seedance 2.5 经 kie.ai 的 curated 传输契约。契约逐项对账自 kie 官方文档
// （docs.kie.ai/cn/market/bytedance/seedance-2-5，2026-08-07 核对）。
//
// 与 2.0 的传输差异（kieSeedance.ts 是 2.0，本文件是 2.5，**不共用 body**——P1 不并行是指
// 不留两套实现服务同一模型；2.0 与 2.5 是两个版本级模型，各自独立契约）：
//   - model = bytedance/seedance-2-5（2.0 是 bytedance/seedance-2）。
//   - `reference_video_urls` **无尾随空格**（2.0 文档的 ␣ quirk 在 2.5 文档已修复——逐字符照抄
//     2.5 文档，不继承 2.0 的坑）。
//   - 新增 return_last_frame（2.5 独有）。
//   - kie 2.5 文档明确「首帧 / 首尾帧 / 多模态参考 3 种互斥」——与档案 M2 投影天然一致。
//   - 首尾帧沿用 first_frame_url/last_frame_url（2.0 同平台契约；2.5 文档示例未展示图生字段名，
//     已在档案注释标注，真机验证为准）。
//
// baseUrl 约定同 kieSeedance.ts：vendor.baseUrl 裸 "https://api.kie.ai"，path 带完整 /api/v1。

import type { HttpOperation, ProfileKind } from "./types";
import { ARCHETYPE_WIRE_MODEL } from "../shared/modelArchetypes/wireModelIdentity";

/** Seedance 2.5 模型种子。 */
export const SEEDANCE_2_5_MODEL_SEED = {
  modelKey: "bytedance/seedance-2-5",
  labelZh: "Seedance 2.5",
  kind: "video" as const,
} as const;

/**
 * createTask 操作。一条 body 覆盖四模式（文生/首帧/首尾帧/全能参考）：模板引擎对值为
 * undefined 的键整键丢弃，renderer 已按当前模式把别的模式的参考键投影掉（M2 互斥）。
 */
export const SEEDANCE_2_5_CREATE_OP: HttpOperation = {
  method: "POST",
  wireModel: ARCHETYPE_WIRE_MODEL, // 收档案所选的模式 / 变体线上名（wireModelIdentity）
  path: "/api/v1/jobs/createTask",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    // 无变体 → params.model = catalog 行 modelKey（bytedance/seedance-2-5）。
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      first_frame_url: "{{request.params.first_frame_url}}",
      last_frame_url: "{{request.params.last_frame_url}}",
      // 全能参考数组键：kie 2.5 文档逐字符照抄——**全部无尾随空格**（2.0 的 reference_video_urls␣
      // quirk 不遗传）。
      reference_image_urls: "{{request.params.reference_image_urls}}",
      reference_video_urls: "{{request.params.reference_video_urls}}",
      reference_audio_urls: "{{request.params.reference_audio_urls}}",
      resolution: "{{request.params.resolution}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      duration: "{{request.params.duration}}",
      generate_audio: "{{request.params.generate_audio}}",
      return_last_frame: "{{request.params.return_last_frame}}",
    },
  },
};

/** 轮询：沿用已端到端验证过的 kie job 端点（与 2.0/HappyHorse/H3 同，recordInfo）。 */
export const SEEDANCE_2_5_QUERY_OP: HttpOperation = {
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

/** (kie, image_to_video) mapping——绑 modelKey，与同 vendor 的 Seedance 2.0 的 generic 桶区分。 */
export const SEEDANCE_2_5_IMAGE_TO_VIDEO_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_to_video" as ProfileKind,
  modelKey: SEEDANCE_2_5_MODEL_SEED.modelKey,
  name: "Seedance 2.5 · 首帧/首尾帧/全能参考",
  create: SEEDANCE_2_5_CREATE_OP,
  query: SEEDANCE_2_5_QUERY_OP,
};

/** (kie, text_to_video) mapping——文生视频（纯 prompt），同 2.0 的补接结构。 */
export const SEEDANCE_2_5_TEXT_TO_VIDEO_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_video" as ProfileKind,
  modelKey: SEEDANCE_2_5_MODEL_SEED.modelKey,
  name: "Seedance 2.5 · 文生视频",
  create: SEEDANCE_2_5_CREATE_OP,
  query: SEEDANCE_2_5_QUERY_OP,
};
