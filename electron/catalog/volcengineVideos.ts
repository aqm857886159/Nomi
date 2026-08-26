import type { HttpOperation, ProfileKind } from "./types";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };
const VARIANT_MODEL_REF = "{{request.params.model}}";

const TEXT_CONTENT = { type: "text", text: "{{request.prompt}}" };
const FIRST_IMAGE_CONTENT = "{{request.params.volcengine_first_image_content}}";
const FIRST_ROLE_IMAGE_CONTENT = "{{request.params.volcengine_first_role_image_content}}";
const LAST_ROLE_IMAGE_CONTENT = "{{request.params.volcengine_last_role_image_content}}";
const IMAGE_REF_CONTENTS = "{{request.params.volcengine_image_contents}}";
const VIDEO_REF_CONTENTS = "{{request.params.volcengine_video_contents}}";
const AUDIO_REF_CONTENTS = "{{request.params.volcengine_audio_contents}}";

/**
 * Seedance create op（2.0 系列与 2.5 共用形状）。
 *
 * **不发 seed / camera_fixed**：官方 doc 1520757 参数表标注这两项仅 1.5 pro / 1.0 pro / 1.0 pro fast
 * 支持，2.0 系列与 2.5 都不支持（2026-08-26 实查修正；此前这里发 seed）。
 *
 * @param content   content 数组模板（首帧/尾帧/参考图/视频/音频靠元素上的 role 字段区分，不靠顺序）
 * @param extraBody 该 family 独有的顶层字段（2.5 的 output_format）
 */
function seedanceCreateOp(content: unknown[], extraBody: Record<string, unknown> = {}): HttpOperation {
  return {
    method: "POST",
    path: "/api/v3/contents/generations/tasks",
    // 见 volcengineImages.ts 同处注释：路径自带 /api/v3，必须 hostRootJoin，否则 /api/v3/api/v3/… 404。
    pathFrom: "host-root",
    headers: CREATE_HEADERS,
    body: {
      model: VARIANT_MODEL_REF,
      content,
      resolution: "{{request.params.resolution}}",
      ratio: "{{request.params.ratio}}",
      duration: "{{request.params.duration}}",
      generate_audio: "{{request.params.generate_audio}}",
      watermark: false,
      ...extraBody,
    },
    response_mapping: { task_id: "id", status: "status" },
    provider_meta_mapping: { task_id: "id" },
  };
}

/** 图生视频那条的 content 模板（全部 role 通道；空槽由模板渲染时丢弃）。 */
const I2V_CONTENT = [
  TEXT_CONTENT,
  FIRST_IMAGE_CONTENT,
  FIRST_ROLE_IMAGE_CONTENT,
  LAST_ROLE_IMAGE_CONTENT,
  IMAGE_REF_CONTENTS,
  VIDEO_REF_CONTENTS,
  AUDIO_REF_CONTENTS,
];

const T2V_CREATE = seedanceCreateOp([TEXT_CONTENT]);
const I2V_CREATE = seedanceCreateOp(I2V_CONTENT);

// 2.5 独有 output_format（mp4 | mov）。其余顶层字段与 2.0 同形。
// 本轮不发 omni_reference_task_type —— 缺省 auto 即覆盖 reference 语义；edit/extend 两类任务
// 是下一轮的事（带 ratio 必 adaptive、duration 必 -1 的硬约束，需先出样张）。
const SEEDANCE_25_EXTRA = { output_format: "{{request.params.output_format}}" };
const T2V_25_CREATE = seedanceCreateOp([TEXT_CONTENT], SEEDANCE_25_EXTRA);
const I2V_25_CREATE = seedanceCreateOp(I2V_CONTENT, SEEDANCE_25_EXTRA);

export const VOLCENGINE_SEEDANCE_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v3/contents/generations/tasks/{{providerMeta.task_id}}",
  // 同 create：轮询也必须 hostRootJoin，否则任务建得出来、查不回去（更难查的一种坏法）。
  pathFrom: "host-root",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "id",
    status: "status",
    video_url: "content.video_url",
    error_message: "error.message",
  },
};

export const VOLCENGINE_SEEDANCE_STATUS_MAPPING = {
  queued: ["queued"],
  running: ["running"],
  succeeded: ["succeeded"],
  // cancelled 在方舟官方状态枚举里（queued/running/cancelled/succeeded/failed/expired，
  // new-api 中转的交付文档同款）。漏掉它 = 任务在控制台被取消后我们一直轮询到超时，
  // 而不是立刻报「任务已取消」。归 failed 桶（终态、不可恢复、不重试）。
  failed: ["failed", "expired", "cancelled", "canceled"],
};

export type VolcengineVideoModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

export const VOLCENGINE_VIDEO_MODELS: VolcengineVideoModel[] = [
  {
    // catalog 行 = 基础 modelKey；标准/fast/mini 三变体由档案 variants 承载（body 的 model 取
    // {{request.params.model}}，由选中变体填）。
    modelKey: "doubao-seedance-2-0-260128",
    labelZh: "Seedance 2.0",
    archetypeId: "volcengine-seedance-2",
    mappings: [
      { id: "seed-volcengine-seedance-2-text_to_video", taskKind: "text_to_video", name: "Seedance 2.0 · 文生视频", create: T2V_CREATE },
      { id: "seed-volcengine-seedance-2-image_to_video", taskKind: "image_to_video", name: "Seedance 2.0 · 图生视频", create: I2V_CREATE },
    ],
  },
  {
    // Seedance 2.5（2026-08-26 接入）。与 2.0 分档：时长上限 30s、无 4k、参考素材 30/10/10、
    // 音频可单独输入、独有 output_format。详见 shared/videoCapabilities/seedanceVolcengine25.ts。
    modelKey: "doubao-seedance-2-5-260628",
    labelZh: "Seedance 2.5",
    archetypeId: "volcengine-seedance-2-5",
    mappings: [
      { id: "seed-volcengine-seedance-2-5-text_to_video", taskKind: "text_to_video", name: "Seedance 2.5 · 文生视频", create: T2V_25_CREATE },
      { id: "seed-volcengine-seedance-2-5-image_to_video", taskKind: "image_to_video", name: "Seedance 2.5 · 图生视频", create: I2V_25_CREATE },
    ],
  },
];
