// new-api 中转的图片/视频传输模板 + 标准参数（Issue #8）。单源：mapping body 引用的
// {{request.params.X}} 与下方 STANDARD_*_PARAMS 的 key 一一对应（改一处即同步，P1）。
//
// new-api 是开源中转软件，接口被软件固定（R5 已核 doc.newapi.pro / newapi.ai）：
//   图片  POST {base}/v1/images/generations  { model, prompt, size, quality, n, response_format }
//         → **同步** { created, data:[{ url | b64_json }] }
//   视频  POST {base}/v1/video/generations    { model, prompt, duration, size, image? }
//         → **异步** { task_id, status:"processing" }
//   轮询  GET  {base}/v1/video/generations/{task_id}
//         → { status:"succeeded"|"failed"|"processing", data:[{ url }] }
//
// 一个 new-api 适配器覆盖**所有自建 new-api 实例**（baseUrl 用户填，paths 固定）。
// baseUrl 裸（不带 /v1），op.path 自带 /v1（与 apimart/modelscope 同约定，避 joinUrl 双前缀）。
//
// 真实 vendor 字段细微差异（尤其视频轮询结果 url 路径文档没给全）由 runtime 的**防御式
// extractAssetUrl**（试 11 种路径含 data[0].url / videos[0].url / result.video_url）兜底 +
// issue reporter 跑 tests/transport-spike/newapi.mjs 探测确认。

import type { HttpOperation, ProfileKind } from "./types";
import type { ParamMap } from "./paramTranslate";

const JSON_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

/**
 * 中转所有 op 的 model 字段引用——**参数化，不是字面量**（内置变体模型早就是这个写法，
 * apimartVideos.VARIANT_MODEL_REF / apimartImages / volcengineVideos 同串）。
 *
 * 为什么必须参数化：变体（seedance-2 的 标准/快速/mini 等）的全部意义就是「换一个真正发出去的
 * model 串」。渲染层的收窄判据 `archetypeVariantAxisIsLive` 读的正是「这条 create op 的 wire 有没有
 * 引用 params.model」（channelModeReach.ts:80-83）——写死 `{{model.modelKey}}` 的渠道切变体什么也
 * 不会发生，所以那个判据（正确地）把变体栏整条藏掉。结果：中转用户**永远只能跑默认档**，每一次
 * 生成都更贵更慢，且界面上根本看不出还有别的档 —— 这就是内置模型与中转模型体验分家的那道口子。
 *
 * 回落（关键）：`params.model` 只有带变体的档案才产出，裸模型是 undefined，而模板层对整 token 的
 * undefined 是**整键丢弃**（不是留空串）→ 每个没变体的中转模型都会发出没有 model 字段的请求。
 * 回落因此补在**参数层**（taskTemplateParams：`extras.model || selected.wireModelKey`），值与
 * `{{model.modelKey}}` 同源，保证裸模型换写法前后线上字节逐字节一致。模板层没有 `||` 语法，
 * 也刻意不给它加一套（那会是第二套「发哪个 model 串」的机制，P1）。
 */
const RELAY_MODEL_REF = "{{request.params.model}}";

// new-api 状态动词 → 归一态。
export const NEWAPI_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["queued", "pending", "submitted", "not_start", "notstart"],
  running: ["processing", "running", "in_progress", "queueing"],
  succeeded: ["succeeded", "success", "completed", "done"],
  // 失败动词必须尽量收全：**没认出来的动词会落进 queued（= 继续轮询）**，于是一个已经失败的
  // 任务在用户眼里变成「永远转圈」，既不出结果也不报错。往返测试实测 "failure"/"rejected"
  // 此前就是这个下场（2026-08-11）。这里只能缓解，未知动词的兜底语义另行处理。
  failed: [
    "failed", "fail", "failure", "error", "cancelled", "canceled", "timeout",
    "rejected", "refused", "expired", "aborted",
  ],
};

