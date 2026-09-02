import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";
import { runwayDurationControl } from "./runwayWireFacts";

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

// Runway 转售的 grok_imagine_1_5：Runway union 的 grok 变体只有 duration / resolution——
// 它**显式 drop 掉 aspect_ratio**（比例由模型自定），且清晰度键叫 `resolution` 而非 apimart 的
// `quality`。故 Runway 侧既不出「比例」控件（apimart 的 `size` 在这里无处可发），
// 也把清晰度换成线缆真名。时长无族级枚举约束（RUNWAY_VIDEO_DURATION_ENUMS 里只有 veo 登记），
// 故 runwayDurationControl 返回 null，沿用档案自己的 duration 控件——不无谓收窄。
const RUNWAY_PARAMS: ModelParameterControl[] = [
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p"]), defaultValue: "480p" },
  runwayDurationControl("grok") ?? COMMON_PARAMS.find((p) => p.key === "duration")!,
];

export const GROK_IMAGINE_1_5_VIDEO_ARCHETYPE: ModelArchetype = {
  // Runway 的 grok_imagine_1_5 行原挂平台档案 runway-video（已删）；存量节点靠 legacyIds 迁到这里。
  legacyIds: ["runway-video"],
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
    // Runway 判别串。
    "grok_imagine_1_5",
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
      vendorParams: { runway: RUNWAY_PARAMS },
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
      vendorParams: { runway: RUNWAY_PARAMS },
    },
  ],
};
