import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// 火山方舟 Seedance **2.5** 视频档案（`doubao-seedance-2-5-260628`）。
// 契约来自官方文档实查（2026-08-26，docs.volcengine.com doc 1520757「创建任务」+
// doc 2607688「Seedance 2.5 教程」+ doc 1330310 模型列表，页面标注更新 2026.08.24），非记忆。
//
// **为什么与 volcengine-seedance-2（2.0 标准/fast/mini）分档而不是加一个变体**——能力域是不同形状：
//   - 时长 [4,30]s（2.0 是 [4,15]s）——变体 paramOverrides 只能收窄不能放宽，2.5 比 2.0 更宽，套不进去。
//   - 分辨率无 4k（4k 是 **2.0 独有**；2.5 是 480p/720p/1080p）——两边是交叉不是包含。
//   - 参考素材上限 30 图 / 10 视频 / 10 音频（2.0 是 9/3/3）。
//   - 音频**可单独输入**（2.0 明确不支持「纯音频」「文本+音频」）。
//   - 独有 output_format mp4|mov。
//
// **刻意不声明 seed / camera_fixed**：官方参数表标注这两个仅 1.5 pro / 1.0 pro / 1.0 pro fast 支持，
// 2.5 与 2.0 系列都不支持。（seedanceVolcengine.ts 里曾有一条注释断言「官方字段表有 seed，唯独火山
// 这份漏了」——2026-08-26 逐项对账后确认是**反的**，已连同 2.0 的 seed 控件一并删除。）
//
// 本轮**不做**的：omni_reference_task_type 的 edit（编辑视频）/ extend（延长视频）两类任务。
// 它们是全新交互形态且带硬约束（ratio 必须 adaptive、duration 必须 -1），需先出样张走 R8。
// 故这里只覆盖 auto/reference 语义下的文生/首帧/首尾帧/全模态参考四模式。
// ---------------------------------------------------------------------------

const opt = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

// 官方：ratio 默认 adaptive；resolution 默认 720p；duration [4,30] 或 -1（默认 -1 = 由模型定）；
// generate_audio 默认 true；watermark 默认 false；output_format 默认 mp4。
const RATIO_PARAM: ModelParameterControl = {
  key: "ratio",
  label: "比例",
  type: "select",
  options: opt(["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
  defaultValue: "adaptive",
};

// 首帧 / 首尾帧任务下官方**强制** ratio=adaptive（doc 2607688；违反会在任务已创建后才异步报错
// InvalidParameter.TaskTypeConstraint —— 额度已排队才告诉你，所以必须在这里就收窄，别让用户选得到）。
const RATIO_ADAPTIVE_ONLY: ModelParameterControl = {
  key: "ratio",
  label: "比例",
  type: "select",
  options: opt(["adaptive"]),
  defaultValue: "adaptive",
};

const BASE_PARAMS: ModelParameterControl[] = [
  RATIO_PARAM,
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 30, defaultValue: 5 },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
  { key: "output_format", label: "封装格式", type: "select", options: opt(["mp4", "mov"]), defaultValue: "mp4" },
];

/** 把某组参数里的 ratio 换成「只能 adaptive」（首帧 / 首尾帧模式用）。 */
const adaptiveRatioOnly = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "ratio" ? RATIO_ADAPTIVE_ONLY : p));

const FRAME_PARAMS = adaptiveRatioOnly(BASE_PARAMS);

export const SEEDANCE_VOLCENGINE_2_5_ARCHETYPE: ModelArchetype = {
  id: "volcengine-seedance-2-5",
  family: "seedance",
  label: "Seedance 2.5",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["doubao-seedance-2-5-260628"],
  sources: [
    {
      url: "https://docs.volcengine.com/docs/82379/1520757",
      checkedAt: "2026-08-26",
      vendorKey: "volcengine",
      covers:
        "POST /api/v3/contents/generations/tasks；content 元素 type text|image_url|video_url|audio_url 靠 role 区分（first_frame/last_frame/reference_image/reference_video/reference_audio）；duration [4,30] 或 -1；resolution 480p/720p/1080p（无 4k）；generate_audio 默认 true；watermark 默认 false；output_format mp4|mov 为 2.5 独有；seed 与 camera_fixed 仅 1.5pro/1.0pro/1.0pro-fast 支持，2.5 不支持",
    },
    {
      url: "https://docs.volcengine.com/docs/82379/2607688",
      checkedAt: "2026-08-26",
      vendorKey: "volcengine",
      covers:
        "Seedance 2.5 教程：模型 id doubao-seedance-2-5-260628；参考素材上限 30 图 / 10 视频 / 10 音频（2.0 系列为 9/3/3）；2.5 可仅传音频；首帧/首尾帧/编辑/延长任务 ratio 强制 adaptive，违反报 InvalidParameter.TaskTypeConstraint；omni_reference_task_type auto|reference|edit|extend（本轮只用缺省 auto）",
    },
    {
      url: "https://docs.volcengine.com/docs/82379/1521309",
      checkedAt: "2026-08-26",
      vendorKey: "volcengine",
      covers: "GET /api/v3/contents/generations/tasks/{id}；status 枚举 queued/running/cancelled/succeeded/failed；视频在 content.video_url；错误在 error{code,message}",
    },
  ],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频，最长 30 秒",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: BASE_PARAMS,
    },
    {
      id: "first",
      intent: "single",
      vendorTerm: "首帧",
      hint: "单张首帧图驱动生成（比例由首帧决定）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "volcengine_first_image_content" }],
      params: FRAME_PARAMS,
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "首帧 + 尾帧，过渡更可控（比例由首帧决定）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "volcengine_first_role_image_content" },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "volcengine_last_role_image_content" },
      ],
      params: FRAME_PARAMS,
    },
    {
      // 全模态参考：2.5 把上限拉到 30 图 / 10 视频 / 10 音频，且**音频可单独用**
      // （2.0 那份的 requiresAnyOf 限制在 2.5 已解除，故这里不声明）。
      id: "omni",
      intent: "character",
      vendorTerm: "全能参考",
      hint: "多模态参考；最多 30 图 / 10 视频 / 10 音频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "image_ref", label: "角色参考", min: 0, max: 30, characterIndexed: true, inputKey: "volcengine_image_contents" },
        { kind: "video_ref", label: "参考视频", min: 0, max: 10, inputKey: "volcengine_video_contents" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 10, inputKey: "volcengine_audio_contents" },
      ],
      params: BASE_PARAMS,
    },
  ],
};
