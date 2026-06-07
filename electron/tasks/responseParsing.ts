// 厂商任务响应解析 —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 2 步）。
// 把各家 provider 返回的任意 JSON 结构按映射表抽取资产 URL / 状态 / 元数据。
// 纯函数、无副作用、最易出 bug ——本模块的核心价值就是为它补上 characterization 测试。
import { extractTaskId as extractTaskIdShared } from "../ai/requestPipeline";
import { firstString, isJsonRecord, readNestedRecord, type JsonRecord } from "../jsonUtils";

/** 与 runtime 的 TaskResult["status"] 结构等价，解耦类型依赖。 */
export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export function maybeParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

export function pathValues(input: unknown, expression: string): unknown[] {
  const parts = expression.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown[] = [input];
  for (const part of parts) {
    const wildcard = part.endsWith("[*]");
    const key = wildcard ? part.slice(0, -3) : part;
    const next: unknown[] = [];
    for (const rawItem of current) {
      const item = maybeParseJsonString(rawItem);
      let value: unknown;
      if (/^\d+$/.test(key) && Array.isArray(item)) {
        value = item[Number(key)];
      } else if (key && isJsonRecord(item)) {
        value = item[key];
      } else {
        value = item;
      }
      if (wildcard) {
        const parsed = maybeParseJsonString(value);
        if (Array.isArray(parsed)) next.push(...parsed);
      } else if (typeof value !== "undefined") {
        next.push(value);
      }
    }
    current = next;
  }
  return current;
}

export function mappingCandidates(mapping: JsonRecord | null, key: string): string[] {
  const raw = mapping?.[key];
  if (Array.isArray(raw)) return raw.map((item) => String(item || "").trim()).filter(Boolean);
  const direct = firstString(raw);
  return direct ? [direct] : [];
}

export function valuesFromMapping(response: unknown, mapping: JsonRecord | null, key: string): unknown[] {
  return mappingCandidates(mapping, key).flatMap((candidate) => pathValues(response, candidate));
}

export function firstMappedString(response: unknown, mapping: JsonRecord | null, key: string): string {
  return firstString(...valuesFromMapping(response, mapping, key));
}

export function collectAssetUrls(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return /^(https?:\/\/|data:|nomi-local:\/\/)/i.test(text) ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectAssetUrls);
  if (isJsonRecord(value)) {
    return [
      value.url,
      value.video_url,
      value.image_url,
      value.output_url,
      value.thumbnailUrl,
    ].flatMap(collectAssetUrls);
  }
  return [];
}

export function taskStatusFromResponse(response: unknown, responseMapping: JsonRecord | null, statusMapping: Record<string, string[]> | undefined, assetUrls: string[]): TaskStatus {
  const mappedStatus = firstMappedString(response, responseMapping, "status");
  const fallbackStatus = firstString(
    mappedStatus,
    isJsonRecord(response) ? response.status : "",
    isJsonRecord(response) ? readNestedRecord(response, ["data", "status"]) : "",
    isJsonRecord(response) ? readNestedRecord(response, ["choices", "0", "finish_reason"]) : "",
  ).toLowerCase();
  const sm = statusMapping || {};
  for (const status of ["queued", "running", "succeeded", "failed"] as const) {
    const values = Array.isArray(sm[status]) ? sm[status] : [];
    if (values.map((item) => String(item).toLowerCase()).includes(fallbackStatus)) return status;
  }
  // 通用状态词表（供应商无关）。kie 用 waiting/generating/fail，故并入默认 —— 让所有走这套
  // 动词的供应商无需各自声明 statusMapping（避免每家一份并行映射）。
  if (["queued", "pending", "waiting", "in_queue", "starting"].includes(fallbackStatus)) return "queued";
  if (["running", "processing", "in_progress", "generating"].includes(fallbackStatus)) return "running";
  if (["succeeded", "success", "completed", "complete", "done", "stop", "length"].includes(fallbackStatus)) return "succeeded";
  if (["failed", "fail", "error", "timeout", "expired", "canceled", "cancelled"].includes(fallbackStatus)) return "failed";
  if (assetUrls.length > 0) return "succeeded";
  if (isJsonRecord(response) && (response.error || readNestedRecord(response, ["data", "error"]))) return "failed";
  return "queued";
}

export function providerMetaFromResponse(response: unknown, mapping: JsonRecord | null): JsonRecord {
  const meta: JsonRecord = {};
  if (mapping) {
    for (const key of Object.keys(mapping)) {
      const value = firstMappedString(response, mapping, key);
      if (value) meta[key] = value;
    }
  }
  const taskId = firstString(meta.query_id, meta.task_id, extractTaskIdShared(response));
  if (taskId) {
    meta.query_id = meta.query_id || taskId;
    meta.task_id = meta.task_id || taskId;
  }
  return meta;
}
