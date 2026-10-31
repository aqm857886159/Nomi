// 供应商产物（生成出的图 / 视频 / 音频）从远端取回的**唯一一条线路策略**。
//
// 为什么要单独成一个 owner（2026-09-25 用户报「Agent 付费卡生成的视频早就出好了，节点一直转圈」）：
// 同一段供应商视频，普通「生成」那条路（`importRemoteAsset` ← `localizeTaskAsset`）用的是
// 60 秒 / 200MB / 这家供应商自己的线路；Agent 付费卡那条路（`generationOutputMaterializer`）
// 自己又调了一次 `hardenedFetch`，只给了 maxBytes——于是超时落回 hardenedFetch 的缺省 20 秒、
// 也不走供应商线路。一段 15 秒的成片在慢一点的 CDN 上 20 秒传不完，付费卡那条路就每一轮都
// 下载超时、每一轮都重来，节点永远停在「生成中」，而普通生成那条路同一个文件照样落得下来。
// `downloadAsset.fetchAssetBytes` 的注释早就写着「另存与生成本地化必须同一条线路、同一组上限」，
// 那次只收了两处，第三处（付费卡）漏在外面——这就是「三份各写一遍、其中一份漂了」的形状。
// 现在三处都调这里：线路、超时、上限只有一份。
//
// 时间与大小预算（2026-09-28）：以前是一个 60 秒墙钟，慢线路上的大视频注定超时、每次重来都一样；
// 现在是「空闲时限 + 随声明大小放宽的总上限」，数字只在 `shared/assets/providerMediaRetrievalBudget.ts`
// 一处（依据写在那里）——渲染层算「正在存到你电脑上」最长能停多久，读的是同一份。
import type { HardenedFetchDependencies, HardenedFetchDiagnostics, HardenedFetchResult } from "../hardenedFetch";
import { hardenedFetch, hardenedFetchDiagnostics } from "../hardenedFetch";
import { logInfo } from "../logging/logger";
import { providerDispatcher, type ProviderNetworkConfig } from "../providerNetwork";
import {
  PROVIDER_MEDIA_BYTE_CAP,
  PROVIDER_MEDIA_IDLE_TIMEOUT_MS,
  PROVIDER_MEDIA_RETRIEVAL_MAX_MS,
  REFERENCE_LINK_ALIVE_MEMO_MS,
  REFERENCE_LINK_MEMO_LIMIT,
  REFERENCE_LINK_PROBE_MAX_BYTES,
  REFERENCE_LINK_PROBE_RANGE_BYTES,
  REFERENCE_LINK_PROBE_TIMEOUT_MS,
  providerMediaRetrievalTotalMs,
} from "../shared/assets/providerMediaRetrievalBudget";
import { mediaKindFromContentType } from "./mediaTypes";

/**
 * 单个产物是否超过字节上限。取回与「已经在内存里的 data: 产物」都问这里，不各带一个数字。
 */
export function exceedsProviderMediaCap(byteLength: number): boolean {
  return byteLength > PROVIDER_MEDIA_BYTE_CAP;
}

export type ProviderMediaFetchOptions = {
  /**
   * 允许的 content-type 前缀；缺省 = 图 / 视频 / 音频 / 二进制流。`'any'` = 不按类型拦
   * （「另存到磁盘」那条：用户要的就是原样字节，类型不是它的判据）。
   */
  allowContentTypes?: readonly string[] | 'any';
  /**
   * 产出这条 URL 的那家供应商自己的线路（`Vendor.network`）。**谁产的 URL 就用谁的路**：
   * 给某家单独配了代理时，提交走那条代理、取回却走应用默认线路，是同一次生成的两半在两条路上。
   */
  providerNetwork?: ProviderNetworkConfig;
  /** 仅供主进程内部已配置的本地服务（本地 ComfyUI / E2E 回环夹具）；渲染层与 Agent 无法注入。 */
  trustedPrivateOrigin?: string;
};

const DEFAULT_MEDIA_CONTENT_TYPES = ["image/", "video/", "audio/", "application/octet-stream"] as const;

