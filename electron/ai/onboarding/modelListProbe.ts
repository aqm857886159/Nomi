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
import { appFetch } from "../../appFetch";
import {
  appendQueryParams,
  buildHttpRequest,
  type AuthType,
  type BuiltRequest,
} from "../requestPipeline";
import { describeIllegalHeader, findIllegalHeader, isJsonRecord, mergeHeadersCaseInsensitive, pickUpstreamMessage } from "../../jsonUtils";
import { parseModelListPage, type ModelListDescriptor, type ModelListFailureKind } from "./modelListResponse";
import { modelListErrorRedactor } from "./modelListSafety";
import { createExplicitProxyDispatcher } from "../../systemProxy";
import type { Dispatcher } from "undici";
export type { ModelListFailureKind } from "./modelListResponse";

export async function describeNetworkErrorLazy(error: unknown): Promise<string> {
  const { describeNetworkError } = await import("../../systemProxy");
  const reason = describeNetworkError(error);
  return `Network error: ${reason}. Next: check the relay URL, local network, and proxy settings, then retry.`;
}

/** 上游失败体 → 那句人话。键优先级表住 jsonUtils（全仓唯一），挑不出来才退回原文/HTTP 码。 */
function nextStepForUpstreamError(status: number, message: string): string {
  if (status === 401 || status === 403 || /api[_ -]?key|auth|forbidden|permission/i.test(message)) return 'check the API key, auth header, and relay permissions, then retry'
  if (status === 404 || status === 405) return 'check the saved base URL and that its /models route is enabled'
  if (status === 429) return 'wait for the provider rate limit to reset, then retry'
  if (status >= 500) return 'check the relay/provider status and retry when the upstream is healthy'
  return 'check the endpoint response and authentication settings, then retry'
}

/** Keep status, safe provider-body context, and a repair action together at the shared error boundary. */
export function upstreamErrorText(bodyText: string, status: number, sanitize?: (message: string) => string): string {
  let parsed: unknown;
  try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { parsed = null; }
  const said = isJsonRecord(parsed) ? pickUpstreamMessage(parsed, sanitize) : "";
  const rawBody = sanitize ? sanitize(bodyText.trim()) : bodyText.trim();
  const usableMessage = said && !/^no message available[.!]?$/i.test(said) ? said : '';
  const bodySummary = usableMessage || (rawBody ? 'provider returned no usable error message' : 'provider returned an empty error body');
  const safeSummary = bodySummary.slice(0, 220);
  return `HTTP ${status}: provider returned ${safeSummary}. Next: ${nextStepForUpstreamError(status, safeSummary)}.`.slice(0, 500);
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
  return mergeHeadersCaseInsensitive(
    providerKind === "anthropic"
      ? { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) }
      : { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    extraHeaders,
  );
}

export type ModelListResult =
  | { ok: true; models: string[]; descriptors?: ModelListDescriptor[]; statuses: number[]; partial?: boolean }
  | { ok: false; status?: number; error: string; statuses: number[]; failureKind?: ModelListFailureKind };

type Failure = Extract<ModelListResult, { ok: false }> & { failureKind: ModelListFailureKind };
const FAILURE_PRIORITY: Record<ModelListFailureKind, number> = {
  unsupported: 0, invalid_response: 1, upstream: 2, network: 3, rate_limit: 4, auth: 5,
};
const MAX_PAGES = 10;
const MAX_MODELS = 2000;

function failureKindForStatus(status: number): ModelListFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 404 || status === 405) return "unsupported";
  if (status >= 300 && status < 400) return "invalid_response";
  return "upstream";
}

export function buildModelListRequests(input: {
  providerKind: AiSdkProviderKind;
  baseUrl: string;
  authType: AuthType;
  apiKey: string;
  authHeader?: string;
  authQueryParam?: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
}): BuiltRequest[] {
  const { providerKind, baseUrl } = input;
  const base = new URL(baseUrl);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("Invalid API address");
  base.hash = "";
  const baseQuery = Object.fromEntries(base.searchParams);
  base.search = "";
  const path = base.pathname.replace(/\/+$/, "");
  const versioned = /\/v\d+(?:[a-z]+\d*)?$/i.test(path);
  const paths = /\/models$/i.test(path) ? ["/models"] : versioned ? ["/models"]
    : providerKind === "anthropic" ? ["/v1/models"] : ["/models", "/v1/models"];
  return paths.map((operationPath) => {
    const built = buildHttpRequest({
      baseUrl: base.toString(),
      authType: input.authType,
      authHeaderName: input.authHeader,
      authQueryParam: input.authQueryParam,
      apiKey: input.apiKey,
      context: {},
      operation: { method: "GET", path: operationPath, query: { ...baseQuery, ...(input.query || {}) } },
      extraHeaders: input.headers,
    });
    return { ...built, url: appendQueryParams(built.url, built.query) };
  });
}

function pageIdentity(url: URL): string {
  const canonical = new URL(url);
  canonical.searchParams.sort();
  return canonical.toString();
}

/**
 * 拉这个上游开放的模型列表。候选 URL：openai-compatible 的 baseUrl 通常已含 /v1 → /models；
 * 但很多 new-api 后台给的是**裸地址**——那样 /models 会 404 或（更坑）被后台 SPA 200 回一页
 * index.html。所以依次试 /models 与 /v1/models，且**命中判据是「解析得出模型列表」而不是
 * 「HTTP 200」**（只看 200 会被 SPA 骗到提前收工，真正对的 /v1/models 永远轮不到）。
 *
 * `statuses` 保留每次实际 HTTP 状态作诊断；`failureKind` 是调用方的唯一分类依据，
 * 因为业务错误能藏在 HTTP 200 中，网络异常又不产生 HTTP 状态。空列表不掩盖这些错误。
 */
