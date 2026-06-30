// vendor HTTP 出口(harness S4-0):从 runtime.ts(807/807 零余量)拆出,同时修
// 「错误压扁」根因(P2)——此前 throw 时把 httpStatus/逻辑码/上游消息全压成一个字符串,
// 下游 classifyGenerationError 只能正则反猜。现在错误在抛出那一刻保留结构:
// 下游(人话错误卡/事件日志/分类)读 structured,字符串 message 仅供展示兜底。
import {
  type AuthType,
  appendQueryParams,
  authQueryParams as buildAuthQueryParams,
  looksLikeLogicalError,
} from "../ai/requestPipeline";
import { describeIllegalHeader, findIllegalHeader, firstString, isJsonRecord, readNestedRecord } from "../jsonUtils";
import type { Vendor } from "../catalog/types";

export type VendorErrorCategory = "auth" | "balance" | "quota" | "input" | "server" | "network" | "unknown";

// 单次 vendor HTTP 请求的硬超时（堵无界阻塞 P2 根因：此前裸 fetch 无 timeout，vendor 一 hang
// 整条生成链 await 死，外部 MCP 端跟着永久转圈）。一次往返足够慢的同步图生成也走得完；异步 vendor
// 首调返 queued 后由 core.ts 轮询循环（240s/300s）接管，故这里只兜「单次请求别永久挂死」。
// 可经 NOMI_VENDOR_HTTP_TIMEOUT_MS 调（大模型同步出图慢可调大）。
const DEFAULT_VENDOR_HTTP_TIMEOUT_MS = 120_000;

function vendorHttpTimeoutMs(): number {
  const raw = Number(process.env.NOMI_VENDOR_HTTP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VENDOR_HTTP_TIMEOUT_MS;
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
  if (code >= 500) return { category: "server", retryable: true };
  return { category: "unknown", retryable: false };
}

/** Vendor→primitive 鉴权 query 适配(从 runtime 迁来,全仓唯一)。 */
export function authQueryParams(vendor: Vendor, apiKey: string): Record<string, string> {
  return buildAuthQueryParams(vendor.authType as AuthType, apiKey, vendor.authQueryParam ?? undefined);
}

export async function requestJson(
  vendor: Vendor,
  apiKey: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  body: unknown,
): Promise<unknown> {
  const finalUrl = appendQueryParams(url, { ...authQueryParams(vendor, apiKey), ...query });
  const upperMethod = method.toUpperCase();
  const hasBody = upperMethod !== "GET" && upperMethod !== "HEAD" && body != null;
  // 发送前请求头守卫：fetch 遇到码点 > 255 的头值会同步抛 ByteString 错，被下面 catch
  // 误判成「网络超时」让用户白查网络（最常见来源=密钥混进中文/全角字符）。在这里先识别，
  // 抛 auth 类（不可重试）+ 说人话的 upstreamMsg，让错误卡指向「重新粘贴密钥」而非网络。
  const headerProblem = findIllegalHeader(headers);
  if (headerProblem) {
    const { isAuth, message: upstreamMsg } = describeIllegalHeader(headerProblem);
    throw new VendorRequestError(`Provider request rejected (invalid header) at ${vendor.key} ${upperMethod} ${url}: ${upstreamMsg}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url,
      upstreamMsg,
      category: isAuth ? "auth" : "input",
      retryable: false,
    });
  }
  const timeoutMs = vendorHttpTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(finalUrl, {
      method: upperMethod,
      headers,
      signal: controller.signal,
      ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    // abort = 我们的超时，给一条说人话的 timeout 错误（仍归 network 类、可重试），而不是裸 "aborted"。
    const aborted = error instanceof Error && error.name === "AbortError";
    const upstreamMsg = aborted
      ? `请求超时（${Math.round(timeoutMs / 1000)}s 无响应）`
      : (error instanceof Error ? error.message : String(error)).slice(0, 256);
    throw new VendorRequestError(`Provider request failed (network) at ${vendor.key} ${upperMethod} ${url}: ${upstreamMsg}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url,
      upstreamMsg,
      category: "network",
      retryable: true,
    });
  }
  // 超时同样覆盖响应体读取（vendor 可能接了连接却 hang 在 body 上）；读完才清 timer。
  let text: string;
  try {
    text = await response.text();
  } catch (error: unknown) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const upstreamMsg = aborted
      ? `读取响应超时（${Math.round(timeoutMs / 1000)}s）`
      : (error instanceof Error ? error.message : String(error)).slice(0, 256);
    throw new VendorRequestError(`Provider request failed (network) at ${vendor.key} ${upperMethod} ${url}: ${upstreamMsg}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url,
      upstreamMsg,
      category: "network",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const record = isJsonRecord(json) ? json : {};
  // Many providers (kie.ai and other Java/Spring backends) return HTTP 200 with
  // a logical-error envelope `{ code: 4xx/5xx, msg/message: "..." }` instead of
  // a real error status. Treat that as a failure too, otherwise we'd hand a
  // body with no asset URL to the result builder and report a silent dud.
  const logicalCode = looksLikeLogicalError(record);
  if (!response.ok || logicalCode != null) {
    const rawUpstream = firstString(
      record.msg,
      record.message,
      record.error,
      readNestedRecord(record, ["error", "message"]),
      readNestedRecord(record, ["data", "msg"]),
      // ModelScope（及同类）失败体是复数 `errors`：{ "errors": { "message": "..." } }——
      // 轮询侧 mapping 早就读这个键（modelscopeVendor.ts:41），但提交/错误侧此前漏读，
      // 真正的 400 原因被压成「(no detail from provider)」。补齐复数 errors 的 message/detail。
      readNestedRecord(record, ["errors", "message"]),
      readNestedRecord(record, ["errors", "detail"]),
      record.errors,
    );
    const statusLabel = logicalCode != null ? `code ${logicalCode}` : `HTTP ${response.status}`;
    // "No message available" is Spring's default placeholder — surface the URL
    // and status so the failure is diagnosable instead of opaque.
    const detail = rawUpstream && rawUpstream !== "No message available" ? rawUpstream : `(no detail from provider)`;
    const { category, retryable } = categorizeVendorFailure(response.ok ? undefined : response.status, logicalCode ?? undefined);
    throw new VendorRequestError(`Provider request failed (${statusLabel}) at ${vendor.key} ${upperMethod} ${url}: ${detail}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url,
      ...(response.ok ? {} : { httpStatus: response.status }),
      ...(logicalCode != null ? { logicalCode } : {}),
      upstreamMsg: detail.slice(0, 256),
      category,
      retryable,
    });
  }
  return json;
}
