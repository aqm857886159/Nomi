// 厂商任务响应解析 —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 2 步）。
// 把各家 provider 返回的任意 JSON 结构按映射表抽取资产 URL / 状态 / 元数据。
// 纯函数、无副作用、最易出 bug ——本模块的核心价值就是为它补上 characterization 测试。
import { extractTaskId as extractTaskIdShared } from "../ai/requestPipeline";
import { firstString, isJsonRecord, readNestedRecord, trim, type JsonRecord } from "../jsonUtils";

export type { TaskStatus } from "../shared/taskStatus";
import type { TaskStatus } from "../shared/taskStatus";
import { classifyUpstreamTaskStatus } from "../shared/taskStatus";

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
      value.model_url,
      value.output_url,
      value.thumbnailUrl,
    ].flatMap(collectAssetUrls);
  }
  return [];
}

/**
 * 状态归一的完整结论。
 *
 * `unrecognizedStatus` 是本类型存在的理由：旧版只返回 `TaskStatus`，于是「上游说排队中」和
 * 「上游说了个我们不认得的词」**被压成同一个 `queued`**。而 `queued` 对三条轮询循环都是
 * 「再查一次」的指令 —— 上游已经返回 `failure`/`rejected` 时，系统读成「还在排队」，
 * 把预算烧完也没把真因报给用户（用户看到的就是「永远转圈」）。
 * 分出这个字段 = 让「不知道」不再冒充「排队中」，判定交给 tasks/taskResultQuery 的有界容忍规则。
 */
export type TaskStatusResolution = {
  status: TaskStatus;
  /**
   * 上游确实给了、但所有映射表 + 通用词表都不认得的**原始动词**（保留大小写原样，供诊断与报错）。
   * 空串 = 认得，**或**上游压根没给状态（后者是正常的排队，例如 create 只回 task_id ——
   * 这两者必须分开，否则每个同步/首调响应都会被误计为「未知」，是不误伤的第一道保险）。
   */
  unrecognizedStatus: string;
};

/** 归一状态的**唯一实现**（`taskStatusFromResponse` 只是它的取值投影，不是第二套）。 */
export function resolveTaskStatus(response: unknown, responseMapping: JsonRecord | null, statusMapping: Record<string, string[]> | undefined, assetUrls: string[]): TaskStatusResolution {
  const mappedStatus = firstMappedString(response, responseMapping, "status");
  const rawStatus = firstString(
    mappedStatus,
    isJsonRecord(response) ? response.status : "",
    isJsonRecord(response) ? readNestedRecord(response, ["data", "status"]) : "",
    isJsonRecord(response) ? readNestedRecord(response, ["choices", "0", "finish_reason"]) : "",
  );
  const fallbackStatus = rawStatus.toLowerCase();
  const recognized = (status: TaskStatus): TaskStatusResolution => ({ status, unrecognizedStatus: "" });
  const sm = statusMapping || {};
  for (const status of ["queued", "running", "succeeded", "failed"] as const) {
    const values = Array.isArray(sm[status]) ? sm[status] : [];
    if (values.map((item) => String(item).toLowerCase()).includes(fallbackStatus)) return recognized(status);
  }
  // 通用状态词表（供应商无关）：全仓唯一一份 shared/taskStatus，引擎 B 与这里问的是同一张表
  // （#1213：四张表各漏不同的词，同一个上游动词在画布与制作 Run 里被判成两样）。
  const vocabulary = classifyUpstreamTaskStatus(fallbackStatus);
  if (vocabulary === "queued" || vocabulary === "running" || vocabulary === "succeeded") return recognized(vocabulary);
  if (vocabulary === "failed" || vocabulary === "cancelled") return recognized("failed");
  // 词表都没认出来 → 先看有没有**硬证据**能定案（有产物=成了、有 error 字段=挂了）。
  // 硬证据比动词可信，且能定案就不算「不知道」，故不标 unrecognizedStatus。
  if (assetUrls.length > 0) return recognized("succeeded");
  if (isJsonRecord(response) && (response.error || readNestedRecord(response, ["data", "error"]))) return recognized("failed");
  // 真·不知道。仍返回 queued（保持「继续轮询」的乐观行为，绝不一见未知就判死 —— 未知动词
  // 也可能表示「进行中」，立刻判死会误杀**已付费**的生成）。但把原始动词带出去，让
  // taskResultQuery 能在「连续多次 + 超过宽限期」后判失败并如实报出这个词。
  return { status: "queued", unrecognizedStatus: rawStatus };
}

