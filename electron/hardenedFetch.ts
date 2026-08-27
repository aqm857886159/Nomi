/**
 * Hardened fetch for main process — SSRF/DoS 防护。
 *
 * 桌面端默认能访问用户本机网络（包括 NAS、路由器、私网服务），
 * 直接 fetch 任意用户/Agent 给的 URL 会带来：
 *  - SSRF：探测私网/localhost 服务
 *  - DoS：下载超大文件撑爆内存或磁盘
 *  - 阻塞：远端慢/挂导致主进程长时间不响应
 *  - 假内容：服务方返回 HTML/exe 但声称是 image/*
 *
 * 本模块只做 main 进程内的"主动出站"加固。renderer / preload 不应直接 fetch。
 */
import { URL } from "node:url";
import { isPrivateHost } from "./networkHostPolicy";
import { appFetch } from "./appFetch";
export { isPrivateHost } from "./networkHostPolicy";

export type HardenedFetchOptions = {
  /** 超时（毫秒）。默认 20 秒。 */
  timeoutMs?: number;
  /** 最大字节数。超过即中断并抛错。默认 50MB。 */
  maxBytes?: number;
  /** 允许的 content-type 前缀。空则不限。例如 ['image/', 'video/', 'application/json']。 */
  allowContentTypes?: readonly string[];
  /** 允许 redirect。默认 true。 */
  allowRedirect?: boolean;
  /** HTTP method。默认 GET。 */
  method?: string;
  /** 请求头。Authorization / Content-Type 等。 */
  headers?: Record<string, string>;
  /** 请求体。string 直接发，object/array 自动 JSON.stringify。 */
  body?: unknown;
  /** 上层任务取消信号；与本函数自己的超时共同中断请求。 */
  signal?: AbortSignal;
  /** 是否拒抛非 2xx —— 默认 true（保持旧行为）。设为 false 则返回任何 status 不抛错（让调用方读 body 自己判断）。 */
  throwOnNon2xx?: boolean;
  /**
   * 内部可信本地服务的精确 origin 白名单。只允许完全同源的私网/回环 URL，且启用后强制禁止重定向。
   * 不得从 renderer/Agent 原样透传；当前只由已配置的本地 ComfyUI 产物回收使用。
   */
  allowedPrivateOrigins?: readonly string[];
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** A configured private exception must match the complete origin exactly. */
function isExplicitlyAllowedPrivateOrigin(url: URL, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some((rawOrigin) => {
    try {
      const allowed = new URL(rawOrigin);
      return (allowed.protocol === "http:" || allowed.protocol === "https:") && allowed.origin === url.origin;
    } catch {
      return false;
    }
  });
}

function assertSafeUrl(targetUrl: string, allowedPrivateOrigins: readonly string[] = []): URL {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http/https URLs are allowed (got ${url.protocol})`);
  }
  if (isPrivateHost(url.hostname) && !isExplicitlyAllowedPrivateOrigin(url, allowedPrivateOrigins)) {
    throw new Error(`Refusing to fetch private/loopback host: ${url.hostname}`);
  }
  return url;
}

function isAllowedContentType(contentType: string, allow: readonly string[]): boolean {
  const lower = contentType.toLowerCase().split(";")[0]?.trim() || "";
  return allow.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

export type HardenedFetchResult = {
  bytes: Buffer;
  contentType: string;
  status: number;
  finalUrl: string;
  truncated: boolean;
};

/**
 * 安全 fetch — 主流程：
 *  1. assert URL 合法 + 非私网
 *  2. 带超时 + redirect 控制发请求
 *  3. 校验 content-type（若指定）
 *  4. 流式累计 bytes，超过 maxBytes 即中断
 */
export async function hardenedFetch(
  rawUrl: string,
  options: HardenedFetchOptions = {},
): Promise<HardenedFetchResult> {
  const allowedPrivateOrigins = options.allowedPrivateOrigins || [];
  const url = assertSafeUrl(rawUrl, allowedPrivateOrigins);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  // 可信本地服务只允许精确同源的一跳请求。禁止重定向，避免先访问重定向目标、事后才校验。
  const allowRedirect = allowedPrivateOrigins.length === 0 && options.allowRedirect !== false;
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) relayAbort();
  else options.signal?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const method = (options.method || "GET").toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD" && options.body != null;
    const requestHeaders = { ...(options.headers || {}) };
    let bodyInit: string | undefined;
    if (hasBody) {
      bodyInit = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === "content-type")) {
        requestHeaders["Content-Type"] = "application/json";
      }
    }
    const response = await appFetch(url, {
      method,
      signal: controller.signal,
      // `error` hides the fact that a redirect happened behind a generic TypeError("fetch failed").
      // `manual` returns the first 3xx without contacting its target, so callers can classify the
      // refusal without ever exposing a private-origin grant to the redirect destination.
      redirect: allowRedirect ? "follow" : "manual",
      headers: requestHeaders,
      ...(bodyInit !== undefined ? { body: bodyInit } : {}),
    });
    if (!allowRedirect && response.status >= 300 && response.status < 400) {
      throw new Error("Redirect refused by hardened fetch policy");
    }
    if (!response.ok && options.throwOnNon2xx !== false) {
      throw new Error(`Fetch failed: HTTP ${response.status}`);
    }

    // 重定向终点必须也通过私网检查
    if (response.url && response.url !== url.toString()) {
      assertSafeUrl(response.url, allowedPrivateOrigins);
    }

    const contentType = response.headers.get("content-type") || "";
    if (options.allowContentTypes && !isAllowedContentType(contentType, options.allowContentTypes)) {
      throw new Error(
        `Unsupported content type: ${contentType || "<empty>"} (expected one of ${options.allowContentTypes.join(", ")})`,
      );
    }

    // Content-Length 提前拦
    const declaredLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Response too large: declared ${declaredLength} bytes (limit ${maxBytes})`);
    }

    // 流式累计 — 超 maxBytes 立刻断
    if (!response.body) {
      throw new Error("Response has no body");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    let truncated = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }

    return {
      bytes: Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), total),
      contentType,
      status: response.status,
      finalUrl: response.url || url.toString(),
      truncated,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
  }
}

/** 仅做 text 解析（小一些的 limit，避免 SSRF 探测）。 */
export async function hardenedFetchText(
  rawUrl: string,
  options: HardenedFetchOptions = {},
): Promise<{ text: string; contentType: string; status: number; finalUrl: string; truncated: boolean }> {
  const TEXT_DEFAULT_MAX = 5 * 1024 * 1024;
  const result = await hardenedFetch(rawUrl, { maxBytes: TEXT_DEFAULT_MAX, ...options });
  return {
    text: result.bytes.toString("utf8"),
    contentType: result.contentType,
    status: result.status,
    finalUrl: result.finalUrl,
    truncated: result.truncated,
  };
}
