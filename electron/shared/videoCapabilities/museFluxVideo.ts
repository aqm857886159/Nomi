import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// Muse Video Ext 与 FLUX 3 Video（APIMart 官方页 docs.apimart.ai/en/api-reference/videos/muse-video-ext/generation.md 与
// flux-3-video/generation.md，2026-11-07 核）。两个模型的声明都只接文生 / 图生基础模式。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

// ── Muse Video Ext ─────────────────────────────────────────────────────────────
// 固定约 10 秒、720p、自带声音的 MP4；时长 / 清晰度 / 声音官方都不让改（audio:false 会被拒），所以一个都不声明、也不发。
// 比例 7 档；不选就不发（文生默认 16:9，带参考图则跟随参考图）；官方明写不要发 "auto"，所以没有 auto 项也没有默认值。
// 参考图最多 9 张，合计原始大小 ≤11 MiB；参考图是「引导」，不保证首帧逐像素一致。
const MUSE_ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"]) };

export const MUSE_VIDEO_EXT_ARCHETYPE: ModelArchetype = {
  id: "muse-video-ext",
  family: "runway-muse",
  label: "Muse Video",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["muse-video-ext"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/muse-video-ext/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `muse-video-ext`；aspect_ratio 7 档 1:1|16:9|9:16|4:3|3:4|3:2|2:3，不发则文生 16:9、带参考图跟随参考图，不要发 auto；" +
      "image_urls 最多 9 张（合计原始大小 ≤11 MiB）；固定约 10 秒 / 720p / 带声音，duration / resolution / audio 官方不让改（audio:false 被拒），不声明；n 只能 1。",
  }],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成约 10 秒视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: [MUSE_ASPECT] },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "最多 9 张参考图；约 10 秒、720p", promptRequired: true, transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 9, inputKey: "image_urls" }],
      params: [MUSE_ASPECT],
    },
  ],
};

// ── FLUX 3 Video ───────────────────────────────────────────────────────────────
// duration 5–20 整数（默认 5；官方不支持 "auto"）；resolution hd(默认，也收 720p)|fhd(也收 1080p)；
// aspect_ratio 21:9|2:1|16:9|4:3|1:1|3:4|9:16|auto(默认)；audio 布尔(默认 true；关掉也不打折)。
// 图生 image_urls 1–10 张关键帧（顺序有首 / 尾 / 关键帧语义）。
// 不声明：draft / draft_from_task_id（草稿转正片是两步操作，要原任务）、video_url(s)（续拍要源视频）、mode、safety_tolerance。
const FLUX_DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 5, max: 20, defaultValue: 5 };
const FLUX_RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["hd", "fhd"]), defaultValue: "hd" };
const FLUX_ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"]), defaultValue: "auto" };
const FLUX_AUDIO: ModelParameterControl = { key: "audio", label: "生成声音", type: "boolean", options: [], defaultValue: true };

export const FLUX_3_VIDEO_ARCHETYPE: ModelArchetype = {
  id: "flux-3-video",
  family: "flux",
  label: "FLUX 3 Video",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["flux-3-video"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/flux-3-video/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `flux-3-video`；duration 5–20 整数(默认 5，不支持 auto)；resolution hd(默认)|fhd；" +
      "aspect_ratio 21:9|2:1|16:9|4:3|1:1|3:4|9:16|auto(默认)；audio 布尔(默认 true)；image_urls 1–10 张关键帧；" +
      "不声明 draft / draft_from_task_id / video_url(s) / mode / safety_tolerance。",
  }],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成 5–20 秒视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: [FLUX_ASPECT, FLUX_RESOLUTION, FLUX_DURATION, FLUX_AUDIO] },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "1–10 张关键帧图，按顺序", promptRequired: true, transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "关键帧", min: 1, max: 10, inputKey: "image_urls" }],
      params: [FLUX_ASPECT, FLUX_RESOLUTION, FLUX_DURATION, FLUX_AUDIO],
    },
  ],
};
