import type { ModelParameterControl, ModelArchetype } from "./types";

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: options(["480P", "768P"]), defaultValue: "768P" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 5, max: 15, defaultValue: 5 };

export const MINIMAX_H3_MAX_ARCHETYPE: ModelArchetype = {
  id: "minimax-h3-max", family: "minimax", label: "MiniMax H3-Max", kind: "video", defaultModeId: "t2v", transportTaskKind: "text_to_video",
  identifierPatterns: ["minimax/h3-max", "MiniMax-H3-Max"],
  sources: [{ url: "https://platform.minimaxi.com/docs/guides/video-generation", checkedAt: "2026-09-02", vendorKey: "minimax", covers: "POST /v2/video_generation: MiniMax-H3-Max supports text, first/last-frame, and multimodal reference video; 480P/768P, 5–15 seconds." }],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "极速生成视频", promptRequired: true, slots: [], params: [RESOLUTION, DURATION, { key: "aspect_ratio", label: "比例", type: "select", options: options(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" }] },
    { id: "i2v", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧必填，尾帧可选", promptRequired: true, transportTaskKind: "image_to_video", slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "image_url", asArray: false }, { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "end_image_url", asArray: false }], params: [RESOLUTION, DURATION] },
  ],
};
