// 即梦官方 dreamina CLI 的 curated 视频配方（单源）。
// 不是 HTTP：create/query op 都声明 `process`（spawn dreamina + dreaminaCodec 解析，见 processOperation.ts）。
//
// 范围：文生视频(text2video) + 图生视频(image2video) + 首尾帧(frames2video) + 全能参考(multimodal2video)。
// 后三个同 image_to_video 桶，靠**一条 mapping** + dreamina_cmd（mode.fixedParams 注入）选子命令 + per-mode params
// 控制 flag（空值自动丢，避开子命令 flag 差异）。multiframe2video（多帧/transition）留下一切片。
//
// 模型 = 一条 catalog 行 + 档案 5 变体（model_version：seedance2.0fast/2.0/_vip/fast_vip/mini，见 dreaminaSeedance 档案），
// 用户经 VariantBar 切换；args 的 --model_version 取 {{request.params.model}}（= 当前变体 modelKey）。
// 输入图/视频/音频经 fileParams 物化成本地路径（dreamina 收 --image=<本地路径>，见 dreaminaInputFiles.ts）。

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

// 图生视频 / 首尾帧 / 全能参考 合一：子命令取 {{request.params.dreamina_cmd}}（mode.fixedParams 注入）。
// args 含所有模式的 flag，per-mode params 只填对应的：i2v 填 i2v_image_path；首尾帧填 frames_*_path；
// 全能参考填 mm_*_flags（重复 flag 数组 spread）+ ratio。其余渲染成空被丢。fileParams 把输入 URL 物化成本地路径。
const IMAGE_TO_VIDEO_CREATE: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:image_to_video",
  process: {
    bin: "dreamina",
    parser: "dreamina-cli",
    fileParams: [
      { param: "i2v_image", expose: "i2v_image_path", mode: "single" },
      { param: "frames_first", expose: "frames_first_path", mode: "single" },
      { param: "frames_last", expose: "frames_last_path", mode: "single" },
      { param: "mm_images", expose: "mm_image_flags", mode: "repeat", flag: "--image" },
      { param: "mm_videos", expose: "mm_video_flags", mode: "repeat", flag: "--video" },
      { param: "mm_audios", expose: "mm_audio_flags", mode: "repeat", flag: "--audio" },
    ],
    args: [
      "{{request.params.dreamina_cmd}}",
      "--image={{request.params.i2v_image_path}}",
      "--first={{request.params.frames_first_path}}",
      "--last={{request.params.frames_last_path}}",
      "{{request.params.mm_image_flags}}",
      "{{request.params.mm_video_flags}}",
      "{{request.params.mm_audio_flags}}",
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

// 多帧（multiframe2video）：无 model_version → 单列无变体模型（modelKey dreamina-multiframe），不与上面合并 mapping 撞车。
// args 按图数变形（2 图 shorthand / 3+ 图 N-1 句 --transition-prompt），逻辑在 buildMultiframeArgs；build:"multiframe" 分派它。
const MULTIFRAME_CREATE: HttpOperation = {
  method: PROCESS_METHOD,
  path: "dreamina:multiframe2video",
  process: {
    bin: "dreamina",
    parser: "dreamina-cli",
    build: "multiframe",
    fileParams: [{ param: "mf_images", expose: "mf_image_paths", mode: "array" }],
    args: [], // 忽略：build=multiframe 改调 buildMultiframeArgs
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

export const DREAMINA_MULTIFRAME_MODEL_KEY = "dreamina-multiframe";

export const DREAMINA_CURATED_MODELS = [
  { modelKey: DREAMINA_VIDEO_MODEL_KEY, labelZh: "即梦 Seedance 2.0（会员）", kind: "video" as const, archetypeId: DREAMINA_ARCHETYPE_ID },
  { modelKey: DREAMINA_MULTIFRAME_MODEL_KEY, labelZh: "即梦多帧视频（会员）", kind: "video" as const, archetypeId: "dreamina-multiframe" },
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
  {
    id: "seed-dreamina-seedance-2-image_to_video",
    taskKind: "image_to_video" as const,
    modelKey: DREAMINA_VIDEO_MODEL_KEY,
    name: "即梦 Seedance 2.0 · 图生/首尾帧/全能参考",
    create: IMAGE_TO_VIDEO_CREATE,
    query: QUERY_RESULT,
    statusMapping: DREAMINA_VIDEO_STATUS,
  },
  {
    id: "seed-dreamina-multiframe-image_to_video",
    taskKind: "image_to_video" as const,
    modelKey: DREAMINA_MULTIFRAME_MODEL_KEY,
    name: "即梦多帧视频 · 2-20 关键帧",
    create: MULTIFRAME_CREATE,
    query: QUERY_RESULT,
    statusMapping: DREAMINA_VIDEO_STATUS,
  },
];
