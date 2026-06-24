// 即梦官方 dreamina CLI 的 curated 视频配方（单源）。
// 不是 HTTP：create/query op 都声明 `process`（spawn dreamina + dreaminaCodec 解析，见 processOperation.ts）。
//
// v1 范围：**文生视频**（text2video）端到端。图生视频/首尾帧/全能参考留下一切片——它们要 `--image=<本地路径>`，
// 需「输入图 → 本地文件路径」的额外吞入子系统（与 HTTP vendor 的 URL 吞入相反），单列。
//
// 模型 = 一条 catalog 行 + 档案 5 变体（model_version：seedance2.0fast/2.0/_vip/fast_vip/mini，见 dreaminaSeedance 档案），
// 用户经 VariantBar 切换；args 的 --model_version 取 {{request.params.model}}（= 当前变体 modelKey，同 apimart Seedance）。
// 变体未注入时该参数渲染成空被丢弃 → dreamina 回落默认 seedance2.0fast（优雅降级）。

import type { HttpOperation } from "./types";

export const DREAMINA_VIDEO_MODEL_KEY = "dreamina-seedance-2.0";
export const DREAMINA_ARCHETYPE_ID = "dreamina-seedance-2";

// 进程型 op 的 method/path 是惰性占位（process 分支在用到它们前就短路了）——只为满足 HttpOperation 类型。
const PROCESS_METHOD = "PROCESS";

const TEXT2VIDEO_CREATE: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:text2video",
  process: {
    bin: "dreamina",
    parser: "dreamina-cli",
    appendDownloadDir: true,
    args: [
      "text2video",
      "--prompt={{request.prompt}}",
      "--duration={{request.params.duration}}",
      "--ratio={{request.params.ratio}}",
      "--video_resolution={{request.params.video_resolution}}",
      "--model_version={{request.params.model}}",
      "--poll=30",
    ],
  },
  response_mapping: { task_id: "submit_id", status: "gen_status", video_url: "video_url" },
  provider_meta_mapping: { task_id: "submit_id" },
};

const QUERY_RESULT: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:query_result",
  process: {
    bin: "dreamina",
    parser: "dreamina-cli",
    appendDownloadDir: true,
    args: ["query_result", "--submit_id={{providerMeta.task_id}}"],
  },
  response_mapping: { task_id: "submit_id", status: "gen_status", video_url: "video_url" },
  provider_meta_mapping: { task_id: "submit_id" },
};

// gen_status 归一：success→成功 / fail|error→失败 / querying→生成中（轮询）。
// 「querying」必须落 running（不在 succeeded/failed）→ runTask 才会 admitTask 续查。
const DREAMINA_VIDEO_STATUS: Record<string, string[]> = {
  succeeded: ["success", "completed"],
  failed: ["fail", "failed", "error"],
  running: ["querying", "processing", "generating"],
  queued: ["queued", "pending", "in_queue"],
};

export const DREAMINA_CURATED_MODELS = [
  { modelKey: DREAMINA_VIDEO_MODEL_KEY, labelZh: "即梦 Seedance 2.0（会员）", kind: "video" as const, archetypeId: DREAMINA_ARCHETYPE_ID },
];

export const DREAMINA_CURATED_MAPPINGS = [
  {
    id: "seed-dreamina-seedance-2-text_to_video",
    taskKind: "text_to_video" as const,
    modelKey: DREAMINA_VIDEO_MODEL_KEY,
    name: "即梦 Seedance 2.0 · 文生视频",
    create: TEXT2VIDEO_CREATE,
    query: QUERY_RESULT,
    statusMapping: DREAMINA_VIDEO_STATUS,
  },
];
