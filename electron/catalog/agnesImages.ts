// Agnes AI 图片模型的 curated 传输配方（agnes-image-2.0/2.1-flash）。契约见
// wiki.agnes-ai.com/en/docs/agnes-image-21-flash.md（R5 已抓）。
//
// AGNES 图片是**同步** create（无轮询）：
//   POST /v1/images/generations  { model, prompt, size, extra_body:{ image?, response_format } }
//   → { created, data:[{ url | b64_json }] }（取 data.0.url）
//
// 两个 AGNES quirk（文档明确，照搬 mapping）：
//   ① response_format 必须在 **extra_body 内**（顶层会被拒）。
//   ② 图生图参考图放 **extra_body.image**(数组，公网 URL / data:URI)，非顶层 image。
// 故 t2i/edit 的 body 都把这俩塞进 extra_body（模板引擎渲染嵌套对象，空键自动丢）。
//
// 档案：agnes-image（全新族，src/config/modelArchetypes/agnesImage.ts）。canonical 参数 size 直透（无翻译）。

import type { HttpOperation, ProfileKind } from "./types";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

const SIZE = "{{request.params.size}}";
const IMAGE = "{{request.params.image}}"; // edit 输入图数组（档案 slot inputKey=image）

/** 同步图片 create op 工厂。extra_body 收 response_format(强制 url) + 可选 image(改图)。 */
function imageCreateOp(extraImage: boolean): HttpOperation {
  return {
    method: "POST",
    path: "/v1/images/generations",
    headers: CREATE_HEADERS,
    body: {
      model: "{{model.modelKey}}",
      prompt: "{{request.prompt}}",
      size: SIZE,
      extra_body: {
        response_format: "url",
        ...(extraImage ? { image: IMAGE } : {}),
      },
    },
    response_mapping: { image_url: "data.0.url" },
    // headless/MCP 兜底：size 是 AGNES 必填（缺则 400）。UI 路已由档案默认填，此处仅救 nomi_generate。
    defaultParams: { size: "1024x1024" },
  };
}

export type AgnesImageModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

/** t2i + edit 两条 mapping（同步，无 query/statusMapping）。modelKey 精确路由。 */
function imageModel(modelKey: string, labelZh: string): AgnesImageModel {
  return {
    modelKey,
    labelZh,
    archetypeId: "agnes-image",
    mappings: [
      { id: `seed-agnes-${modelKey}-text_to_image`, taskKind: "text_to_image", name: `${labelZh} · 文生图`, create: imageCreateOp(false) },
      { id: `seed-agnes-${modelKey}-image_edit`, taskKind: "image_edit", name: `${labelZh} · 改图`, create: imageCreateOp(true) },
    ],
  };
}

/** AGNES 图片模型（2.0 + 2.1，同 API 形状共用 agnes-image 档案）。 */
export const AGNES_IMAGE_MODELS: AgnesImageModel[] = [
  imageModel("agnes-image-2.1-flash", "Agnes Image 2.1"),
  imageModel("agnes-image-2.0-flash", "Agnes Image 2.0"),
];
