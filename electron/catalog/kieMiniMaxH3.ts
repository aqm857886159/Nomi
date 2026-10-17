// MiniMax H3（Hailuo 03）经 kie.ai 的 curated 传输契约。契约逐项对账自 kie 官方文档
// （docs.kie.ai/cn/market/minimax-h3/{text,image,reference}-to-video，2026-08-07 核对）。
//
// kie 把 H3 的 3 个场景做成 3 个 model enum（minimax-h3/text-to-video | image-to-video |
// reference-to-video）——合成 1 个 catalog 条目 + 3 个档案模式，靠 per-mode modelEnum 区分
// （同 HappyHorse，评审 M3）：body.model 取 {{request.params.model}}（档案当前模式的 modelEnum），
// 而非 catalog 行的 modelKey。
//
// 所有 H3 模式打同一个 kie createTask 端点 → 只需 1 条 mapping（挂 text_to_video 桶 +
// 绑 modelKey，避免与同 vendor 的 Seedance 2.x 撞车；档案 taskKind 归一机制同 HappyHorse）。
//
// kie H3 的 reference_* 键**无尾随空格**（与 kie Seedance 2.0 的 ␣ quirk 不同）——
// 逐字符照抄 H3 文档，quirk 不跨模型传染。

import type { HttpOperation, ProfileKind } from "./types";
import { ARCHETYPE_WIRE_MODEL } from "../shared/modelArchetypes/wireModelIdentity";

/** MiniMax H3 模型种子（modelKey 是 catalog 基 id；真正发请求的 enum 由 per-mode modelEnum 覆盖）。 */
export const MINIMAX_H3_MODEL_SEED = {
  modelKey: "minimax-h3",
  labelZh: "MiniMax H3",
  kind: "video" as const,
} as const;

/**
 * createTask 操作。body 是 kie 的 `{ model, input: {...} }` 嵌套形状；模板引擎对「整串就是一个 {{}}」
 * 的值做原样透传（数组/对象不被 stringify），值为 undefined 的键整键丢弃（M2 互斥：
 * renderer 只投影当前模式声明的键 → 别的模式的键自然不进 body）。
 */
export const MINIMAX_H3_CREATE_OP: HttpOperation = {
  method: "POST",
  wireModel: ARCHETYPE_WIRE_MODEL, // 收档案所选的模式 / 变体线上名（wireModelIdentity）
  path: "/api/v1/jobs/createTask",
  headers: {
    Authorization: "Bearer {{user_api_key}}",
    "Content-Type": "application/json",
  },
  body: {
    // per-mode enum 覆盖（M3）：值来自 request.params.model（档案当前模式的 modelEnum：
    // minimax-h3/text-to-video | image-to-video | reference-to-video）。
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      // 图生视频（kie H3 契约键名：image_url / end_image_url，非 first_frame_url）。
      image_url: "{{request.params.image_url}}",
      end_image_url: "{{request.params.end_image_url}}",
      // 参考生视频（kie H3 文档键，**无尾随空格**）。
      reference_image_urls: "{{request.params.reference_image_urls}}",
      reference_video_urls: "{{request.params.reference_video_urls}}",
      reference_audio_urls: "{{request.params.reference_audio_urls}}",
      // 标量（各模式声明的才在场）：文生必填 aspect_ratio（无 adaptive）；参考默认 adaptive；
      // duration 4-15 整数；resolution 768P/2K 默认 2K。
      aspect_ratio: "{{request.params.aspect_ratio}}",
      duration: "{{request.params.duration}}",
      resolution: "{{request.params.resolution}}",
    },
  },
};

/** 轮询：沿用已端到端验证过的 kie job 端点（与 Seedance/HappyHorse 同，recordInfo）。 */
export const MINIMAX_H3_QUERY_OP: HttpOperation = {
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

/** (kie, text_to_video) 的完整 mapping 种子——绑 modelKey，防止与同 vendor 其他模型撞桶。 */
export const MINIMAX_H3_MAPPING = {
  vendorKey: "kie",
  taskKind: "text_to_video" as ProfileKind,
  modelKey: MINIMAX_H3_MODEL_SEED.modelKey,
  name: "MiniMax H3 · 文生/图生/参考",
  create: MINIMAX_H3_CREATE_OP,
  query: MINIMAX_H3_QUERY_OP,
};
