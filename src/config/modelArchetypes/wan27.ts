import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Wan 2.7（apimart 独占）视频档案。比例字段是 size（非 aspect_ratio，i2v 时被忽略）；resolution 720P/1080P；
// duration 2-15。文生视频 / 图生视频（image_urls 1-2，1=首帧 2=首尾帧）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["720P", "1080P"]), defaultValue: "1080P" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 2, max: 15, defaultValue: 5 },
  { key: "negative_prompt", label: "负向提示", type: "text", options: [], placeholder: "排除的元素…" },
];

export const WAN_2_7_ARCHETYPE: ModelArchetype = {
  id: "wan-2.7",
  family: "wan",
  label: "Wan 2.7",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["wan-2.7", "wan2.7", "wan-2-7"],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "参考图驱动（1 张=首帧，2 张=首尾帧）", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "首/尾帧", min: 1, max: 2, inputKey: "image_urls" }],
      params: PARAMS,
    },
  ],
};
