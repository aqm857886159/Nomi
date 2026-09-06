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
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, type Dispatcher } from "undici";
import { isPrivateHost } from "./networkHostPolicy";
import {
  OutboundDestinationRefusedError,
  classifyOutboundAddresses,
  getLabTrustedPrivateOrigins,
  readOutboundEnvironment,
  type OutboundEnvironment,
} from "./networkOutboundPolicy";
import { describeOutboundRefusal } from "./networkOutboundMessage";
import { appFetch } from "./appFetch";
import { getAppDispatcher, isApplicationProxyActive } from "./systemProxy";
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
  /** Additional application-specific credential headers stripped on cross-origin redirects. */
  sensitiveHeaders?: readonly string[];
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
  /** Optional explicit provider route. Destination SSRF checks remain active. */
  dispatcher?: Dispatcher;
};

export type { ResolvedHostAddress } from "./networkOutboundPolicy";
import type { ResolvedHostAddress } from "./networkOutboundPolicy";

export type HardenedFetchDependencies = {
  resolveHost?: (hostname: string) => Promise<ResolvedHostAddress[]>;
  createPinnedDispatcher?: (hostname: string, addresses: ResolvedHostAddress[]) => Dispatcher;
  fetch?: (input: URL, init: RequestInit & { dispatcher?: Dispatcher }) => Promise<Response>;
  /** Test seam for the already-committed application proxy route. */
  isApplicationProxyActive?: () => boolean;
  /** Test seam for waiting until the application route has been committed. */
  waitForApplicationRoute?: (signal: AbortSignal, target: URL) => Promise<void>;
  /** Test seam for the shared outbound environment (fake-IP resolver detection). */
  readOutboundEnvironment?: () => Promise<OutboundEnvironment>;
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
    // Structured, not a bare string: the renderer has to tell "our own security policy refused
    // this" apart from "the provider failed", because only the former means the paid task is
    // still intact and can be re-fetched for free.
    throw new OutboundDestinationRefusedError({
      reason: "private-host",
      hostname: url.hostname,
      syntheticResolver: false,
      message: describeOutboundRefusal({ reason: "private-host", hostname: url.hostname, observedAddress: "", syntheticResolver: false }),
    });
  }
  return url;
}

/**
 * The retrieval half of the shared outbound decision. Both halves - the vendor submit/poll calls
 * in vendorHttp and this artifact download - now ask networkOutboundPolicy the same question with
 * the same once-per-process environment snapshot, so a destination we were willing to pay through
 * cannot be a destination we then refuse to read from.
 */
async function resolvePublicAddresses(
  hostname: string,
  resolveHost: NonNullable<HardenedFetchDependencies["resolveHost"]>,
  environment: OutboundEnvironment,
): Promise<ResolvedHostAddress[]> {
  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolveHost(hostname);
  const verdict = classifyOutboundAddresses({ hostname, addresses, environment });
  if (!verdict.allowed) {
    throw new OutboundDestinationRefusedError({
      reason: verdict.reason,
      hostname,
      observedAddress: verdict.observedAddress,
      syntheticResolver: environment.syntheticResolver,
      message: describeOutboundRefusal({
        reason: verdict.reason,
        hostname,
        observedAddress: verdict.observedAddress,
        syntheticResolver: environment.syntheticResolver,
      }),
    });
  }
  return addresses;
}

function connectionHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function createPinnedDispatcher(hostname: string, addresses: ResolvedHostAddress[]): Dispatcher {
  let cursor = 0;
  const lookup = (
    requestedHost: string,
    options: { family?: number; all?: boolean },
    callback: (error: Error | null, address?: unknown, family?: number) => void,
  ): void => {
    if (requestedHost.toLowerCase() !== hostname.toLowerCase()) {
      callback(new Error("Pinned dispatcher hostname mismatch"));
      return;
    }
    const family = options.family === 4 || options.family === 6 ? options.family : 0;
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
    if (!candidates.length) {
      callback(new Error("Pinned dispatcher has no address for requested family"));
      return;
    }
    if (options.all) {
      callback(null, candidates);
      return;
    }
    const selected = candidates[cursor++ % candidates.length];
    callback(null, selected.address, selected.family);
  };
  return new Agent({ connect: { lookup } as never });
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
  dependencies: HardenedFetchDependencies = {},
): Promise<HardenedFetchResult> {
  // Lab fixtures name their exact loopback origin; main.ts only seeds them on an unpackaged
  // build, so a packaged app merges an always-empty list here.
  const allowedPrivateOrigins = [...(options.allowedPrivateOrigins || []), ...getLabTrustedPrivateOrigins()];
  const url = assertSafeUrl(rawUrl, allowedPrivateOrigins);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  // 可信本地服务只允许精确同源的一跳请求。禁止重定向，避免先访问重定向目标、事后才校验。
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) relayAbort();
  else options.signal?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatchers: Dispatcher[] = [];
  // When Nomi has committed an HTTP/SOCKS application proxy, resolving the
  // provider hostname locally is both unnecessary and actively harmful: fake-IP
  // proxies commonly answer with RFC 2544 (198.18/15), which must not be treated
  // as the provider's real destination. The proxy performs the DNS resolution
  // on its side. Direct routes retain the original DNS pinning/SSRF checks.
  const applicationProxyActive = dependencies.isApplicationProxyActive ?? isApplicationProxyActive;
  // The route can still be applying during app start. If we resolve DNS before
  // that commit, a proxy's synthetic 198.18/15 answer is mistaken for a private
  // destination and the request is rejected (or a pinned direct dispatcher
  // bypasses the proxy entirely). Wait for the app-owned route only for the
  // production fetch path; injected test transports keep their existing seam.
  const usesApplicationFetch = !dependencies.fetch && !dependencies.isApplicationProxyActive;
  const waitForApplicationRoute = dependencies.waitForApplicationRoute
    ?? ((signal: AbortSignal, target: URL) => getAppDispatcher(signal, target).then(() => undefined));

  try {
    const method = (options.method || "GET").toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD" && options.body != null;
    let requestHeaders = { ...(options.headers || {}) };
    const sensitiveHeaders = new Set([
      "authorization",
      "proxy-authorization",
      "cookie",
      ...(options.sensitiveHeaders || []).map((header) => header.trim().toLowerCase()).filter(Boolean),
    ]);
    const carriesSensitiveHeaders = Object.keys(requestHeaders).some((header) => sensitiveHeaders.has(header.toLowerCase()));
    // Credential-bearing calls reject redirects unless the caller opts in explicitly.
    const allowRedirect = allowedPrivateOrigins.length === 0
      && options.allowRedirect !== false
      && (!carriesSensitiveHeaders || options.allowRedirect === true);
    let bodyInit: string | undefined;
    if (hasBody) {
      bodyInit = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === "content-type")) {
        requestHeaders["Content-Type"] = "application/json";
      }
    }
    const resolveHost = dependencies.resolveHost ?? (async (hostname: string) => {
      const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
      return resolved.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
    });
    const makeDispatcher = dependencies.createPinnedDispatcher ?? createPinnedDispatcher;
    const fetchImpl = dependencies.fetch ?? ((input, init) => appFetch(input, init));
    let currentUrl = url;
    let response: Response | undefined;
    for (let hop = 0; hop <= 5; hop += 1) {
      currentUrl = assertSafeUrl(currentUrl.toString(), allowedPrivateOrigins);
      const privateAllowed = isPrivateHost(currentUrl.hostname)
        && isExplicitlyAllowedPrivateOrigin(currentUrl, allowedPrivateOrigins);
      let dispatcher: Dispatcher | undefined;
      if (options.dispatcher) {
        // An explicit provider route is already selected by the caller. Keep
        // the application proxy wait and direct DNS pinning out of this path.
        dispatcher = options.dispatcher;
      } else {
        if (!privateAllowed && (usesApplicationFetch || dependencies.waitForApplicationRoute)) {
          await waitForApplicationRoute(controller.signal, currentUrl);
        }
        if (!privateAllowed && !applicationProxyActive()) {
          const hostname = connectionHostname(currentUrl.hostname);
          const environment = await (dependencies.readOutboundEnvironment ?? readOutboundEnvironment)();
          const addresses = await resolvePublicAddresses(hostname, resolveHost, environment);
          dispatcher = makeDispatcher(hostname, addresses);
          dispatchers.push(dispatcher);
        }
      }
      response = await fetchImpl(currentUrl, {
        method,
        signal: controller.signal,
        redirect: "manual",
        headers: requestHeaders,
        ...(dispatcher ? { dispatcher } : {}),
        ...(bodyInit !== undefined ? { body: bodyInit } : {}),
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      try { await response.body?.cancel(); } catch { /* ignore */ }
      if (!allowRedirect || !location || hop === 5 || (method !== "GET" && method !== "HEAD")) {
        throw new Error("Redirect refused by hardened fetch policy");
      }
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== currentUrl.origin) {
        requestHeaders = Object.fromEntries(
          Object.entries(requestHeaders).filter(([header]) => !sensitiveHeaders.has(header.toLowerCase())),
        );
      }
      currentUrl = nextUrl;
    }
    if (!response) throw new Error("Fetch failed");
    if (!response.ok && options.throwOnNon2xx !== false) {
      throw new Error(`Fetch failed: HTTP ${response.status}`);
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
      finalUrl: currentUrl.toString(),
      truncated,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`Fetch timed out after ${timeoutMs}ms`);
      (timeoutError as Error & { cause?: unknown }).cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
    await Promise.allSettled(dispatchers.map((dispatcher) => dispatcher.close()));
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
