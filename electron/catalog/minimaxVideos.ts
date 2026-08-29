// MiniMax H3（官方 V2）视频模型的 curated 传输配方（文生视频 t2v；i2v 暂缓——需 MiniMax 文件上传资产吞入，
// 见 docs/plan/2026-08-29-minimax-vendor.md）。
//
// V2 创建 body 是 **content 多模态数组**，不是扁平 prompt：
//   POST /v2/video_generation { model:"MiniMax-H3", content:[{type:"text",text}], resolution, duration, ratio }
//   → { task_id }。轮询/结果见 minimaxVendor.ts 的 MINIMAX_VIDEO_QUERY_OP（结果 task.content.url）。
//
// 字段名：resolution(768P/2K)、duration(6/8/10 离散)、ratio(16:9/9:16/1:1/4:3/3:4)。无 seed/负向。

import type { HttpOperation, ProfileKind } from "./types";
import { MINIMAX_CREATE_TASK_ID_PATH } from "./minimaxVendor";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

// 通用 snake 参数引用（值取自档案控件，见 src/config/modelArchetypes/hailuoH3.ts）。
const RESOLUTION = "{{request.params.resolution}}";
const DURATION = "{{request.params.duration}}";
const RATIO = "{{request.params.ratio}}";

export type MinimaxVideoModel = {
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
}): MinimaxVideoModel {
  const mappings: MinimaxVideoModel["mappings"] = [
    {
      id: `seed-minimax-${p.archetypeId}-text_to_video`,
      taskKind: "text_to_video",
      name: `${p.labelZh} · 文生视频`,
      create: {
        method: "POST",
        path: "/v2/video_generation",
        headers: CREATE_HEADERS,
        // content 数组：V2 必填 ≥1 个 text 元素；model 字段取 catalog 行 modelKey。
        body: { model: "{{model.modelKey}}", content: [{ type: "text", text: "{{request.prompt}}" }], ...p.t2vBody },
        response_mapping: { task_id: MINIMAX_CREATE_TASK_ID_PATH },
        provider_meta_mapping: { task_id: MINIMAX_CREATE_TASK_ID_PATH },
      },
    },
  ];
  return { modelKey: p.modelKey, labelZh: p.labelZh, archetypeId: p.archetypeId, mappings };
}

export const MINIMAX_VIDEO_MODELS: MinimaxVideoModel[] = [
  videoModel({
    modelKey: "MiniMax-H3",
    labelZh: "MiniMax H3",
    archetypeId: "hailuo-h3",
    t2vBody: { resolution: RESOLUTION, duration: DURATION, ratio: RATIO },
  }),
];
