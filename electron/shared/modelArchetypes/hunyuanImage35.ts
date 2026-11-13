import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// 混元图像 3.5 预览版（APIMart 官方页 docs.apimart.ai/en/api-reference/images/hy-image-v3.5-preview/generation.md，2026-11-07 核）。
// 文生图与改图同一个 model id，给 image_urls（最多 5 张）即改图。
// 不声明：width / height / 精确像素 size（三者互相覆盖，档案只暴露比例 + 清晰度档，避免两套尺寸同时生效）；
// n 只能 1；negative_prompt、seed 官方有但这里不暴露（创作者不摸；需要时由 Agent 描述里写）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const SIZES = ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(SIZES), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K", "4K"]), defaultValue: "1K" },
];

export const HY_IMAGE_V35_ARCHETYPE: ModelArchetype = {
  id: "hy-image-v3.5-preview", family: "hunyuan-image", label: "混元图像 3.5", kind: "image",
  defaultModeId: "t2i", transportTaskKind: "text_to_image",
  identifierPatterns: ["hy-image-v3.5-preview"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/images/hy-image-v3.5-preview/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/images/generations，model `hy-image-v3.5-preview`；size 比例 1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9 或 auto(默认)，也收精确像素；" +
      "resolution 1K(默认)|2K|4K；image_urls 最多 5 张（JPEG/PNG/WEBP，单张建议 <7MB）；n 只能 1。" +
      "不声明：width/height/精确像素（优先级高于比例 + 清晰度，会盖掉用户选的档）/ negative_prompt / seed / n。",
  }],
  modes: [
    { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: PARAMS },
    {
      id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 5 张）+ 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 5, inputKey: "image_urls" }],
      params: PARAMS,
    },
  ],
};
