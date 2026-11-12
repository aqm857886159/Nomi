import type { ModelParameterControl, ModelArchetype } from "./types";

// 可灵 4.0 Flash（APIMart 官方页 docs.apimart.ai/en/api-reference/videos/kling-v4-flash/generation.md，2026-11-12 核）。
// 整页对齐，能力表见 docs/models/capabilities/kling-v4-flash.md。单 model id `kling-v4-flash`，五种方式：
//   文生视频 / 图生视频（单张首帧）/ 全能参考（≤10 图 + ≤5 视频，合计 ≤15）/ 视频编辑 / 视频续写。
// 清晰度只有 720p（官方：1080p 返回 400，默认就是 720p）→ 不渲染只有一个选项的假下拉，也不发；时长 3–20 整数。
// 比例：文生 16:9 / 9:16 / 1:1 / 21:9；参考与编辑多一个界面上的「auto」（经 omitAuto 不发：官方参考默认 auto、编辑不给比例就跟随源视频，线上永远不会收到 auto 给编辑）；
// 图生 / 续写发比例会 400，所以这两个方式不声明比例。图生只收一张首帧（尾帧 / 中间帧 / 第二张图都不支持）。
// 参考方式的声音：audio_setting auto（默认，生成新声音）| origin（保留第一段参考视频的声音，需要有参考视频）；编辑 / 续写官方明说不要发。
// 替创作者定：resolution 不发、nsfw 类字段不存在；不露出：seconds（duration 的别名，同一件事）、video_url（video_urls 的单值写法）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 3, max: 20, defaultValue: 5 };
const ASPECT_T2V: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "21:9"]), defaultValue: "16:9" };
const ASPECT_FOLLOW: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["auto", "16:9", "9:16", "1:1", "21:9"]), defaultValue: "auto" };
const AUDIO_SETTING: ModelParameterControl = { key: "audio_setting", label: "声音", type: "select", options: opt(["auto", "origin"]), defaultValue: "auto" };
/** 编辑：不给时长 = 跟随源视频（向上取整），所以没有默认值。 */
const DURATION_FOLLOW_SOURCE: ModelParameterControl = { ...DURATION, defaultValue: undefined, placeholder: "跟随源视频" };

export const KLING_4_FLASH_ARCHETYPE: ModelArchetype = {
  id: "kling-v4-flash",
  family: "kling",
  label: "可灵 4.0 Flash",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["kling-v4-flash", "kling-4.0-flash"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/kling-v4-flash/generation.md", checkedAt: "2026-11-12", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `kling-v4-flash`；五种方式：文生 / 图生(单首帧) / 参考生成(image_urls ≤10 + video_urls ≤5，合计 ≤15，视频合计 ≤20 秒) / 编辑(video 3–20 秒) / 续写；" +
      "duration 3–20 整数；resolution 只有 720p；aspect_ratio 16:9|9:16|1:1|21:9，仅参考生成接受 auto，图生与续写不接受；" +
      "audio_setting auto|origin 仅参考生成；omni_reference_task_type auto|reference|edit|extend。",
  }],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成 3–20 秒视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: [ASPECT_T2V, DURATION] },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "一张首帧；比例跟随首帧，提示词可选", promptRequired: false,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false }],
      params: [DURATION],
    },
    {
      id: "ref", intent: "character", vendorTerm: "全能参考", hint: "最多 10 张参考图 + 5 段参考视频（合计 15 个，视频合计 20 秒内）", promptRequired: true,
      transportTaskKind: "image_to_video", maxTotalReferences: 15,
      slots: [
        { kind: "image_ref", label: "参考图", min: 0, max: 10, characterIndexed: true, inputKey: "image_urls" },
        { kind: "video_ref", label: "参考视频", min: 0, max: 5, inputKey: "video_urls" },
      ],
      fixedParams: { omni_reference_task_type: "reference" },
      params: [ASPECT_FOLLOW, DURATION, AUDIO_SETTING],
    },
    {
      id: "edit", intent: "edit", vendorTerm: "视频编辑", hint: "源视频（3–20 秒）+ 提示词改写，可带最多 10 张参考图；声音重新生成", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "video_ref", label: "源视频", min: 1, max: 1, inputKey: "video_urls" },
        { kind: "image_ref", label: "参考图", min: 0, max: 10, characterIndexed: true, inputKey: "image_urls" },
      ],
      fixedParams: { omni_reference_task_type: "edit" },
      params: [ASPECT_FOLLOW, DURATION_FOLLOW_SOURCE],
    },
    {
      id: "extend", intent: "edit", vendorTerm: "视频续写", hint: "源视频接着往后生成一段新的 3–20 秒（只返回新片段）；比例沿用原视频", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "video_ref", label: "源视频", min: 1, max: 1, inputKey: "video_urls" }],
      fixedParams: { omni_reference_task_type: "extend" },
      params: [DURATION],
    },
  ],
};
