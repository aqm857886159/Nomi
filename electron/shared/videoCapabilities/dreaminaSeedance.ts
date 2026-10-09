// 即梦官方 dreamina CLI 的 Seedance 视频档案（声明控件/模式/变体，通用系统据此渲染 UI）。
// dreamina 底层现覆盖 Seedance 2.0 家族 + 2.5，走本地 CLI，参数 enum 以官方 `-h` 为准。
// SOURCE：docs/research/2026-09-01-dreamina-cli-v1417-matrix.md（CLI v1.4.17，build 2026-08-17，checkedAt 2026-09-01）。
//   - 2.0 家族：duration 4-15、6 比例、720p；1080p 仅 vip 档（720p/1080p/4k）。
//   - 2.5（v1.4.15 起视频全线支持，v1.4.17 加 1080p）：duration 4-30、video_resolution 480p/720p/1080p、VIP-only、多模态可纯音频。
// v1.4.14 破坏性变更：视频必须显式 --video_resolution（本机 pre-auth 探针实测硬拒缺参）。
//
// 4 模式 = dreamina 的 4 个视频子命令（mode.fixedParams 注入 dreamina_cmd 选子命令，args 模板首元素取它）：
//   t2v=text2video（text_to_video 桶）/ i2v=image2video / 首尾帧=frames2video / 全能参考=multimodal2video（后三个同 image_to_video 桶，
//   靠一条 mapping + per-mode params 控制 flag，空值自动丢 → 避开「image2video 不认 --ratio」类子命令 flag 差异）。
// multiframe2video（多帧/transition）在 dreaminaMultiframe.ts 单列（无 model_version）。
import type { ModelParameterControl } from "./types";
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
    id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "用即梦接入，纯文字生成 Seedance 视频",
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
    id: "multimodal", intent: "character", vendorTerm: "全能参考", hint: "多模态参考：2.0 最多 9 图 / 3 视频 / 3 音频；2.5 最多 30 图 / 10 视频 / 10 音频（可纯音频）",
    promptRequired: true, transportTaskKind: "image_to_video", fixedParams: { dreamina_cmd: "multimodal2video" },
    slots: [
      { kind: "image_ref", label: "角色参考", min: 0, max: 9, characterIndexed: true, inputKey: "mm_images" },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "mm_videos" },
      // requiresAnyOf 是**槽级声明**、无 per-variant 覆盖轴（ModelArchetypeVariant 只有 paramOverrides）。这里按 2.0 家族的
      // 模型级契约声明「音频不能单独用」（同方舟/APIMart：不支持纯音频输入）。2.5 的 -h 虽解除此限（audio-only is allowed），
      // 但因 dreamina CLI 是**单命令 + model_version 变体轴**（不像方舟/APIMart 各自独立档案），保留此声明是**保守安全**的：
      // 只会拦下「2.5 纯音频」这一 2.5 独有场景，绝不会放行 2.0 的非法组合。此为诚实的有界限制，非 bug（见 matrix §1 multimodal2video）。
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "mm_audios", requiresAnyOf: ["image_ref", "video_ref"] },
    ], params: PARAMS_WITH_RATIO,
  },
];

// 非 vip 档（2.0 标准/快速/mini）不支持 1080p（官方 -h：其余所有 → 720p）→ 清晰度收成 720p only（effect-first，不给跑不了的选项）。
const lowResParam: ModelParameterControl = { key: "video_resolution", label: "清晰度", type: "select", options: opt(["720p"]), defaultValue: "720p" };
const narrowResolutionToLow = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "video_resolution" ? lowResParam : p));
const LOW_RES_OVERRIDES = Object.fromEntries(MODES.map((m) => [m.id, narrowResolutionToLow] as const));

// Seedance 2.5：video_resolution 480p/720p/1080p（非 vip 也可全档，-h：seedance2.5 -> 480p, 720p, or 1080p）、duration 4-30。
// 用 paramOverrides 给 2.5 变体自己的清晰度+时长形状（不套 LOW_RES，也不用基础的 720p/1080p）。
const res25Param: ModelParameterControl = { key: "video_resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p"]), defaultValue: "720p" };
const duration25Param: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 30, defaultValue: 5 };
const applySeedance25Shape = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "video_resolution" ? res25Param : p.key === "duration" ? duration25Param : p));
const SEEDANCE_25_OVERRIDES = Object.fromEntries(MODES.map((m) => [m.id, applySeedance25Shape] as const));

export const DREAMINA_SEEDANCE_ARCHETYPE: ModelArchetype = {
  id: "dreamina-seedance-2",
  family: "seedance",
  label: "即梦 Seedance",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["dreamina-seedance-2.0", "dreamina-seedance"],
  modes: MODES,
  // 变体 = dreamina 的 model_version（默认 fast，官方 -h text2video 默认值）。非 vip 2.0 档锁 720p；2.5 全档 480/720/1080 + 4-30s。
  // 命名裁决：2.5 的 model_version 在现役 -h 里写作 `seedance2.5`（有小数点、无「3」）——见 matrix §5，不采纳 #258 侧支线的 seedance-3 改名。
  variants: [
    { id: "fast", label: "快速", modelKey: "seedance2.0fast", paramOverrides: LOW_RES_OVERRIDES },
    { id: "standard", label: "标准", modelKey: "seedance2.0", paramOverrides: LOW_RES_OVERRIDES },
    { id: "vip", label: "VIP·可1080p", modelKey: "seedance2.0_vip" },
    { id: "fast_vip", label: "VIP快速·可1080p", modelKey: "seedance2.0fast_vip" },
    { id: "mini", label: "Mini", modelKey: "seedance2.0mini", paramOverrides: LOW_RES_OVERRIDES },
    { id: "v2_5", label: "2.5·VIP", modelKey: "seedance2.5", paramOverrides: SEEDANCE_25_OVERRIDES },
  ],
  defaultVariantId: "fast",
};