export async function fetchProviderMedia(url: string, options: ProviderMediaFetchOptions = {}): Promise<HardenedFetchResult> {
  // 连接池只属于这一次取回（与 vendorHttp 同一条纪律）：建了必关，不散给调用方各记一遍。
  const providerRoute = options.providerNetwork ? providerDispatcher({ network: options.providerNetwork }) : undefined;
  try {
    return await hardenedFetch(url, {
      // 响应头到达之前还不知道多大：总上限先按字节上限那一档给，到了再按声明大小重算；
      // 线路一个字节都不来，空闲时限先拦住，不陪到总上限。
      timeoutMs: PROVIDER_MEDIA_RETRIEVAL_MAX_MS,
      idleTimeoutMs: PROVIDER_MEDIA_IDLE_TIMEOUT_MS,
      timeoutForDeclaredSize: providerMediaRetrievalTotalMs,
      maxBytes: PROVIDER_MEDIA_BYTE_CAP,
      ...(options.allowContentTypes === 'any' ? {} : { allowContentTypes: options.allowContentTypes ?? DEFAULT_MEDIA_CONTENT_TYPES }),
      ...(options.trustedPrivateOrigin ? { allowedPrivateOrigins: [options.trustedPrivateOrigin] } : {}),
      ...(providerRoute ? { dispatcher: providerRoute } : {}),
    });
  } finally {
    if (providerRoute) void providerRoute.close().catch(() => undefined);
  }
}

// ── 参考素材的临时链接：发给模型之前先试一下 ───────────────────────────────────────────────────────────────
//
// 为什么在这里：试探也是「从供应商那边取东西」，要走同一条线路（这家供应商单配的代理）、同一套出站策略
// （hardenedFetch：私网 / 跳转逐跳检查，不带 Key），所以住在取回线路策略的 owner 里，不另起一条出口。
// 它只回答一个问题：这条临时链接现在还能不能取到**媒体**。三个答案，只有明确失效才改走上传：
//   · alive    取到了媒体字节的头（或类型就是图片 / 视频 / 音频）→ 发原链接；
//   · dead     服务商明确说不行（4xx），或 2xx 回来的是网页 / XML / JSON / 文字 → 改用本机文件上传；
//   · unknown  超时、断网、5xx、跳转失败、出站策略拒绝……→ 照发原链接，和没有这个功能时一模一样。
// 判不了不能当失效：本机网络不通时，模型那边多半仍然拉得到。
// 用 GET + Range，不用 HEAD：对象存储的预签名链接只对签名时的方法有效，HEAD 会得到 403（把活链接判死）。

export type ProviderLinkVerdict = "alive" | "dead" | "unknown";

export type ProviderLinkProbeOptions = {
  /** 产出这条链接的那家供应商自己的线路（同 fetchProviderMedia）。 */
  providerNetwork?: ProviderNetworkConfig;
  /** 测试注入：记忆的时钟。 */
  now?: () => number;
};

/** 4xx 里**不**算失效的：请求超时 / 太早 / 限流 / Range 不可满足——都说明不了链接本身死了。 */
const NOT_A_DEAD_LINK_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 416]);
/** 2xx 里这些类型不是媒体：JSON / XML / 网页 / 脚本（文本类由 mediaKindFromContentType 判）。 */
const TEXTUAL_APPLICATION_TYPE = /^application\/(?:json|xml|xhtml\+xml|javascript)$|\+(?:json|xml)$/;

/** 没声明类型（或声明得不可信）的 2xx：开头是 `<` 或 `{` 就是网页 / XML / JSON 错误体，不是媒体。 */
function startsLikeMarkupOrJson(head: Uint8Array): boolean {
  const first = new TextDecoder("utf-8").decode(head.subarray(0, 64)).trimStart()[0];
  return first === "<" || first === "{";
}

function judgeProbeResponse(status: number, contentType: string, head: Uint8Array | null): ProviderLinkVerdict {
  if (status >= 400 && status < 500) return NOT_A_DEAD_LINK_STATUSES.has(status) ? "unknown" : "dead";
  if (status < 200 || status >= 300) return "unknown";
  // 2xx 却一个字节都没有：说不清是链接坏了还是服务器怪，当判断不了。
  if (head !== null && head.length === 0) return "unknown";
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const kind = mediaKindFromContentType(type);
  if (kind === "image" || kind === "video" || kind === "audio") return "alive";
  if (kind === "text" || TEXTUAL_APPLICATION_TYPE.test(type)) return "dead";
  if (head === null) return "alive";
  return startsLikeMarkupOrJson(head) ? "dead" : "alive";
}

