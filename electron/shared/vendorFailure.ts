// 供应商失败的结构化事实：错误类、状态码→类别查表、穿 IPC 的编码（唯一一处）。
//
// 2026-10-27 从 vendor/vendorHttp.ts 原样搬来：这几样只描述「失败长什么样」，不碰网络。留在 vendorHttp 里，
// 想读它的模块就得把整条 HTTP 传输（目录、代理、出站守卫……）一起 import 进来。pi 那座 NodeNext 岛装配
// provider 时，要按同一张表给 Agent 的失败编码（laneModelProvider → runtimeVendorError.modelCallFailure），
// 一拖进 vendorHttp 就把整个运行时编进岛里，岛编译当场红（logging/diskSafeFailure.ts 早先就为同一个原因抄过一份类别表）。
// vendorHttp 照旧把这几个名字转出去，已有的 import 不用改；会被编进岛里的轻模块直接从这里引。
import type { ProviderAnswer } from "../outboundDispatchEvidence";

export type VendorErrorCategory = "auth" | "balance" | "quota" | "input" | "server" | "network" | "timeout" | "unknown";

export type VendorErrorStructured = {
  vendorKey: string;
  method: string;
  url: string;
  httpStatus?: number;
  logicalCode?: number | string;
  /** 上游原话,截 256(防日志爆炸,§4.3)。 */
  upstreamMsg: string;
  /**
   * 上游**自己给的错误码**（`model_not_found` 这一类字符串标识；没有就不写）。状态码只说「请求有问题」，
   * 这个码才是它说的原因——渲染层分类优先读它（classifyError 的 UPSTREAM_CODE_KINDS），不靠 400 猜「参数不对」。
   */
  upstreamCode?: string;
  /** 查表分类,不是猜:401/403→auth,402→balance,429→quota,400/422→input,5xx→server。 */
  category: VendorErrorCategory;
  retryable: boolean;
  reasonCode?: "response_timeout";
};

export class VendorRequestError extends Error {
  readonly structured: VendorErrorStructured;
  declare readonly cause?: unknown;
  /** 只在**收到了响应**时才有：「提交有没有被受理」由 `outboundDispatchEvidence.providerExplicitlyRejected` 读它判。 */
  readonly providerAnswer?: ProviderAnswer;
  constructor(message: string, structured: VendorErrorStructured, providerAnswer?: ProviderAnswer, options?: { cause?: unknown }) {
    super(message);
    // 与原生 `new Error(msg, { cause })` 同形（非枚举）；app 工程的 lib 还没有 ErrorOptions 类型，所以手挂。
    if (options?.cause !== undefined) Object.defineProperty(this, "cause", { value: options.cause, enumerable: false, writable: true, configurable: true });
    this.name = "VendorRequestError";
    this.structured = structured;
    if (providerAnswer) this.providerAnswer = providerAnswer;
  }
}

/**
 * Electron IPC 的 promise rejection 只保留 message 字符串(自定义字段全丢)。
 * structured 经 base64 标记嵌进 message 穿过 IPC;渲染层配对解析器:
 * src/workbench/generationCanvas/runner/vendorErrorIpc.ts(双端常量,改一处必改另一处)。
 */
export const VENDOR_ERROR_IPC_MARKER = "NOMI_VENDOR_ERR_B64::";

export function encodeVendorErrorMessage(error: VendorRequestError): string {
  return encodeStructuredErrorMessage(error.structured, error.message);
}

/** Reuse the established IPC marker for non-provider structured task errors. */
export function encodeStructuredErrorMessage(structured: Record<string, unknown>, message: string): string {
  const b64 = Buffer.from(JSON.stringify(structured), "utf8").toString("base64");
  return `${VENDOR_ERROR_IPC_MARKER}${b64}:: ${message}`;
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
