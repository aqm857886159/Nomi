import type { ModelArchetype } from "./types";

export const CODEX_IMAGEGEN_ARCHETYPE: ModelArchetype = {
  id: "codex-imagegen",
  family: "codex-imagegen",
  label: "Codex 生图",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["codex-imagegen"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "使用当前 Codex 登录额度，纯文字生成图片",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: [],
    },
    {
      id: "i2i",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（可多张）+ 提示词生成或编辑图片",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "reference_images" }],
      params: [],
    },
  ],
};
