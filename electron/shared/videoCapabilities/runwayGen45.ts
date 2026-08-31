import type { ModelParameterControl, ModelArchetype } from "./types";

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const ratios = ["1280:720", "720:1280", "1104:832", "832:1104", "960:960", "1584:672"];
const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(ratios), defaultValue: "1280:720" },
  { key: "duration", label: "时长(秒)", type: "select", options: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ value, label: String(value) })), defaultValue: 5 },
  { key: "seed", label: "种子", type: "number", options: [], min: 0, max: 4294967295, defaultValue: 0 },
];

export const RUNWAY_GEN45_ARCHETYPE: ModelArchetype = {
  id: "runway-gen4.5", family: "runway", label: "Runway Gen-4.5", kind: "video", defaultModeId: "t2v", transportTaskKind: "text_to_video",
  identifierPatterns: ["gen4.5", "runway-gen4.5", "runway-gen-4.5"],
  sources: [
    { url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json", checkedAt: "2026-08-30", vendorKey: "runway", covers: "Runway OpenAPI v2024-11-06: gen4.5 on /v1/text_to_video and /v1/image_to_video, promptText, ratio, duration 2–10, seed 0–4294967295." },
    { url: "https://docs.dev.runwayml.com/guides/using-the-api/", checkedAt: "2026-08-30", vendorKey: "runway", covers: "Official quickstart: Bearer API key plus X-Runway-Version: 2024-11-06; create then poll task output; promptImage is optional for Gen-4.5 text-to-video." },
  ],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
    { id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "单张首帧驱动视频", promptRequired: true, transportTaskKind: "image_to_video", slots: [{ kind: "image_ref", label: "首帧", min: 1, max: 1, inputKey: "image_url", asArray: false }], params: PARAMS },
  ],
};
