import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// PixVerse V6 / V6 Max（APIMart 官方页 docs.apimart.ai/en/api-reference/videos/pixverse-v6/generation.md 与 pixverse-v6-max，2026-11-07 核）。
// 两个并列 model id：
//   pixverse-v6      文生 / 单图生 / 首尾帧过渡（时长只收 5 或 8 秒）/ 多图融合 / 续拍；比例字段叫 size
//   pixverse-v6-max  更高质量档，只有文生 / 单图生；比例字段叫 aspect_ratio；明写不支持首尾帧、多图融合、续拍
// 只接文生 / 单图生 / V6 的首尾帧。不声明：img_references 多图融合（另一类输入）、extend_from_task_id（续拍，要原任务）、
// generate_multi_clip_switch / motion_mode / watermark / seed / negative_prompt（默认值即可用）。
// audio 官方默认 false（开了每秒更贵），本档案声明并默认关，不替用户开付费项。
// 分辨率默认 540p（官方默认），1080p 每秒约 2.7 倍价。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["360p", "540p", "720p", "1080p"]), defaultValue: "540p" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 15, defaultValue: 5 };
const AUDIO: ModelParameterControl = { key: "audio", label: "生成声音", type: "boolean", options: [], defaultValue: false };
const RATIOS = ["16:9", "9:16", "4:3", "3:4", "1:1", "2:3", "3:2", "21:9"];

export const PIXVERSE_V6_ARCHETYPE: ModelArchetype = {
  id: "pixverse-v6",
  family: "pixverse",
  label: "PixVerse V6",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["pixverse-v6"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/pixverse-v6/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `pixverse-v6`；resolution 360p|540p(默认)|720p|1080p；duration 1–15 整数(默认 5)，首尾帧过渡只收 5 或 8；" +
      "size 比例 16:9(默认)|4:3|1:1|3:4|9:16|2:3|3:2|21:9，仅文生有效；audio 布尔(默认 false，开了更贵)；" +
      "单图生 image_urls 只取第一张；首尾帧 first_frame_image + last_frame_image 必须成对；" +
      "不声明 img_references / extend_from_task_id / generate_multi_clip_switch / motion_mode / watermark / seed / negative_prompt。",
  }],
  modes: [
    {
      id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [],
      params: [{ key: "size", label: "比例", type: "select", options: opt(RATIOS), defaultValue: "16:9" }, RESOLUTION, DURATION, AUDIO],
    },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "单张图驱动，比例跟随图片", promptRequired: true, transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 1, inputKey: "image_urls" }],
      params: [RESOLUTION, DURATION, AUDIO],
    },
    {
      id: "firstlast", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧和尾帧都要给；时长只能 5 或 8 秒", promptRequired: true, transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false },
        { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "last_frame_image", asArray: false },
      ],
      params: [RESOLUTION, { key: "duration", label: "时长(秒)", type: "select", options: [{ value: 5, label: "5" }, { value: 8, label: "8" }], defaultValue: 5 }, AUDIO],
    },
  ],
};

export const PIXVERSE_V6_MAX_ARCHETYPE: ModelArchetype = {
  id: "pixverse-v6-max",
  family: "pixverse",
  label: "PixVerse V6 Max",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["pixverse-v6-max"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/pixverse-v6-max/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `pixverse-v6-max`；resolution 360p|540p(默认)|720p|1080p（也收 quality 别名，同时给以 resolution 为准）；" +
      "duration 1–15 整数(默认 5)；aspect_ratio 16:9(默认)|9:16|4:3|3:4|1:1|2:3|3:2|21:9，仅文生；audio 布尔(默认 false)；" +
      "图生 image_urls 必须刚好 1 张；明写不支持 extend_from_task_id / img_references / 首尾帧（同步 400）。",
  }],
  modes: [
    {
      id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [],
      params: [{ key: "aspect_ratio", label: "比例", type: "select", options: opt(RATIOS), defaultValue: "16:9" }, RESOLUTION, DURATION, AUDIO],
    },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "刚好 1 张图，比例跟随图片", promptRequired: false, transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 1, inputKey: "image_urls" }],
      params: [RESOLUTION, DURATION, AUDIO],
    },
  ],
};
