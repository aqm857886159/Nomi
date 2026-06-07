import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Z-Image Turbo（apimart 独占）图像档案。仅文生图（无 image_urls / 无 n）。
// params 键 = apimart 字段名（size/resolution）。prompt_extend 暂不暴露（默认 false，避免额外计费）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

export const Z_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "z-image-turbo",
  family: "z-image",
  label: "Z-Image Turbo",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["z-image-turbo", "z-image"],
  modes: [
    {
      id: "t2i", intent: "text", vendorTerm: "文生图", hint: "极速文生图", promptRequired: true,
      transportTaskKind: "text_to_image", slots: [],
      params: [
        { key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]), defaultValue: "1:1" },
        { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K"]), defaultValue: "1K" },
      ],
    },
  ],
};
