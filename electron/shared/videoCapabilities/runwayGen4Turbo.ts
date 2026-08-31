import type { ModelParameterControl, ModelArchetype } from "./types";

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["1280:720", "720:1280", "1104:832", "832:1104", "960:960", "1584:672"]), defaultValue: "1280:720" },
  { key: "duration", label: "时长(秒)", type: "select", options: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ value, label: String(value) })), defaultValue: 5 },
  { key: "seed", label: "种子", type: "number", options: [], min: 0, max: 4294967295, defaultValue: 0 },
];

export const RUNWAY_GEN4_TURBO_ARCHETYPE: ModelArchetype = {
  id: "runway-gen4-turbo", family: "runway", label: "Runway Gen-4 Turbo", kind: "video", defaultModeId: "i2v", transportTaskKind: "image_to_video",
  identifierPatterns: ["gen4_turbo", "runway-gen4-turbo", "runway-gen-4-turbo"],
  sources: [
    { url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json", checkedAt: "2026-08-30", vendorKey: "runway", covers: "Runway OpenAPI v2024-11-06: gen4_turbo is image-to-video only; promptText, promptImage, six ratio values, optional duration 2–10, seed 0–4294967295." },
    { url: "https://docs.dev.runwayml.com/guides/models/", checkedAt: "2026-08-30", vendorKey: "runway", covers: "Official model table lists gen4_turbo as Image → Video and current flagship Gen-4 family; Gen-3 Alpha Turbo is sunset and is not seeded." },
  ],
  modes: [{ id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "快速单图首帧生成视频", promptRequired: true, transportTaskKind: "image_to_video", slots: [{ kind: "image_ref", label: "首帧", min: 1, max: 1, inputKey: "image_url", asArray: false }], params: PARAMS }],
};
