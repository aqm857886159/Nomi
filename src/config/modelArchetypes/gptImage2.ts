import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// GPT Image 2 档案（图像，2026-06）。kie.ai 文档：docs.kie.ai/market/gpt/gpt-image-2-{text,image}-to-image。
// 两模式：文生图（无参考槽）/ 图生图（输入图数组 → input_urls）。两模式 model enum + taskKind 不同，
// 靠 per-mode modelEnum + transportTaskKind 区分（档案体系图像支持，见 types）。标量参数复用 ModelParameterControl（规则 1）。
// 注：图生图的输入图槽用 image_ref（数组），inputKey 覆盖成模型契约名 `input_urls`（非 Seedance 的 reference_image_urls）；
// 不 characterIndexed（不是 character1..N 角色图，不标 ①②③）。这样它直接吃到通用的参考槽 + 拖入/连线。

const ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"];
const ASPECT_PARAM: ModelParameterControl = {
  key: "aspect_ratio",
  label: "比例",
  type: "select",
  options: ASPECT_RATIOS.map((value) => ({ value, label: value })),
  defaultValue: "auto",
};

// apimart 专属 params（B 分层）：apimart GPT-Image-2 用扁平 size（同比例集）+ resolution(1k/2k/4k)。
const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const APIMART_PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: ASPECT_RATIOS.map((value) => ({ value, label: value })), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1k", "2k", "4k"]), defaultValue: "1k" },
];

export const GPT_IMAGE_2_ARCHETYPE: ModelArchetype = {
  id: "gpt-image-2",
  family: "gpt-image",
  label: "GPT Image 2",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // 含旧的两个独立 model key → 老节点按身份自动套上档案（无需数据迁移）。
  identifierPatterns: ["gpt-image-2", "gpt-image-2-text-to-image", "gpt-image-2-image-to-image", "gpt-4o-image"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像",
      promptRequired: true,
      modelEnum: "gpt-image-2-text-to-image",
      transportTaskKind: "text_to_image",
      slots: [],
      params: [ASPECT_PARAM],
      vendorParams: { apimart: APIMART_PARAMS },
    },
    {
      id: "i2i",
      intent: "edit",
      vendorTerm: "图生图",
      hint: "给图 + 提示词改图",
      promptRequired: true,
      modelEnum: "gpt-image-2-image-to-image",
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 4, inputKey: "input_urls" }],
      params: [ASPECT_PARAM],
      vendorParams: { apimart: APIMART_PARAMS },
    },
  ],
};
