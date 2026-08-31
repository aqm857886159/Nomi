// Agnes AI 视频模型的 curated 传输配方（agnes-video-v2.0）。契约见
// wiki.agnes-ai.com/en/docs/agnes-video-v20.md（R5 已抓）。
//
// AGNES 视频是**异步** create→poll：
//   POST /v1/videos  { model, prompt, width, height, num_frames, frame_rate, image?, negative_prompt?, seed? }
//   → { video_id, task_id, status:"queued" }
//   轮询/状态归一/取 URL 共用 agnesVendor 的 AGNES_VIDEO_QUERY_OP + AGNES_STATUS_MAPPING（query 参数 +
//   反常字段 remixed_from_video_id，见 agnesVendor.ts）。
//
// wire 字段 width/height/num_frames/frame_rate 不直接暴露用户（D1：不让用户按"帧"思考）——
// 档案出 比例 + 清晰度(480p/720p/1080p) + 时长(秒)，由 paramMap transform 派生：
//   width/height ← (aspect_ratio, resolution)  | num_frames ← duration  | frame_rate = 常量 24。
// 提交响应抓 video_id 进 providerMeta（轮询 query 用）。

import type { HttpOperation, ProfileKind } from "./types";
import type { ParamMap } from "./paramTranslate";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

// 比例+清晰度+时长 → AGNES wire 字段（width/height/num_frames）。frame_rate 走 body 字面量 24。
const AGNES_VIDEO_PARAM_MAP: ParamMap = {
  rules: [
    { wire: "width", fromMany: ["aspect_ratio", "resolution"], transform: "agnesVideoWidth" },
    { wire: "height", fromMany: ["aspect_ratio", "resolution"], transform: "agnesVideoHeight" },
    { wire: "num_frames", fromMany: ["duration"], transform: "agnesVideoNumFrames" },
  ],
};

const WIDTH = "{{request.params.width}}"; // paramMap 派生
const HEIGHT = "{{request.params.height}}"; // paramMap 派生
const NUM_FRAMES = "{{request.params.num_frames}}"; // paramMap 派生
const NEGATIVE_PROMPT = "{{request.params.negative_prompt}}"; // 可选，未填丢弃
const IMAGE = "{{request.params.image}}"; // i2v 首帧链接（档案 slot inputKey=image，单图字符串）

/** 异步视频 create op 工厂。提交抓 video_id 进 providerMeta（轮询 query 用）。 */
function videoCreateOp(i2v: boolean): HttpOperation {
  return {
    method: "POST",
    path: "/v1/videos",
    headers: CREATE_HEADERS,
    body: {
      model: "{{model.modelKey}}",
      prompt: "{{request.prompt}}",
      width: WIDTH,
      height: HEIGHT,
      num_frames: NUM_FRAMES,
      frame_rate: 24,
      negative_prompt: NEGATIVE_PROMPT,
      ...(i2v ? { image: IMAGE } : {}),
    },
    response_mapping: { task_id: "video_id" },
    provider_meta_mapping: { video_id: "video_id" },
    paramMap: AGNES_VIDEO_PARAM_MAP,
    // headless/MCP 兜底：缺 wire 必填则 AGNES 用默认 1152×768；这里给一组够跑的默认。
    defaultParams: { aspect_ratio: "16:9", resolution: "720p", duration: "5" },
  };
}

export type AgnesVideoModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

/** AGNES 视频模型（单款 v2.0；t2v + i2v 两条 mapping，共用轮询）。 */
export const AGNES_VIDEO_MODELS: AgnesVideoModel[] = [
  {
    modelKey: "agnes-video-v2.0",
    labelZh: "Agnes Video V2.0",
    archetypeId: "agnes-video",
    mappings: [
      { id: "seed-agnes-video-v2-text_to_video", taskKind: "text_to_video", name: "Agnes Video V2.0 · 文生视频", create: videoCreateOp(false) },
      { id: "seed-agnes-video-v2-image_to_video", taskKind: "image_to_video", name: "Agnes Video V2.0 · 图生视频", create: videoCreateOp(true) },
    ],
  },
];
