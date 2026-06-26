// apimart 视频模型的 curated 传输配方（6 个高频视频模型，单源）。契约见
// docs/plan/2026-06-07-apimart-curated-onboarding.md 附录 A（R5 抓 + Sora 2 已真 mp4 验证）；
// VEO 3.1 的别名/范围归一参考 R6 对标（Infinite-Canvas 的 apimart_veo31_* helper）。
//
// apimart 视频创建是扁平 body：POST /v1/videos/generations { model, prompt, <按模型不同的字段> }
//   → { code:200, data:[{ status:"submitted", task_id }] }。轮询/结果与图片同构（已验证视频结果
//   在 data.result.videos[0].url[0]，url 是嵌套数组）→ 共用 apimartVendor 的 APIMART_VIDEO_QUERY_OP。
//
// 字段名分歧（这正是每条 mapping 各自翻译的原因）：
//   比例：aspect_ratio(sora/veo/kling) · size(seedance/wan) · 无(hailuo)
//   清晰度：resolution(多数) · mode(kling)
//   图生视频：image_urls 数组(多数) · first_frame_image 字符串(hailuo)
//   音频：audio(kling) · generate_audio(seedance)

import type { HttpOperation, ProfileKind } from "./types";
import type { ParamMap } from "./paramTranslate";
import { APIMART_CREATE_TASK_ID_PATH, APIMART_STATUS_MAPPING, APIMART_VIDEO_QUERY_OP } from "./apimartVendor";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

// model 字段缺省取 catalog 行 modelKey；变体合并的模型（Seedance：1 catalog 行 + 4 变体）改取
// {{request.params.model}}（值来自档案当前变体的 modelKey，同 happyhorse modelEnum 通道）。
function videoCreateOp(bodyFields: Record<string, unknown>, modelRef = "{{model.modelKey}}", paramMap?: ParamMap): HttpOperation {
  return {
    method: "POST",
    path: "/v1/videos/generations",
    headers: CREATE_HEADERS,
    body: { model: modelRef, prompt: "{{request.prompt}}", ...bodyFields },
    response_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
    provider_meta_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
    ...(paramMap ? { paramMap } : {}),
  };
}

// i2v「比例由图自动决定」→ 档案该模式仍显示比例控件（与 t2v 共享 params），但 apimart i2v body 不发它。
// 用 drops 把这层「故意不发」显式声明（铁律不变量要求：每个 canonical 参数要么被 codec 覆盖、要么明示 drop），
// 行为与迁移前完全一致，只是从「静默丢弃」变「明示不支持」。
const dropParamMap = (keys: string[]): ParamMap => ({ drops: keys, rules: [] });

// 变体合并模型用：body model = 档案当前变体的 modelKey（{{request.params.model}}）。
const VARIANT_MODEL_REF = "{{request.params.model}}";

// 通用 snake 参数引用（值取自档案控件/槽，键 = 各模型 apimart 字段名）。
const ASPECT = "{{request.params.aspect_ratio}}";
const SIZE = "{{request.params.size}}";
const RESOLUTION = "{{request.params.resolution}}";
const DURATION = "{{request.params.duration}}";
const MODE = "{{request.params.mode}}";
const AUDIO = "{{request.params.audio}}";
const GEN_AUDIO = "{{request.params.generate_audio}}";
const IMAGE_URLS = "{{request.params.image_urls}}"; // image_ref 槽 inputKey=image_urls
const VIDEO_URLS = "{{request.params.video_urls}}"; // seedance 全能参考 video_ref 槽 inputKey=video_urls
const AUDIO_URLS = "{{request.params.audio_urls}}"; // seedance 全能参考 audio_ref 槽 inputKey=audio_urls
const FIRST_FRAME_IMAGE = "{{request.params.first_frame_image}}"; // hailuo first_frame 槽 inputKey=first_frame_image
const SEED = "{{request.params.seed}}"; // 可选种子（无默认 → 未填则模板丢弃）
const NEGATIVE_PROMPT = "{{request.params.negative_prompt}}"; // 负向提示词（可选，未填则丢弃）
const GENERATION_TYPE = "{{request.params.generation_type}}"; // 首尾帧/参考图模式标记（mode.fixedParams 注入，Veo/Omni）
// 首尾帧角色数组：整串一个 {{}} → 模板引擎原样透传 [{url,role}] 不 stringify（同 kie 整串透传）。
// 由 archetypeMeta combineSlotsInto 在构造层组装，与 image_urls 互斥（同 body，非当前模式键自动丢）。
const IMAGE_WITH_ROLES = "{{request.params.image_with_roles}}";

// Seedance 四变体共享的 body 形状（单源 P1，见下方 APIMART_VIDEO_MODELS 注释）。
const SEEDANCE_T2V_BODY = { size: SIZE, resolution: RESOLUTION, duration: DURATION, seed: SEED, generate_audio: GEN_AUDIO };
const SEEDANCE_I2V_BODY = { size: SIZE, resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS, video_urls: VIDEO_URLS, audio_urls: AUDIO_URLS, image_with_roles: IMAGE_WITH_ROLES, seed: SEED, generate_audio: GEN_AUDIO };

export type ApimartVideoModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

