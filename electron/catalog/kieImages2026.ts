// kie 2026-08 代图像模型的 curated 传输配方（Nano Banana 2 族 / Seedream 5.0 族 / FLUX.2 Pro）。
// 契约来自官方文档实查（2026-08-26），逐条出处记在对应档案的 `sources` 字段里（门岗 check:archetype-sources）：
//   src/config/modelArchetypes/nanoBanana2.ts · kieSeedream5.ts · flux2Pro.ts
//
// 为什么新开这个文件而不是往 kieNanoBanana.ts / kieSeedream.ts 里塞：那两份是「一个模型一份手写 op」的
// 老形状（各自重复 QUERY_OP + STATUS_MAPPING），本轮一次进 5 个模型 × 2 模式 = 10 条 mapping，
// 照抄老形状就是十段近乎相同的字面量。这里改成**表驱动**（同 apimartImages / volcengineImages 的成熟形状）：
// 一个模型一行，body 差异用字段声明。老两份保持不动（它们是 4.5 / 2.5 代，仍现役，P1 不适用）。
//
// **kie 的结构性特点（本文件的核心建模决定）**：
//   kie 把「文生图」和「改图」拆成**两个 model id**（seedream/5-pro-text-to-image vs -image-to-image，
//   flux-2/pro-text-to-image vs -image-to-image），而 apimart/火山是一个 id + 有没有 image_urls。
//   → 我们**按能力建模**：档案层永远是「一个模型两个 mode」，两个 kie id 由档案的 per-mode `modelEnum`
//     承担，body 里的 model 字段统一读 {{request.params.model}}（模板引擎会填当前 mode 的 modelEnum）。
//     上层（画布/编排/UI）看到的只有 mode，完全不知道 kie 拆了 id —— 无并行路径（P1/P4）。
//   例外：Nano Banana 2 **本来就是一个 id 双模式**（nano-banana-2 靠 image_input 有没有值切换），
//     它的档案不设 modelEnum → body 的 model 读 {{model.modelKey}}（catalog 行的 modelKey）。

import type { HttpOperation, ProfileKind } from "./types";

/** kie 全家桶统一的状态归一 + 轮询（与 kieSeedream / kieNanoBanana 完全一致的值）。 */
const KIE_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["waiting", "queuing", "queued", "pending"],
  running: ["generating", "processing", "running"],
  succeeded: ["success", "succeeded", "completed"],
  failed: ["fail", "failed", "error", "expired"],
};

const KIE_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v1/jobs/recordInfo",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  query: { taskId: "{{providerMeta.task_id}}" },
  response_mapping: {
    task_id: "data.taskId",
    status: "data.state",
    image_url: "data.resultJson.resultUrls.0",
    error_message: "data.failMsg",
  },
};

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

/** 档案 per-mode modelEnum（kie 把 t2i/edit 拆成两个 model id 的那些模型用这个）。 */
const MODE_MODEL_REF = "{{request.params.model}}";
/** catalog 行 modelKey（单 id 双模式的模型用这个，如 nano-banana-2）。 */
const ROW_MODEL_REF = "{{model.modelKey}}";

/** kie 图片 create op 工厂：model + input.prompt 固定，inputFields 补该模型自己的字段。
 *  模板引擎会丢弃取值为 undefined 的键，故未填的可选参数不会发出去。 */
function createOp(inputFields: Record<string, unknown>, modelRef: string): HttpOperation {
  return {
    method: "POST",
    path: "/api/v1/jobs/createTask",
    headers: CREATE_HEADERS,
    body: { model: modelRef, input: { prompt: "{{request.prompt}}", ...inputFields } },
  };
}

const ASPECT_RATIO = "{{request.params.aspect_ratio}}";
const RESOLUTION = "{{request.params.resolution}}";
const QUALITY = "{{request.params.quality}}";
const OUTPUT_FORMAT = "{{request.params.output_format}}";
/** 档案改图槽 inputKey=image_urls（seedream / nano-banana 一族）。 */
const IMAGE_URLS = "{{request.params.image_urls}}";
/** FLUX.2 档案改图槽 inputKey=input_urls（kie 在 flux2 上换了字段名）。 */
const INPUT_URLS = "{{request.params.input_urls}}";

/** 一个 kie 图片模型的 curated 定义：catalog 行 + 档案指针 + 1~2 条 mapping。 */
export type KieImageModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

