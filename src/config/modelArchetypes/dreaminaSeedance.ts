// 即梦官方 dreamina CLI 的 Seedance 2.0 视频档案（声明控件/模式/变体，通用系统据此渲染 UI）。
// dreamina 底层是 Seedance 2.0，走本地 CLI，参数 enum 以官方 `-h` 为准（duration 4-15、6 比例、720p；1080p 仅 vip）。
//
// 4 模式 = dreamina 的 4 个视频子命令（mode.fixedParams 注入 dreamina_cmd 选子命令，args 模板首元素取它）：
//   t2v=text2video（text_to_video 桶）/ i2v=image2video / 首尾帧=frames2video / 全能参考=multimodal2video（后三个同 image_to_video 桶，
//   靠一条 mapping + per-mode params 控制 flag，空值自动丢 → 避开「image2video 不认 --ratio」类子命令 flag 差异）。
// multiframe2video（多帧/transition）未接——它无 model_version 且 transition 是按段数组，最特殊，留下一切片。
import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const opt = (values: Array<string | number>): ModelParameterControl["options"] => values.map((value) => ({ value, label: String(value) }));

const RATIO: ModelParameterControl = { key: "ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]), defaultValue: "16:9" };
const RESOLUTION: ModelParameterControl = { key: "video_resolution", label: "清晰度", type: "select", options: opt(["720p", "1080p"]), defaultValue: "720p" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 15, defaultValue: 5 };

// t2v/全能参考带比例；i2v/首尾帧比例由输入图推断（dreamina 不收 --ratio）→ 这两模式不放 ratio 控件。
const PARAMS_WITH_RATIO: ModelParameterControl[] = [RATIO, RESOLUTION, DURATION];
const PARAMS_NO_RATIO: ModelParameterControl[] = [RESOLUTION, DURATION];

const MODES: ModelArchetype["modes"] = [
  {
    id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "用即梦会员积分，纯文字生成 Seedance 2.0 视频",
    promptRequired: true, transportTaskKind: "text_to_video", fixedParams: { dreamina_cmd: "text2video" },
    slots: [], params: PARAMS_WITH_RATIO,
  },
  {
    id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "单张首帧图驱动生成（比例随图）",
    promptRequired: true, transportTaskKind: "image_to_video", fixedParams: { dreamina_cmd: "image2video" },
    slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "i2v_image" }], params: PARAMS_NO_RATIO,
  },
  {
    id: "firstlast", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧 + 尾帧，过渡更可控（比例随首帧）",
    promptRequired: true, transportTaskKind: "image_to_video", fixedParams: { dreamina_cmd: "frames2video" },
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "frames_first" },
      { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "frames_last" },
    ], params: PARAMS_NO_RATIO,
  },
  {
    id: "multimodal", intent: "character", vendorTerm: "全能参考", hint: "多模态参考：最多 9 图 / 3 视频 / 3 音频",
    promptRequired: true, transportTaskKind: "image_to_video", fixedParams: { dreamina_cmd: "multimodal2video" },
    slots: [
      { kind: "image_ref", label: "角色参考", min: 0, max: 9, characterIndexed: true, inputKey: "mm_images" },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "mm_videos" },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "mm_audios" },
    ], params: PARAMS_WITH_RATIO,
  },
];

// 非 vip 档不支持 1080p（官方 -h）→ 清晰度收成 720p only（effect-first，不给跑不了的选项）。
const lowResParam: ModelParameterControl = { key: "video_resolution", label: "清晰度", type: "select", options: opt(["720p"]), defaultValue: "720p" };
const narrowResolutionToLow = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "video_resolution" ? lowResParam : p));
const LOW_RES_OVERRIDES = Object.fromEntries(MODES.map((m) => [m.id, narrowResolutionToLow] as const));

export const DREAMINA_SEEDANCE_ARCHETYPE: ModelArchetype = {
  id: "dreamina-seedance-2",
  family: "seedance",
  label: "即梦 Seedance 2.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["dreamina-seedance-2.0", "dreamina-seedance"],
  modes: MODES,
  // 5 变体 = dreamina 的 model_version（默认 fast，官方 -h 默认值）。非 vip 档锁 720p。
  variants: [
    { id: "fast", label: "快速", modelKey: "seedance2.0fast", paramOverrides: LOW_RES_OVERRIDES },
    { id: "standard", label: "标准", modelKey: "seedance2.0", paramOverrides: LOW_RES_OVERRIDES },
    { id: "vip", label: "VIP·可1080p", modelKey: "seedance2.0_vip" },
    { id: "fast_vip", label: "VIP快速·可1080p", modelKey: "seedance2.0fast_vip" },
    { id: "mini", label: "Mini", modelKey: "seedance2.0mini", paramOverrides: LOW_RES_OVERRIDES },
  ],
  defaultVariantId: "fast",
};
