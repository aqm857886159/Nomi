import type { ModelParameterControl } from "./types";
import type { ArchetypeMode, ModelArchetype } from "./types";

// Gemini Omni 1.2 Flash（官方通道）与 Gemini Omni 1.2 Flash Ext（APIMart 官方页
// docs.apimart.ai/en/api-reference/videos/gemini-omni-1.2-flash/generation.md 与 …/gemini-omni-1.2-flash-ext/generation.md，2026-11-07 核）。
// 两者都是单 model id、同一个提交端点；Omni 1.1（gemini-omni-1.1 / omni-flash-ext 档案）是上一代，两代都可选。
// 共同合同：duration 整数 3–15（默认 10）；resolution 360p|720p(默认)|1080p|4k（大小写都收，2160p 同 4k）；
// aspect_ratio 只有 16:9|9:16、默认 16:9（两页都没有 auto：Flash 页写「其它值按 16:9」，Ext 页写「其它值 400」），
// 所以每种模式都只给这两档、默认 16:9，没有「自动」。每种模式 prompt 都必填；图只收公网 HTTP(S) 直链。
// 两条通道都只接文生视频 / 首帧图生视频 / 首尾帧 / 多图参考四种基础操作
// （Ext 页「Scenario 3: First-and-Last-Frame Video」：first_frame_image + last_frame_image；image_with_roles 是等价写法）。
// 首尾帧两页都写最长 10 秒，所以首尾帧模式的时长上限 10，其余模式 15。
// 不声明：video_urls + omni_reference_task_type=edit|extend、extend_from_task_id（视频编辑、续写：需要源视频，是另一类操作）、
// image_with_roles（首尾帧用直接字段）、negative_prompt、system_prompt。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["360p", "720p", "1080p", "4k"]), defaultValue: "720p" };
const duration = (max: number): ModelParameterControl => ({ key: "duration", label: "时长(秒)", type: "number", options: [], min: 3, max, defaultValue: 10 });
const ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16"]), defaultValue: "16:9" };

const T2V: ArchetypeMode = {
  id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成 3–15 秒视频", promptRequired: true, transportTaskKind: "text_to_video",
  slots: [], params: [ASPECT, RESOLUTION, duration(15)],
};
const I2V: ArchetypeMode = {
  id: "i2v", intent: "single", vendorTerm: "首帧图生视频", hint: "单张首帧图（提示词必填）", promptRequired: true, transportTaskKind: "image_to_video",
  slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false }],
  params: [ASPECT, RESOLUTION, duration(15)],
};
const FIRSTLAST: ArchetypeMode = {
  id: "firstlast", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧 + 尾帧，最长 10 秒；两张图比例要一致", promptRequired: true, transportTaskKind: "image_to_video",
  slots: [
    { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false },
    { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "last_frame_image", asArray: false },
  ],
  params: [ASPECT, RESOLUTION, duration(10)],
};
const REFERENCE: ArchetypeMode = {
  id: "reference", intent: "character", vendorTerm: "多图参考", hint: "1–10 张主体 / 风格参考图（提示词必填）", promptRequired: true, transportTaskKind: "image_to_video",
  slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 10, inputKey: "image_urls" }],
  fixedParams: { omni_reference_task_type: "reference" },
  params: [ASPECT, RESOLUTION, duration(15)],
};

export const GEMINI_OMNI_12_FLASH_ARCHETYPE: ModelArchetype = {
  id: "gemini-omni-1.2-flash", family: "gemini-omni", label: "Gemini Omni 1.2 Flash", kind: "video",
  defaultModeId: "t2v", transportTaskKind: "text_to_video",
  identifierPatterns: ["gemini-omni-1.2-flash"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/gemini-omni-1.2-flash/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `gemini-omni-1.2-flash`；duration 整数 3–15(默认 10，首尾帧 / 续写最长 10)；resolution 360p|720p(默认)|1080p|4k；" +
      "aspect_ratio 只有 16:9|9:16(默认 16:9，没有 auto，其它值按 16:9)；首帧 first_frame_image，首尾帧加 last_frame_image(必须有首帧)，多图参考 image_urls 最多 10 张(含首尾帧)；" +
      "多图参考发 omni_reference_task_type=reference；不声明视频编辑 / 续写 / image_with_roles / negative_prompt / system_prompt。",
  }],
  modes: [T2V, I2V, FIRSTLAST, REFERENCE],
};

export const GEMINI_OMNI_12_FLASH_EXT_ARCHETYPE: ModelArchetype = {
  id: "gemini-omni-1.2-flash-ext", family: "gemini-omni", label: "Gemini Omni 1.2 Flash Ext", kind: "video",
  defaultModeId: "t2v", transportTaskKind: "text_to_video",
  identifierPatterns: ["gemini-omni-1.2-flash-ext"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/gemini-omni-1.2-flash-ext/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `gemini-omni-1.2-flash-ext`；duration 整数 3–15(默认 10，首尾帧 3–10)；resolution 360p|720p(默认)|1080p|4k；" +
      "aspect_ratio 只有 16:9|9:16(默认 16:9，没有 auto，其它值 400)；首帧 first_frame_image；首尾帧 first_frame_image + last_frame_image" +
      "(Scenario 3；尾帧必须带首帧，两者都不能与 image_urls 同发；image_with_roles 的 first_frame / last_frame 是等价写法)；" +
      "多图参考 image_urls 1–10 张并发 omni_reference_task_type=reference；" +
      "不声明视频编辑 / 续写 / extend_from_task_id / image_with_roles / negative_prompt / system_prompt(后两者首尾帧模式也不能发)。",
  }],
  modes: [T2V, I2V, FIRSTLAST, REFERENCE],
};
