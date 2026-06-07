// Kling 3.0（可灵）视频档案的**传输塑形**（curated 单源）。kie 文档（2026-06 实时核对）：
//   model `kling-3.0/video`（唯一值）；input {prompt, image_urls[首/尾帧，单镜头 len1=首 / len2=[首,尾]],
//   sound(bool), duration(string "3".."15" 默认 "5"), aspect_ratio(16:9/9:16/1:1), mode(std/pro/4K 默认 pro),
//   multi_shots, multi_prompt[], kling_elements[@元素 ≤3]}。
// 本期从简：文生视频 + 图生视频（首/尾帧走一个有序 image_urls 数组槽，≤2）。多镜头 / @元素引用作后续增强。
// 结果路径 data.resultJson.resultUrls.0（kie 统一）。
// 注：与用户机器上残留的旧「Kling 3.0」generic text_to_video mapping 共存——本档案 mapping 带 modelKey=kling-3.0
// 精确路由到自己，不被旧 generic 抢（selectTaskMapping）。

import type { HttpOperation, ProfileKind } from "./types";

// kie 的状态动词（waiting/generating/success/fail）已并入通用默认归一
// （electron/tasks/responseParsing.ts taskStatusFromResponse），故本档案与 Seedance/HappyHorse
// 一致，不再各自声明 statusMapping（避免每家一份并行映射）。

export const KLING_3_QUERY_OP: HttpOperation = {
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

// 一条 body 覆盖文生/图生视频：image_urls 取档案图生视频模式的有序帧数组（slot inputKey=image_urls）；
// 文生视频模式无该槽 → 投影为 undefined → 整键被模板引擎丢弃（不发空 image_urls）。
export const KLING_3_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/jobs/createTask",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      image_urls: "{{request.params.image_urls}}",
      mode: "{{request.params.mode}}",
      duration: "{{request.params.duration}}",
      aspect_ratio: "{{request.params.aspect_ratio}}",
      sound: "{{request.params.sound}}",
    },
  },
};

export const KLING_3_MODEL_SEED = {
  modelKey: "kling-3.0",
  labelZh: "可灵 3.0",
  kind: "video" as const,
} as const;

export const KLING_3_T2V_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_video" as ProfileKind,
  modelKey: "kling-3.0",
  name: "可灵 3.0 · 文生视频",
  create: KLING_3_CREATE_OP,
  query: KLING_3_QUERY_OP,
};

export const KLING_3_I2V_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_to_video" as ProfileKind,
  modelKey: "kling-3.0",
  name: "可灵 3.0 · 图生视频",
  create: KLING_3_CREATE_OP,
  query: KLING_3_QUERY_OP,
};
