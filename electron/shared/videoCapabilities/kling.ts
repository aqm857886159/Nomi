import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// Kling 3.0（可灵）视频档案（2026-06）。kie 文档：docs.kie.ai/market/kling/kling-3-0。
// 本期从简两模式：文生视频 / 图生视频（首/尾帧走一个有序 image_urls 数组槽，≤2；[0]=首帧 [1]=尾帧）。
// 多镜头 multi_shots / @元素引用 kling_elements 作后续增强（见 docs/plan/2026-06-06-image-archetypes.md §6）。
// 两模式同 model enum `kling-3.0/video`，taskKind 不同（text_to_video / image_to_video）。
// duration 是字符串枚举（kie 文档 "3".."15"），用 select string 选项保证发的是 "5" 而非数字。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const KLING_PARAMS: ModelParameterControl[] = [
  { key: "mode", label: "画质", type: "select", options: opt(["std", "pro", "4K"]), defaultValue: "pro" },
  { key: "duration", label: "时长", type: "select", options: opt(["3", "5", "10"]), defaultValue: "5" },
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1"]), defaultValue: "16:9" },
  { key: "sound", label: "声效", type: "boolean", options: [], defaultValue: false },
];

// apimart 专属 params（B 分层）：apimart Kling v3 字段名 mode(std/pro/4k) + duration(整数 3-15) +
// aspect_ratio + audio(非 kie 的 sound)。i2v 结构与 kie 对齐（image_urls 数组槽）故共享本档案。
const APIMART_KLING_PARAMS: ModelParameterControl[] = [
  { key: "mode", label: "画质", type: "select", options: opt(["std", "pro", "4k"]), defaultValue: "pro" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 3, max: 15, defaultValue: 5 },
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1"]), defaultValue: "16:9" },
  { key: "audio", label: "声效", type: "boolean", options: [], defaultValue: false },
  { key: "negative_prompt", label: "负向提示", type: "text", options: [], placeholder: "排除的元素…" },
];

// APIMart 图生方式不给选比例：APIMart 文档「In image-to-video mode, aspect_ratio may be overridden by the actual
// image ratio」，目录一直在图生里丢掉它。控件在、值发不出去 = 选了没用，故 APIMart 的图生参数不声明它
// （以前是 APIMart 目录的 i2vDrops 在发送时丢，2026-11-15 收回档案一处）。共享 params（fal / kie）不动：fal 图生 body 照发
// aspect_ratio，改它会动 fal 的请求体，不在这一刀。
const withoutAspectRatio = (params: ModelParameterControl[]) => params.filter((control) => control.key !== "aspect_ratio");

export const KLING_3_ARCHETYPE: ModelArchetype = {
  id: "kling-3.0",
  family: "kling",
  sources: [{ url: "https://docs.apimart.ai/en/api-reference/videos/kling-v3/generation.md", checkedAt: "2026-11-15", vendorKey: "apimart", covers: "aspect_ratio 16:9 / 9:16 / 1:1, default 16:9; In image-to-video mode, aspect_ratio may be overridden by the actual image ratio" }],
  label: "可灵 3.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["kling-3.0", "kling-3.0/video", "kling-3", "kling3", "kling-v3"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频",
      promptRequired: true,
      modelEnum: "kling-3.0/video",
      transportTaskKind: "text_to_video",
      slots: [],
      params: KLING_PARAMS,
      vendorParams: { apimart: APIMART_KLING_PARAMS },
    },
    {
      id: "i2v",
      intent: "single",
      vendorTerm: "图生视频",
      hint: "首/尾帧驱动（按序放：第 1 张=首帧，第 2 张=尾帧）",
      promptRequired: true,
      modelEnum: "kling-3.0/video",
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "首/尾帧", min: 1, max: 2, inputKey: "image_urls" }],
      params: KLING_PARAMS,
      vendorParams: { apimart: withoutAspectRatio(APIMART_KLING_PARAMS) },
    },
  ],
};
