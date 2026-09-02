// apimart 视频模型的 curated 传输配方（11 个高频视频模型，单源）。契约见
// docs/plan/2026-06-07-apimart-curated-onboarding.md 附录 A（R5 抓 + Sora 2 已真 mp4 验证）；
// VEO 3.1 的别名/范围归一参考 R6 对标（Infinite-Canvas 的 apimart_veo31_* helper）。
// 2026-07-29 增补（各自照 docs.apimart.ai 当日文档对账）：Vidu Q3（参考生，无 t2v）、可灵 3.0 Turbo、
// HappyHorse 1.1（单 model 字段自动路由）、Wan 2.7 升级角色参考（wan2.7-r2v，per-mode modelEnum 通道）。
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
import "./apimartMinimaxH3";
import "./apimartModelIds";

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

// model 字段缺省取 catalog 行 modelKey；变体合并的模型（Seedance：1 catalog 行 + 3 变体）改取
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
const QUALITY = "{{request.params.quality}}";
const DURATION = "{{request.params.duration}}";
const MODE = "{{request.params.mode}}";
const AUDIO = "{{request.params.audio}}";
const GEN_AUDIO = "{{request.params.generate_audio}}";
const IMAGE_URLS = "{{request.params.image_urls}}"; // image_ref 槽 inputKey=image_urls
const VIDEO_URLS = "{{request.params.video_urls}}"; // seedance 全能参考 video_ref 槽 inputKey=video_urls
const AUDIO_URLS = "{{request.params.audio_urls}}"; // seedance 全能参考 audio_ref 槽 inputKey=audio_urls
const FIRST_FRAME_IMAGE = "{{request.params.first_frame_image}}"; // hailuo first_frame 槽 inputKey=first_frame_image
const SEED = "{{request.params.seed}}"; // 可选种子（无默认 → 未填则模板丢弃）
const RETURN_LAST_FRAME = "{{request.params.return_last_frame}}"; // Seedance 2.5 独有：返回尾帧图
const NEGATIVE_PROMPT = "{{request.params.negative_prompt}}"; // 负向提示词（可选，未填则丢弃）
const GENERATION_TYPE = "{{request.params.generation_type}}"; // 首尾帧/参考图模式标记（mode.fixedParams 注入，Veo/Omni/Wan 3.0）
const WATERMARK = "{{request.params.watermark}}"; // 水印开关（Wan 3.0，官方默认 false）
// 首尾帧角色数组：整串一个 {{}} → 模板引擎原样透传 [{url,role}] 不 stringify（同 kie 整串透传）。
// 由 archetypeMeta combineSlotsInto 在构造层组装，与 image_urls 互斥（同 body，非当前模式键自动丢）。
const IMAGE_WITH_ROLES = "{{request.params.image_with_roles}}";

// Seedance 三变体共享的 body 形状（单源 P1，见下方 APIMART_VIDEO_MODELS 注释）。
const SEEDANCE_T2V_BODY = { size: SIZE, resolution: RESOLUTION, duration: DURATION, seed: SEED, generate_audio: GEN_AUDIO };
const SEEDANCE_I2V_BODY = { size: SIZE, resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS, video_urls: VIDEO_URLS, audio_urls: AUDIO_URLS, image_with_roles: IMAGE_WITH_ROLES, seed: SEED, generate_audio: GEN_AUDIO };

const H3_REGENERATION_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/v1/videos/generations",
  headers: CREATE_HEADERS,
  body: { model: "{{model.modelKey}}", source_task_id: "{{request.params.source_task_id}}" },
  response_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
  provider_meta_mapping: { task_id: APIMART_CREATE_TASK_ID_PATH },
};

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
  /** 模板渲染后、HTTP 发送前的具名请求护栏。 */
  requestTransform?: string;
  /** 省略 = 该模型无纯文生模式（Vidu Q3 参考生：image_urls 必填，只有 i2v mapping）。 */
  t2vBody?: Record<string, unknown>;
  i2vBody?: Record<string, unknown>;
  /** i2v 模式「故意不发」的 canonical 参数（比例由图自动决定）。明示 drop 满足铁律不变量，行为不变。 */
  i2vDrops?: string[];
}): ApimartVideoModel {
  const idKey = p.idKey ?? p.archetypeId;
  const mappings: ApimartVideoModel["mappings"] = [];
  if (p.t2vBody) {
    const create = videoCreateOp(p.t2vBody, p.modelRef);
    if (p.requestTransform) create.request_transform = p.requestTransform;
    mappings.push({ id: `seed-apimart-${idKey}-text_to_video`, taskKind: "text_to_video", name: `${p.labelZh} · 文生视频`, create });
  }
  if (p.i2vBody) {
    const create = videoCreateOp(p.i2vBody, p.modelRef, p.i2vDrops?.length ? dropParamMap(p.i2vDrops) : undefined);
    if (p.requestTransform) create.request_transform = p.requestTransform;
    mappings.push({ id: `seed-apimart-${idKey}-image_to_video`, taskKind: "image_to_video", name: `${p.labelZh} · 图生视频`, create });
  }
  return { modelKey: p.modelKey, labelZh: p.labelZh, archetypeId: p.archetypeId, mappings };
}

