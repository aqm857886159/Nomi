import type { ModelArchetype, ModelParameterControl } from "./types";

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const SIZE: ModelParameterControl = {
  key: "size",
  label: "比例",
  type: "select",
  options: opt(["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
  defaultValue: "adaptive",
};

const BASE_PARAMS: ModelParameterControl[] = [
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 30, defaultValue: 5 },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
  { key: "return_last_frame", label: "返回尾帧", type: "boolean", options: [], defaultValue: false },
  { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" },
  { key: "watermark", label: "添加水印", type: "boolean", options: [], defaultValue: false },
  { key: "output_format", label: "输出格式", type: "select", options: opt(["mp4", "mov"]), defaultValue: "mp4" },
  { key: "nsfw_check", label: "提交前内容审核", type: "boolean", options: [], defaultValue: false },
];
const PARAMS: ModelParameterControl[] = [SIZE, ...BASE_PARAMS];

// 视频编辑：官方「size 必须 adaptive、duration 必须 -1（或不发，平台自动补 -1）」→ 比例由 fixedParams 钉死、不声明时长控件。
const EDIT_PARAMS: ModelParameterControl[] = BASE_PARAMS.filter((p) => p.key !== "duration");
// 视频续写：官方只约束「size 必须 adaptive」，时长仍可选 4–30。
const EXTEND_PARAMS: ModelParameterControl[] = BASE_PARAMS;

const UNKNOWN_CAMERA_PROMPT = { signal: "camera_motion", via: "prompt" as const, status: "unknown" as const };
const UNKNOWN_MOTION_REFERENCE = {
  signal: "motion_reference",
  via: "reference_slot" as const,
  slotKind: "video_ref" as const,
  status: "unknown" as const,
};

export const SEEDANCE_2_5_APIMART_ARCHETYPE: ModelArchetype = {
  id: "seedance-2.5-apimart",
  family: "seedance",
  label: "Seedance 2.5",
  kind: "video",
  sources: [
    {
      url: "https://docs.apimart.ai/cn/api-reference/videos/doubao-seedance-2-5",
      checkedAt: "2026-11-12",
      vendorKey: "apimart",
      covers:
        "reference channels, first/last-frame roles, parameter ranges and task constraints; resolution 480p / 720p(default) / 1080p " +
        "(4k and 2k return 400; draft / draft_task_id two-step flow not declared)",
    },
  ],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["doubao-seedance-2.5", "doubao-seedance-2-5"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频，最长 30 秒",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      expressionChannels: [UNKNOWN_CAMERA_PROMPT],
      params: PARAMS,
    },
    {
      id: "first",
      intent: "single",
      vendorTerm: "首帧",
      hint: "单张首帧图驱动生成",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1 }],
      combineSlotsInto: { key: "image_with_roles" },
      fixedParams: { size: "adaptive" },
      expressionChannels: [UNKNOWN_CAMERA_PROMPT],
      params: BASE_PARAMS,
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "首帧 + 尾帧，自动补间过渡",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1 },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1 },
      ],
      combineSlotsInto: { key: "image_with_roles" },
      fixedParams: { size: "adaptive" },
      expressionChannels: [UNKNOWN_CAMERA_PROMPT],
      params: BASE_PARAMS,
    },
    {
      id: "omni",
      intent: "character",
      vendorTerm: "全能参考",
      hint: "多模态参考；最多 30 图 / 10 视频 / 10 音频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "image_ref", label: "角色参考", min: 0, max: 30, characterIndexed: true, inputKey: "image_urls" },
        { kind: "video_ref", label: "参考视频", min: 0, max: 10, inputKey: "video_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 10, inputKey: "audio_urls" },
      ],
      expressionChannels: [UNKNOWN_CAMERA_PROMPT, UNKNOWN_MOTION_REFERENCE],
      params: PARAMS,
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "视频编辑",
      hint: "源视频 + 提示词改写；可带参考图 / 音频；输出长度跟随源视频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "video_ref", label: "源视频", min: 1, max: 10, inputKey: "video_urls" },
        { kind: "image_ref", label: "参考图", min: 0, max: 30, characterIndexed: true, inputKey: "image_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 10, inputKey: "audio_urls" },
      ],
      fixedParams: { omni_reference_task_type: "edit", size: "adaptive" },
      expressionChannels: [UNKNOWN_CAMERA_PROMPT],
      params: EDIT_PARAMS,
    },
    {
      id: "extend",
      intent: "edit",
      vendorTerm: "视频续写",
      hint: "源视频向前 / 向后延长；比例跟随源视频",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "video_ref", label: "源视频", min: 1, max: 10, inputKey: "video_urls" },
        { kind: "image_ref", label: "参考图", min: 0, max: 30, characterIndexed: true, inputKey: "image_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 10, inputKey: "audio_urls" },
      ],
      fixedParams: { omni_reference_task_type: "extend", size: "adaptive" },
      expressionChannels: [UNKNOWN_CAMERA_PROMPT],
      params: EXTEND_PARAMS,
    },
  ],
};