/** 响应头到了、但整份 body 超过了读取上限（服务器忽略 Range，或 4xx 页面很大）：诊断里的状态码与类型就是答案。 */
function exceededProbeBudget(diagnostics: HardenedFetchDiagnostics): boolean {
  return (diagnostics.declaredBytes ?? 0) > REFERENCE_LINK_PROBE_MAX_BYTES || diagnostics.receivedBytes > REFERENCE_LINK_PROBE_MAX_BYTES;
}

async function readProbeVerdict(
  url: string,
  signal: AbortSignal,
  dispatcher: ReturnType<typeof providerDispatcher>,
  dependencies: HardenedFetchDependencies,
): Promise<ProviderLinkVerdict> {
  try {
    const response = await hardenedFetch(url, {
      method: "GET",
      headers: { Range: `bytes=0-${REFERENCE_LINK_PROBE_RANGE_BYTES - 1}` },
      throwOnNon2xx: false,
      maxBytes: REFERENCE_LINK_PROBE_MAX_BYTES,
      timeoutMs: REFERENCE_LINK_PROBE_TIMEOUT_MS,
      signal,
      ...(dispatcher ? { dispatcher } : {}),
    }, dependencies);
    return judgeProbeResponse(response.status, response.contentType, response.bytes);
  } catch (error) {
    const diagnostics = hardenedFetchDiagnostics(error);
    if (diagnostics?.status != null && exceededProbeBudget(diagnostics)) {
      return judgeProbeResponse(diagnostics.status, diagnostics.contentType ?? "", null);
    }
    return "unknown";
  }
}

/** 做一次试探：4 秒是硬上限。DNS 不看 abort（hardenedFetch 的计时器停不下它），所以另用 race 兜底。 */
async function probeOnce(url: string, options: ProviderLinkProbeOptions, dependencies: HardenedFetchDependencies): Promise<ProviderLinkVerdict> {
  const controller = new AbortController();
  const route = options.providerNetwork ? providerDispatcher({ network: options.providerNetwork }) : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<ProviderLinkVerdict>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("unknown");
    }, REFERENCE_LINK_PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readProbeVerdict(url, controller.signal, route, dependencies), expired]);
  } finally {
    clearTimeout(timer);
    if (route) void route.close().catch(() => undefined);
  }
}

type Memo = { verdict: ProviderLinkVerdict; expiresAt: number };
const memo = new Map<string, Memo>();
const inflight = new Map<string, Promise<ProviderLinkVerdict>>();

function remember(url: string, verdict: ProviderLinkVerdict, now: number): void {
  memo.delete(url);
  memo.set(url, { verdict, expiresAt: verdict === "dead" ? Number.POSITIVE_INFINITY : now + REFERENCE_LINK_ALIVE_MEMO_MS });
  while (memo.size > REFERENCE_LINK_MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

/** 测试用：清空记忆与在途表。 */
export function resetProviderLinkProbes(): void {
  memo.clear();
  inflight.clear();
}

/**
 * 试一下这条临时链接。同一条链接并发只发一个 GET；活着或判断不了的结论记 5 分钟，明确失效的记到进程结束。
 * 日志只写主机——链接的查询串里常带签名，拿到就能下载。
 */
export function probeProviderLink(
  url: string,
  options: ProviderLinkProbeOptions = {},
  dependencies: HardenedFetchDependencies = {},
): Promise<ProviderLinkVerdict> {
  const now = options.now ?? Date.now;
  const known = memo.get(url);
  if (known && known.expiresAt > now()) return Promise.resolve(known.verdict);
  const pending = inflight.get(url);
  if (pending) return pending;
  const startedAt = Date.now();
  const run = probeOnce(url, options, dependencies)
    .then((verdict) => {
      remember(url, verdict, now());
      // 日志只是留证据：写不了（目录不可写、没有 electron）不能把一个已经得出的结论变成失败。
      try { logInfo("assets", "reference-link-probe", { host: new URL(url).hostname, verdict, ms: Date.now() - startedAt }); } catch { /* 见上 */ }
      return verdict;
    })
    .finally(() => { inflight.delete(url); });
  inflight.set(url, run);
  return run;
}
