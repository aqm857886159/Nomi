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
import { firstString, isJsonRecord, readNestedRecord } from "../jsonUtils";
import type { Vendor } from "../catalog/types";

export type VendorErrorCategory = "auth" | "balance" | "quota" | "input" | "server" | "network" | "unknown";

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
  let response: Response;
  try {
    response = await fetch(finalUrl, {
      method: upperMethod,
      headers,
      ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
  } catch (error: unknown) {
    const upstreamMsg = (error instanceof Error ? error.message : String(error)).slice(0, 256);
    throw new VendorRequestError(`Provider request failed (network) at ${vendor.key} ${upperMethod} ${url}: ${upstreamMsg}`, {
      vendorKey: vendor.key,
      method: upperMethod,
      url,
      upstreamMsg,
      category: "network",
      retryable: true,
    });
  }
  const text = await response.text();
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
