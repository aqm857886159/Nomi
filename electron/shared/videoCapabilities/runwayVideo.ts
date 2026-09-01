import type { ModelParameterControl, ModelArchetype } from "./types";

const options = (values: Array<string | number>): ModelParameterControl["options"] => values.map((value) => ({ value, label: String(value) }));
const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["1280:720", "720:1280", "1920:1080", "1080:1920", "16:9", "9:16"]), defaultValue: "1280:720" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 30, defaultValue: 5 },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
];

export const RUNWAY_VIDEO_ARCHETYPE: ModelArchetype = {
  id: "runway-video", family: "runway", label: "Runway 视频模型", kind: "video", defaultModeId: "t2v", transportTaskKind: "text_to_video",
  identifierPatterns: ["seedance2", "seedance2_fast", "seedance2_mini", "wan3", "grok_imagine_1_5", "hailuo3", "veo3.1", "veo3.1_fast", "happyhorse_1_0", "gemini_omni_flash"],
  sources: [
    { url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json", checkedAt: "2026-08-30", vendorKey: "runway", covers: "Runway OpenAPI current video discriminators: seedance2/2.5/fast/mini, wan3, grok_imagine_1_5, hailuo3, veo3.1/fast, happyhorse_1_0, gemini_omni_flash; text_to_video and image_to_video lifecycle" },
    { url: "https://docs.dev.runwayml.com/guides/models/", checkedAt: "2026-08-30", vendorKey: "runway", covers: "官方模型目录与当前可用的视频模型族；旧模型不在本档案中新增" },
  ],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "用文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
    { id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "用首帧或参考图生成视频", promptRequired: true, transportTaskKind: "image_to_video", slots: [{ kind: "image_ref", label: "首帧/参考图", min: 1, max: 10, inputKey: "image_url", asArray: false }], params: PARAMS },
    { id: "reference", intent: "character", vendorTerm: "多图参考", hint: "用多张角色或环境参考图生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [{ kind: "image_ref", label: "角色/环境参考", min: 1, max: 10, inputKey: "reference_image_urls", characterIndexed: true }], params: PARAMS },
  ],
};

export const RUNWAY_VIDEO_T2V_ARCHETYPE: ModelArchetype = {
  ...RUNWAY_VIDEO_ARCHETYPE,
  id: "runway-video-t2v", label: "Runway 文生视频模型", identifierPatterns: ["happyhorse_1_0"], modes: [RUNWAY_VIDEO_ARCHETYPE.modes[0]],
};
