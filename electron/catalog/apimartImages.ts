// apimart 图片模型的 curated 传输配方（6 个高频图片模型，单源）。契约见
// docs/plan/2026-06-07-apimart-curated-onboarding.md 附录 A（R5 已抓，Seedream 已真图验证）。
//
// apimart 图片创建是**扁平 body**（不像 kie 嵌在 input 里）：
//   POST /v1/images/generations  { model, prompt, size?, resolution?, image_urls? }
//   → { code:200, data:[{ status:"submitted", task_id }] }
// task_id 在 data[0].task_id（数组下标）→ create op 同时声明 response_mapping + provider_meta_mapping
// 的 task_id="data.0.task_id"（前者填 result.id，后者填 providerMeta.task_id 供轮询 URL；runtime 零改动）。
// 轮询/状态归一共用 apimartVendor 的 APIMART_IMAGE_QUERY_OP + APIMART_STATUS_MAPPING。
//
// model enum 经 catalog 行的 modelKey（body 用 {{model.modelKey}}）。档案：共享模型复用 kie 已建档案
// （标 meta.archetypeId，apimart 专属 params 由档案 vendorParams 提供，见 B 分层）；独占模型新建档案。

import type { HttpOperation, ProfileKind } from "./types";
import { APIMART_CREATE_TASK_ID_PATH, APIMART_IMAGE_QUERY_OP, APIMART_STATUS_MAPPING } from "./apimartVendor";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

/** 扁平图片 create op 工厂：model+prompt 固定，bodyFields 补 size/resolution/image_urls 等（undefined 键模板引擎丢弃）。 */
function imageCreateOp(bodyFields: Record<string, unknown>): HttpOperation {
  return {
    method: "POST",
    path: "/v1/images/generations",
    headers: CREATE_HEADERS,
    body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", ...bodyFields },
    response_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
    provider_meta_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
  };
}

const SIZE = "{{request.params.size}}";
const RESOLUTION = "{{request.params.resolution}}";
const IMAGE_URLS = "{{request.params.image_urls}}"; // 改图模式的输入图数组（档案 slot inputKey=image_urls）

/** 一个 apimart 图片模型的 curated 定义：catalog 行（modelKey=apimart enum）+ 档案指针 + 1~2 条 mapping。 */
export type ApimartImageModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

/** t2i + edit 两条 mapping（共享同一 query/status）。modelKey 精确路由（同 vendor 同桶不撞）。 */
function imageModel(p: {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  t2iBody: Record<string, unknown>;
  editBody?: Record<string, unknown>; // 省略 = 该模型仅文生图（imagen / z-image）
}): ApimartImageModel {
  const mappings: ApimartImageModel["mappings"] = [
    {
      id: `seed-apimart-${p.archetypeId}-text_to_image`,
      taskKind: "text_to_image",
      name: `${p.labelZh} · 文生图`,
      create: imageCreateOp(p.t2iBody),
    },
  ];
  if (p.editBody) {
    mappings.push({
      id: `seed-apimart-${p.archetypeId}-image_edit`,
      taskKind: "image_edit",
      name: `${p.labelZh} · 改图`,
      create: imageCreateOp(p.editBody),
    });
  }
  return { modelKey: p.modelKey, labelZh: p.labelZh, archetypeId: p.archetypeId, mappings };
}

/** 6 个 apimart 图片模型（单源；seedBuiltins 据此注册 catalog 行 + mapping）。 */
export const APIMART_IMAGE_MODELS: ApimartImageModel[] = [
  // 共享档案（kie 已建）：Seedream / Nano Banana(Gemini) / GPT-Image-2 —— apimart 专属 params 由档案 vendorParams 提供。
  imageModel({
    modelKey: "doubao-seedream-4.5", labelZh: "Seedream 4.5", archetypeId: "seedream",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS },
  }),
  imageModel({
    modelKey: "gemini-2.5-flash-image-preview", labelZh: "Nano Banana（Gemini 2.5 Flash）", archetypeId: "nano-banana",
    t2iBody: { size: SIZE }, // resolution 固定 1K → 省略走默认
    editBody: { size: SIZE, image_urls: IMAGE_URLS },
  }),
  imageModel({
    modelKey: "gpt-image-2", labelZh: "GPT Image 2", archetypeId: "gpt-image-2",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    // GPT 档案改图槽 inputKey=input_urls（kie 契约），apimart 字段名是 image_urls → 值读 input_urls。
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: "{{request.params.input_urls}}" },
  }),
  // 独占档案（apimart 专属，新建）：Qwen-Image / Imagen 4 / Z-Image-Turbo。
  imageModel({
    modelKey: "qwen-image-2.0", labelZh: "Qwen-Image 2.0", archetypeId: "qwen-image",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS },
  }),
  imageModel({
    modelKey: "imagen-4.0-apimart", labelZh: "Imagen 4", archetypeId: "imagen-4",
    t2iBody: { size: SIZE }, // imagen 仅 t2i，无 resolution
  }),
  imageModel({
    modelKey: "z-image-turbo", labelZh: "Z-Image Turbo", archetypeId: "z-image-turbo",
    t2iBody: { size: SIZE, resolution: RESOLUTION }, // 仅 t2i
  }),
];

/** 所有 apimart 图片 mapping 共用的轮询 + 状态归一（seedBuiltins 注册时套上）。 */
export const APIMART_IMAGE_QUERY = APIMART_IMAGE_QUERY_OP;
export const APIMART_IMAGE_STATUS = APIMART_STATUS_MAPPING;
