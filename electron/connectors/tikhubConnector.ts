// TikHub 数据 connector —— 分享链接 → 无水印直链（喂现有拆解引擎 / 落项目素材）。
//
// 规格：docs/plan/2026-09-01-tikhub-connector-v1.md（R5 OpenAPI 对账见其中）。
// 只接 TikHub；BYO-key（用户设置里自带，走 catalog 的 safeStorage 凭据层）；抖音/TikTok；
// 小红书/走势/轮询留 v2。
//
// R5 对账要点（一手 api.tikhub.io/openapi.json，openapi 3.1.0，checkedAt 2026-09-01）：
//   · 鉴权 Authorization: Bearer {token}；base https://api.tikhub.io（无 servers 块，文档站口径）。
//   · 响应统一 ResponseModel 信封：{ code, message, message_zh, request_id, data }。
//   · data 是 anyOf:[{},null]——**未定型的原始平台载荷透传**，OpenAPI 不描述内层字段。
//   · 唯一被端点 description 明写的干净直链字段：fetch_video_high_quality_play_url 的
//     data.original_video_url（最高画质无水印）。抖音首选走它（一步到位）。
//   · fetch_one_video_by_share_url（抖音/TikTok）返回原始 aweme，直链要在 aweme 里按候选路径找。
import { hardenedFetch } from "../hardenedFetch";
import { firstString, isJsonRecord, trim, type JsonRecord } from "../jsonUtils";
import type { ConnectorDefinition } from "./connectorDefinition";
import { TIKHUB_CONNECTOR_ID, TIKHUB_HOST_PRIMARY, TIKHUB_HOSTS } from "./tikhubHosts";
import { resolveTikhubHost, failoverTikhubHost } from "./tikhubRoute";

/** 主域基址（sticky 未定/兜底时用；实际出站 host 由 tikhubRoute 实测选路决定）。 */
export const TIKHUB_BASE_URL = `https://${TIKHUB_HOST_PRIMARY}`;
/** @deprecated 单域名遗留常量，保留仅为兼容既有 import；候选域清单以 TIKHUB_HOSTS 为准。 */
export const TIKHUB_HOST = TIKHUB_HOST_PRIMARY;
export { TIKHUB_CONNECTOR_ID, TIKHUB_HOSTS } from "./tikhubHosts";

/** connector 形态定义（§5.5 ConnectorDefinition）。 */
export const TIKHUB_CONNECTOR: ConnectorDefinition = {
  kind: "connector",
  id: TIKHUB_CONNECTOR_ID,
  name: "TikHub",
  baseUrl: TIKHUB_BASE_URL,
  transport: "native-api",
  auth: { kind: "api-key", secretOwner: "nomi-settings" },
  // 候选域清单覆盖两域：主域 api.tikhub.io + 大陆加速域 api.tikhub.dev（实测选路在两者间挑）。
  network: { allowedOrigins: [...TIKHUB_HOSTS], redirectPolicy: "same-origin" },
  tools: [
    {
      externalName: "fetch_video_high_quality_play_url",
      nomiName: "douyinHighQualityPlayUrl",
      effect: "spend",
      path: "/api/v1/douyin/web/fetch_video_high_quality_play_url",
      method: "GET",
      unitPriceUsd: 0.005,
    },
    {
      externalName: "fetch_one_video_by_share_url",
      nomiName: "douyinVideoByShareUrl",
      effect: "spend",
      path: "/api/v1/douyin/web/fetch_one_video_by_share_url",
      method: "GET",
    },
    {
      externalName: "fetch_one_video_by_share_url",
      nomiName: "tiktokVideoByShareUrl",
      effect: "spend",
      path: "/api/v1/tiktok/app/v3/fetch_one_video_by_share_url",
      method: "GET",
    },
  ],
  dataEgress: {
    categories: ["share-link", "video-id"],
    retention: "本次请求即用即弃；Nomi 不长存发往 api.tikhub.io 的链接/ID。",
  },
};

export type ShareUrlPlatform = "douyin" | "tiktok";

