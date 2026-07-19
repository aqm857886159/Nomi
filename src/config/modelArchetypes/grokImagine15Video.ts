import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Grok Imagine 1.5（APIMart）视频档案。支持文生视频 / 图生视频；图生最多 7 张公网图片，
// 比例会自动跟随参考图，因此图生模式不展示也不发送 size。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const COMMON_PARAMS: ModelParameterControl[] = [
  { key: "quality", label: "清晰度", type: "select", options: opt(["480p", "720p"]), defaultValue: "480p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 6, max: 30, defaultValue: 6 },
];

const T2V_PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "3:2", "2:3"]), defaultValue: "16:9" },
  ...COMMON_PARAMS,
];

export const GROK_IMAGINE_1_5_VIDEO_ARCHETYPE: ModelArchetype = {
  id: "grok-imagine-1.5-video",
  family: "grok-imagine",
  label: "Grok Imagine 1.5",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: [
    "grok-imagine-1.5-video-apimart",
    "grok-imagine-1.5-video-ext",
    "grok-imagine-1.5-video",
    "grok-imagine-1.5",
  ],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成 6–30 秒视频",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: T2V_PARAMS,
    },
    {
      id: "i2v",
      intent: "single",
      vendorTerm: "图生视频",
      hint: "最多 7 张公网参考图；比例自动跟随图片",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 7, inputKey: "image_urls" }],
      params: COMMON_PARAMS,
    },
  ],
};
