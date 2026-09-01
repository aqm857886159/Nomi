// Kling 3.0（可灵）视频档案的**传输塑形**（curated 单源）。
// 2026-09-02 官方 `.md` 合同按模式区分 model：
//   text-to-video = kling-3.0-omni/text-to-video；image-to-video = kling-3.0-omni/image-to-video。
//   单镜头 input 使用 prompt、duration、resolution、aspect_ratio、audio、
//   customize_multi_shots=false、prefer_multi_shots=false；i2v 另带 image_urls。
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

// The generic archetype still contains historical mode/sound/model defaults for other
// providers sharing this family. This factory owns the KIE projection and removes those
// stale generic fields at the provider request boundary.
function createKling3Operation(mode: "text-to-video" | "image-to-video"): HttpOperation {
  const isImage = mode === "image-to-video";
  return {
    method: "POST",
    path: "/api/v1/jobs/createTask",
    headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
    body: {
      model: `kling-3.0-omni/${mode}`,
      input: {
        prompt: "{{request.prompt}}",
        ...(isImage ? { image_urls: "{{request.params.image_urls}}" } : {}),
        duration: "{{request.params.duration}}",
        resolution: "720p",
        aspect_ratio: isImage ? "auto" : "{{request.params.aspect_ratio}}",
        audio: "{{request.params.sound}}",
        customize_multi_shots: false,
        prefer_multi_shots: false,
      },
    },
    paramMap: {
      drops: isImage ? ["mode", "aspect_ratio"] : ["mode"],
      rules: [],
    },
  };
}

export const KLING_3_T2V_CREATE_OP = createKling3Operation("text-to-video");
export const KLING_3_I2V_CREATE_OP = createKling3Operation("image-to-video");

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
  create: KLING_3_T2V_CREATE_OP,
  query: KLING_3_QUERY_OP,
};

export const KLING_3_I2V_MAPPING = {
  vendorKey: "kie",
  taskKind: "image_to_video" as ProfileKind,
  modelKey: "kling-3.0",
  name: "可灵 3.0 · 图生视频",
  create: KLING_3_I2V_CREATE_OP,
  query: KLING_3_QUERY_OP,
};