function videoModel(p: {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  /** mapping id 的稳定后缀。缺省 = archetypeId（每模型唯一时够用）。 */
  idKey?: string;
  /** body 的 model 字段引用。缺省 {{model.modelKey}}；变体合并模型传 VARIANT_MODEL_REF。 */
  modelRef?: string;
  t2vBody: Record<string, unknown>;
  i2vBody?: Record<string, unknown>;
  /** i2v 模式「故意不发」的 canonical 参数（比例由图自动决定）。明示 drop 满足铁律不变量，行为不变。 */
  i2vDrops?: string[];
}): ApimartVideoModel {
  const idKey = p.idKey ?? p.archetypeId;
  const mappings: ApimartVideoModel["mappings"] = [
    { id: `seed-apimart-${idKey}-text_to_video`, taskKind: "text_to_video", name: `${p.labelZh} · 文生视频`, create: videoCreateOp(p.t2vBody, p.modelRef) },
  ];
  if (p.i2vBody) {
    mappings.push({ id: `seed-apimart-${idKey}-image_to_video`, taskKind: "image_to_video", name: `${p.labelZh} · 图生视频`, create: videoCreateOp(p.i2vBody, p.modelRef, p.i2vDrops?.length ? dropParamMap(p.i2vDrops) : undefined) });
  }
  return { modelKey: p.modelKey, labelZh: p.labelZh, archetypeId: p.archetypeId, mappings };
}

/** 6 个 apimart 视频模型（单源）。 */
export const APIMART_VIDEO_MODELS: ApimartVideoModel[] = [
  // Sora 2：变体（标准 sora-2 / Pro sora-2-pro）→ body model 取 {{request.params.model}}。duration 离散枚举。
  videoModel({
    modelKey: "sora-2", labelZh: "Sora 2", archetypeId: "sora-2", modelRef: VARIANT_MODEL_REF,
    t2vBody: { aspect_ratio: ASPECT, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS }, // i2v 时 aspect 由图自动决定
    i2vDrops: ["aspect_ratio"],
  }),
  // Veo 3.1：变体（fast/quality/lite）→ {{request.params.model}}。i2v 含 generation_type（reference 参考图 /
  // frame 首尾帧，由 mode.fixedParams 注入）；duration 固定 8 不发（走 API 默认）。
  videoModel({
    modelKey: "veo3.1-fast", labelZh: "Veo 3.1", archetypeId: "veo-3.1", modelRef: VARIANT_MODEL_REF,
    t2vBody: { aspect_ratio: ASPECT, resolution: RESOLUTION },
    i2vBody: { resolution: RESOLUTION, image_urls: IMAGE_URLS, generation_type: GENERATION_TYPE },
    i2vDrops: ["aspect_ratio"],
  }),
  // Kling v3：共享 kie 的 kling-3.0 档案（i2v 结构对齐：image_urls 数组槽）+ apimart vendorParams。
  videoModel({
    modelKey: "kling-v3", labelZh: "可灵 3.0", archetypeId: "kling-3.0",
    t2vBody: { mode: MODE, duration: DURATION, aspect_ratio: ASPECT, audio: AUDIO, negative_prompt: NEGATIVE_PROMPT },
    i2vBody: { mode: MODE, duration: DURATION, image_urls: IMAGE_URLS, audio: AUDIO, negative_prompt: NEGATIVE_PROMPT },
    i2vDrops: ["aspect_ratio"], // i2v 比例由首/尾帧决定
  }),
  // Seedance 2.0：变体合并（2026-06-16）——原 4 个独立 catalog 行（标准/fast/face/fast-face）收成 **1 个**。
  // 4 变体由档案 variants 声明（seedanceApimart.ts），用户经 VariantBar 切换；body 的 model 字段取
  // {{request.params.model}}（= 档案当前变体的 modelKey，如 doubao-seedance-2.0-fast），同 happyhorse 通道。
  // body 形状一致（SEEDANCE_*_BODY 单源 P1）：i2vBody 一条覆盖 图生/全能参考/首尾帧 三模式——
  // image_urls + video_urls/audio_urls + image_with_roles(与 image_urls 互斥) + seed；空键由模板自动丢（M2）。
  videoModel({ modelKey: "doubao-seedance-2.0", labelZh: "Seedance 2.0", archetypeId: "seedance-2-apimart", modelRef: VARIANT_MODEL_REF, t2vBody: SEEDANCE_T2V_BODY, i2vBody: SEEDANCE_I2V_BODY }),
  videoModel({
    modelKey: "wan2.7", labelZh: "Wan 2.7", archetypeId: "wan-2.7",
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, negative_prompt: NEGATIVE_PROMPT },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS, negative_prompt: NEGATIVE_PROMPT },
    i2vDrops: ["size"], // wan i2v 比例（size）由参考帧决定
  }),
  // Hailuo 2.3：无 aspect_ratio；图生视频用 first_frame_image（字符串，非数组）。变体（标准 / Fast）→ {{request.params.model}}。
  videoModel({
    modelKey: "MiniMax-Hailuo-2.3", labelZh: "Hailuo 2.3", archetypeId: "hailuo-2.3", modelRef: VARIANT_MODEL_REF,
    t2vBody: { resolution: RESOLUTION, duration: DURATION },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, first_frame_image: FIRST_FRAME_IMAGE },
  }),
  // Omni-Flash-Ext：Omni 类，比例字段用 size（与 aspect_ratio 同义）；参考图融合 image_urls（1 或 3 张）+
  // generation_type:reference（mode.fixedParams 注入，否则 3 图被拒）。
  videoModel({
    modelKey: "Omni-Flash-Ext", labelZh: "Omni-Flash-Ext", archetypeId: "omni-flash-ext",
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS, generation_type: GENERATION_TYPE },
  }),
];

export const APIMART_VIDEO_QUERY = APIMART_VIDEO_QUERY_OP;
export const APIMART_VIDEO_STATUS = APIMART_STATUS_MAPPING;
