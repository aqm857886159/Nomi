import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// Vidu Q3 Pro / Turbo（文生 + 图生 + 首尾帧）与 Vidu Q4 预览版（图生 + 参考生）。
// 官方页 docs.apimart.ai/en/api-reference/videos/vidu-q3-pro 与 vidu-q4-preview（2026-11-07 核）。
// 现有 vidu-q3 档案只有参考生（viduq3 / viduq3-mix，无文生）；Pro / Turbo 是 Q3 的文生专线最新档，Q4 预览版没有文生。
// Q3 是上一代（Q3 Pro/Turbo 与 viduq3 都可选），Q4 预览版是最新一代。
// 不声明：Q3 的 seed / style / off_peak 等；Q4 的 audio_urls / audio_url 参考音频、size 别名、seed。

const opt = (values: Array<string | number>): ModelParameterControl["options"] => values.map((value) => ({ value, label: String(value) }));

// ── Q3 Pro / Turbo ────────────────────────────────────────────────────────────
// 1 张图 = 图生（首帧），2 张 = 首尾帧；有图时比例由图决定，官方禁止同时发 aspect_ratio。
const Q3_RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["540p", "720p", "1080p"]), defaultValue: "720p" };
const Q3_DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 16, defaultValue: 5 };
const Q3_AUDIO: ModelParameterControl = { key: "audio", label: "生成声音", type: "boolean", options: [], defaultValue: true };
const Q3_ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "4:3", "3:4", "1:1"]), defaultValue: "16:9" };

function viduQ3(modelId: string, label: string): ModelArchetype {
  return {
    id: modelId,
    family: "vidu",
    label,
    kind: "video",
    defaultModeId: "t2v",
    transportTaskKind: "text_to_video",
    identifierPatterns: [modelId],
    sources: [{
      url: "https://docs.apimart.ai/en/api-reference/videos/vidu-q3-pro/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
      covers:
        `POST /v1/videos/generations，model \`${modelId}\`；duration 1–16 整数(默认 5)；resolution 540p|720p(默认)|1080p；audio 布尔(默认 true)；` +
        "aspect_ratio 16:9|9:16|4:3|3:4|1:1，仅文生；image_urls 最多 2 张：1 张图生、2 张首尾帧，有图时不能再发 aspect_ratio；",
    }],
    modes: [
      { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: [Q3_ASPECT, Q3_RESOLUTION, Q3_DURATION, Q3_AUDIO] },
      {
        id: "i2v", intent: "firstlast", vendorTerm: "图生视频", hint: "1 张图 = 首帧，2 张图 = 首帧 + 尾帧；比例跟随图片", promptRequired: false, transportTaskKind: "image_to_video",
        slots: [{ kind: "image_ref", label: "首帧 / 首尾帧", min: 1, max: 2, inputKey: "image_urls" }],
        params: [Q3_RESOLUTION, Q3_DURATION, Q3_AUDIO],
      },
    ],
  };
}

export const VIDU_Q3_PRO_ARCHETYPE = viduQ3("viduq3-pro", "Vidu Q3 Pro");
export const VIDU_Q3_TURBO_ARCHETYPE = viduQ3("viduq3-turbo", "Vidu Q3 Turbo");

// ── Q4 预览版 ──────────────────────────────────────────────────────────────────
// 图生：首帧 first_frame_image 刚好 1 张；参考生：1–15 张参考图，prompt 必填，比例 aspect_ratio 仅参考生有效。
// 参考生的图走 image_with_roles，每张都带 role "reference_image"（combineSlotsInto，role 由 image_ref 槽派生）：
// 官方「Generation modes」表与「With only one image and no reference audio, explicitly set role: "reference_image";
// otherwise, image-to-video is used」——不带角色的单张图会被当成图生视频。带了角色，1 张也是参考生（官方示例
// 「Reference-to-video with a single image」），不在背后换成图生。
// duration 3–16（1–2 秒不收），resolution 540p|720p(默认)|1080p|2K|4K，audio 布尔(默认 true，有无声音同价)。
const Q4_RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["540p", "720p", "1080p", "2K", "4K"]), defaultValue: "720p" };
const Q4_DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 3, max: 16, defaultValue: 5 };
const Q4_ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" };

export const VIDU_Q4_PREVIEW_ARCHETYPE: ModelArchetype = {
  id: "viduq4-preview",
  family: "vidu",
  label: "Vidu Q4 预览版",
  kind: "video",
  defaultModeId: "i2v",
  transportTaskKind: "image_to_video",
  identifierPatterns: ["viduq4-preview"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/vidu-q4-preview/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `viduq4-preview`（无文生）；图生 first_frame_image 刚好 1 张；" +
      "参考生 1–15 张参考图且 prompt 必填，走 image_with_roles 每张 role=reference_image" +
      "(官方：只有 1 张、没有参考音频时必须显式写 role reference_image，否则按图生视频；图组限量依据「counts are added together」；示例「Reference-to-video with a single image」)；" +
      "aspect_ratio 1:1|9:16|16:9|3:4|4:3(默认 16:9) 仅参考生有效；duration 3–16 整数(默认 5)；resolution 540p|720p(默认)|1080p|2K|4K；" +
      "audio 布尔(默认 true，有无声音同价)；不声明 audio_urls / audio_url / size / seed。",
  }],
  modes: [
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "单张首帧图（提示词可留空）", promptRequired: false, transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false }],
      params: [Q4_RESOLUTION, Q4_DURATION, Q3_AUDIO],
    },
    {
      id: "ref", intent: "character", vendorTerm: "参考生视频", hint: "1–15 张参考图（1 张也按参考），必须写提示词", promptRequired: true, transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 15, inputKey: "image_urls" }],
      combineSlotsInto: { key: "image_with_roles" },
      params: [Q4_ASPECT, Q4_RESOLUTION, Q4_DURATION, Q3_AUDIO],
    },
  ],
};