/** 只要状态、不关心动词是否认得时的取值投影（解析逻辑单一真相在 `resolveTaskStatus`）。 */
export function taskStatusFromResponse(response: unknown, responseMapping: JsonRecord | null, statusMapping: Record<string, string[]> | undefined, assetUrls: string[]): TaskStatus {
  return resolveTaskStatus(response, responseMapping, statusMapping, assetUrls).status;
}

/** 各家把失败原因塞进的字段名（无序扫描用）。含 kie 的 failMsg、runninghub 的 errorMessage。 */
const FAILURE_TEXT_KEYS = [
  "error_message",
  "errorMessage",
  "failMsg",
  "fail_reason",
  "failureReason",
  "message",
  "detail",
  "reason",
] as const;
/** 递归下钻的容器字段（`error` 必须在内——它常是对象 `{code,message}`，不是字符串）。 */
const FAILURE_NEST_KEYS = ["error", "data", "raw", "response", "result", "output", "errors"] as const;
/** 成功态占位词：`{code:200,message:"success",data:{…}}` 这种包裹别被当成失败原因报给用户。 */
const NON_FAILURE_TEXTS = new Set(["success", "succeeded", "ok", "done", "成功", "完成"]);

function failureTextByShape(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  const node = maybeParseJsonString(value);
  if (typeof node === "string") {
    const text = node.trim();
    return NON_FAILURE_TEXTS.has(text.toLowerCase()) ? "" : text;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = failureTextByShape(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (!isJsonRecord(node)) return "";
  for (const key of FAILURE_TEXT_KEYS) {
    const text = trim(node[key]);
    if (text && !NON_FAILURE_TEXTS.has(text.toLowerCase())) return text;
  }
  for (const key of FAILURE_NEST_KEYS) {
    if (!(key in node)) continue;
    const found = failureTextByShape(node[key], depth + 1);
    if (found) return found;
  }
  return "";
}

/**
 * 终态失败的**真实原因**（唯一读点）。
 *
 * 病根（2026-07-30 用户真机报「模型任务执行失败 (taskId=…, kind=text_to_image)」）：16 份 profile 的
 * `response_mapping.error_message` 声明了失败原因在哪（apimart `data.error.message` / kie `data.failMsg` /
 * runninghub `errorMessage` / modelscope `errors.message` …），但**全程没有任何一处读它**——声明即死代码。
 * 渲染层只好自己按形状猜，且猜不到 failMsg/errorMessage 这类家族专属字段，于是所有 vendor 的终态失败
 * 统统退化成一句「模型任务执行失败 + taskId」：用户看不到能行动的信息，我们也拿不到真原因。
 *
 * 顺序：① profile 声明的映射（每家自己的路径，权威）→ ② 映射没声明/没取到才按常见形状下钻。
 * 两层都在这一个函数里，渲染层不再自己解析（删掉了那份猜形状的副本）。
 *
 * 上游 JSON 常被当字符串二次嵌套（apimart 把 Google 的 `{"error":{"code":404,…}}` 整个塞进
 * `data.error.message`），故取到文本后再解一层——否则用户看到的是一坨转义 JSON 而非「Requested
 * entity was not found.」。
 */
export function taskFailureMessageFromResponse(response: unknown, responseMapping: JsonRecord | null): string {
  const mapped = firstMappedString(response, responseMapping, "error_message");
  const text = mapped || failureTextByShape(response);
  if (!text) return "";
  return failureTextByShape(text) || text;
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