/** 11 个 apimart 视频模型（单源）。 */
export const APIMART_VIDEO_MODELS: ApimartVideoModel[] = [
  // Vidu Q3（2026-07-29）：参考生视频，1-7 张参考图必填、无纯文生 → 只种 i2v mapping。
  // 变体（标准 viduq3 / Mix viduq3-mix）→ body model 取 {{request.params.model}}。
  videoModel({
    modelKey: "viduq3", labelZh: "Vidu Q3", archetypeId: "vidu-q3", modelRef: VARIANT_MODEL_REF,
    i2vBody: { duration: DURATION, resolution: RESOLUTION, aspect_ratio: ASPECT, image_urls: IMAGE_URLS, seed: SEED },
  }),
  // 可灵 3.0 Turbo（2026-07-29）：无画质档（resolution 代替 mode），图生=单张 first_frame_image 字符串、
  // 比例随首帧（i2v 不声明 aspect_ratio，无需 drop）。watermark 不发=默认无。
  videoModel({
    modelKey: "kling-3.0-turbo", labelZh: "可灵 3.0 Turbo", archetypeId: "kling-3.0-turbo",
    t2vBody: { aspect_ratio: ASPECT, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { resolution: RESOLUTION, duration: DURATION, first_frame_image: FIRST_FRAME_IMAGE },
  }),
  // HappyHorse 1.1（2026-07-29）：单 model id，上游按字段自动路由（first_frame_image=图生 /
  // image_urls 1-9=角色参考）。i2v/ref 共用一条 i2v mapping：互斥由 M2 模式投影保证（非当前模式键不进 body）；
  // size 仅 t2v/ref 模式声明（图生被官方忽略→不声明不发，同 body 键自动丢）。
  videoModel({
    modelKey: "happyhorse-1.1", labelZh: "HappyHorse 1.1", archetypeId: "happyhorse-1.1",
    t2vBody: { resolution: RESOLUTION, size: SIZE, duration: DURATION, seed: SEED },
    i2vBody: { resolution: RESOLUTION, size: SIZE, duration: DURATION, seed: SEED, first_frame_image: FIRST_FRAME_IMAGE, image_urls: IMAGE_URLS },
  }),
  // Grok Imagine 1.5：文生/图生共用标准视频端点。图生最多 7 图，比例自动跟随参考图，故不发 size。
  videoModel({
    modelKey: "grok-imagine-1.5-video-apimart", labelZh: "Grok Imagine 1.5", archetypeId: "grok-imagine-1.5-video",
    requestTransform: "apimart-canonical-model-id",
    t2vBody: { size: SIZE, quality: QUALITY, duration: DURATION },
    i2vBody: { quality: QUALITY, duration: DURATION, image_urls: IMAGE_URLS },
  }),
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
  // Seedance 2.0：catalog 始终只有 **1 个**基础行；档案提供 Seedance 2.0 / Fast / Mini 三种模式。
  // 3 变体由档案 variants 声明（seedanceApimart.ts），用户经 VariantBar 切换；body 的 model 字段取
  // {{request.params.model}}（= 档案当前变体的 modelKey，如 doubao-seedance-2.0-fast），同 happyhorse 通道。
  // body 形状一致（SEEDANCE_*_BODY 单源 P1）：i2vBody 一条覆盖 图生/全能参考/首尾帧 三模式——
  // image_urls + video_urls/audio_urls + image_with_roles(与 image_urls 互斥) + seed；空键由模板自动丢（M2）。
  videoModel({ modelKey: "doubao-seedance-2.0", labelZh: "Seedance 2.0", archetypeId: "seedance-2-apimart", modelRef: VARIANT_MODEL_REF, requestTransform: "apimart-canonical-model-id", t2vBody: SEEDANCE_T2V_BODY, i2vBody: SEEDANCE_I2V_BODY }),
  // Seedance 2.5（2026-08-12 接入，逐项对账 docs.apimart.ai/cn/api-reference/videos/doubao-seedance-2-5）。
  // 与 2.0 的通道差异：无变体（官方 model 固定 doubao-seedance-2.5，故用默认 {{model.modelKey}}）、
  // 多一个 return_last_frame（2.5 独有，返回尾帧图）。参考通道键名与 2.0 相同（image_urls /
  // video_urls / audio_urls / image_with_roles），故沿用同款 body 形状 + 该字段。
  // size 在首尾帧模式由档案 fixedParams 钉成 adaptive（官方硬约束），不在这里 drop —— 值照发即可。
  videoModel({
    modelKey: "doubao-seedance-2.5", labelZh: "Seedance 2.5", archetypeId: "seedance-2.5-apimart",
    requestTransform: "apimart-canonical-model-id",
    t2vBody: { ...SEEDANCE_T2V_BODY, return_last_frame: RETURN_LAST_FRAME },
    i2vBody: { ...SEEDANCE_I2V_BODY, return_last_frame: RETURN_LAST_FRAME },
  }),
  videoModel({
    modelKey: "MiniMax-H3", labelZh: "MiniMax H3", archetypeId: "minimax-h3-apimart",
    requestTransform: "apimart-minimax-h3",
    t2vBody: { duration: DURATION, resolution: RESOLUTION, aspect_ratio: ASPECT, watermark: "{{request.params.watermark}}", webhook: "{{request.params.webhook}}" },
    i2vBody: { duration: DURATION, resolution: RESOLUTION, aspect_ratio: ASPECT, watermark: "{{request.params.watermark}}", webhook: "{{request.params.webhook}}", first_frame_image: "{{request.params.first_frame_image}}", last_frame_image: "{{request.params.last_frame_image}}", image_urls: IMAGE_URLS, video_urls: VIDEO_URLS, audio_urls: AUDIO_URLS },
  }),
  // Wan 2.7（2026-07-29 升级角色参考）：三模式经 per-mode modelEnum 发不同 model（t2v/i2v=wan2.7、
  // 角色参考=wan2.7-r2v）→ body model 改取 {{request.params.model}}。i2v/ref 共用一条 i2v mapping：
  // i2v 走 image_urls（首/尾帧）；ref 走 image_with_roles（combineSlotsInto 产 [{url,role:'reference_image'}]）
  // + video_urls；互斥由 M2 模式投影保证。size 从 i2v 模式移除（官方忽略 → 不声明不发，替代旧 drops 明示）。
  videoModel({
    modelKey: "wan2.7", labelZh: "Wan 2.7", archetypeId: "wan-2.7", modelRef: VARIANT_MODEL_REF,
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, negative_prompt: NEGATIVE_PROMPT },
    i2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS, image_with_roles: IMAGE_WITH_ROLES, video_urls: VIDEO_URLS, negative_prompt: NEGATIVE_PROMPT, seed: SEED },
  }),
  // Wan 3.0（2026-08-27 接入，逐项对账 docs.apimart.ai/cn/api-reference/videos/wan3.0-video/generation）。
  // 单 model id（无变体 → 默认 {{model.modelKey}}）；四模式（文生/首帧/首尾帧/全能参考）共用一条 i2v mapping。
  // **generation_type 是这里的关键**：image_urls 在「首尾帧族」和「参考族」之间被官方重载，
  // 只有它能告诉上游这批素材属于哪族 → 由档案 mode.fixedParams 钉死（frame / reference），不靠上游猜。
  // 首/尾帧走 image_with_roles（combineSlotsInto 产 [{url,role:'first_frame'|'last_frame'}]），
  // 参考族走裸 image_urls + video_urls + audio_urls；互斥由 M2 模式投影保证。
  // 比例字段是 size（同 Wan 2.7，不是 aspect_ratio）；首尾帧模式档案已把 size 收窄为 adaptive → 值照发。
  videoModel({
    modelKey: "wan3.0-video", labelZh: "Wan 3.0", archetypeId: "wan-3.0-apimart",
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, audio: AUDIO, watermark: WATERMARK, seed: SEED },
    i2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, audio: AUDIO, watermark: WATERMARK, seed: SEED, generation_type: GENERATION_TYPE, image_urls: IMAGE_URLS, image_with_roles: IMAGE_WITH_ROLES, video_urls: VIDEO_URLS, audio_urls: AUDIO_URLS },
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
    requestTransform: "apimart-omni-flash-ext-contract",
    t2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION },
    i2vBody: { size: SIZE, resolution: RESOLUTION, duration: DURATION, image_urls: IMAGE_URLS, generation_type: GENERATION_TYPE },
  }),
  {
    modelKey: "MiniMax-H3-Regeneration",
    labelZh: "MiniMax H3 再生成",
    archetypeId: "minimax-h3-regeneration",
    mappings: [{ id: "seed-apimart-minimax-h3-regeneration-text_to_video", taskKind: "text_to_video", name: "MiniMax H3 · 再生成（768P → 2K）", create: H3_REGENERATION_CREATE_OP }],
  },
];

export const APIMART_VIDEO_QUERY = APIMART_VIDEO_QUERY_OP;
export const APIMART_VIDEO_STATUS = APIMART_STATUS_MAPPING;
