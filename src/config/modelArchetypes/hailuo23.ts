import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Hailuo 2.3（apimart 独占）视频档案。无 aspect_ratio；resolution 768p/1080p（1080p 仅支持 6s）；
// duration 官方离散 6/10（select + 数值 option → 发整数、不可输 7/8/9 非法值）。
// 图生视频用 first_frame_image（字符串，非数组）→ first_frame 槽 inputKey 覆盖。
// 变体（官方 model 枚举标准 / -2.3-Fast）：Fast 低延迟（注：Fast 要求 first_frame_image，宜配图模式）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const numOpt = (values: number[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: `${value}` }));

const PARAMS: ModelParameterControl[] = [
  { key: "resolution", label: "清晰度", type: "select", options: opt(["768p", "1080p"]), defaultValue: "768p" },
  { key: "duration", label: "时长(秒)", type: "select", options: numOpt([6, 10]), defaultValue: 6 },
];

export const HAILUO_2_3_ARCHETYPE: ModelArchetype = {
  id: "hailuo-2.3",
  family: "hailuo",
  label: "Hailuo 2.3",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["hailuo-2.3", "minimax-hailuo-2.3", "hailuo-2-3", "minimax-hailuo-2.3-fast"],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "单张首帧图驱动", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false }],
      params: PARAMS,
    },
  ],
  // 变体：标准 / Fast（低延迟）。modelKey = 实际发请求的 model 字符串。
  variants: [
    { id: "standard", label: "标准", modelKey: "MiniMax-Hailuo-2.3", identifierPatterns: ["minimax-hailuo-2.3", "hailuo-2-3"] },
    { id: "fast", label: "Fast", modelKey: "MiniMax-Hailuo-2.3-Fast", identifierPatterns: ["minimax-hailuo-2.3-fast"] },
  ],
  defaultVariantId: "standard",
};
