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
import type { ParamMap } from "./paramTranslate";
import { APIMART_CREATE_TASK_ID_PATH, APIMART_IMAGE_QUERY_OP, APIMART_STATUS_MAPPING } from "./apimartVendor";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

/** 扁平图片 create op 工厂：model+prompt 固定，bodyFields 补 size/resolution/image_urls 等（undefined 键模板引擎丢弃）。
 *  model 缺省取 catalog 行 modelKey；变体合并模型（Qwen：标准/Pro）传 VARIANT_MODEL_REF（取档案当前变体的 modelKey）。
 *  paramMap：把档案的中性 canonical 参数翻译成 apimart 字段（如 gpt-image-2 的 比例→size、清晰度档位小写）。 */
function imageCreateOp(bodyFields: Record<string, unknown>, modelRef = "{{model.modelKey}}", paramMap?: ParamMap): HttpOperation {
  return {
    method: "POST",
    path: "/v1/images/generations",
    headers: CREATE_HEADERS,
    body: { model: modelRef, prompt: "{{request.prompt}}", ...bodyFields },
    response_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
    provider_meta_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
    ...(paramMap ? { paramMap } : {}),
  };
}

// GPT Image 2 的 apimart 翻译（铁律）：中性 比例(aspect_ratio) → apimart 的 size 字段；
// 清晰度档位小写（apimart 历史用 1k/2k/4k，中性 canonical 用 1K/2K/4K）。线缆输出与迁移前完全一致。
const GPT_IMAGE_2_APIMART_PARAM_MAP: ParamMap = {
  rules: [
    { wire: "size", from: "aspect_ratio" },
    { wire: "resolution", fromMany: ["resolution"], transform: "toLowerCase" },
  ],
};

// 变体合并模型用：body model = 档案当前变体的 modelKey（{{request.params.model}}，同视频侧）。
const VARIANT_MODEL_REF = "{{request.params.model}}";

const SIZE = "{{request.params.size}}";
const RESOLUTION = "{{request.params.resolution}}";
const NEGATIVE_PROMPT = "{{request.params.negative_prompt}}"; // 负向提示词（可选，未填则丢弃）
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
  /** body 的 model 字段引用。缺省 {{model.modelKey}}；变体合并模型传 VARIANT_MODEL_REF。 */
  modelRef?: string;
  t2iBody: Record<string, unknown>;
  editBody?: Record<string, unknown>; // 省略 = 该模型仅文生图（imagen / z-image）
  /** 中性 canonical → apimart 字段的翻译（如 gpt-image-2）。缺省 = 档案 params 键即 apimart 字段名（透传）。 */
  paramMap?: ParamMap;
}): ApimartImageModel {
  const mappings: ApimartImageModel["mappings"] = [
    {
      id: `seed-apimart-${p.archetypeId}-text_to_image`,
      taskKind: "text_to_image",
      name: `${p.labelZh} · 文生图`,
      create: imageCreateOp(p.t2iBody, p.modelRef, p.paramMap),
    },
  ];
  if (p.editBody) {
    mappings.push({
      id: `seed-apimart-${p.archetypeId}-image_edit`,
      taskKind: "image_edit",
      name: `${p.labelZh} · 改图`,
      create: imageCreateOp(p.editBody, p.modelRef, p.paramMap),
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
    modelKey: "gemini-2.5-flash-image-preview", labelZh: "Nano Banana", archetypeId: "nano-banana",
    t2iBody: { size: SIZE }, // resolution 固定 1K → 省略走默认
    editBody: { size: SIZE, image_urls: IMAGE_URLS },
  }),
  imageModel({
    modelKey: "gpt-image-2", labelZh: "GPT Image 2", archetypeId: "gpt-image-2",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    // GPT 档案改图槽 inputKey=input_urls（kie 契约），apimart 字段名是 image_urls → 值读 input_urls。
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: "{{request.params.input_urls}}" },
    // 铁律迁移：gpt-image-2 已中性化（档案 params=比例+清晰度），apimart 字段是 size/resolution → 翻译。
    paramMap: GPT_IMAGE_2_APIMART_PARAM_MAP,
  }),
  // 独占档案（apimart 专属，新建）：Qwen-Image / Imagen 4 / Z-Image-Turbo。
  // Qwen-Image：变体（标准 qwen-image-2.0 / Pro qwen-image-2.0-pro）→ body model 取 {{request.params.model}}。
  imageModel({
    modelKey: "qwen-image-2.0", labelZh: "Qwen-Image 2.0", archetypeId: "qwen-image", modelRef: VARIANT_MODEL_REF,
    t2iBody: { size: SIZE, resolution: RESOLUTION, negative_prompt: NEGATIVE_PROMPT },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS, negative_prompt: NEGATIVE_PROMPT },
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
