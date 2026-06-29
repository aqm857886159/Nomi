import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Agnes AI 视频档案（agnes-video-v2.0）。文档：wiki.agnes-ai.com/en/docs/agnes-video-v20.md。
// 用户侧控件 = 比例 + 清晰度(480p/720p/1080p) + 时长(秒) + 负向（D1：不暴露 width/height/num_frames）；
// wire 字段由 agnesVideos.ts 的 paramMap transform 派生（aspect_ratio/resolution → width/height，
// duration → num_frames）。文生视频 / 图生视频（单图首帧，进顶层 image）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 18, defaultValue: 5 },
  { key: "negative_prompt", label: "负向提示", type: "text", options: [], placeholder: "排除的元素…" },
];

export const AGNES_VIDEO_ARCHETYPE: ModelArchetype = {
  id: "agnes-video",
  family: "agnes-video",
  label: "Agnes Video V2.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["agnes-video", "agnes-video-v2.0", "agnes-video-v2"],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "参考图作首帧驱动", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "首帧图", min: 1, max: 1, inputKey: "image", asArray: false }],
      params: PARAMS,
    },
  ],
};
