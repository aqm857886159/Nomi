/**
 * AI SDK 错误 → 结构化 `VendorRequestError`（文本侧接上图/视频侧那条契约，P1 不建第二套）。
 *
 * 病根（2026-08-12）：图/视频侧走 vendorHttp，失败在**抛出那一刻**就带 `category`（查表派生），
 * 经 `NOMI_VENDOR_ERR_B64::` 穿 IPC，渲染层 classifyError 优先采信；文本侧走 AI SDK，失败被压成
 * 一句裸字符串，渲染层只能用关键词正则去猜。猜就按类漏——classifyError 的注释里已记着 5 次
 * 同型补丁（output-truncated / not-enabled / retired / model-unavailable / network），每次都是
 * 「撞到一种没被枚举的措辞 → 落 unknown → 拿到『可能是服务商临时故障，建议稍等重试』」。
 * 状态码本来就在 `APICallError.statusCode` 里，只是没人接住。这里接住它。
 *
 * 分类**不自己写一张表**——原样调 vendorHttp 的 `categorizeVendorFailure`，
 * 401/403→auth、402→balance、429→quota、400/422→input、5xx→server 全仓只此一份。
 *
 * 三条 AI SDK 事实（读 ai@4.3.19 / @ai-sdk/provider-utils@2.2.8 源码得来，不是凭记忆）：
 *  ① `RetryError` 套壳：maxRetries>0 时可重试错误（429/5xx/网络）打光重试后抛的是 RetryError，
 *     真错误在 `.lastError`（ai/dist/index.mjs:294,311）。不拆壳 = 500 只剩
 *     "Failed after 4 attempts. Last error: Internal Server Error"，状态码照样丢。
 *  ② 连接失败已被包成 `APICallError`：`TypeError: fetch failed` 且带 cause 时 provider-utils 包成
 *     `APICallError{ message: "Cannot connect to API: …" }` 且**无 statusCode**
 *     （provider-utils/dist/index.mjs:264,612）。无码 → categorizeVendorFailure 给 network/可重试，
 *     正是要的答案，不用特判。
 *  ③ 不可重试错误（401/400）在第一次尝试就裸抛，不套 RetryError——两种形态都得认。
 *
 * 不含 electron import，可在纯 Node 单测直接导入（aiSdkVendorError.test.ts）。
 */
import { APICallError, RetryError } from "ai";
import { VendorRequestError, categorizeVendorFailure } from "../vendor/vendorHttp";

/** 上游报文里的人话：{error:{message}} / {error} / {message} / {msg} 四种常见信封。 */
function pickBodyMessage(parsed: unknown): string {
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return "";
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (obj.error && typeof obj.error === "object") {
    const inner = (obj.error as Record<string, unknown>).message;
    if (typeof inner === "string" && inner.trim()) return inner;
  }
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  if (typeof obj.msg === "string" && obj.msg.trim()) return obj.msg;
  return "";
}

/**
 * JSON-or-raw：上游响应体里那句人话，抠不出就给清洗过的片段。
 * 中转常把真原因（如「官方算力限制，请等待一段时间后再进行使用」）只放在 body 里，
 * `APICallError.message` 只有一句裸状态文本（"Bad Request"）。
 */
export function upstreamMessageFromBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const message = pickBodyMessage(JSON.parse(trimmed));
    if (message) return message.trim();
  } catch {
    /* not JSON — fall through to raw snippet */
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

/** 拆 RetryError 套壳，拿到真正的最后一次失败。深度上限防自引用死循环。 */
function unwrapRetry(error: unknown, depth = 0): unknown {
  if (depth >= 4 || !RetryError.isInstance(error)) return error;
  return unwrapRetry(error.lastError, depth + 1);
}

export type AiSdkErrorContext = {
  /** 目录里的 vendor key（结构化里带上，错误卡技术详情/埋点用得着）。 */
  vendorKey?: string;
};

/**
 * 厂商请求失败 → 结构化错误；**不是**厂商请求失败（工具报错、没配模型、空响应截断、
 * 用户点停止）→ null，由调用方退回裸字符串走 legacy 兜底。
 *
 * 已经是 VendorRequestError 的原样放行；非 Agent 文本任务的结构化错误不该再拆一遍。
 */
export function vendorErrorFromAiSdkError(error: unknown, ctx: AiSdkErrorContext = {}): VendorRequestError | null {
  if (error instanceof VendorRequestError) return error;
  const unwrapped = unwrapRetry(error);
  if (unwrapped instanceof VendorRequestError) return unwrapped;
  if (!APICallError.isInstance(unwrapped)) return null;

  const httpStatus = typeof unwrapped.statusCode === "number" ? unwrapped.statusCode : undefined;
  const upstreamMsg =
    (unwrapped.responseBody ? upstreamMessageFromBody(unwrapped.responseBody) : "") ||
    (unwrapped.message || "").trim();
  // 分类只认 vendorHttp 那张表（单一真相）——APICallError 自带的 isRetryable 不另开一路，
  // 免得同一个 429 在图像侧和文本侧给出两个不同的「要不要重试」。
  const { category, retryable } = categorizeVendorFailure(httpStatus);
  // 展示串：有状态码就报状态码，没有就报**错误类名**（AI SDK 的 `AI_APICallError` 这种名字本身
  // 就是线索）。刻意不再用「请求失败」当兜底——那句话与顶部状态徽标同义，用户读完不知道下一步是
  // 什么，还盖掉了本可展示的类名；它正是 check:outbound-policy 规则 4 盯的那一族（本文件必须保持
  // electron-free，用不了 desktopT，所以这一侧的「有信息的替代品」是类名而不是一句 i18n 文案）。
  const statusLabel = httpStatus != null ? `HTTP ${httpStatus}` : (unwrapped.name || "").trim();
  const message = [statusLabel ? `（${statusLabel}）` : "", upstreamMsg].join("") || String(unwrapped);

  return new VendorRequestError(message, {
    vendorKey: ctx.vendorKey || "",
    // AI SDK 只经 postJsonToApi/postToApi 造 APICallError，那两条都是 POST（错误里不带 method）。
    method: "POST",
    url: unwrapped.url || "",
    ...(httpStatus != null ? { httpStatus } : {}),
    upstreamMsg: upstreamMsg.slice(0, 256),
    category,
    retryable,
  });
}

/**
 * 我们自己的流式超时守卫（首字块 / 中途空闲）→ 结构化 network·可重试，与 vendorHttp 给自家
 * 超时的待遇一致。没这条它就是一句中文裸串，legacy 正则一个词都匹配不上（'timeout' 是英文），
 * 端点挂起会被说成「可能是额度问题」。
 */
export function vendorStallError(upstreamMsg: string, ctx: AiSdkErrorContext = {}): VendorRequestError {
  return new VendorRequestError(upstreamMsg, {
    vendorKey: ctx.vendorKey || "",
    method: "POST",
    url: "",
    upstreamMsg: upstreamMsg.slice(0, 256),
    category: "network",
    retryable: true,
  });
}
