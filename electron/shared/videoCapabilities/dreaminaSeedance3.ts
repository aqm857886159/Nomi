// 即梦官方 dreamina CLI 的 Seedance 3.x 能力档案。
// 3.x 只在 image2video / frames2video 的官方 help 中出现，不与 Seedance 2.0 的
// text2video / multimodal2video 变体共用一条档案，避免 UI 暴露 CLI 不支持的组合。
import type { ModelParameterControl, ModelArchetype } from "./types";

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const RESOLUTION_720P: ModelParameterControl = {
  key: "video_resolution", label: "清晰度", type: "select", options: opt(["720p"]), defaultValue: "720p",
};

const duration = (min: number, max: number): ModelParameterControl => ({
  key: "duration", label: "时长(秒)", type: "number", options: [], min, max, step: 1, defaultValue: 5,
});

const IMAGE2VIDEO_PARAMS = (min: number, max: number): ModelParameterControl[] => [RESOLUTION_720P, duration(min, max)];
const FRAME_PARAMS = (min: number, max: number): ModelParameterControl[] => [RESOLUTION_720P, duration(min, max)];

const SOURCE = {
  url: "https://jimeng.jianying.com/cli",
  checkedAt: "2026-08-31",
  vendorKey: "dreamina",
  covers: "dreamina image2video/frames2video model_version：3.0、3.0fast、3.0pro、3.5pro；3.0/3.0fast/3.0pro 时长 3-10 秒，3.5pro 时长 4-12 秒；非 Seedance 2.0 变体仅 720p；比例由输入图推断",
} as const;

export const DREAMINA_SEEDANCE_3_I2V_ARCHETYPE: ModelArchetype = {
  id: "dreamina-seedance-3-i2v",
  family: "dreamina-seedance-3",
  label: "即梦 Seedance 3.x 图生视频",
  kind: "video",
  defaultModeId: "i2v",
  transportTaskKind: "image_to_video",
  identifierPatterns: ["dreamina-seedance-3-i2v"],
  sources: [SOURCE],
  modes: [{
    id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "即梦 3.x 单张首帧图生成视频，比例随输入图推断",
    promptRequired: true, transportTaskKind: "image_to_video", fixedParams: { dreamina_cmd: "image2video" },
    slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "i2v_image" }], params: IMAGE2VIDEO_PARAMS(3, 10),
  }],
  variants: [
    { id: "v3_0", label: "3.0", modelKey: "3.0" },
    { id: "v3_0_fast", label: "3.0 Fast", modelKey: "3.0fast", identifierPatterns: ["3.0_fast"] },
    { id: "v3_0_pro", label: "3.0 Pro", modelKey: "3.0pro", identifierPatterns: ["3.0_pro"] },
    { id: "v3_5_pro", label: "3.5 Pro", modelKey: "3.5pro", identifierPatterns: ["3.5_pro"], paramOverrides: { i2v: (params) => params.map((p) => p.key === "duration" ? { ...p, min: 4, max: 12, defaultValue: 5 } : p) } },
  ],
  defaultVariantId: "v3_0_fast",
};

export const DREAMINA_SEEDANCE_3_FRAMES_ARCHETYPE: ModelArchetype = {
  id: "dreamina-seedance-3-frames",
  family: "dreamina-seedance-3",
  label: "即梦 Seedance 3.x 首尾帧",
  kind: "video",
  defaultModeId: "firstlast",
  transportTaskKind: "image_to_video",
  identifierPatterns: ["dreamina-seedance-3-frames"],
  sources: [SOURCE],
  modes: [{
    id: "firstlast", intent: "firstlast", vendorTerm: "首尾帧", hint: "即梦 3.x 用首帧和尾帧控制过渡，比例随首帧推断",
    promptRequired: true, transportTaskKind: "image_to_video", fixedParams: { dreamina_cmd: "frames2video" },
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "frames_first" },
      { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "frames_last" },
    ], params: FRAME_PARAMS(3, 10),
  }],
  variants: [
    { id: "v3_0", label: "3.0", modelKey: "3.0" },
    { id: "v3_5_pro", label: "3.5 Pro", modelKey: "3.5pro", identifierPatterns: ["3.5_pro"], paramOverrides: { firstlast: (params) => params.map((p) => p.key === "duration" ? { ...p, min: 4, max: 12, defaultValue: 5 } : p) } },
  ],
  defaultVariantId: "v3_0",
};
