import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Qwen-Image 2.0（apimart 独占）图像档案。契约见 docs/plan/2026-06-07-apimart-curated-onboarding.md 附录 A。
// 两模式：文生图 / 改图（image_urls）。params 键 = apimart 字段名（size/resolution）→ mapping body 直通。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]), defaultValue: "1:1" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K"]), defaultValue: "1K" },
];

export const QWEN_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "qwen-image",
  family: "qwen-image",
  label: "Qwen-Image 2.0",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["qwen-image", "qwen-image-2.0", "qwen-image-2-0"],
  modes: [
    { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: PARAMS },
    {
      id: "edit", intent: "edit", vendorTerm: "改图", hint: "给图 + 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 4, inputKey: "image_urls" }],
      params: PARAMS,
    },
  ],
};