function imageModel(p: {
  /** catalog 行的 modelKey。kie 拆 id 的模型取**文生图那个 id**做行标识（改图 id 由 mode modelEnum 发）。 */
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  /** 稳定 mapping id 的后缀（按 vendor+模型固定，便于幂等与排查）。 */
  seedKey: string;
  modelRef: string;
  t2iInput: Record<string, unknown>;
  editInput?: Record<string, unknown>; // 省略 = 仅文生图
}): KieImageModel {
  const mappings: KieImageModel["mappings"] = [
    {
      id: `seed-kie-${p.seedKey}-text_to_image`,
      taskKind: "text_to_image",
      name: `${p.labelZh} · 文生图`,
      create: createOp(p.t2iInput, p.modelRef),
    },
  ];
  if (p.editInput) {
    mappings.push({
      id: `seed-kie-${p.seedKey}-image_edit`,
      taskKind: "image_edit",
      name: `${p.labelZh} · 改图`,
      create: createOp(p.editInput, p.modelRef),
    });
  }
  return { modelKey: p.modelKey, labelZh: p.labelZh, archetypeId: p.archetypeId, mappings };
}

export const KIE_IMAGE_MODELS_2026: KieImageModel[] = [
  // ── Nano Banana 2（gemini-3.1-flash-image 代）─────────────────────────────
  // **单 model id 双模式**：改图不换 id，只多 image_input。故 modelRef 取行 modelKey。
  // ⚠️ 输入图字段名是 `image_input`（不是全家桶的 image_urls）——值仍从档案槽 image_urls 读，
  //    这里做键名转接。抄成 image_urls 会静默丢掉所有参考图（不报错，只是当纯文生图跑）。
  imageModel({
    modelKey: "nano-banana-2", labelZh: "Nano Banana 2", archetypeId: "nano-banana-2",
    seedKey: "nano-banana-2", modelRef: ROW_MODEL_REF,
    t2iInput: { aspect_ratio: ASPECT_RATIO, resolution: RESOLUTION, output_format: OUTPUT_FORMAT },
    editInput: { image_input: IMAGE_URLS, aspect_ratio: ASPECT_RATIO, resolution: RESOLUTION, output_format: OUTPUT_FORMAT },
  }),
  // Lite：同代快档，但**自己一个档案**（nano-banana-2-lite）——它无 resolution / output_format 字段，
  // 共用主款档案会让 UI 摆出按了没反应的控件（被 paramConsistency 不变量抓到过）。
  // **它的输入图字段反而叫 image_urls**（与主款的 image_input 不同名），槽上限 10 而非 14。
  imageModel({
    modelKey: "nano-banana-2-lite", labelZh: "Nano Banana 2 Lite", archetypeId: "nano-banana-2-lite",
    seedKey: "nano-banana-2-lite", modelRef: ROW_MODEL_REF,
    t2iInput: { aspect_ratio: ASPECT_RATIO },
    editInput: { image_urls: IMAGE_URLS, aspect_ratio: ASPECT_RATIO },
  }),

  // ── Seedream 5.0（kie 渠道）───────────────────────────────────────────────
  // 两 id 拆分 → modelRef 取档案 per-mode modelEnum。pro 与 lite 各自独立档案（quality 域与槽上限冲突）。
  imageModel({
    modelKey: "seedream/5-pro-text-to-image", labelZh: "Seedream 5.0 Pro", archetypeId: "kie-seedream-5-pro",
    seedKey: "seedream-5-pro", modelRef: MODE_MODEL_REF,
    t2iInput: { aspect_ratio: ASPECT_RATIO, quality: QUALITY, output_format: OUTPUT_FORMAT },
    editInput: { image_urls: IMAGE_URLS, aspect_ratio: ASPECT_RATIO, quality: QUALITY, output_format: OUTPUT_FORMAT },
  }),
  imageModel({
    modelKey: "seedream/5-lite-text-to-image", labelZh: "Seedream 5.0 Lite", archetypeId: "kie-seedream-5-lite",
    seedKey: "seedream-5-lite", modelRef: MODE_MODEL_REF,
    t2iInput: { aspect_ratio: ASPECT_RATIO, quality: QUALITY, output_format: OUTPUT_FORMAT },
    editInput: { image_urls: IMAGE_URLS, aspect_ratio: ASPECT_RATIO, quality: QUALITY, output_format: OUTPUT_FORMAT },
  }),

  // ── FLUX.2 Pro ────────────────────────────────────────────────────────────
  // 两 id 拆分；改图字段名是 `input_urls`；两端点的 aspect_ratio 枚举不同（i2i 多一档 auto，见档案）。
  imageModel({
    modelKey: "flux-2/pro-text-to-image", labelZh: "FLUX.2 Pro", archetypeId: "flux-2-pro",
    seedKey: "flux-2-pro", modelRef: MODE_MODEL_REF,
    t2iInput: { aspect_ratio: ASPECT_RATIO, resolution: RESOLUTION },
    editInput: { input_urls: INPUT_URLS, aspect_ratio: ASPECT_RATIO, resolution: RESOLUTION },
  }),
];

/** 本族所有 mapping 共用的轮询 + 状态归一（seedBuiltins 注册时套上）。 */
export const KIE_IMAGE_2026_QUERY = KIE_QUERY_OP;
export const KIE_IMAGE_2026_STATUS = KIE_STATUS_MAPPING;