export async function fetchModelList(
  providerKind: AiSdkProviderKind,
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  options: { query?: Record<string, string>; proxyUrl?: string } = {},
): Promise<ModelListResult> {
  const query = options.query || {};
  const redact = modelListErrorRedactor(baseUrl, headers, query);
  const statuses: number[] = [];
  const failure = (failureKind: ModelListFailureKind, error: string, status?: number): Failure => ({
    ok: false, failureKind, ...(status !== undefined ? { status } : {}), error: redact(error), statuses,
  });
  let dispatcher: Dispatcher | undefined;
  try {
    dispatcher = options.proxyUrl ? createExplicitProxyDispatcher(options.proxyUrl) : undefined;
  } catch (error) {
    return failure("invalid_response", error instanceof Error ? error.message : "Invalid provider proxy URL");
  }
  try {
    return await (async (): Promise<ModelListResult> => {
  const headerProblem = findIllegalHeader(headers);
  if (headerProblem) return failure("auth", describeIllegalHeader(headerProblem).message);
  let candidates: BuiltRequest[];
  try {
    candidates = buildModelListRequests({
      providerKind,
      baseUrl,
      authType: "none",
      apiKey: "",
      headers,
      query,
    });
  }
  catch { return failure("invalid_response", "Invalid API address"); }
  let strongest: Failure | undefined;
  const remember = (failed: Failure): Failure => {
    if (!strongest || FAILURE_PRIORITY[failed.failureKind] > FAILURE_PRIORITY[strongest.failureKind]) strongest = failed;
    return strongest;
  };
  let sawEmptyList = false;
  for (const candidate of candidates) {
    let url = new URL(candidate.url);
    const seenPages = new Set<string>();
    const models = new Set<string>();
    const descriptors = new Map<string, ModelListDescriptor>();
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      seenPages.add(pageIdentity(url));
      let res: Response;
      let body: string;
      let status: number | undefined;
      try {
        // Never auto-follow redirects with arbitrary gateway auth headers/query credentials.
        res = await appFetch(url.toString(), { method: candidate.method, headers: candidate.headers, signal, redirect: "manual", ...(dispatcher ? { dispatcher } : {}) });
        statuses.push(res.status);
        status = res.status;
        body = await res.text();
      } catch (error) {
        const failed = status === 401 || status === 403 || status === 429
          ? failure(failureKindForStatus(status), upstreamErrorText('', status, redact), status)
          : failure("network", await describeNetworkErrorLazy(error), status);
        const best = remember(failed);
        if (pageNumber > 0 || signal.aborted) return best;
        break;
      }
      if (!res.ok) {
        const failed = remember(failure(failureKindForStatus(res.status), upstreamErrorText(body, res.status, redact), res.status));
        if (pageNumber > 0) return failed;
        break;
      }
      const page = parseModelListPage(body, redact);
      if (!page.ok) {
        const failed = remember(failure(page.failureKind, upstreamErrorText(body, res.status, redact), res.status));
        if (pageNumber > 0) return failed;
        break;
      }
      for (const id of page.models) models.add(id);
      for (const descriptor of page.descriptors || []) descriptors.set(descriptor.id, descriptor);
      let next: URL | undefined;
      if (page.next || page.afterId) {
        try {
          next = page.next ? new URL(page.next, url) : new URL(url);
          if (page.afterId) next.searchParams.set("after_id", page.afterId);
          const candidateUrl = new URL(candidate.url);
          if (next.origin !== candidateUrl.origin || next.pathname !== candidateUrl.pathname || next.username || next.password || next.hash) {
            return remember(failure("invalid_response", "Unsafe model-list pagination link", res.status));
          }
          // Keep saved base/query authentication when next contains only its cursor.
          for (const [key, value] of candidateUrl.searchParams) if (!next.searchParams.has(key)) next.searchParams.set(key, value);
          for (const [key, value] of Object.entries(query)) if (key && value) next.searchParams.set(key, value);
          if (seenPages.has(pageIdentity(next))) return remember(failure("invalid_response", "Repeated model-list pagination cursor", res.status));
        } catch { return remember(failure("invalid_response", "Invalid model-list pagination link", res.status)); }
      }
      if (models.size > MAX_MODELS || (next && (models.size >= MAX_MODELS || pageNumber + 1 === MAX_PAGES))) {
        return { ok: true, models: [...models].slice(0, MAX_MODELS), ...(descriptors.size ? { descriptors: [...descriptors.values()].slice(0, MAX_MODELS) } : {}), statuses, partial: true };
      }
      if (next) { url = next; continue; }
      if (models.size > 0) return { ok: true, models: [...models], ...(descriptors.size ? { descriptors: [...descriptors.values()] } : {}), statuses };
      sawEmptyList = true;
      break;
    }
  }
  if (sawEmptyList && (!strongest || FAILURE_PRIORITY[strongest.failureKind] < FAILURE_PRIORITY.upstream)) {
    return { ok: true, models: [], statuses };
  }
  return strongest || failure("invalid_response", "Unable to retrieve a model list");
    })();
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}
