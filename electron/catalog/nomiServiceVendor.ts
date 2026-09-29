import type { HttpOperation, Mapping, Model } from "./types";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { APIMART_STATUS_MAPPING } from "./apimartVendor";

/** Nomi-service 本地中转：使用 Nomi-service 用户 token，不把 APIMart key 暴露给 Electron。 */
export const NOMI_SERVICE_VENDOR_SEED = {
  key: "nomi-service-local",
  name: "Nomi-service 本地中转",
  baseUrl: "http://127.0.0.1:8080",
  authType: "bearer" as const,
  authHeader: "Authorization",
  credentialMode: "direct-key" as const,
} as const;

const headers = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };
const query = (kind: "image" | "video"): HttpOperation => ({
  method: "GET",
  path: "/v1/apimart/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "task_id",
    status: "status",
    ...(kind === "image" ? { image_url: "image_url" } : { video_url: "video_url" }),
    error_message: "error",
  },
});

function localCreate(op: HttpOperation, kind: "image" | "video"): HttpOperation {
  return {
    ...op,
    path: kind === "image" ? "/v1/apimart/images/generations" : "/v1/apimart/videos/generations",
    headers,
  };
}

export const NOMI_SERVICE_CURATED_MODELS: Array<Pick<Model, "modelKey" | "labelZh" | "kind"> & { archetypeId?: string }> = [
  ...APIMART_IMAGE_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "image" as const, archetypeId: m.archetypeId })),
  ...APIMART_VIDEO_MODELS.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: "video" as const, archetypeId: m.archetypeId })),
];

export const NOMI_SERVICE_CURATED_MAPPINGS: Array<{
  id: string;
  taskKind: Mapping["taskKind"];
  modelKey: string;
  name: string;
  create: HttpOperation;
  query: HttpOperation;
  statusMapping: Mapping["statusMapping"];
}> = [
  ...APIMART_IMAGE_MODELS.flatMap((model) => model.mappings.map((mapping) => ({
    id: `seed-nomi-service-${mapping.id.replace(/^seed-apimart-/, "")}`,
    taskKind: mapping.taskKind,
    modelKey: model.modelKey,
    name: `${mapping.name} · 本地中转`,
    create: localCreate(mapping.create, "image"),
    query: query("image"),
    statusMapping: APIMART_STATUS_MAPPING,
  }))),
  ...APIMART_VIDEO_MODELS.flatMap((model) => model.mappings.map((mapping) => ({
    id: `seed-nomi-service-${mapping.id.replace(/^seed-apimart-/, "")}`,
    taskKind: mapping.taskKind,
    modelKey: model.modelKey,
    name: `${mapping.name} · 本地中转`,
    create: localCreate(mapping.create, "video"),
    query: query("video"),
    statusMapping: APIMART_STATUS_MAPPING,
  }))),
];
