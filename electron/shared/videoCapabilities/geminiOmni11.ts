import type { ModelParameterControl, ModelArchetype } from "./types";
import { runwayRatioControl } from "./runwayWireFacts";

const opt = (values: Array<string | number>): ModelParameterControl["options"] => values.map((value) => ({ value, label: String(value) }));
const PARAMS: ModelParameterControl[] = [
  { key: "duration", label: "时长(秒)", type: "select", options: opt([4, 6, 8, 10]), defaultValue: 8 },
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["360p", "720p", "1080p", "4k"]), defaultValue: "720p" },
  { key: "seed", label: "种子", type: "number", options: [], min: 0, max: 2147483647 },
];

// Runway 转售的 gemini_omni_flash：Runway union 的 gemini 变体只有 ratio / duration——
// **没有 resolution，也没有 seed**（kie 侧两者都有）。比例枚举是像素式的 1280:720 / 720:1280
// 两项，从 shared 的同一张表 derive（与传输层归一器同源）。
// 时长无族级枚举约束登记 → 沿用档案自己的 4/6/8/10 控件，不无谓收窄。
const RUNWAY_PARAMS: ModelParameterControl[] = [
  PARAMS.find((p) => p.key === "duration")!,
  runwayRatioControl("gemini"),
];

export const GEMINI_OMNI_11_ARCHETYPE: ModelArchetype = {
  legacyIds: ["runway-video"], id: "gemini-omni-1.1", family: "gemini-omni", label: "Gemini Omni 1.1 Flash", kind: "video", defaultModeId: "t2v", transportTaskKind: "text_to_video",
  identifierPatterns: ["google/gemini-omni-flash-1-1", "gemini-omni-flash-1-1", "gemini_omni_flash"],
  sources: [{ url: "https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md", checkedAt: "2026-08-30", vendorKey: "kie", covers: "POST /api/v1/jobs/createTask + /api/v1/jobs/recordInfo; 4/6/8/10 seconds, 16:9 or 9:16, 360p/720p/1080p/4k, image_urls≤7, audio_ids≤3, video_list≤1 (≤10s segment), character_ids quota-limited. The typed UI currently blocks the latter three ID/object inputs; headless contracts accept them explicitly." }],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS, vendorParams: { runway: RUNWAY_PARAMS } },
    { id: "firstlast", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧必填，尾帧可选", promptRequired: true, transportTaskKind: "image_to_video", slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_url" }, { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "last_frame_url" }], params: PARAMS, vendorParams: { runway: RUNWAY_PARAMS } },
    { id: "reference", intent: "character", vendorTerm: "参考图", hint: "最多 7 张角色、场景或风格参考图", promptRequired: true, transportTaskKind: "image_to_video", slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 7, inputKey: "image_urls" }], params: PARAMS, vendorParams: { runway: RUNWAY_PARAMS } },
  ],
};
