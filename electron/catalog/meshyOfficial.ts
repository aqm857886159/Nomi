import type { HttpOperation, ProfileKind } from "./types";

export const MESHY_VENDOR_SEED = {
  key: "meshy",
  name: "Meshy",
  baseUrl: "https://api.meshy.ai",
  authType: "bearer" as const,
  authHeader: "Authorization",
  assetIngestion: { strategy: "inline-base64" as const, accepts: ["image" as const] },
};

export const MESHY_7_CREATE: HttpOperation = {
  method: "POST",
  path: "/openapi/v1/image-to-3d",
  headers: { "Content-Type": "application/json" },
  body: {
    image_url: "{{request.params.image_url}}",
    model_type: "standard",
    ai_model: "meshy-7",
    topology: "{{request.params.topology}}",
    target_polycount: "{{request.params.target_polycount}}",
    should_texture: true,
    enable_pbr: "{{request.params.enable_pbr}}",
    target_formats: ["glb"],
  },
  response_mapping: { task_id: "result" },
  provider_meta_mapping: { task_id: "result" },
};

export const MESHY_7_QUERY: HttpOperation = {
  method: "GET",
  path: "/openapi/v1/image-to-3d/{{providerMeta.task_id}}",
  response_mapping: {
    task_id: "id",
    status: "status",
    model_url: "model_urls.glb",
    error_message: "task_error.message",
  },
};

export const MESHY_STATUS: Record<string, string[]> = {
  queued: ["PENDING"],
  running: ["IN_PROGRESS"],
  succeeded: ["SUCCEEDED"],
  failed: ["FAILED", "CANCELED", "CANCELLED", "EXPIRED"],
};

export const MESHY_MODELS = [{
  modelKey: "meshy-7",
  labelZh: "Meshy 7",
  kind: "model3d" as const,
  archetypeId: "meshy-7",
  mappings: [{
    id: "seed-meshy-7-image-to-3d",
    taskKind: "image_to_3d" as ProfileKind,
    name: "Meshy 7 · 单图生 3D",
    create: MESHY_7_CREATE,
    query: MESHY_7_QUERY,
    statusMapping: MESHY_STATUS,
  }],
}];