// 铁律翻译（用户自建中转的关键）：通用 new-api 站走 OpenAI 兼容契约 → size 是像素。中性「比例
// aspect_ratio + 清晰度 resolution(1K/2K/4K)」在这里算成 OpenAI 像素 size（3840x2160=4K…），无论模型
// 是否套档案：裸 relay 模型的标准参数现在也出 比例+清晰度（NEWAPI_STANDARD_IMAGE_PARAMS，取代旧的写死
// 像素 size 三档），故用户能选到 2K/4K（治「只能出 1K」）。比例 auto/空 → 转换返回 undefined → 不覆盖
// （极端兜底）。这条 paramMap 让自建站的「分辨率/比例」不再发不出去、也不再钉死 1K。
export const NEWAPI_IMAGE_PARAM_MAP: ParamMap = {
  rules: [{ wire: "size", fromMany: ["aspect_ratio", "resolution"], transform: "ratioResToOpenAiSize" }],
};
export const NEWAPI_VIDEO_PARAM_MAP: ParamMap = {
  rules: [{ wire: "size", fromMany: ["aspect_ratio", "resolution"], transform: "ratioResToOpenAiSize" }],
};

// ── 图片：同步 create（无 query；create 返回即结果，buildProfileTaskResult 用 extractAssetUrl 取 data[0].url）──
export const NEWAPI_IMAGE_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/v1/images/generations",
  headers: JSON_HEADERS,
  body: {
    model: RELAY_MODEL_REF,
    prompt: "{{request.prompt}}",
    size: "{{request.params.size}}",
    quality: "{{request.params.quality}}",
    n: "{{request.params.n}}", // OpenAI 标准张数（taskParams 缺省 1；整 token 保留 number）
    response_format: "url",
  },
  // data[*].url：n>1 时取回**全部**图（pathValues 支持 [*] 通配摊平），不再只落第一张（旧 data.0.url）。
  response_mapping: { image_url: "data[*].url" },
  paramMap: NEWAPI_IMAGE_PARAM_MAP,
};

// ── 图片：图生图/改图（image_edit）走 chat/completions 多模态 ──────────────────────────────
// 通用中转的图生图**主力口径**（R5 核 apiyi/laozhang/七牛 等 nano-banana 中转文档）：gemini/nano-banana
// 系图生图走 /v1/chat/completions，参考图在 messages[].content[] 的 {type:"image_url",image_url:{url}}，
// 出图是 base64 塞在 choices[0].message.content（extractChatImageUrl 兜底解析）。这条纯 URL-in-JSON，
// 贴 Nomi 架构。content 是 [静态 text 项, 变长 image_url 项数组]——后者用整 token 引用 chat_image_parts
// （taskParams 建），renderTemplateValue 的数组摊平特性把它铺平进 content。
// 边界：gpt-image/DALL·E 的 /v1/images/edits 是 multipart 二进制上传，与 URL 架构冲突，本期不接（诚实标出）。
export const NEWAPI_IMAGE_EDIT_OP: HttpOperation = {
  method: "POST",
  path: "/v1/chat/completions",
  headers: JSON_HEADERS,
  body: {
    model: RELAY_MODEL_REF,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "{{request.prompt}}" },
          "{{request.params.chat_image_parts}}",
        ],
      },
    ],
    stream: false,
  },
  // 结构化路径优先（部分中转 message.images:[{url}]）；markdown/字符串/数组内联 base64 由 runtime 的
  // extractAssetUrl → extractChatImageUrl 兜底。刻意不把 message.content 直接当 image_url（会把整段 markdown
  // 误当 URL 污染结果）。
  response_mapping: { image_url: "choices.0.message.images.0.url" },
};

// xAI Imagine 图片编辑官方契约（2026-05-26）：JSON POST /v1/images/edits；单图字段 image，多图字段
// images（最多 3 张），返回 data[*].url。注意它和 OpenAI SDK 的 multipart images.edit 不是同一种线缆。
export const XAI_JSON_IMAGE_EDIT_OP: HttpOperation = {
  method: "POST",
  path: "/v1/images/edits",
  headers: JSON_HEADERS,
  body: {
    model: RELAY_MODEL_REF,
    prompt: "{{request.prompt}}",
    image: "{{request.params.json_edit_image}}",
    images: "{{request.params.json_edit_images}}",
    aspect_ratio: "{{request.params.json_edit_aspect_ratio}}",
    resolution: "{{request.params.xai_resolution}}",
    response_format: "url",
  },
  response_mapping: { image_url: "data[*].url" },
  paramMap: {
    rules: [{ wire: "xai_resolution", fromMany: ["resolution"], transform: "toLowerCase" }],
  },
};