/** connector 层错误分类——供 UI 三段式失败态按 kind 给对应「下一步」。 */
export type TikhubErrorKind =
  | "missing-key" // 没配 key
  | "auth" // 401：key 无效/过期
  | "quota" // 403：额度不足/权限
  | "not-found" // 404：链接解析不到作品
  | "unsupported-platform" // 不是抖音/TikTok 链接
  | "no-play-url" // 拿到作品但抽不出直链
  | "upstream" // 5xx / 风控波动 / 网络
  | "no-route" // 两个候选域（主 api.tikhub.io + 加速 api.tikhub.dev）都探测不通
  | "bad-response"; // 非 JSON / 信封异常

export class TikhubConnectorError extends Error {
  kind: TikhubErrorKind;
  /** 上游 http status（若有），仅供日志/诊断。 */
  status?: number;
  constructor(kind: TikhubErrorKind, message: string, status?: number) {
    super(message);
    this.name = "TikhubConnectorError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * 从分享文本里判平台。抖音口令常夹在长文本里（含 v.douyin.com 短链），TikTok 是
 * tiktok.com / vm.tiktok.com。判不出返回 null（上层报 unsupported-platform）。
 */
export function detectSharePlatform(shareText: string): ShareUrlPlatform | null {
  const text = String(shareText || "").toLowerCase();
  if (/douyin\.com|iesdouyin\.com|抖音/.test(text)) return "douyin";
  if (/tiktok\.com/.test(text)) return "tiktok";
  return null;
}

/** 从一段可能含中文/表情的分享文本里抠出第一个 http(s) URL；没有则返回原文（端点自己也能吃口令）。 */
export function extractShareUrl(shareText: string): string {
  const text = String(shareText || "");
  const match = text.match(/https?:\/\/[^\s"'<>）)]+/i);
  return match ? match[0] : text.trim();
}

export type ResolvedShareVideo = {
  platform: ShareUrlPlatform;
  /** 无水印/高画质媒体直链（http(s)）。 */
  playUrl: string;
  /** 作品 id（若解析得到）。 */
  videoId?: string;
  /** 该端点的名义单价（美元，若文档化）——供 UI 费用确认展示。 */
  unitPriceUsd?: number;
};

type TikhubDeps = {
  /** 出站发送器（默认 hardenedFetch）。host 由选路给定。测试注入。 */
  fetchJson?: (path: string, query: Record<string, string>, apiKey: string, host: string) => Promise<JsonRecord>;
  /** 选路：连接时/首次调用前挑生效 host（默认 tikhubRoute.resolveTikhubHost，实测赛跑 + sticky）。测试注入。 */
  resolveHost?: () => Promise<string | null>;
  /** 失败自动切换：主选 host 出站失败后换备域（默认 tikhubRoute.failoverTikhubHost）。测试注入。 */
  failover?: (failedHost: string) => Promise<string | null>;
};

/** 判「像是线路层网络问题」——据此触发一次自动切换（区别于 401/404 这类业务错，切域没意义）。 */
function isRoutableFailure(error: unknown): boolean {
  return error instanceof TikhubConnectorError && error.kind === "upstream";
}

/** 拼 query string（跳过空值）。 */
function buildQuery(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const s = trim(v);
    if (s) out[k] = s;
  }
  return out;
}

/**
 * 真出站：GET https://{host}{path}?{query}，Bearer 鉴权，全过 hardenedFetch（allowedOrigins 覆盖两候选域，
 * 禁重定向出域，Authorization 作敏感头跨域剥离）。非 2xx 不抛（throwOnNon2xx:false），
 * 由本函数读 status 分类。host 由 tikhubRoute 实测选路给定；此处硬校验它是候选域之一（防被改打到别处）。
 */
async function fetchTikhubJson(
  path: string,
  query: Record<string, string>,
  apiKey: string,
  host: string,
): Promise<JsonRecord> {
  const url = new URL(path, `https://${host}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  // allowedOrigins 硬校验：只允许候选域清单里的域（防被改 host/path 打到别处）。
  if (!(TIKHUB_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())) {
    throw new TikhubConnectorError("bad-response", `TikHub 出站目标非法：${url.hostname}`);
  }

  let result;
  try {
    result = await hardenedFetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      sensitiveHeaders: ["authorization"],
      allowRedirect: false,
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 30_000,
      throwOnNon2xx: false,
    });
  } catch (error) {
    throw new TikhubConnectorError(
      "upstream",
      `连接 TikHub 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const status = result.status;
  let body: unknown;
  try {
    body = JSON.parse(result.bytes.toString("utf8"));
  } catch {
    if (status >= 500) throw new TikhubConnectorError("upstream", `TikHub 上游 ${status}`, status);
    throw new TikhubConnectorError("bad-response", `TikHub 返回了非 JSON（HTTP ${status}）`, status);
  }
  if (!isJsonRecord(body)) throw new TikhubConnectorError("bad-response", "TikHub 响应结构异常", status);

  // ResponseModel.code 可能与 http status 不一致——两者任一非 2xx 都按错分类。
  const envelopeCode = typeof body.code === "number" ? body.code : status;
  const effective = status >= 400 ? status : envelopeCode;
  if (effective >= 400) {
    const msg = firstString(body.message_zh, body.message) || `TikHub 请求失败（${effective}）`;
    if (effective === 401) throw new TikhubConnectorError("auth", msg, effective);
    if (effective === 403) throw new TikhubConnectorError("quota", msg, effective);
    if (effective === 404) throw new TikhubConnectorError("not-found", msg, effective);
    if (effective >= 500) throw new TikhubConnectorError("upstream", msg, effective);
    throw new TikhubConnectorError("bad-response", msg, effective);
  }
  return body;
}

/**
 * 在原始 aweme 结构里防御式抽媒体直链。因 data 内层 OpenAPI 未文档化，走多候选路径遍历
 * （抖音/TikTok 已知形状：aweme_detail.video.{play_addr,download_addr}.url_list[]，
 * 或裸 video.*）。取第一个 http(s)。抽不到返回空串。
 */
export function extractPlayUrlFromAweme(data: unknown): string {
  const roots: unknown[] = [];
  if (isJsonRecord(data)) {
    roots.push(data);
    if (isJsonRecord(data.aweme_detail)) roots.push(data.aweme_detail);
    for (const listKey of ["aweme_list", "aweme_details"]) {
      const list = data[listKey];
      if (Array.isArray(list) && isJsonRecord(list[0])) roots.push(list[0]);
    }
  }
  const addrKeys = ["play_addr", "download_addr", "play_addr_h264", "play_addr_265"];
  for (const root of roots) {
    if (!isJsonRecord(root)) continue;
    const video = isJsonRecord(root.video) ? root.video : root;
    for (const addrKey of addrKeys) {
      const addr = isJsonRecord(video) ? video[addrKey] : undefined;
      if (!isJsonRecord(addr)) continue;
      const list = addr.url_list;
      if (Array.isArray(list)) {
        for (const candidate of list) {
          const url = trim(candidate);
          if (/^https?:\/\//i.test(url)) return url;
        }
      }
    }
  }
  return "";
}

function extractVideoId(data: unknown): string | undefined {
  if (!isJsonRecord(data)) return undefined;
  const detail = isJsonRecord(data.aweme_detail) ? data.aweme_detail : data;
  const id = firstString(
    (data as JsonRecord).video_id,
    (data as JsonRecord).aweme_id,
    isJsonRecord(detail) ? detail.aweme_id : undefined,
  );
  return id || undefined;
}

/**
 * 单个 host 上跑完整解析（抖音首选高画质端点、兜底 aweme；TikTok 抽 aweme）。
 * 抽成内部函数，让「主选 host」与「failover 后的备域」复用同一套逻辑。
 */
async function resolveOnHost(
  platform: ShareUrlPlatform,
  shareUrl: string,
  apiKey: string,
  host: string,
  fetchJson: NonNullable<TikhubDeps["fetchJson"]>,
): Promise<ResolvedShareVideo> {
  if (platform === "douyin") {
    // 首选：一步拿高画质无水印直链。region=CN 让抖音返回国内 CDN（下载更快）。
    const hq = await fetchJson(
      "/api/v1/douyin/web/fetch_video_high_quality_play_url",
      buildQuery({ share_url: shareUrl, region: "CN" }),
      apiKey,
      host,
    );
    const hqData = hq.data;
    const originalUrl = isJsonRecord(hqData) ? trim(hqData.original_video_url) : "";
    if (/^https?:\/\//i.test(originalUrl)) {
      return {
        platform,
        playUrl: originalUrl,
        videoId: isJsonRecord(hqData) ? trim(hqData.video_id) || undefined : undefined,
        unitPriceUsd: 0.005,
      };
    }
    // 兜底：原始 aweme 抽直链。
    const detail = await fetchJson(
      "/api/v1/douyin/web/fetch_one_video_by_share_url",
      buildQuery({ share_url: shareUrl }),
      apiKey,
      host,
    );
    const playUrl = extractPlayUrlFromAweme(detail.data);
    if (!playUrl) {
      throw new TikhubConnectorError("no-play-url", "解析到作品，但取不到可下载的视频直链。");
    }
    return { platform, playUrl, videoId: extractVideoId(detail.data) };
  }

  // TikTok
  const detail = await fetchJson(
    "/api/v1/tiktok/app/v3/fetch_one_video_by_share_url",
    buildQuery({ share_url: shareUrl }),
    apiKey,
    host,
  );
  const playUrl = extractPlayUrlFromAweme(detail.data);
  if (!playUrl) {
    throw new TikhubConnectorError("no-play-url", "解析到作品，但取不到可下载的视频直链。");
  }
  return { platform, playUrl, videoId: extractVideoId(detail.data) };
}

/**
 * 解析一条分享链接 → 无水印直链（双域名全球化）。
 * 流程：① 实测选路挑生效 host（tikhubRoute：手动锁定 / sticky / locale 序探测两域，谁健康用谁）；
 *       ② 在该 host 上解析；③ 若像线路层网络失败（upstream）→ 自动切换到备域重试一次（更新 sticky）；
 *       ④ 两域都拿不到 host → no-route（三段式「换个网络或在高级设置手动指定线路」）。
 * locale 只影响探测顺序，绝不决定结果。
 */
export async function resolveShareVideo(
  shareText: string,
  apiKey: string,
  deps: TikhubDeps = {},
): Promise<ResolvedShareVideo> {
  if (!trim(apiKey)) {
    throw new TikhubConnectorError("missing-key", "尚未配置 TikHub API Key。");
  }
  const platform = detectSharePlatform(shareText);
  if (!platform) {
    throw new TikhubConnectorError(
      "unsupported-platform",
      "识别不到抖音或 TikTok 链接。v1 仅支持抖音/TikTok 分享链接。",
    );
  }
  const shareUrl = extractShareUrl(shareText);
  const fetchJson = deps.fetchJson || fetchTikhubJson;
  const resolveHost = deps.resolveHost || resolveTikhubHost;
  const failover = deps.failover || failoverTikhubHost;

  const host = await resolveHost();
  if (!host) {
    throw new TikhubConnectorError(
      "no-route",
      "连不上 TikHub：主线路和大陆加速线路都探测不通。请换个网络或代理后重试；也可在高级设置里手动指定线路。",
    );
  }

  try {
    return await resolveOnHost(platform, shareUrl, apiKey, host, fetchJson);
  } catch (error) {
    // 只有「像线路层网络问题」才值得切域重试（401/404 这类业务错切域没意义，原样冒泡）。
    if (!isRoutableFailure(error)) throw error;
    const alternate = await failover(host);
    if (!alternate) {
      throw new TikhubConnectorError(
        "no-route",
        "连不上 TikHub：主线路和大陆加速线路都探测不通。请换个网络或代理后重试；也可在高级设置里手动指定线路。",
      );
    }
    return await resolveOnHost(platform, shareUrl, apiKey, alternate, fetchJson);
  }
}
