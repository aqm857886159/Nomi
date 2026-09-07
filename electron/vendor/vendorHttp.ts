// vendor HTTP 出口(harness S4-0):从 runtime.ts(807/807 零余量)拆出,同时修
// 「错误压扁」根因(P2)——此前 throw 时把 httpStatus/逻辑码/上游消息全压成一个字符串,
// 下游 classifyGenerationError 只能正则反猜。现在错误在抛出那一刻保留结构:
// 下游(人话错误卡/事件日志/分类)读 structured,字符串 message 仅供展示兜底。
import {
  type AuthType,
  appendQueryParams,
  authQueryParams as buildAuthQueryParams,
  collectRequestSecretValues,
  looksLikeLogicalError,
  redactRequestSecrets,
} from "../ai/requestPipeline";
import { describeIllegalHeader, findIllegalHeader, isJsonRecord, pickUpstreamMessage } from "../jsonUtils";
import { fetchVendorWithBaseFallback } from "./vendorBaseFallback";
import type { Vendor } from "../catalog/types";
import { networkFailureDetails, redactNetworkMessage, safeNetworkUrl } from "../networkErrorDetails";
import { BoundedResponseError, readBoundedResponseBytes } from "./boundedResponse";
import { providerDispatcher } from "../providerNetwork";
import { authorizeSubmitDestination } from "./vendorOutboundGuard";

export type VendorErrorCategory = "auth" | "balance" | "quota" | "input" | "server" | "network" | "timeout" | "unknown";

// 单次 vendor HTTP 请求的硬超时（堵无界阻塞 P2 根因：此前裸 fetch 无 timeout，vendor 一 hang
// 整条生成链 await 死，外部 MCP 端跟着永久转圈）。一次往返足够慢的同步图生成也走得完；异步 vendor
// 首调返 queued 后由 core.ts 轮询循环（240s/300s）接管，故这里只兜「单次请求别永久挂死」。
// 可经 NOMI_VENDOR_HTTP_TIMEOUT_MS 调（大模型同步出图慢可调大）。
const DEFAULT_VENDOR_HTTP_TIMEOUT_MS = 120_000;
export const DEFAULT_VENDOR_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_VENDOR_RESPONSE_MAX_BYTES = Math.ceil((25 * 1024 * 1024 * 4) / 3) + 1024 * 1024;

export type BinaryVendorResponse = {
  bytes: Buffer;
  contentType: string;
};

export function vendorResponseLimitForKind(kind: string): number {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "model3d"
    ? MEDIA_VENDOR_RESPONSE_MAX_BYTES
    : DEFAULT_VENDOR_RESPONSE_MAX_BYTES;
}

