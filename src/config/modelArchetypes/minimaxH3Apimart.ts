import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// APIMart MiniMax-H3 能力档案。KIE H3 的 image_url/reference_* 与 APIMart 的
// first_frame_image/image_urls/video_urls/audio_urls 不是同一条线缆，故保留独立档案。

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: options(["2K", "768P"]), defaultValue: "2K" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 15, defaultValue: 5 };
const WATERMARK: ModelParameterControl = { key: "watermark", label: "添加水印", type: "boolean", options: [], defaultValue: false };
const WEBHOOK: ModelParameterControl = { key: "webhook", label: "Webhook", type: "text", options: [], placeholder: "可选" };
const RATIO_REQUIRED: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: options(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), defaultValue: "16:9" };
const RATIO_ADAPTIVE: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: options(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), defaultValue: "adaptive" };

const MODES: ModelArchetype["modes"] = [
  {
    id: "t2v",
    intent: "text",
    vendorTerm: "文生视频",
    hint: "纯文字生成视频，2K / 768P，4–15 秒",
    promptRequired: true,
    transportTaskKind: "text_to_video",
    slots: [],
    params: [RESOLUTION, RATIO_REQUIRED, DURATION, WATERMARK, WEBHOOK],
  },
  {
    id: "first",
    intent: "single",
    vendorTerm: "首帧",
    hint: "首帧图驱动，可选尾帧",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image" },
      { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "last_frame_image" },
    ],
    params: [RESOLUTION, DURATION, WATERMARK, WEBHOOK],
  },
  {
    id: "firstlast",
    intent: "firstlast",
    vendorTerm: "首尾帧",
    hint: "首帧 + 尾帧，比例随输入图片",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image" },
      { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "last_frame_image" },
    ],
    params: [RESOLUTION, DURATION, WATERMARK, WEBHOOK],
  },
  {
    id: "ref",
    intent: "character",
    vendorTerm: "多模态参考",
    hint: "参考图 / 视频 / 音频；音频不能单独输入",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "image_ref", label: "参考图", min: 0, max: 9, characterIndexed: true, inputKey: "image_urls" },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "video_urls" },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "audio_urls" },
    ],
    params: [RESOLUTION, RATIO_ADAPTIVE, DURATION, WATERMARK, WEBHOOK],
  },
];

export const MINIMAX_H3_APIMART_ARCHETYPE: ModelArchetype = {
  id: "minimax-h3-apimart",
  family: "minimax",
  label: "MiniMax H3",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["MiniMax-H3"],
  modes: MODES,
};
