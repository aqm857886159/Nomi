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
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, type Dispatcher } from "undici";
import {
  OutboundDestinationRefusedError,
  authorizeOutboundDestination,
  connectionHostname,
  getLabTrustedPrivateOrigins,
  matchesDeclaredOrigin,
  readOutboundEnvironment,
  type OutboundAuthorization,
  type OutboundEnvironment,
  type OutboundRouteKind,
} from "./networkOutboundPolicy";
import { describeOutboundRefusal } from "./networkOutboundMessage";
import { appFetch } from "./appFetch";
import { getAppDispatcher, isApplicationProxyActive } from "./systemProxy";
import { guardTestNetworkUrl } from "./testNetworkGuard";
export { isPrivateHost } from "./networkHostPolicy";

export type HardenedFetchOptions = {
  /** 总时限（毫秒，从发请求算起）。默认 20 秒。给了 `timeoutForDeclaredSize` 时，它只管到响应头到达为止。 */
  timeoutMs?: number;
  /**
   * 空闲时限（毫秒）：连续这么久没有任何进展就中断——响应头到达、收到一块 body 都算进展。
   * 它管的是「线路断了」（一个字节都不再来），与总时限管的「线路太慢」分开。不给 = 只有总时限。
   */
  idleTimeoutMs?: number;
  /**
   * 响应头到达后，按声明长度（Content-Length；没声明 = null）重算总时限（毫秒，从发请求算起）。
   * 大文件在慢线路上合法地需要更久：总上限随大小放宽，而不是所有文件共用一个墙钟。
   */
  timeoutForDeclaredSize?: (declaredBytes: number | null) => number;
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
  /** 请求体。string 与二进制视图（Buffer/Uint8Array）原样发，object/array 自动 JSON.stringify。 */
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
  /**
   * 流式消费每一块响应体。**给了它就不在内存里攒**（返回的 `bytes` 为空 Buffer）。
   *
   * 为什么这条住在这里、而不是让调用方自己开一条下载路：目的地策略只该有一个 owner
   * （`check:outbound-policy` 规则 2/3 盯着这件事）。模型权重这类「大到不该整段进内存、
   * 且必须有进度」的下载如果自己 new 一条 fetch，就是第二个判据，也就是下一次不对称。
   * 回调抛错即中断本次下载（reader 会被 cancel），所以校验失败可以就地叫停。
   */
  onChunk?: (chunk: Uint8Array, doneBytes: number, totalBytes: number | null) => void | Promise<void>;
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

/** Parse + scheme only. The private/loopback verdict belongs to the policy owner, not here. */
function assertSafeUrl(targetUrl: string): URL {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http/https URLs are allowed (got ${url.protocol})`);
  }
  return url;
}

/**
 * 取回侧的授权。**提交侧（vendorHttp.requestVendor）调的是同一个 `authorizeOutboundDestination`**，
 * 读同一份进程内环境事实——「愿意为之付钱的目的地」与「愿意读取的目的地」不可能再分家。
 *
 * 拒绝时抛结构化错误而不是裸字符串：渲染层要分得清「我们自己的安全策略拒了」与「供应商挂了」，
 * 只有前者意味着这次的钱还在（取回侧）或根本没花（提交侧）。
 */
function refuse(authorization: Extract<OutboundAuthorization, { allowed: false }>): never {
  throw new OutboundDestinationRefusedError({
    reason: authorization.reason,
    hostname: authorization.hostname,
    observedAddress: authorization.observedAddress,
    syntheticResolver: authorization.syntheticResolver,
    message: describeOutboundRefusal({
      reason: authorization.reason,
      hostname: authorization.hostname,
      observedAddress: authorization.observedAddress,
      syntheticResolver: authorization.syntheticResolver,
      stage: "retrieval",
    }),
  });
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

/** 「一串字节、没说是什么」的标准写法。调用方在白名单里写它 = 接受这种字节，类型交给下游按字节判。 */
const OPAQUE_BYTES_TYPE = "application/octet-stream";
/**
 * 同一件事的别名。S3 等对象存储在上传时没给类型，就回 `binary/octet-stream`——它不是一个类型声明，
 * 与 application/octet-stream、以及干脆不带 Content-Type 一样，只是「没说」。
 */
const OPAQUE_BYTES_ALIASES: ReadonlySet<string> = new Set(["binary/octet-stream"]);

function mediaTypeOf(contentType: string): string {
  return contentType.toLowerCase().split(";")[0]?.trim() || "";
}

function isOpaqueBytesType(contentType: string): boolean {
  const type = mediaTypeOf(contentType);
  return !type || type === OPAQUE_BYTES_TYPE || OPAQUE_BYTES_ALIASES.has(type);
}

function isAllowedContentType(contentType: string, allow: readonly string[]): boolean {
  const type = mediaTypeOf(contentType);
  // 白名单收 application/octet-stream = 调用方接受「没说是什么的字节」，由下游字节校验判真伪
  // （生成产物落盘：projectAssetStore 的 validatedGeneratedMeta）。同一件事的另外两种写法——缺类型、
  // binary/octet-stream——也照收，不在这一步当成「类型不符」拒掉（2026-09-28：S3 缺省类型的成片被拒在门外）。
  if (isOpaqueBytesType(type) && allow.some((prefix) => mediaTypeOf(prefix) === OPAQUE_BYTES_TYPE)) return true;
  return Boolean(type) && allow.some((prefix) => type.startsWith(prefix.toLowerCase()));
}

/** 响应头声明的长度；没声明、不是正数都算「不知道多大」（null）。 */
function declaredContentLength(response: Response): number | null {
  const declared = Number(response.headers.get("content-length") || "0");
  return Number.isFinite(declared) && declared > 0 ? declared : null;
}

/** 报给调用方的类型：别名统一成下游只认的那一种写法；缺类型仍是空串（下游各自按「没有声明」处理）。 */
function reportedContentType(contentType: string): string {
  return OPAQUE_BYTES_ALIASES.has(mediaTypeOf(contentType)) ? OPAQUE_BYTES_TYPE : contentType;
}

export type HardenedFetchResult = {
  bytes: Buffer;
  contentType: string;
  status: number;
  finalUrl: string;
  truncated: boolean;
};

/** 这次取回走的是哪条路：直连 / 应用的系统代理 / 这家供应商单配的线路。 */
export type RetrievalRoute = "direct" | "system-proxy" | "provider-route";

/**
 * 一次失败取回的形状（挂在抛出的错误上，`hardenedFetchDiagnostics` 读）。
 * 只有排查要的东西：主机、路由、状态码、类型、大小、耗时——**没有 URL**：结果地址的查询串里常带签名，
 * 拿到就能下载；主机已经足够定位是哪一家的 CDN。
 */
export type HardenedFetchDiagnostics = {
  host: string;
  route: RetrievalRoute;
  status: number | null;
  contentType: string | null;
  declaredBytes: number | null;
  receivedBytes: number;
  elapsedMs: number;
};

const DIAGNOSTICS = Symbol("hardenedFetch.diagnostics");

function attachDiagnostics(error: unknown, diagnostics: HardenedFetchDiagnostics): unknown {
  if (error !== null && typeof error === "object" && Object.isExtensible(error)) {
    Object.defineProperty(error, DIAGNOSTICS, { value: { ...diagnostics }, enumerable: false, configurable: true });
  }
  return error;
}

/** 从 hardenedFetch 抛出的错误上读诊断；不是它抛的（或诊断挂不上）返回 null。 */
export function hardenedFetchDiagnostics(error: unknown): HardenedFetchDiagnostics | null {
  if (error === null || typeof error !== "object") return null;
  const value = (error as { [DIAGNOSTICS]?: HardenedFetchDiagnostics })[DIAGNOSTICS];
  return value ?? null;
}

/**
 * 放弃这个响应：丢掉 body（取消底层请求、把连接还回去），不读，也不等它。
 *
 * 为什么每条拒绝路径都必须先经过这里（2026-09-28「生成完了却一直停在『正在存到你电脑上』」的真因）：
 * 响应头一到，我们就可能拒掉它（状态码 ≥400、类型不在白名单、声明超上限）。以前直接抛错、body 原封不动——
 * 没人读的 body 把连接占着（服务端被背压顶住，自己也不会断），收尾那一步又在「优雅关闭」这次请求专用的
 * 连接池、等在途请求走完：永远等不到。比流缓冲小的 body 会被一口气收进来，所以小响应不挂——
 * 这就是它在几字节夹具的单测里一直绿、在真 CDN 的错误页 / 大文件上挂死的原因。
 * 共享线路（系统代理）与供应商单配线路的连接池不归这里拆，那两条路上能释放连接的也只有这一步。
 * 重定向那一跳早就这么做；现在它是唯一的「放弃响应」出口，所有拒绝路径都走它。
 */
function abandonResponse(response: Response, reader?: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    const released = reader ? reader.cancel() : response.body?.cancel();
    void released?.catch(() => undefined);
  } catch {
    // body 已被锁住或已出错：没有剩下可释放的东西。
  }
}

/**
 * 拆掉这次请求专用的连接池（DNS pinning 为它建的，别人不会再用）。
 *
 * 用 destroy（立刻断开，不等任何在途 body），不用 close（优雅关闭：要等在途请求全部走完——被拒掉、
 * 没人读的 body 永远走不完，这正是挂死点）。等它拆完再返回，但**不晚于本次请求自己的计时器**：
 * 计时器到点会 abort，这一步随之结束——收尾不可能比请求本身活得更久。
 */
async function releaseRequestDispatchers(dispatchers: readonly Dispatcher[], deadline: AbortSignal): Promise<void> {
  if (dispatchers.length === 0) return;
  const destroyed = Promise.allSettled(dispatchers.map((dispatcher) => Promise.resolve().then(() => dispatcher.destroy())));
  if (deadline.aborted) return;
  await new Promise<void>((resolve) => {
    const onDeadline = () => resolve();
    deadline.addEventListener("abort", onDeadline, { once: true });
    void destroyed.then(() => {
      deadline.removeEventListener("abort", onDeadline);
      resolve();
    });
  });
}

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
  // Lab origins stay merged here so the "any configured private exception disables redirects"
  // rule below keeps its existing meaning; the policy owner merges them again on its side.
  const allowedPrivateOrigins = [...(options.allowedPrivateOrigins || []), ...getLabTrustedPrivateOrigins()];
  const url = assertSafeUrl(guardTestNetworkUrl(rawUrl));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const startedAt = Date.now();
  // 可信本地服务只允许精确同源的一跳请求。禁止重定向，避免先访问重定向目标、事后才校验。
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) relayAbort();
  else options.signal?.addEventListener("abort", relayAbort, { once: true });
  // 我们自己的两个时限到点都只 abort，并记下是哪一个——报错要说清是「总时间到了」还是「线路停住了」。
  let expired: "total" | "idle" | null = null;
  let totalLimitMs = timeoutMs;
  const expire = (which: "total" | "idle") => {
    if (controller.signal.aborted) return;
    expired = which;
    controller.abort();
  };
  let totalTimer = setTimeout(() => expire("total"), totalLimitMs);
  let idleTimer: ReturnType<typeof setTimeout> | undefined = idleTimeoutMs ? setTimeout(() => expire("idle"), idleTimeoutMs) : undefined;
  const progressed = () => {
    if (idleTimer === undefined) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => expire("idle"), idleTimeoutMs);
  };
  const dispatchers: Dispatcher[] = [];
  const diagnostics: HardenedFetchDiagnostics = {
    host: url.hostname,
    route: options.dispatcher ? "provider-route" : "direct",
    status: null,
    contentType: null,
    declaredBytes: null,
    receivedBytes: 0,
    elapsedMs: 0,
  };
  // When Nomi has committed an HTTP/SOCKS application proxy, resolving the
  // provider hostname locally is both unnecessary and actively harmful: fake-IP
  // proxies commonly answer with RFC 2544 (198.18/15), which must not be treated
  // as the provider's real destination. The proxy performs the DNS resolution
  // on its side. Direct routes retain the original DNS pinning/SSRF checks.
  const applicationProxyActive = dependencies.isApplicationProxyActive ?? isApplicationProxyActive;
  // The route can still be applying during app start. If we classify by resolved
  // address before that commit, a proxy's synthetic 198.18/15 answer is mistaken
  // for a private destination and the request is rejected (or a pinned direct
  // dispatcher bypasses the proxy entirely). Wait for the app-owned route only for
  // the production fetch path; injected test transports keep their existing seam.
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
    let bodyInit: BodyInit | undefined;
    if (hasBody) {
      // 二进制体（Uint8Array / Buffer）**原样发**。没有这一条，任何要上传字节的调用方
      // （本地转写把 wav 片段 multipart 打给回环 sidecar 是第一例）都只能自己 new 一条出口，
      // 而目的地策略只该有一个 owner（见文件头与 `check:outbound-policy` 规则 2/3）。
      // 走到 JSON.stringify 的 Buffer 会变成 `{"type":"Buffer","data":[...]}` —— 一个看起来
      // 成功发出去、对面却解不出文件的静默错误，正是这层该拦住的那种。
      // Content-Type 由调用方给（multipart 必须带 boundary），只有都没给时才兜底成 JSON。
      bodyInit = ArrayBuffer.isView(options.body)
        ? (options.body.buffer.slice(options.body.byteOffset, options.body.byteOffset + options.body.byteLength) as ArrayBuffer)
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body);
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
    const readEnvironment = dependencies.readOutboundEnvironment ?? readOutboundEnvironment;
    for (let hop = 0; hop <= 5; hop += 1) {
      currentUrl = assertSafeUrl(guardTestNetworkUrl(currentUrl.toString()));
      const declaredPrivate = matchesDeclaredOrigin(currentUrl, allowedPrivateOrigins);
      let dispatcher: Dispatcher | undefined;
      if (options.dispatcher) {
        // The caller already picked an explicit provider route (a per-connection
        // HTTP/SOCKS proxy). Keep the application-route wait and DNS pinning out
        // of this path - but NOT the policy: the owner is asked below with
        // route "proxy", which classifies the name instead of a local answer the
        // proxy is not going to use.
        dispatcher = options.dispatcher;
      } else if (!declaredPrivate && (usesApplicationFetch || dependencies.waitForApplicationRoute)) {
        await waitForApplicationRoute(controller.signal, currentUrl);
      }
      // 每一跳都问策略 owner——代理生效时也问，只是判据的对象换成名字（见
      // networkOutboundPolicy.authorizeOutboundDestination 的「为什么代理生效时不能整段跳过分类」）。
      const route: OutboundRouteKind = options.dispatcher || applicationProxyActive() ? "proxy" : "direct";
      diagnostics.host = currentUrl.hostname;
      diagnostics.route = options.dispatcher ? "provider-route" : route === "proxy" ? "system-proxy" : "direct";
      const authorization = await authorizeOutboundDestination({
        url: currentUrl,
        route,
        readEnvironment,
        resolve: resolveHost,
        declaredOrigins: allowedPrivateOrigins,
      });
      if (!authorization.allowed) refuse(authorization);
      if (!dispatcher && authorization.pinnedAddresses) {
        dispatcher = makeDispatcher(connectionHostname(currentUrl.hostname), [...authorization.pinnedAddresses]);
        dispatchers.push(dispatcher);
      }
      response = await fetchImpl(currentUrl, {
        method,
        signal: controller.signal,
        redirect: "manual",
        headers: requestHeaders,
        ...(dispatcher ? { dispatcher } : {}),
        ...(bodyInit !== undefined ? { body: bodyInit } : {}),
      });
      progressed();
      diagnostics.status = response.status;
      diagnostics.contentType = response.headers.get("content-type");
      diagnostics.declaredBytes = declaredContentLength(response);
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      abandonResponse(response);
      if (!allowRedirect || !location || hop === 5 || (method !== "GET" && method !== "HEAD")) {
        throw new Error("Redirect refused by hardened fetch policy");
      }
      const nextUrl = new URL(guardTestNetworkUrl(new URL(location, currentUrl).toString()));
      if (nextUrl.origin !== currentUrl.origin) {
        requestHeaders = Object.fromEntries(
          Object.entries(requestHeaders).filter(([header]) => !sensitiveHeaders.has(header.toLowerCase())),
        );
      }
      currentUrl = nextUrl;
    }
    if (!response) throw new Error("Fetch failed");
    // 以下每一条拒绝都先 abandonResponse 再抛：响应头到了、body 还在路上，不丢掉它就会把连接占住（见 abandonResponse）。
    if (!response.ok && options.throwOnNon2xx !== false) {
      abandonResponse(response);
      throw new Error(`Fetch failed: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (options.allowContentTypes && !isAllowedContentType(contentType, options.allowContentTypes)) {
      abandonResponse(response);
      throw new Error(
        `Unsupported content type: ${contentType || "<empty>"} (expected one of ${options.allowContentTypes.join(", ")})`,
      );
    }

    // Content-Length 提前拦
    const declaredLength = Number(response.headers.get("content-length") || "0");
    const declaredTotal = declaredContentLength(response);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      abandonResponse(response);
      throw new Error(`Response too large: declared ${declaredLength} bytes (limit ${maxBytes})`);
    }
    if (options.timeoutForDeclaredSize) {
      // 响应头到了才知道多大：总上限按声明大小重算（仍从发请求那一刻算起，不是再给一整份）。
      totalLimitMs = options.timeoutForDeclaredSize(declaredTotal);
      clearTimeout(totalTimer);
      totalTimer = setTimeout(() => expire("total"), Math.max(0, startedAt + totalLimitMs - Date.now()));
    }

    // 流式累计 — 超 maxBytes 立刻断
    if (!response.body) {
      throw new Error("Response has no body");
    }
    const sink = options.onChunk;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    let truncated = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      progressed();
      total += value.byteLength;
      diagnostics.receivedBytes = total;
      if (total > maxBytes) {
        truncated = true;
        abandonResponse(response, reader);
        throw new Error(`Response exceeded ${maxBytes} bytes`);
      }
      if (sink) {
        try {
          await sink(value, total, declaredTotal);
        } catch (sinkError) {
          abandonResponse(response, reader);
          throw sinkError;
        }
      } else {
        chunks.push(value);
      }
    }

    return {
      bytes: sink ? Buffer.alloc(0) : Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), total),
      contentType: reportedContentType(contentType),
      status: response.status,
      finalUrl: currentUrl.toString(),
      truncated,
    };
  } catch (error) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(expired === "idle"
        ? `Fetch stalled: no data for ${idleTimeoutMs}ms`
        : `Fetch timed out after ${totalLimitMs}ms`);
      (timeoutError as Error & { cause?: unknown }).cause = error;
      throw attachDiagnostics(timeoutError, diagnostics);
    }
    throw attachDiagnostics(error, diagnostics);
  } finally {
    options.signal?.removeEventListener("abort", relayAbort);
    // 收尾不晚于计时器：先在计时器仍在跑的时候拆掉这次请求专用的连接池，拆完（或计时器到点）才清计时器。
    await releaseRequestDispatchers(dispatchers, controller.signal);
    clearTimeout(totalTimer);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
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
