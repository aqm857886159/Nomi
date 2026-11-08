import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// 可灵 4.0（APIMart 官方页 docs.apimart.ai/en/api-reference/videos/kling-v4/generation.md，2026-11-07 核）。
// 单 model id `kling-v4`；3–30 秒，720p / 1080p，永远带立体声（官方：V4 不支持 mode 画质档，也没有声音开关）。
// 只接文生视频 / 图生视频（首帧，可选尾帧）基础模式。
// 不声明：参考生（omni_reference_task_type=reference，参考图 / 视频 / 音频混合）、视频编辑（edit）、视频续写（extend）、
// image_with_roles 的 keyframe 中间帧、audio_setting —— 要么要源视频，要么是另一类操作。
// 可灵 3.0（kling-3.0 档案）是上一代，两代都可选。官方写明 i2v 比例跟随首帧，所以图生模式不声明比例。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["720p", "1080p"]), defaultValue: "720p" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 3, max: 30, defaultValue: 5 };
const ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "21:9"]), defaultValue: "16:9" };

export const KLING_4_ARCHETYPE: ModelArchetype = {
  id: "kling-v4",
  family: "kling",
  label: "可灵 4.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["kling-v4", "kling-4.0"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/kling-v4/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `kling-v4`；duration 3–30 整数(默认 5)；resolution 720p(默认)|1080p（V4 没有 mode）；" +
      "aspect_ratio 16:9(默认)|9:16|1:1|21:9，仅文生；图生首帧 first_frame_image、尾帧 last_frame_image，比例跟随首帧；永远带立体声，无声音开关。" +
      "不声明：omni_reference_task_type / video_url(s) / audio_urls / image_with_roles keyframe / audio_setting（参考生、编辑、续写）。",
  }],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成 3–30 秒视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: [ASPECT, RESOLUTION, DURATION] },
    {
      id: "i2v", intent: "firstlast", vendorTerm: "图生视频", hint: "首帧必填，尾帧可选；比例跟随首帧", promptRequired: false,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "last_frame_image", asArray: false },
      ],
      params: [RESOLUTION, DURATION],
    },
  ],
};