// OpenAI 官方图像编辑契约（gpt-image-1/1.5/2、dall-e-2；R5 核 OpenAI 官方 developers.openai.com +
// new-api doc.newapi.pro + apiyi 文档，2026-07）：**multipart/form-data** POST /v1/images/edits，参考图走
// image[] 文件字段（多图，官方上限 16），文本字段 model/prompt/size/quality/n，返回 data[*].url|b64_json。
// 这是 chat/completions 之外一大类中转站唯一认的图生图线缆（packyapi 等明确不支持 chat 出图）——补上它 =
// 通用覆盖所有走 OpenAI 标准 images/edits 的模型，不止 gpt-image。v1 不做 mask（Nomi 节点无 mask 概念；
// gpt-image mask 本可选，纯 prompt 改图能用）。参考图来自 request.params.reference_images（taskParams 聚合）。
export const OPENAI_MULTIPART_IMAGE_EDIT_OP: HttpOperation = {
  method: "POST",
  path: "/v1/images/edits",
  headers: { Authorization: "Bearer {{user_api_key}}" }, // 不设 Content-Type：multipart 由 fetch 自动加 boundary
  multipart: {
    fields: {
      model: RELAY_MODEL_REF,
      prompt: "{{request.prompt}}",
      size: "{{request.params.size}}",
      quality: "{{request.params.quality}}",
      n: "{{request.params.n}}",
      response_format: "url",
    },
    imageField: "image[]",
    imageSource: "{{request.params.reference_images}}",
    multiple: true,
  },
  response_mapping: { image_url: "data[*].url" },
  paramMap: NEWAPI_IMAGE_PARAM_MAP,
};

export type NewapiImageEditProtocol = "chat-completions-image-url" | "xai-json-edits" | "openai-multipart-edits";
export type NewapiImageEditProfile = { protocol: NewapiImageEditProtocol; operation: HttpOperation };

// 协议 → 真实 wire op（单一真相源；commit/migration/probe 都按协议名查这张表拿 op）。
const OP_BY_PROTOCOL: Record<NewapiImageEditProtocol, HttpOperation> = {
  "chat-completions-image-url": NEWAPI_IMAGE_EDIT_OP,
  "xai-json-edits": XAI_JSON_IMAGE_EDIT_OP,
  "openai-multipart-edits": OPENAI_MULTIPART_IMAGE_EDIT_OP,
};

// 智能默认按模型族猜协议（B1，探测/手动缺位时的兜底）：只匹配**确有 /v1/images/edits 端点**的模型族——
// gpt-image 全系 + dall-e-2。dall-e-3 是纯生成、无编辑端点，故意不匹配（避免误判成 multipart 后撞 404）。
const OPENAI_MULTIPART_EDIT_MODEL_RE = /(^|[/_-])gpt[_-]?image|(^|[/_-])dall-?e-2(?![0-9])/i;

// 模型级协议档案，而非 vendor 级开关：同一个中转站可以同时挂 Nano Banana(chat 多模态)与
// Grok Imagine(JSON edits)。匹配只认完整模型身份/末段，避免把普通 grok 文本模型误判成图片端点。
const XAI_JSON_EDIT_MODEL_IDS = new Set([
  "grok-imagine-image",
  "grok-imagine-image-quality",
  "grok-imagine-image-pro",
  "grok-imagine-image-2026-03-02",
]);

