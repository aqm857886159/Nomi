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

export const TIKHUB_BASE_URL = "https://api.tikhub.io";
export const TIKHUB_HOST = "api.tikhub.io";
/** 凭据 vendorKey：复用 catalog apiKeysByVendor 的 safeStorage 存储，不另起加密管线（P1）。 */
export const TIKHUB_CONNECTOR_ID = "tikhub";

/** connector 形态定义（§5.5 ConnectorDefinition）。 */
export const TIKHUB_CONNECTOR: ConnectorDefinition = {
  kind: "connector",
  id: TIKHUB_CONNECTOR_ID,
  name: "TikHub",
  baseUrl: TIKHUB_BASE_URL,
  transport: "native-api",
  auth: { kind: "api-key", secretOwner: "nomi-settings" },
  network: { allowedOrigins: [TIKHUB_HOST], redirectPolicy: "same-origin" },
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
  /** 出站发送器（默认 hardenedFetch）。测试注入。 */
  fetchJson?: (path: string, query: Record<string, string>, apiKey: string) => Promise<JsonRecord>;
};

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
 * 真出站：GET {base}{path}?{query}，Bearer 鉴权，全过 hardenedFetch（allowedOrigins=api.tikhub.io，
 * 禁重定向出域，Authorization 作敏感头跨域剥离）。非 2xx 不抛（throwOnNon2xx:false），
 * 由本函数读 status 分类。
 */
async function fetchTikhubJson(path: string, query: Record<string, string>, apiKey: string): Promise<JsonRecord> {
  const url = new URL(path, TIKHUB_BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  // allowedOrigins 硬校验：只允许 api.tikhub.io（防被改 path 打到别处）。
  if (url.hostname.toLowerCase() !== TIKHUB_HOST) {
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
 * 解析一条分享链接 → 无水印直链。
 * 抖音：先 fetch_video_high_quality_play_url(share_url)（一步拿 data.original_video_url）；
 *       取不到再兜底 fetch_one_video_by_share_url 抽 aweme。
 * TikTok：fetch_one_video_by_share_url(share_url) 抽 aweme。
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

  if (platform === "douyin") {
    // 首选：一步拿高画质无水印直链。region=CN 让抖音返回国内 CDN（下载更快）。
    const hq = await fetchJson(
      "/api/v1/douyin/web/fetch_video_high_quality_play_url",
      buildQuery({ share_url: shareUrl, region: "CN" }),
      apiKey,
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
  );
  const playUrl = extractPlayUrlFromAweme(detail.data);
  if (!playUrl) {
    throw new TikhubConnectorError("no-play-url", "解析到作品，但取不到可下载的视频直链。");
  }
  return { platform, playUrl, videoId: extractVideoId(detail.data) };
}
