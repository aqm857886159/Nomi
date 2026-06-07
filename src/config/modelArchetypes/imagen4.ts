import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Imagen 4（apimart 独占）图像档案。仅文生图（apimart 文档：传 image/image_urls 会报错）。
// 无 resolution 参数；非法比例 apimart 侧静默回退 16:9。params 键 = apimart 字段名（size）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

export const IMAGEN_4_ARCHETYPE: ModelArchetype = {
  id: "imagen-4",
  family: "imagen",
  label: "Imagen 4",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["imagen-4", "imagen-4.0-apimart", "imagen-4-0-apimart"],
  modes: [
    {
      id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像（仅支持文生图）", promptRequired: true,
      transportTaskKind: "text_to_image", slots: [],
      params: [{ key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16"]), defaultValue: "16:9" }],
    },
  ],
};