function normalizedModelId(modelKey: string): string {
  const value = String(modelKey || "").trim().toLowerCase().replace(/^models\//, "");
  return value.slice(value.lastIndexOf("/") + 1);
}

/**
 * 中转 image_edit 选真实 wire。三层（探测优先 → 智能默认 → chat 兜底）：
 *  - override：来自免费端点探测（probeImageEditProtocol）或用户在模型编辑面板手选的协议，最高优先；
 *  - 智能默认：grok-imagine → xai-json；gpt-image 系 / dall-e 系 → openai-multipart-edits；
 *  - 兜底：其余（gemini/nano-banana 系）→ chat/completions 多模态。
 * 只认完整模型身份，避免把普通文本模型误判成图片端点。
 */
export function newapiImageEditProfileForModel(
  modelKey: string,
  modelAlias?: string | null,
  override?: NewapiImageEditProtocol | null,
): NewapiImageEditProfile {
  const forced = override && OP_BY_PROTOCOL[override] ? override : null;
  const protocol = forced ?? smartDefaultImageEditProtocol(modelKey, modelAlias);
  return { protocol, operation: OP_BY_PROTOCOL[protocol] };
}

/** 按模型族猜协议（无探测/手动时的默认）。 */
export function smartDefaultImageEditProtocol(modelKey: string, modelAlias?: string | null): NewapiImageEditProtocol {
  const identities = [modelKey, modelAlias].filter((v): v is string => Boolean(v));
  if (identities.some((value) => XAI_JSON_EDIT_MODEL_IDS.has(normalizedModelId(value)))) return "xai-json-edits";
  if (identities.some((value) => OPENAI_MULTIPART_EDIT_MODEL_RE.test(value))) return "openai-multipart-edits";
  return "chat-completions-image-url";
}

// ── 视频：异步 create（返回 task_id 进轮询）──
export const NEWAPI_VIDEO_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/v1/video/generations",
  headers: JSON_HEADERS,
  body: {
    model: RELAY_MODEL_REF,
    prompt: "{{request.prompt}}",
    duration: "{{request.params.duration}}",
    size: "{{request.params.size}}",
    // i2v 首帧：取 taskParams 聚合后的 image_url（含节点填的 firstFrameUrl / referenceImages[0]），
    // 不是裸 image 键（那个 taskParams 从不产出 → 通用路 i2v 首帧此前根本到不了 wire）。可选，未填模板丢弃。
    image: "{{request.params.image_url}}",
    // seed / negative_prompt：**文档明写的字段，此前静默丢弃**（R5 核 doc.newapi.pro/api/kling-jimeng/
    // 2026-09-03：seed「随机种子」是顶层可选 integer；negative_prompt 是 metadata 的官方示例字段之一，
    // 原文 "供应商特定/自定义参数（如 negative_prompt, style, quality_level 等）"）。
    // 两者 taskParams 早就归一好了（seed 走 numericWireParam 保数字、negative_prompt 认 camel/snake 两种来源），
    // 只是 body 没给位置 —— 于是用户在节点上填的种子/负向词一路走到发送前被无声吃掉，
    // 产出不可复现、负向词完全不生效，且界面上没有任何迹象。未填 → 模板整键丢弃，严格端点不会收到空字段。
    seed: "{{request.params.seed}}",
    // metadata 用**整 token**引用（不是 `{ negative_prompt: "{{...}}" }` 逐键写）：模板层丢得掉
    // undefined 的**键**，却丢不掉那个已经变空的**父对象** —— 实测逐键写法在什么都没填时仍会发出
    // `"metadata":{}`，给严格端点凭空多一个空对象。整 token 引用则在没内容时整键消失（见 relay_metadata）。
    metadata: "{{request.params.relay_metadata}}",
  },
  response_mapping: { task_id: "task_id" },
  provider_meta_mapping: { task_id: "task_id" },
  paramMap: NEWAPI_VIDEO_PARAM_MAP,
};

// ── 视频：轮询 query（task_id 走路径参数）──
export const NEWAPI_VIDEO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/v1/video/generations/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "task_id",
    status: "status",
    video_url: "data[*].url", // 取回全部产物（n>1 / 多结果），不再只落第一个（旧 data.0.url）
    error_message: "error.message",
  },
};

// ── 标准参数（落 model.meta.parameters，节点 UI 渲染；key 与上方 body 模板对齐）──
type ParamControl = {
  key: string;
  label: string;
  type: "select" | "number" | "text" | "boolean" | "image-url";
  options: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
};

const sel = (values: string[]) => values.map((value) => ({ value, label: value }));

// 中性「比例 + 清晰度档」（不再写死像素 size 三档 = 治「只能出 1K」）。派生像素 size 由 NEWAPI_IMAGE_PARAM_MAP
// 的 ratioResToOpenAiSize 算（支持 1K/2K/4K，受 OpenAI 像素预算夹取）。resolution 大写 canonical，转换器内部归一。
export const NEWAPI_STANDARD_IMAGE_PARAMS: ParamControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: sel(["1:1", "16:9", "9:16", "4:3", "3:4"]), defaultValue: "1:1" },
  { key: "resolution", label: "清晰度", type: "select", options: sel(["1K", "2K", "4K"]), defaultValue: "1K" },
  { key: "quality", label: "质量", type: "select", options: sel(["standard", "hd"]), defaultValue: "standard" },
  { key: "n", label: "张数", type: "number", options: [], min: 1, max: 4, defaultValue: 1 },
];

