import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";
import { runwayImageParams } from "../../../electron/shared/imageCapabilities/runwayImageWireFacts";

// Nano Banana（Google/Gemini 影像）图像档案（2026-06）。kie 文档：docs.kie.ai/market/google/nano-banana(-edit)。
// 两模式：文生图（google/nano-banana）/ 改图（google/nano-banana-edit，输入图数组 ≤10）。两模式参数相同
// （aspect_ratio + output_format），仅改图多输入图槽。输入图槽 inputKey=image_urls（同 Seedream 改图键名）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const NB_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "auto"]), defaultValue: "1:1" },
  { key: "output_format", label: "格式", type: "select", options: opt(["png", "jpeg"]), defaultValue: "png" },
];

// apimart 专属 params（B 分层）：apimart Gemini 2.5 Flash 用扁平 size（resolution 固定 1K 不暴露，无 output_format）。
const APIMART_PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]), defaultValue: "1:1" },
];

// Runway 专属 params（B 分层，第三家）：Runway 把这个产品叫 `gemini_2.5_flash`，其 union 变体收
// **像素串** ratio（1344:768 / 1024:1024 / 1536:672… 共 10 值），朝向式 `1:1`/`16:9` 一个都不合法；
// 且该变体**没有** outputCount 字段（故不出「张数」控件）也没有 output_format。取值由官方 OpenAPI 逐字表 derive。
const RUNWAY_PARAMS: ModelParameterControl[] = runwayImageParams("gemini_2.5_flash");

export const NANO_BANANA_ARCHETYPE: ModelArchetype = {
  id: "nano-banana",
  family: "nano-banana",
  label: "Nano Banana",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // `gemini_2.5_flash` 是 Runway 侧对同一产品（Gemini 2.5 Flash Image）的判别串
  // （P4：档案 = 模型身份，供应商无关）。
  identifierPatterns: ["nano-banana", "google/nano-banana", "google/nano-banana-edit", "nano-banana-pro", "gemini-2.5-flash-image-preview", "gemini_2.5_flash"],
  // Runway 的这一行原挂平台档案 runway-image（已删）；存量节点靠 legacyIds + 模型身份匹配迁到这里。
  legacyIds: ["runway-image"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像",
      promptRequired: true,
      modelEnum: "google/nano-banana",
      transportTaskKind: "text_to_image",
      slots: [],
      params: NB_PARAMS,
      vendorParams: { apimart: APIMART_PARAMS, runway: RUNWAY_PARAMS },
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图",
      promptRequired: true,
      modelEnum: "google/nano-banana-edit",
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "image_urls" }],
      params: NB_PARAMS,
      vendorParams: { apimart: APIMART_PARAMS, runway: RUNWAY_PARAMS },
    },
  ],
};
