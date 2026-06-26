// RunningHub 标准模型 API 接入 —— 3D 这一片（混元3D v3.1 / HiTem3D v21 / Meshy 6）。
// RunningHub = aggregator（一个 key 解锁 355 个标准模型）；本文件先接最新 3 个 3D 模型，让画布 model3d 节点
// 有真实可选模型。视频图片兼容集（apimart 同款经 RunningHub）是后续增量。
//
// API 形状（实查官方文档 + 开源插件 HM-RunningHub/ComfyUI_RH_OpenAPI core/task.py，非凭记忆）：
//   提交 POST /openapi/v2/{endpoint}（endpoint + 参数 + LIST options 逐字照官方 models_registry.json）
//   轮询 POST /openapi/v2/query，body {taskId}；鉴权 Bearer；完成 results:[{fileUrl,fileType:"glb"}]
//   状态 SUCCESS / FAILED / CANCEL / RUNNING / QUEUED / CREATE
// joinUrl 约定（避双前缀，见 kieSeedance 注释）：baseUrl 裸到 /openapi/v2，op.path = /{endpoint}。
// 本地图（图生3D）经通用 ANON_UPLOAD_CHAIN 自动传公网（resolveAssetIngestionWithFallback 兜底，零配置）。
import type { HttpOperation, ProfileKind } from "./types";

/** RunningHub 供应商种子（裸 baseUrl 到 /openapi/v2 + bearer）。 */
export const RUNNINGHUB_VENDOR_SEED = {
  key: "runninghub",
  name: "RunningHub",
  baseUrl: "https://www.runninghub.cn/openapi/v2",
  authType: "bearer" as const,
  authHeader: "Authorization",
} as const;

// 状态动词 → 我们三态。RunningHub 返大写；matcher 大小写不确定 → 大小写都列（防 casing，不脑补一种）。
const RUNNINGHUB_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["QUEUED", "CREATE", "PENDING", "queued", "create", "pending"],
  running: ["RUNNING", "running"],
  succeeded: ["SUCCESS", "success"],
  failed: ["FAILED", "CANCEL", "ERROR", "failed", "cancel", "error"],
};

// 轮询 op（所有 3D 模型共用）。任务响应是扁平 {taskId,status,results:[{fileUrl}]}（实查官方示例），但标准
// 模型 API 别处（resource/list）用 {code,data} 信封 → 任务端点是否套信封文档/实测略有出入。故每个 key 给
// flat + data.* 两条候选（mappingCandidates 支持数组、先命中者胜），真验收(待 key)首跑收敛到一条。
const RUNNINGHUB_QUERY_OP: HttpOperation = {
  method: "POST",
  path: "/query",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: { taskId: "{{providerMeta.task_id}}" },
  response_mapping: {
    task_id: ["taskId", "data.taskId"],
    status: ["status", "data.status"],
    model_url: ["results.0.fileUrl", "data.results.0.fileUrl"],
    error_message: ["errorMessage", "data.errorMessage"],
  },
};

const HDR = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

// ── 混元3D v3.1（文生 + 图生）──
const HUNYUAN3D_T2_CREATE: HttpOperation = {
  method: "POST", path: "/hunyuan3d-v3.1/text-to-3d", headers: HDR,
  body: { prompt: "{{request.prompt}}", faceCount: "{{request.params.faceCount}}", enablePbr: "{{request.params.enablePbr}}", generateType: "{{request.params.generateType}}" },
};
const HUNYUAN3D_I2_CREATE: HttpOperation = {
  method: "POST", path: "/hunyuan3d-v3.1/image-to-3d", headers: HDR,
  body: { imageUrl: "{{request.params.imageUrl}}", faceCount: "{{request.params.faceCount}}", enablePbr: "{{request.params.enablePbr}}", generateType: "{{request.params.generateType}}" },
};

// ── HiTem3D v21（图生）──
const HITEM3D_I2_CREATE: HttpOperation = {
  method: "POST", path: "/hitem3d-v21/image-to-3d", headers: HDR,
  body: { imageUrl: "{{request.params.imageUrl}}", requestType: "{{request.params.requestType}}", resolution: "{{request.params.resolution}}", face: "{{request.params.face}}" },
};

// ── Meshy 6（文生 + 图生）──
const MESHY6_T2_CREATE: HttpOperation = {
  method: "POST", path: "/meshy6/text-to-3d", headers: HDR,
  body: { prompt: "{{request.prompt}}", artStyle: "{{request.params.artStyle}}", topology: "{{request.params.topology}}", targetPolycount: "{{request.params.targetPolycount}}", symmetryMode: "{{request.params.symmetryMode}}", shouldRemesh: "{{request.params.shouldRemesh}}", enablePbr: "{{request.params.enablePbr}}" },
};
const MESHY6_I2_CREATE: HttpOperation = {
  method: "POST", path: "/meshy6/image-to-3d", headers: HDR,
  body: { imageUrl: "{{request.params.imageUrl}}", topology: "{{request.params.topology}}", targetPolycount: "{{request.params.targetPolycount}}", symmetryMode: "{{request.params.symmetryMode}}", shouldRemesh: "{{request.params.shouldRemesh}}", shouldTexture: "{{request.params.shouldTexture}}", enablePbr: "{{request.params.enablePbr}}" },
};

export const RUNNINGHUB_3D_CURATED_MODELS = [
  { modelKey: "hunyuan3d-v3.1", labelZh: "混元3D v3.1", kind: "model3d" as const, archetypeId: "hunyuan3d" },
  { modelKey: "hitem3d-v21", labelZh: "HiTem3D v21", kind: "model3d" as const, archetypeId: "hitem3d" },
  { modelKey: "meshy6", labelZh: "Meshy 6", kind: "model3d" as const, archetypeId: "meshy6" },
];

const mk = (id: string, taskKind: ProfileKind, modelKey: string, name: string, create: HttpOperation) => ({
  id, vendorKey: RUNNINGHUB_VENDOR_SEED.key, taskKind, modelKey, name, create,
  query: RUNNINGHUB_QUERY_OP, statusMapping: RUNNINGHUB_STATUS_MAPPING,
});

// 同 vendor 多模型同 taskKind 不撞：mapping 身份 = (vendor, taskKind, modelKey)，modelKey 区分。
export const RUNNINGHUB_3D_CURATED_MAPPINGS = [
  mk("seed-runninghub-hunyuan3d-text_to_3d", "text_to_3d", "hunyuan3d-v3.1", "混元3D v3.1 · 文生3D", HUNYUAN3D_T2_CREATE),
  mk("seed-runninghub-hunyuan3d-image_to_3d", "image_to_3d", "hunyuan3d-v3.1", "混元3D v3.1 · 图生3D", HUNYUAN3D_I2_CREATE),
  mk("seed-runninghub-hitem3d-image_to_3d", "image_to_3d", "hitem3d-v21", "HiTem3D v21 · 图生3D", HITEM3D_I2_CREATE),
  mk("seed-runninghub-meshy6-text_to_3d", "text_to_3d", "meshy6", "Meshy 6 · 文生3D", MESHY6_T2_CREATE),
  mk("seed-runninghub-meshy6-image_to_3d", "image_to_3d", "meshy6", "Meshy 6 · 图生3D", MESHY6_I2_CREATE),
];