export const NEWAPI_STANDARD_VIDEO_PARAMS: ParamControl[] = [
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 30, defaultValue: 5 },
  { key: "size", label: "比例 / 尺寸", type: "select", options: sel(["16:9", "9:16", "1:1", "1280x720", "720x1280"]), defaultValue: "16:9" },
  // 键必须叫 image_url（= body 模板读的那个键、= taskParams 聚合首帧的那个键）。曾叫 image：
  // 于是 commit 的 reconcile 发现「声明了 image 但 body 里没有 {{request.params.image}}」，就把
  // body 的 `image: "{{request.params.image_url}}"` **覆盖**成 `{{request.params.image}}` ——
  // 而 taskParams 从不产出 image，连线的首帧从此静默到不了线上。同一个东西只准一个名字。
  { key: "image_url", label: "首帧图(图生视频，可选)", type: "image-url", options: [] },
];

// ── 配音(TTS)：OpenAI 兼容同步 create（POST /v1/audio/speech → **直接回二进制音频**，runner 读 arrayBuffer）──
// 中转(Xcode.hk 等)的 seed-tts-2.0 走这条：Bearer + JSON body，response_format=mp3（实测回 audio/mpeg，
// 见 SeedTTS-2.0 文档）。audioResponse 缺省=binary（裸字节），区别于火山原生的 ndjson-base64。
// model 发模型真名（用户接入时填 seed-tts-2.0），voice 由档案/参数给（seed-tts 档案提供火山音色下拉）。
export const NEWAPI_AUDIO_TTS_OP: HttpOperation = {
  method: "POST",
  path: "/v1/audio/speech",
  headers: JSON_HEADERS,
  body: {
    model: RELAY_MODEL_REF,
    input: "{{request.prompt}}",
    voice: "{{request.params.voice}}",
    speed: "{{request.params.speed}}", // OpenAI /v1/audio/speech 标准语速（0.25~4.0，缺省由模板丢弃→站默认）
    response_format: "mp3",
  },
  audioResponse: { type: "binary", contentType: "audio/mpeg", extension: "mp3" },
};

// 通用中转配音参数（裸 relay 模型的兜底；模型若命中 seed-tts 档案，UI 由档案给火山音色下拉）。
// voice 用 freeform——各中转 TTS 模型音色 ID 不同，不写死枚举。speed 是 OpenAI 标准语速。
export const NEWAPI_STANDARD_AUDIO_PARAMS: ParamControl[] = [
  { key: "voice", label: "音色 ID", type: "text", options: [] },
  { key: "speed", label: "语速", type: "number", options: [], min: 0.25, max: 4, defaultValue: 1 },
];

/** 一个 new-api 模型的传输配方（按 kind 取 create/query + taskKind；图像另带 image_edit 改图 op、
 *  视频另带 image_to_video 图生视频 op）。 */
export function newapiTransportFor(kind: "image" | "video" | "audio"): {
  taskKind: ProfileKind;
  create: HttpOperation;
  /** 图像专有：图生图/改图 mapping（chat/completions 多模态）。落库时按 taskKind:"image_edit" 注册。 */
  edit?: HttpOperation;
  /** 视频专有：图生视频 mapping。落库时按 taskKind:"image_to_video" 注册（与 create 共用轮询 query）。 */
  imageToVideo?: HttpOperation;
  query?: HttpOperation;
  statusMapping?: Record<string, string[]>;
  params: ParamControl[];
} {
  if (kind === "video") {
    // 图生视频与文生视频是**同一条 wire**：new-api 的 /v1/video/generations 本就带可选 image（首帧）。
    // 但 taskKind 必须各注册一条 mapping——runtime 按 taskKind 选投递通道，只有 text_to_video 时
    // 图生视频请求找不到通道，参考图整条掉地（imageEditGuardError 会拒发）。共用同一个 op 对象，
    // 不造第二份形状（P1）。
    return { taskKind: "text_to_video", create: NEWAPI_VIDEO_CREATE_OP, imageToVideo: NEWAPI_VIDEO_CREATE_OP, query: NEWAPI_VIDEO_QUERY_OP, statusMapping: NEWAPI_STATUS_MAPPING, params: NEWAPI_STANDARD_VIDEO_PARAMS };
  }
  if (kind === "audio") {
    return { taskKind: "text_to_audio", create: NEWAPI_AUDIO_TTS_OP, params: NEWAPI_STANDARD_AUDIO_PARAMS };
  }
  return { taskKind: "text_to_image", create: NEWAPI_IMAGE_CREATE_OP, edit: NEWAPI_IMAGE_EDIT_OP, params: NEWAPI_STANDARD_IMAGE_PARAMS };
}
