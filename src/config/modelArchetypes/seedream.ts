import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Seedream（字节）图像档案（2026-06）。kie 文档：docs.kie.ai/market/seedream/*。
// 两模式：文生图（seedream/4.5-text-to-image，无参考槽）/ 改图（bytedance/seedream-v4-edit，输入图数组 ≤10）。
// 两模式标量参数不同（t2i: aspect_ratio+quality；edit: image_size+resolution+max_images），各自声明（档案支持 per-mode params）。
// 改图输入图槽 inputKey 覆盖成模型契约名 `image_urls`（非 GPT 的 input_urls / Seedance 的 reference_image_urls）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const T2I_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"]), defaultValue: "1:1" },
  { key: "quality", label: "质量", type: "select", options: opt(["basic", "high"]), defaultValue: "basic" },
];

const EDIT_PARAMS: ModelParameterControl[] = [
  {
    key: "image_size", label: "画幅", type: "select",
    options: opt(["square", "square_hd", "portrait_4_3", "portrait_3_2", "portrait_16_9", "landscape_4_3", "landscape_3_2", "landscape_16_9", "landscape_21_9"]),
    defaultValue: "square_hd",
  },
  { key: "image_resolution", label: "清晰度", type: "select", options: opt(["1K", "2K", "4K"]), defaultValue: "1K" },
  { key: "max_images", label: "出图数", type: "number", options: [], min: 1, max: 6, defaultValue: 1 },
];

// apimart 专属 params（B 档案分层）：apimart Seedream 用扁平 size/resolution（与 kie 的 aspect_ratio/quality、
// image_size/image_resolution 字段名+取值都不同）。文生图/改图同一组（apimart 改图只多 image_urls 槽，槽不变）。
const APIMART_PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "auto"]), defaultValue: "1:1" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["2K", "4K"]), defaultValue: "2K" },
];

export const SEEDREAM_ARCHETYPE: ModelArchetype = {
  id: "seedream",
  family: "seedream",
  label: "Seedream 4.5",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["seedream", "seedream/4.5-text-to-image", "seedream/5-lite-text-to-image", "bytedance/seedream-v4-edit", "bytedance/seedream-v4-text-to-image", "seedream-4-5", "seedream-v4"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像",
      promptRequired: true,
      modelEnum: "seedream/4.5-text-to-image",
      transportTaskKind: "text_to_image",
      slots: [],
      params: T2I_PARAMS,
      vendorParams: { apimart: APIMART_PARAMS },
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图，强身份一致性",
      promptRequired: true,
      modelEnum: "bytedance/seedream-v4-edit",
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "image_urls" }],
      params: EDIT_PARAMS,
      vendorParams: { apimart: APIMART_PARAMS },
    },
  ],
};
