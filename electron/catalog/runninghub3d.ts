// RunningHub 标准模型 API 接入（先垂直打通 3D：混元3D v3.1 文生3D）。
// RunningHub = aggregator（一个 key 解锁 355 个标准模型）；本文件先接 3D 这一片的混元文生3D，
// 验证传输打通 + 让画布 model3d 节点有真实可选模型。图生3D / HiTem / Meshy / 视频图片兼容集是后续增量。
//
// API 形状（实查官方文档 + 开源插件 HM-RunningHub/ComfyUI_RH_OpenAPI 的 core/task.py，非凭记忆）：
//   提交 POST /openapi/v2/{endpoint}（endpoint 逐字照官方 models_registry.json）
//   轮询 POST /openapi/v2/query，body {taskId}
//   鉴权 Authorization: Bearer <key>
//   状态 SUCCESS / FAILED / CANCEL / RUNNING / QUEUED / CREATE
//   完成 results:[{fileUrl, fileType:"glb"}]
// joinUrl 约定（避双前缀，见 kieSeedance 注释）：baseUrl 裸到 /openapi/v2，op.path = /{endpoint}。
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

// 轮询 op。任务响应是扁平 {taskId,status,results:[{fileUrl}]}（实查官方示例），但标准模型 API 别处
// （resource/list）用 {code,data} 信封 → 任务端点是否套信封文档/实测略有出入。故每个 key 给
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

// 混元3D v3.1 文生3D create（端点 + 参数逐字照官方 models_registry.json：prompt/faceCount/enablePbr/generateType，
// 输出 glb）。generateType 枚举官方未在注册表给值 → 不脑补、不发，服务端用默认（faceCount/enablePbr 是已知 INT/BOOLEAN）。
const HUNYUAN3D_TEXT_TO_3D_CREATE: HttpOperation = {
  method: "POST",
  path: "/hunyuan3d-v3.1/text-to-3d",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    prompt: "{{request.prompt}}",
    faceCount: "{{request.params.faceCount}}",
    enablePbr: "{{request.params.enablePbr}}",
  },
};

export const RUNNINGHUB_3D_MODEL_SEED = {
  modelKey: "hunyuan3d-v3.1",
  labelZh: "混元3D v3.1",
  kind: "model3d" as const,
  archetypeId: "hunyuan3d",
};

export const RUNNINGHUB_3D_CURATED_MODELS = [RUNNINGHUB_3D_MODEL_SEED];

export const RUNNINGHUB_3D_CURATED_MAPPINGS = [
  {
    id: "seed-runninghub-hunyuan3d-text_to_3d",
    vendorKey: RUNNINGHUB_VENDOR_SEED.key,
    taskKind: "text_to_3d" as ProfileKind,
    modelKey: "hunyuan3d-v3.1",
    name: "混元3D v3.1 · 文生3D",
    create: HUNYUAN3D_TEXT_TO_3D_CREATE,
    query: RUNNINGHUB_QUERY_OP,
    statusMapping: RUNNINGHUB_STATUS_MAPPING,
  },
];
