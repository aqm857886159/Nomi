import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Agnes AI 图片档案（agnes-image-2.0/2.1-flash，同形状共用）。文档：wiki.agnes-ai.com/en/docs/agnes-image-21-flash.md。
// 两模式：文生图（无参考槽）/ 改图（输入图数组，进 extra_body.image）。
// AGNES size 是**像素串**（"1024x768"）——canonical=wire 直透（无 paramMap），故档案 key 即 AGNES 字段名。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  {
    key: "size", label: "尺寸", type: "select",
    options: opt(["1024x1024", "1024x768", "768x1024", "1280x720", "720x1280", "1536x1024", "1024x1536"]),
    defaultValue: "1024x1024",
  },
];

export const AGNES_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "agnes-image",
  family: "agnes-image",
  label: "Agnes Image",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["agnes-image", "agnes-image-2.0-flash", "agnes-image-2.1-flash"],
  modes: [
    {
      id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true,
      transportTaskKind: "text_to_image", slots: [], params: PARAMS,
    },
    {
      id: "edit", intent: "edit", vendorTerm: "改图", hint: "给图（可多张）+ 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 6, inputKey: "image" }],
      params: PARAMS,
    },
  ],
};