function vendorHttpTimeoutMs(): number {
  const raw = Number(process.env.NOMI_VENDOR_HTTP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VENDOR_HTTP_TIMEOUT_MS;
}

function callerCancellation(signal?: AbortSignal): Error | null {
  if (!signal?.aborted) return null;
  if (signal.reason instanceof Error) return signal.reason;
  return new Error("Provider request cancelled");
}

export type VendorErrorStructured = {
  vendorKey: string;
  method: string;
  url: string;
  httpStatus?: number;
  logicalCode?: number | string;
  /** 上游原话,截 256(防日志爆炸,§4.3)。 */
  upstreamMsg: string;
  /** 查表分类,不是猜:401/403→auth,402→balance,429→quota,400/422→input,5xx→server。 */
  category: VendorErrorCategory;
  retryable: boolean;
  reasonCode?: "response_timeout";
};

export class VendorRequestError extends Error {
  readonly structured: VendorErrorStructured;
  constructor(message: string, structured: VendorErrorStructured) {
    super(message);
    this.name = "VendorRequestError";
    this.structured = structured;
  }
}

/**
 * Electron IPC 的 promise rejection 只保留 message 字符串(自定义字段全丢)。
 * structured 经 base64 标记嵌进 message 穿过 IPC;渲染层配对解析器:
 * src/workbench/generationCanvas/runner/vendorErrorIpc.ts(双端常量,改一处必改另一处)。
 */
export const VENDOR_ERROR_IPC_MARKER = "NOMI_VENDOR_ERR_B64::";

export function encodeVendorErrorMessage(error: VendorRequestError): string {
  const b64 = Buffer.from(JSON.stringify(error.structured), "utf8").toString("base64");
  return `${VENDOR_ERROR_IPC_MARKER}${b64}:: ${error.message}`;
}

/** 状态码→类别查表(数字逻辑码与 HTTP 状态同表)。 */
export function categorizeVendorFailure(
  httpStatus?: number,
  logicalCode?: number | string,
): { category: VendorErrorCategory; retryable: boolean } {
  const code = typeof httpStatus === "number" ? httpStatus : typeof logicalCode === "number" ? logicalCode : Number(logicalCode);
  if (!Number.isFinite(code)) return { category: "network", retryable: true };
  if (code === 401 || code === 403) return { category: "auth", retryable: false };
  if (code === 402) return { category: "balance", retryable: false };
  if (code === 429) return { category: "quota", retryable: true };
  if (code === 400 || code === 422) return { category: "input", retryable: false };
  // 厂商业务码（≥1000，非 HTTP 状态码，如 RunningHub 1014/1007/1001）：是应用级拒绝（鉴权档/缺参/路径），
  // 重试无意义 → 非 retryable。放在 ≥500 之前，免被误判成「服务端可重试」白白重试几次。
  if (typeof httpStatus !== "number" && code >= 1000) return { category: "input", retryable: false };
  if (code >= 500) return { category: "server", retryable: true };
  return { category: "unknown", retryable: false };
}

/** Vendor→primitive 鉴权 query 适配(从 runtime 迁来,全仓唯一)。 */
export function authQueryParams(vendor: Vendor, apiKey: string): Record<string, string> {
  return buildAuthQueryParams(vendor.authType as AuthType, apiKey, vendor.authQueryParam ?? undefined);
}

/**
 * 付费生成提交的共享传输核（JSON 与 multipart 两条 wire 同源，P1 不建并行版）：请求头守卫 → 超时 fetch →
 * 读体 → 逻辑错误信封识别 → 分诊抛 VendorRequestError。`bodyInit` 已是 fetch 可直发的形态
 * （字符串 JSON / FormData / undefined），本核不再关心 body 是什么形状。
 */
async function requestVendor(
  vendor: Vendor,
  apiKey: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  bodyInit: BodyInit | undefined,
  signal?: AbortSignal,
  maxResponseBytes = DEFAULT_VENDOR_RESPONSE_MAX_BYTES,
  responseKind: "json" | "binary" = "json",
): Promise<unknown | BinaryVendorResponse> {
  const requestAuthQuery = authQueryParams(vendor, apiKey);
  const finalUrl = appendQueryParams(url, { ...requestAuthQuery, ...query });
  const diagnosticUrl = safeNetworkUrl(url);
  const upperMethod = method.toUpperCase();
  const hasBody = bodyInit != null;
  // Error payloads are untrusted: upstreams regularly echo credentials in
  // message/detail fields. Exact values from this concrete request are the
  // primary boundary; redactNetworkMessage's format/query regexes remain a
  // defense-in-depth fallback. Redaction happens before any slice, throw, IPC,
  // run persistence, or UI projection can observe the value.
  const requestSecrets = collectRequestSecretValues({ apiKey, headers, authQuery: requestAuthQuery, query });
  const redactRequestMessage = (message: string, maximumLength = 8_192) =>
    redactNetworkMessage(
      redactRequestSecrets(message, requestSecrets),
      [],
      maximumLength,
    );
  // 发送前请求头守卫：fetch 遇到码点 > 255 的头值会同步抛 ByteString 错，被下面 catch
  // 误判成「网络超时」让用户白查网络（最常见来源=密钥混进中文/全角字符）。在这里先识别，
  // 抛 auth 类（不可重试）+ 说人话的 upstreamMsg，让错误卡指向「重新粘贴密钥」而非网络。
  const headerProblem = findIllegalHeader(headers);
  if (headerProblem) {
    const { isAuth, message: upstreamMsg } = describeIllegalHeader(headerProblem);
    throw new VendorRequestError(`Provider request rejected (invalid header) at ${vendor.key} ${upperMethod} ${diagnosticUrl}: ${upstreamMsg}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url: diagnosticUrl,
      upstreamMsg,
      category: isAuth ? "auth" : "input",
      retryable: false,
    });
  }
  const timeoutMs = vendorHttpTimeoutMs();
  const networkMessage = (error: unknown) => redactRequestMessage(
    networkFailureDetails(error)?.message ?? (error instanceof Error ? error.message : String(error)),
    256,
  );
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Provider response timeout", "TimeoutError")), timeoutMs);
  const dispatcher = providerDispatcher(vendor);
  // ── 出站策略：提交侧与取回侧问**同一个** owner、读同一份进程内环境事实 ────────────────
  // 判据跑在这里而不是更下面，是因为「不扣费」这条承诺就是靠位置成立的：refusal 抛在
  // fetchVendorWithBaseFallback 之前，请求一个字节都没离开本机，供应商不可能计费
  // （与 vendorBaseFallback 文件头第 3 条同一个道理：连接未建立 ⇒ 不可能已计费）。
  const submitRefusal = await authorizeSubmitDestination({ vendor, url: finalUrl, routedThroughProviderProxy: Boolean(dispatcher) });
  if (submitRefusal) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
    if (dispatcher) void dispatcher.close().catch(() => undefined);
    throw new VendorRequestError(`Provider request refused by outbound policy at ${vendor.key} ${upperMethod} ${diagnosticUrl}: ${submitRefusal}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url: diagnosticUrl,
      upstreamMsg: submitRefusal,
      // network 类但**不可重试**：同一个目的地重试一万次都是同一堵墙，而这堵墙在本机。
      category: "network",
      retryable: false,
    });
  }
  let response: Response;
  try {
    // 经 vendorBaseFallback：主域被墙（连接从未建立）→ 零额度探测官方备用域 → 换线重发一次。
    // 仅连接层安全码触发重发，「重试绝不包住付费提交」铁律不破（见 vendorBaseFallback 文件头）。
    response = await fetchVendorWithBaseFallback(finalUrl, {
      method: upperMethod,
      headers,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
      ...(hasBody ? { body: bodyInit } : {}),
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
    if (dispatcher) void dispatcher.close().catch(() => undefined);
    const cancellation = callerCancellation(signal);
    if (cancellation) throw cancellation;
    // abort = 我们的超时，给一条说人话的 timeout 错误（仍归 network 类、可重试），而不是裸 "aborted"。
    const aborted = (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
      || (error instanceof BoundedResponseError && error.code === "response_timeout");
    const upstreamMsg = aborted
      ? `请求超时（${Math.round(timeoutMs / 1000)}s 无响应）`
      : networkMessage(error);
    throw new VendorRequestError(`Provider request failed (network) at ${vendor.key} ${upperMethod} ${diagnosticUrl}: ${upstreamMsg}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url: diagnosticUrl,
      upstreamMsg,
      category: "network",
      retryable: true,
    });
  }
  // 超时同样覆盖响应体读取（vendor 可能接了连接却 hang 在 body 上）；读完才清 timer。
  let bytes: Buffer;
  try {
    bytes = await readBoundedResponseBytes(response, { maxBytes: maxResponseBytes, signal: controller.signal });
  } catch (error: unknown) {
    const cancellation = callerCancellation(signal);
    if (cancellation) throw cancellation;
    if (error instanceof BoundedResponseError && error.code === "response_timeout") {
      const upstreamMsg = `读取响应超时（${Math.round(timeoutMs / 1000)}s）`;
      throw new VendorRequestError(`Provider request failed (timeout) at ${vendor.key} ${upperMethod} ${diagnosticUrl}: ${upstreamMsg}`, {
        vendorKey: vendor.key,
        method: upperMethod,
        url: diagnosticUrl,
        upstreamMsg,
        category: "timeout",
        retryable: true,
        reasonCode: "response_timeout",
      });
    }
    if (error instanceof BoundedResponseError && error.code === "response_too_large") {
      const upstreamMsg = "Provider response exceeded the safe size limit";
      throw new VendorRequestError(`Provider request failed (response limit) at ${vendor.key} ${upperMethod} ${diagnosticUrl}: ${upstreamMsg}`, {
        vendorKey: vendor.key,
        method: upperMethod,
        url: diagnosticUrl,
        upstreamMsg,
        category: "network",
        retryable: false,
      });
    }
    const aborted = error instanceof Error && error.name === "AbortError";
    const upstreamMsg = aborted
      ? `读取响应超时（${Math.round(timeoutMs / 1000)}s）`
      : networkMessage(error);
    throw new VendorRequestError(`Provider request failed (network) at ${vendor.key} ${upperMethod} ${diagnosticUrl}: ${upstreamMsg}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url: diagnosticUrl,
      upstreamMsg,
      category: "network",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
    // per-connection dispatcher 的连接池只属于本次请求；body 已缓冲读完，可安全退休。
    if (dispatcher) void dispatcher.close().catch(() => undefined);
  }
  const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const looksJson = contentType === "application/json"
    || contentType.endsWith("+json")
    || /^[\s]*(?:\[|\{)/.test(bytes.subarray(0, 64).toString("utf8"));
  const mustInspectText = responseKind === "json" || !response.ok || looksJson;
  const text = mustInspectText ? bytes.toString("utf8") : "";
  let json: unknown = null;
  if (mustInspectText) {
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
  }
  const record = isJsonRecord(json) ? json : {};
  // Many providers (kie.ai and other Java/Spring backends) return HTTP 200 with
  // a logical-error envelope `{ code: 4xx/5xx, msg/message: "..." }` instead of
  // a real error status. Treat that as a failure too, otherwise we'd hand a
  // body with no asset URL to the result builder and report a silent dud.
  const logicalCode = looksLikeLogicalError(record);
  if (!response.ok || logicalCode != null) {
    // 键优先级表住 jsonUtils.pickUpstreamMessage（全仓唯一，onboarding 拉模型/测连接同读一份）。
    const rawUpstream = pickUpstreamMessage(record, redactRequestMessage);
    const statusLabel = logicalCode != null ? `code ${logicalCode}` : `HTTP ${response.status}`;
    // "No message available" is Spring's default placeholder — surface the URL
    // and status so the failure is diagnosable instead of opaque.
    const detail = rawUpstream && rawUpstream !== "No message available" ? rawUpstream : `(no detail from provider)`;
    const { category, retryable } = categorizeVendorFailure(response.ok ? undefined : response.status, logicalCode ?? undefined);
    throw new VendorRequestError(`Provider request failed (${statusLabel}) at ${vendor.key} ${upperMethod} ${diagnosticUrl}: ${detail}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url: diagnosticUrl,
      ...(response.ok ? {} : { httpStatus: response.status }),
      ...(logicalCode != null ? { logicalCode } : {}),
      upstreamMsg: detail.slice(0, 256),
      category,
      retryable,
    });
  }
  return responseKind === "binary" ? { bytes, contentType } : json;
}

/** URL-in-JSON 提交（现有主路）：非 GET/HEAD 且有 body 时序列化成 JSON 发。 */
export async function requestJson(
  vendor: Vendor,
  apiKey: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  body: unknown,
  signal?: AbortSignal,
  options: { maxResponseBytes?: number } = {},
): Promise<unknown> {
  const upperMethod = method.toUpperCase();
  const hasBody = upperMethod !== "GET" && upperMethod !== "HEAD" && body != null;
  const bodyInit = hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined;
  return requestVendor(vendor, apiKey, upperMethod, url, headers, query, bodyInit, signal, options.maxResponseBytes, "json");
}

/** Byte-in-body submission for synchronous media endpoints, with the same error, redaction and timeout contract as JSON. */
export async function requestBinary(
  vendor: Vendor,
  apiKey: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  body: unknown,
  signal?: AbortSignal,
  options: { maxResponseBytes?: number } = {},
): Promise<BinaryVendorResponse> {
  const upperMethod = method.toUpperCase();
  const hasBody = upperMethod !== "GET" && upperMethod !== "HEAD" && body != null;
  const bodyInit = hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined;
  return requestVendor(
    vendor,
    apiKey,
    upperMethod,
    url,
    headers,
    query,
    bodyInit,
    signal,
    options.maxResponseBytes,
    "binary",
  ) as Promise<BinaryVendorResponse>;
}

/**
 * multipart/form-data 提交（OpenAI 官方 /v1/images/edits 图生图等二进制文件上传端点）。POST FormData，
 * **不设 Content-Type**（fetch 自动加 boundary，手动设会缺 boundary 令服务器 400）。响应解析/错误分诊
 * 与 requestJson 共享 requestVendor 核。
 */
export async function requestMultipart(
  vendor: Vendor,
  apiKey: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  form: FormData,
  signal?: AbortSignal,
  options: { maxResponseBytes?: number } = {},
): Promise<unknown> {
  const cleanHeaders = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== "content-type"),
  );
  return requestVendor(vendor, apiKey, "POST", url, cleanHeaders, query, form, signal, options.maxResponseBytes, "json");
}
