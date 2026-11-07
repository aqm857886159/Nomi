import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// Muse Image Ext（APIMart 官方页 docs.apimart.ai/en/api-reference/images/muse-image-ext/generation.md，2026-11-07 核）。
// 单张 WebP，尺寸由模型定，清晰度档不可选（官方：不要发非空 resolution）；参考图最多 9 张，合计原始大小 ≤11 MiB。
// 比例官方 7 档；**不选就不发**：文生图默认 1:1，带参考图时跟随参考图构图；官方明写不要发 "auto"。
// 所以比例控件没有 auto 项也没有默认值，没选 = 请求里没有这个字段。
// 不声明：size（兼容别名）/ n（只能 1）/ language / webhook。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]) },
];

export const MUSE_IMAGE_EXT_ARCHETYPE: ModelArchetype = {
  id: "muse-image-ext", family: "runway-muse", label: "Muse Image", kind: "image",
  defaultModeId: "t2i", transportTaskKind: "text_to_image",
  identifierPatterns: ["muse-image-ext"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/images/muse-image-ext/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers:
      "POST /v1/images/generations，model `muse-image-ext`；aspect_ratio 7 档 1:1|16:9|9:16|4:3|3:4|3:2|2:3，不发则文生图 1:1、带参考图跟随参考图，不要发 auto；" +
      "image_urls 最多 9 张（合计原始大小 ≤11 MiB）；n 只能 1；返回 WebP，尺寸模型定，不要发 resolution；提交 data[0].task_id。",
  }],
  modes: [
    { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: PARAMS },
    {
      id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 9 张）+ 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 9, inputKey: "image_urls" }],
      params: PARAMS,
    },
  ],
};
