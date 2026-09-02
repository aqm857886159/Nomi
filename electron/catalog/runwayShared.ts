/**
 * Runway 目录的共享底座 —— 三个 kind（video / image / audio）的目录构建都用这几件：
 * 请求头、任务轮询/取件两段、状态映射、mapping 工厂、以及 `RunwayModel` 形状。
 *
 * **为什么单独一个文件**：图像目录 2026-09-02 从 runwayOfficial.ts 拆出（R9 巨壳门岗）后，
 * 两边都要用这些原语。若让 runwayImage.ts 反向 import runwayOfficial.ts 就会形成静态硬环
 * （check:boundaries 的 no-new-static-circular 当场报红，且那是真的加载顺序炸弹）。
 * 依赖反转到这个**双方共同的下游**，环自然消失。
 */
import type { HttpOperation, ProfileKind } from "./types";

export const RUNWAY_HEADERS = {
  Authorization: "Bearer {{user_api_key}}",
  "X-Runway-Version": "2024-11-06",
  "Content-Type": "application/json",
};

export const POLL_HEADERS = { Authorization: "Bearer {{user_api_key}}", "X-Runway-Version": "2024-11-06" };

export const STATUS: Record<string, string[]> = {
  queued: ["PENDING", "THROTTLED"],
  running: ["RUNNING"],
  succeeded: ["SUCCEEDED"],
  failed: ["FAILED", "CANCELLED", "CANCELED"],
};

export function runwayUriArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

const poll: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", video_url: "output.0", error_message: "failure" },
};

const result: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", assets: "output", error_message: "failure" },
};

export const runwayImagePoll: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", image_url: "output.0", error_message: "failure" },
};

export const runwayImageResult: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", assets: "output", error_message: "failure" },
};

export const runwayMapping = (id: string, modeId: string, taskKind: ProfileKind, name: string, createOp: HttpOperation) => ({
  id,
  modeId,
  taskKind,
  name,
  create: createOp,
  query: poll,
  result,
  statusMapping: STATUS,
});

export type RunwayModel = {
  modelKey: string;
  labelZh: string;
  kind: "video" | "image" | "audio";
  archetypeId: string;
  mappings: Array<{ id: string; modeId: string; taskKind: ProfileKind; name: string; create: HttpOperation; query: HttpOperation; result: HttpOperation; statusMapping: Record<string, string[]> }>;
};
