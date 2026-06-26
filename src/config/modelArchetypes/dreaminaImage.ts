// 即梦官方 dreamina CLI 的图片档案（文生图 + 改图）。模型/参数 enum 以官方 `-h` 为准（2026-06-24 实测）：
//   text2image：model 3.0/3.1/4.0/4.1/4.5/4.6/4.7/5.0；ratio 8 种；resolution_type 3.0/3.1→1k/2k，4.x/5.0→2k/4k
//   image2image：1-10 张本地图输入；model 4.0/4.1/4.5/4.6/4.7/5.0；resolution_type 2k/4k（无 1k）
// 图超清(upscale)无 model，单列在 dreaminaUpscale.ts。
// v1 取舍：resolution_type 按模式粗粒度给（t2i 全集 / i2i 2k4k），非法 model+清晰度组合由 dreamina 后端清晰报错兜底
// （effect-first 的精细 per-variant 收窄留后；先把 8 个模型全接上）。
import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RATIO: ModelParameterControl = {
  key: "ratio", label: "比例", type: "select",
  options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"]), defaultValue: "1:1",
};

const T2I_PARAMS: ModelParameterControl[] = [
  RATIO,
  { key: "resolution_type", label: "清晰度", type: "select", options: opt(["1k", "2k", "4k"]), defaultValue: "2k" },
];
const I2I_PARAMS: ModelParameterControl[] = [
  RATIO,
  { key: "resolution_type", label: "清晰度", type: "select", options: opt(["2k", "4k"]), defaultValue: "2k" },
];

export const DREAMINA_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "dreamina-image",
  family: "dreamina-image",
  label: "即梦图片",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["dreamina-image"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "用即梦会员积分，纯文字生成图像",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: T2I_PARAMS,
    },
    {
      id: "i2i",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图（需模型 4.0+）",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "input_images" }],
      params: I2I_PARAMS,
    },
  ],
  // 8 个图片模型版本（变体）。默认 5.0（最新）。args 的 --model_version 取 {{request.params.model}}。
  variants: [
    { id: "v5_0", label: "5.0", modelKey: "5.0" },
    { id: "v4_7", label: "4.7", modelKey: "4.7" },
    { id: "v4_6", label: "4.6", modelKey: "4.6" },
    { id: "v4_5", label: "4.5", modelKey: "4.5" },
    { id: "v4_1", label: "4.1", modelKey: "4.1" },
    { id: "v4_0", label: "4.0", modelKey: "4.0" },
    { id: "v3_1", label: "3.1", modelKey: "3.1" },
    { id: "v3_0", label: "3.0", modelKey: "3.0" },
  ],
  defaultVariantId: "v5_0",
};
