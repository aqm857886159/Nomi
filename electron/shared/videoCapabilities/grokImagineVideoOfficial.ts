import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// Grok Imagine Video 1.5 官方通道（APIMart 官方页 docs.apimart.ai/en/api-reference/videos/grok-imagine/official.md，2026-11-07 核）。
// model `grok-imagine-video-1.5`，与 `grok-imagine-1.5-video-ext`（grok-imagine-1.5-video 档案）是不同的 model id，两者都可选。
// 官方通道：duration 1–15 整数(默认 8)，resolution 480p(默认)|720p|1080p，比例 7 档；image_urls 全部必须是公网 HTTPS URL。
// 官方参考图张数没给上限，按普查记录的「单图」声明；图生模式不发比例（官方只说比例是「generation 字段」，没说跟随图片，保守不发）。
// 不声明：video（视频编辑，官方只支持基础款 grok-imagine-video，不支持 1.5）/ nsfw_check。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p"]), defaultValue: "480p" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 15, defaultValue: 8 };
const ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: [{ value: "auto", label: "自动" }, ...opt(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"])], defaultValue: "auto" };

export const GROK_IMAGINE_VIDEO_15_OFFICIAL_ARCHETYPE: ModelArchetype = {
  id: "grok-imagine-video-1.5-official",
  family: "grok-imagine",
  label: "Grok Imagine Video 1.5 官方",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["grok-imagine-video-1.5"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/videos/grok-imagine/official.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/videos/generations，model `grok-imagine-video-1.5`；duration 1–15 整数(默认 8)；resolution 480p(默认)|720p|1080p；" +
      "aspect_ratio 1:1|16:9|9:16|4:3|3:4|3:2|2:3（不发则由模型定）；image_urls 公网 HTTPS URL 数组（空数组不发）；" +
      "视频编辑只支持基础款 grok-imagine-video，不在本档案。",
  }],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成 1–15 秒视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: [ASPECT, RESOLUTION, DURATION] },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "单张公网参考图", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 1, inputKey: "image_urls" }],
      params: [RESOLUTION, DURATION],
    },
  ],
};
