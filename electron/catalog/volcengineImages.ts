import type { HttpOperation, ProfileKind } from "./types";

// 火山 Seedream 图片传输配方（单源）。形状 100% 来自真实 API 验证（见 volcengineVendor.ts）。
// **同步**族：create 响应即结果（data[0].url），无 task_id / 无 query / 无 statusMapping
// ——runtime 见 response_mapping.image_url 有值即判 succeeded（同 apimart 音频同步族）。

const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

function seedreamCreateOp(): HttpOperation {
  return {
    method: "POST",
    path: "/api/v3/images/generations",
    headers: CREATE_HEADERS,
    // watermark:false 去掉火山默认的「AI生成」角标（真实验证：默认带角标，false 后干净）——创作工具默认要干净图。
    body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", size: "{{request.params.size}}", watermark: false },
    response_mapping: { image_url: "data.0.url" },
    // size 等档案默认由 archetypeWireDefaults 桥接兜底（runtime.ts，单一真相源=档案 seedreamVolcengine.ts）。
  };
}

export type VolcengineImageModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

/** 一个 Seedream 文生图模型（全 family 共用同步 create op + volcengine-seedream 档案）。 */
function seedreamModel(modelKey: string, labelZh: string, slug: string): VolcengineImageModel {
  return {
    modelKey,
    labelZh,
    archetypeId: "volcengine-seedream",
    mappings: [{
      id: `seed-volcengine-${slug}-text_to_image`,
      taskKind: "text_to_image",
      name: `${labelZh} · 文生图`,
      create: seedreamCreateOp(),
    }],
  };
}

// 声明火山 Seedream 全 family（目录式：谁开通谁能用，未开通调用明确报 ModelNotOpen）。
// 同步图片 API 形状一致（5.0 已真实 E2E 出图验证；4.x 同端点同契约）。modelKey 取自 Ark /api/v3/models。
// 3.0 已 Retiring，不放。Seedance 视频是异步族（另一形状），待单独接（见方案文档）。
export const VOLCENGINE_IMAGE_MODELS: VolcengineImageModel[] = [
  seedreamModel("doubao-seedream-5-0-260128", "Seedream 5.0 lite", "seedream-5"),
  seedreamModel("doubao-seedream-4-5-251128", "Seedream 4.5", "seedream-4-5"),
  seedreamModel("doubao-seedream-4-0-250828", "Seedream 4.0", "seedream-4-0"),
];
