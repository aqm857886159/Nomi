import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: options(["1024:1024", "1280:720", "720:1280", "1360:768", "768:1360", "auto_1k", "auto_2k"]), defaultValue: "1024:1024" },
  { key: "output_count", label: "张数", type: "number", options: [], min: 1, max: 10, defaultValue: 1 },
];

export const RUNWAY_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "runway-image",
  family: "runway",
  label: "Runway 图像模型",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["muse_image", "grok_imagine_image_2", "seedream5_pro", "seedream5_lite", "gen4_image", "gen4_image_turbo", "gemini_image3_pro", "gemini_image3.1_flash", "gpt_image_2", "gemini_2.5_flash"],
  sources: [
    {
      url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
      checkedAt: "2026-08-30",
      vendorKey: "runway",
      covers: "Runway OpenAPI /v1/text_to_image current image model discriminators; promptText, ratio, referenceImages/outputCount where published",
    },
    {
      url: "https://docs.dev.runwayml.com/guides/models/",
      checkedAt: "2026-08-30",
      vendorKey: "runway",
      covers: "官方模型目录中的图像生成模型族",
    },
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "用文字生成图片",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: PARAMS,
    },
    {
      id: "i2i",
      intent: "single",
      vendorTerm: "参考图/改图",
      hint: "用参考图指导或编辑图片",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 3, inputKey: "reference_image_urls" }],
      params: PARAMS,
    },
  ],
};

/** Gen-4 Image Turbo is reference-required in Runway's current discriminator. */
export const RUNWAY_IMAGE_REFERENCE_ARCHETYPE: ModelArchetype = {
  ...RUNWAY_IMAGE_ARCHETYPE,
  id: "runway-image-reference",
  label: "Runway 参考图模型",
  defaultModeId: "i2i",
  identifierPatterns: ["gen4_image_turbo"],
  sources: [
    {
      url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
      checkedAt: "2026-08-31",
      vendorKey: "runway",
      covers: "gen4_image_turbo discriminator requires referenceImages on /v1/text_to_image",
    },
  ],
  modes: [RUNWAY_IMAGE_ARCHETYPE.modes[1]],
};
