/**
 * 「拉模型列表」探测原语（领域层，不含 IPC）。
 *
 * 三处共用同一条实现（P1 不各写一份）：
 *  - 接入向导的 list-models（用户手填地址+key 后拉清单）
 *  - 接入向导「测试连接」的可达性探测（probe: 'reachability'）
 *  - 供应商连接健康自动检查（vendorHealth，主进程按 vendorKey 自取凭证）
 *
 * 从 onboardingIpc.ts 移出——那份是 IPC 面，这份是领域原语（R9 分层）。
 */
import type { AiSdkProviderKind } from "../../catalog/types";
import { isJsonRecord, pickUpstreamMessage } from "../../jsonUtils";
import { parseModelListResponse } from "./modelListResponse";

export async function describeNetworkErrorLazy(error: unknown): Promise<string> {
  const { describeNetworkError } = await import("../../systemProxy");
  return describeNetworkError(error);
}

/** 上游失败体 → 那句人话。键优先级表住 jsonUtils（全仓唯一），挑不出来才退回原文/HTTP 码。 */
export function upstreamErrorText(bodyText: string, status: number): string {
  let parsed: unknown;
  try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { parsed = null; }
  const said = isJsonRecord(parsed) ? pickUpstreamMessage(parsed) : "";
  return said || bodyText.trim().slice(0, 300) || `HTTP ${status}`;
}

/** payload.headers（用户自填的中转请求头）→ 干净的 kv。 */
export function readExtraHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = String(k).trim();
      const value = String(v ?? "").trim();
      if (key && value) out[key] = value;
    }
  }
  return out;
}

/** 按协议给鉴权头（anthropic 用 x-api-key + 版本；其余 Bearer）。拉模型/可达性探测共用。 */
export function buildAuthHeaders(
  providerKind: AiSdkProviderKind,
  apiKey: string,
  extraHeaders: Record<string, string>,
): Record<string, string> {
  return providerKind === "anthropic"
    ? { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}), ...extraHeaders }
    : { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
}

export type ModelListResult =
  | { ok: true; models: string[]; statuses: number[] }
  | { ok: false; status?: number; error: string; statuses: number[] };

/**
 * 拉这个上游开放的模型列表。候选 URL：openai-compatible 的 baseUrl 通常已含 /v1 → /models；
 * 但很多 new-api 后台给的是**裸地址**——那样 /models 会 404 或（更坑）被后台 SPA 200 回一页
 * index.html。所以依次试 /models 与 /v1/models，且**命中判据是「解析得出模型列表」而不是
 * 「HTTP 200」**（只看 200 会被 SPA 骗到提前收工，真正对的 /v1/models 永远轮不到）。
 *
 * `statuses` 收集**每个候选**的 HTTP 码，供调用方区分「这家没有这个端点」（全 404/405）
 * 与「凭证不对」（任一 401/403）——只看 lastStatus 会漏：/models 回 401、/v1/models 回 404 时
 * 末位是 404，据此判「不支持」就把真正的 key 失效吞掉了。
 */
export async function fetchModelList(
  providerKind: AiSdkProviderKind,
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  options: { query?: Record<string, string> } = {},
): Promise<ModelListResult> {
  const rawCandidates =
    providerKind === "anthropic"
      ? [`${baseUrl}/v1/models`]
      : [`${baseUrl}/models`, `${baseUrl}/v1/models`];
  const candidates = rawCandidates.map((candidate) => {
    const query = options.query || {};
    if (Object.keys(query).length === 0) return candidate;
    const url = new URL(candidate);
    for (const [key, value] of Object.entries(query)) {
      if (key && value) url.searchParams.set(key, value);
    }
    return url.toString();
  });
  let lastErr = "";
  let lastStatus: number | undefined;
  const statuses: number[] = [];
  // 某候选回了「合法但空」的列表：先记下，仍继续试下一个候选（可能那个才有货）；全试完还是空，
  // 才如实报「这个地址确实没列出模型」。
  let sawEmptyList = false;
  for (const url of candidates) {
    let res: Response;
    try { res = await fetch(url, { method: "GET", headers, signal }); }
    catch (e) { lastErr = await describeNetworkErrorLazy(e); continue; }
    statuses.push(res.status);
    const text = await res.text().catch(() => "");
    if (!res.ok) { lastStatus = res.status; lastErr = upstreamErrorText(text, res.status); continue; }
    const models = parseModelListResponse(text);
    if (models === null) { lastStatus = res.status; lastErr = `${url} 返回的不是模型列表（像是网页）`; continue; }
    if (models.length === 0) { sawEmptyList = true; continue; }
    return { ok: true, models, statuses };
  }
  if (sawEmptyList) return { ok: true, models: [], statuses };
  return { ok: false, status: lastStatus, error: lastErr || "拉取不到模型列表", statuses };
}
