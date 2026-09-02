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
import "./apimartModelIds";

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
  requestTransform?: string;
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
  for (const mapping of mappings) {
    if (p.requestTransform) mapping.create.request_transform = p.requestTransform;
  }
  return { modelKey: p.modelKey, labelZh: p.labelZh, archetypeId: p.archetypeId, mappings };
}

/** apimart 图片模型（单源；seedBuiltins 据此注册 catalog 行 + mapping）。 */
export const APIMART_IMAGE_MODELS: ApimartImageModel[] = [
  // Seedream 5.0 Pro（2026-07-29 照 docs.apimart.ai seedream-5-0-pro/generation.md 对账）：
  // ≤10 张参考图多参一图（首张免费）；resolution 仅 1K/2K（3K/4K 会 400）→ 独立档案不与 4.5 共享。
  imageModel({
    modelKey: "doubao-seedream-5-0-pro", labelZh: "Seedream 5.0 Pro", archetypeId: "seedream-5-pro",
    requestTransform: "apimart-canonical-model-id",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS },
  }),
  // 共享档案（kie 已建）：Seedream / Nano Banana(Gemini) / GPT-Image-2 —— apimart 专属 params 由档案 vendorParams 提供。
  imageModel({
    modelKey: "doubao-seedream-4.5", labelZh: "Seedream 4.5", archetypeId: "seedream",
    requestTransform: "apimart-canonical-model-id",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS },
  }),
  imageModel({
    modelKey: "gemini-2.5-flash-image-preview", labelZh: "Nano Banana", archetypeId: "nano-banana",
    t2iBody: { size: SIZE }, // resolution 固定 1K → 省略走默认
    editBody: { size: SIZE, image_urls: IMAGE_URLS },
  }),
  // Nano Banana 2（2026-08-26 照 docs.apimart.ai gemini-3.1-flash/generation.md 对账）：
  // **≤14 张参考图**（全市场最多，直接服务跨镜身份一致性）；resolution 0.5K/1K/2K/4K，档案只暴露 1K/2K/4K
  // （取与 kie 的交集，见 nanoBanana2.ts）。这里选 `gemini-3.1-flash-image-preview`（别名 nano-banana-2-ext）
  // 而非 `-official`：文档同页两条同契约，ext 是常规通道；official 走官方直连、贵且限流严，
  // 需要时用户可自建自定义模型指过去，不占 curated 名额（D4 极简）。
  imageModel({
    modelKey: "gemini-3.1-flash-image-preview", labelZh: "Nano Banana 2", archetypeId: "nano-banana-2",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS },
  }),
  imageModel({
    modelKey: "gpt-image-2", labelZh: "GPT Image 2", archetypeId: "gpt-image-2",
    t2iBody: { size: SIZE, resolution: RESOLUTION },
    // GPT 档案改图槽 inputKey=input_urls（kie 契约），apimart 字段名是 image_urls → 值读 input_urls。
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: "{{request.params.input_urls}}" },
    // 铁律迁移：gpt-image-2 已中性化（档案 params=比例+清晰度），apimart 字段是 size/resolution → 翻译。
    paramMap: GPT_IMAGE_2_APIMART_PARAM_MAP,
  }),
  // 独占档案（apimart 专属，新建）：Qwen-Image / Z-Image-Turbo。
  // Imagen 4 已退役（2026-07-30：上游 Google 确定性 404，见 seedBuiltins 的 RETIRED_APIMART_IMAGE_*）
  // —— curated 与退役清单**互斥**，别在这儿加回来，否则每次启动 reconcileModels 插回、prune 再删，
  // 来回抖。上游修好要恢复：这里加回 + 那边两条删掉，一次 commit。
  // Qwen-Image：变体（标准 qwen-image-2.0 / Pro qwen-image-2.0-pro）→ body model 取 {{request.params.model}}。
  imageModel({
    modelKey: "qwen-image-2.0", labelZh: "Qwen-Image 2.0", archetypeId: "qwen-image", modelRef: VARIANT_MODEL_REF,
    t2iBody: { size: SIZE, resolution: RESOLUTION, negative_prompt: NEGATIVE_PROMPT },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS, negative_prompt: NEGATIVE_PROMPT },
  }),
  // Qwen-Image 3.0（2026-08-26 照 docs.apimart.ai qwen-image-3.0/generation.md 对账）：
  // 变体标准/Pro（Pro 强于密集排版与文字渲染）→ body model 取 {{request.params.model}}。
  // ⚠️ 改图参考图**只收 1–3 张**（2.0 是 4 张，别照抄）——档案槽已按 3 收口。
  imageModel({
    modelKey: "qwen-image-3.0", labelZh: "Qwen-Image 3.0", archetypeId: "qwen-image-3", modelRef: VARIANT_MODEL_REF,
    t2iBody: { size: SIZE, resolution: RESOLUTION, negative_prompt: NEGATIVE_PROMPT },
    editBody: { size: SIZE, resolution: RESOLUTION, image_urls: IMAGE_URLS, negative_prompt: NEGATIVE_PROMPT },
  }),
  imageModel({
    modelKey: "z-image-turbo", labelZh: "Z-Image Turbo", archetypeId: "z-image-turbo",
    t2iBody: { size: SIZE, resolution: RESOLUTION }, // 仅 t2i
  }),
];

/** 所有 apimart 图片 mapping 共用的轮询 + 状态归一（seedBuiltins 注册时套上）。 */
export const APIMART_IMAGE_QUERY = APIMART_IMAGE_QUERY_OP;
export const APIMART_IMAGE_STATUS = APIMART_STATUS_MAPPING;
