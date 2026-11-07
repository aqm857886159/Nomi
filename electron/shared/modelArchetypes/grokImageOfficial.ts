import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// Grok Imagine Image 2.0 官方通道（APIMart 官方页 docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/official.md，
// 2026-11-07 核）。model `grok-imagine-image-2.0`，与 `grok-imagine-2.0-ext`（grok-imagine-image-2 档案，只有文生图）是两个不同的
// model id：官方通道文生图与改图都收，参考图 1–3 张，分辨率 1k / 2k。
// quality（low|medium，默认 medium）只在文生图里有效；官方写明带 image_urls 时不能发这个字段，所以只放进文生图模式的参数。
// 不声明：n（节点一次一张）/ nsfw_check（额外审核，默认关即可）。
// 提交不带 X-APIMart-Response-Version 头，走默认响应形状 data[0].task_id（与目录里其它图片模型同一条轮询路）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RATIOS = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1"];

const SHARED: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(RATIOS), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1k", "2k"]), defaultValue: "1k" },
];

const T2I_PARAMS: ModelParameterControl[] = [
  ...SHARED,
  { key: "quality", label: "质量", type: "select", options: opt(["low", "medium"]), defaultValue: "medium" },
];

export const GROK_IMAGINE_IMAGE_20_OFFICIAL_ARCHETYPE: ModelArchetype = {
  id: "grok-imagine-image-2.0-official", family: "grok-imagine", label: "Grok Imagine Image 2.0 官方", kind: "image",
  defaultModeId: "t2i", transportTaskKind: "text_to_image",
  identifierPatterns: ["grok-imagine-image-2.0"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/official.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/images/generations，model 固定 `grok-imagine-image-2.0`；文生图与改图同一个 model id，给 image_urls（1–3 张公网 URL）即改图；" +
      "aspect_ratio 14 档含 auto(默认)，含 9:19.5|19.5:9|9:20|20:9；resolution 1k(默认)|2k；" +
      "quality low|medium(默认 medium)，仅文生图，带 image_urls 时不能发；n 1–10 与 nsfw_check 不声明；" +
      "提交默认 data[0].task_id，带 X-APIMart-Response-Version 头才换成 data.id（本档案不带头）。",
  }],
  modes: [
    { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: T2I_PARAMS },
    {
      id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 3 张）+ 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 3, inputKey: "image_urls" }],
      params: SHARED,
    },
  ],
};
