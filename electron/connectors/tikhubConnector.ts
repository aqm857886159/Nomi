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
import { formatTikhubErrorMessage, type TikhubErrorKind } from "../shared/contracts/tikhubErrorKinds";
import type { ConnectorDefinition } from "./connectorDefinition";
import { TIKHUB_CONNECTOR_ID, TIKHUB_HOST_PRIMARY, TIKHUB_HOSTS } from "./tikhubHosts";
import { resolveTikhubHost, failoverTikhubHost } from "./tikhubRoute";
import { buildSearchResult, extractMediaUrls } from "./referenceSearch";
import {
  REFERENCE_PLATFORM_FACTS,
  type ReferencePlatform,
  type ReferenceSearchResult,
} from "../shared/contracts/referenceSearch";

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

// connector 层错误分类单一 owner 在中立契约层（renderer+main 共用 + 唯一一份 kind 提取器）：
export type { TikhubErrorKind };

export class TikhubConnectorError extends Error {
  kind: TikhubErrorKind;
  /** 上游 http status（若有），仅供日志/诊断。 */
  status?: number;
  constructor(kind: TikhubErrorKind, message: string, status?: number) {
    // ⚠️ Electron IPC 只序列化 Error.message（自定义字段 .kind 会被剥掉），所以把 kind 做成
    // 机读前缀 [tikhub:<kind>] 嵌进 message——这样跨 IPC 后渲染层仍能从 message 里稳定还原 kind，
    // 不再退化成通用「保存失败」。formatTikhubErrorMessage 是单一 owner（渲染层剥前缀只留人话）。
    super(formatTikhubErrorMessage(kind, message));
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

/**
 * Test-only upstream seam. It is deliberately opt-in, loopback-only, and
 * active only for isolated Electron journeys; a malformed value fails closed
 * instead of silently falling back to the real TikHub hosts.
 */
export function getTikhubTestOrigin(): string | null {
  const raw = trim(process.env.NOMI_TIKHUB_TEST_ORIGIN);
  if (!raw) return null;
  if (process.env.NOMI_E2E !== "1") {
    throw new TikhubConnectorError("bad-response", "TikHub 本地测试线路只允许在 E2E 测试进程中启用。");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TikhubConnectorError("bad-response", "TikHub 本地测试线路地址无效。");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (!loopback || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new TikhubConnectorError("bad-response", "TikHub 本地测试线路必须是无凭据的 loopback origin。");
  }
  return parsed.origin;
}

async function resolveRuntimeHost(deps: TikhubDeps): Promise<string | null> {
  if (deps.resolveHost) return deps.resolveHost();
  const testOrigin = getTikhubTestOrigin();
  if (testOrigin) return new URL(testOrigin).host;
  return resolveTikhubHost();
}

type TikhubDeps = {
  /** 出站发送器（默认 hardenedFetch）。host 由选路给定。传 jsonBody 即 POST。测试注入。 */
  fetchJson?: (
    path: string,
    query: Record<string, string>,
    apiKey: string,
    host: string,
    jsonBody?: Record<string, unknown>,
  ) => Promise<JsonRecord>;
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
  /**
   * 传了就发 POST + JSON body（TikHub 的检索族有一半是 POST，如 tiktok/ads/search_ads、
   * douyin/search/fetch_video_search_v1）。**加固参数一字不改**——白名单、敏感头剥离、
   * 禁重定向、字节上限、超时全部沿用 GET 那条路，不给 POST 开任何口子。
   */
  jsonBody?: Record<string, unknown>,
): Promise<JsonRecord> {
  const testOrigin = getTikhubTestOrigin();
  const url = new URL(path, testOrigin && new URL(testOrigin).host === host ? testOrigin : `https://${host}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  // 生产只允许 TikHub 候选域；隔离 E2E 只允许同一个 loopback origin。
  const productionHostAllowed = !testOrigin && (TIKHUB_HOSTS as readonly string[]).includes(url.hostname.toLowerCase());
  const testOriginAllowed = Boolean(testOrigin && url.origin === testOrigin && url.hostname === new URL(testOrigin).hostname);
  if (!productionHostAllowed && !testOriginAllowed) {
    throw new TikhubConnectorError("bad-response", `TikHub 出站目标非法：${url.hostname}`);
  }

  let result;
  try {
    result = await hardenedFetch(url.toString(), {
      method: jsonBody ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(jsonBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(jsonBody ? { body: JSON.stringify(jsonBody) } : {}),
      sensitiveHeaders: ["authorization"],
      allowRedirect: false,
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 30_000,
      throwOnNon2xx: false,
      ...(testOriginAllowed && testOrigin ? { allowedPrivateOrigins: [testOrigin] } : {}),
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
    const msg = extractTikhubErrorMessage(body) || `TikHub 请求失败（${effective}）`;
    if (effective === 401) throw new TikhubConnectorError("auth", msg, effective);
    // 402 余额不足与 403 权限不足处置相同（都得去 tikhub.io 处理），归一到 quota。
    if (effective === 402 || effective === 403) throw new TikhubConnectorError("quota", msg, effective);
    if (effective === 404) throw new TikhubConnectorError("not-found", msg, effective);
    // 429 单列：它只要等一下再试，不该让用户以为要充值。
    if (effective === 429) throw new TikhubConnectorError("rate-limited", msg, effective);
    if (effective >= 500) throw new TikhubConnectorError("upstream", msg, effective);
    throw new TikhubConnectorError("bad-response", msg, effective);
  }
  return body;
}

/**
 * 从 TikHub 的错误响应里捞一句人话。
 *
 * ⚠️ **不能只读顶层 `message_zh`/`message`**：实调 2026-09-07 发现错误走的是另一套信封——
 *   · 401 无效 key → `{"detail": {"code": 401, "message": "Invalid API token, ..."}}`
 *   · 422 参数错   → `{"detail": [{"type": "int_parsing", "loc": [...], "msg": "..."}]}`
 * 顶层读不到时用户只会看到「TikHub 请求失败（401）」这种废话。
 * （docs.tikhub.io 并未规定统一 error envelope——见 docs/plan/2026-09-07-find-reference-connector.md。）
 */
export function extractTikhubErrorMessage(body: JsonRecord): string {
  const top = firstString(body.message_zh, body.message);
  if (top) return top;
  const detail = body.detail;
  if (typeof detail === "string") return detail.trim();
  if (isJsonRecord(detail)) return firstString(detail.message_zh, detail.message, detail.msg);
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((entry) => (isJsonRecord(entry) ? firstString(entry.msg, entry.message) : ""))
      .filter(Boolean);
    if (msgs.length > 0) return msgs.join("；");
  }
  return "";
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

/** 鉴权校验端点（一手 openapi.json，checkedAt 2026-09-01）：
 *  GET /api/v1/tikhub/user/get_user_info —— `security:[{HTTPBearer:[]}]`（**必须**带 Bearer），无参，
 *  是查「当前账号信息」的免费账户端点（非按次计费的抓取端点）。无效 key → 401 → 本层归为 `auth`。
 *  选它做 saveKey 的真实校验：既能区分「key 无效(401)」与「线路不通(no-route/upstream)」，又不烧抓取额度。
 *  ⚠️ 不能用 /api/v1/health/check 校验 key——它无鉴权，任何字符串都会「通过」（正是假成功的根因）。 */
const VERIFY_KEY_PATH = "/api/v1/tikhub/user/get_user_info";

/**
 * 真实校验一把 TikHub key（保存前调用，杜绝「乱填也显示已连接」）。
 * 走与解析同一条边界：实测选路挑生效 host → 对鉴权账户端点发一次带 Bearer 的请求。
 *   · 2xx 且信封 code<400 → key 有效（resolve 成功）。
 *   · 401 → `auth`（key 无效/过期）；403 → `quota`；其余 http/信封错按 fetchTikhubJson 的分类冒泡。
 *   · 主选 host 像线路层网络失败（upstream）→ 自动切备域重试一次；两域都不通 → `no-route`。
 * 空 key 直接 `missing-key`。locale 只影响探测顺序，绝不决定结果。
 */
export async function verifyTikhubApiKey(apiKey: string, deps: TikhubDeps = {}): Promise<void> {
  if (!trim(apiKey)) {
    throw new TikhubConnectorError("missing-key", "尚未配置 TikHub API Key。");
  }
  const fetchJson = deps.fetchJson || fetchTikhubJson;
  const resolveHost = () => resolveRuntimeHost(deps);
  const failover = deps.failover || failoverTikhubHost;

  const host = await resolveHost();
  if (!host) {
    throw new TikhubConnectorError(
      "no-route",
      "连不上 TikHub：主线路和大陆加速线路都探测不通。请换个网络或代理后重试；也可在高级设置里手动指定线路。",
    );
  }

  try {
    // 成功即代表鉴权通过（信封已由 fetchTikhubJson 校验 code<400，401/403 已在其中抛出）。
    await fetchJson(VERIFY_KEY_PATH, {}, apiKey, host);
  } catch (error) {
    if (!isRoutableFailure(error)) throw error;
    const alternate = await failover(host);
    if (!alternate) {
      throw new TikhubConnectorError(
        "no-route",
        "连不上 TikHub：主线路和大陆加速线路都探测不通。请换个网络或代理后重试；也可在高级设置里手动指定线路。",
      );
    }
    await fetchJson(VERIFY_KEY_PATH, {}, apiKey, alternate);
  }
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
  const resolveHost = () => resolveRuntimeHost(deps);
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

// ── 找参考：跨平台检索 ─────────────────────────────────────────────────────────
// 端点按平台分族（TikHub 自己就是这么组织文档的：按平台而不是按能力）。
// 每个平台的请求形状不同（GET query vs POST body），响应形状也不同——
// 前者在这里吸收，后者交给 referenceSearch.ts 的 normalizer。
// 方案：docs/plan/2026-09-07-find-reference-connector.md

/** 一次检索的请求参数（平台无关的那部分）。 */
export type ReferenceSearchQuery = {
  platform: ReferencePlatform;
  /** 用户原样输入的关键词。 */
  keyword: string;
  /**
   * 实际打给上游的关键词。中文 → 英文索引平台时由调用方译好传进来，
   * 归一层据此产出 `translationReason` 让 UI 回显。不传就用 keyword。
   */
  effectiveKeyword?: string;
  /** TikTok 广告库限定：国家码，默认 US。其它平台忽略。 */
  countryCode?: string;
  /** TikTok 广告库限定：广告目标（1 流量 2 应用安装 3 转化 4 视频浏览 5 触达 6 潜客 7 商品销售）。 */
  objective?: number;
  /** 时间窗（天）。TikTok 广告库用 period；抖音映射到 publish_time 档位。 */
  periodDays?: number;
};

/** 每个平台的出站形状（路径 + 方法 + 参数组装）。新增平台只加一条。 */
function buildSearchRequest(
  q: ReferenceSearchQuery,
  keyword: string,
): { path: string; query: Record<string, string>; body?: Record<string, unknown> } {
  const facts = REFERENCE_PLATFORM_FACTS[q.platform];
  if (q.platform === "tiktok") {
    // POST。⚠️ limit 实测上限是 20——文档写「最大 50」是错的（传 30/50 都 422）。
    return {
      path: "/api/v1/tiktok/ads/search_ads",
      query: {},
      body: {
        keyword,
        period: q.periodDays ?? 30,
        country_code: trim(q.countryCode) || "US",
        page: 1,
        limit: facts.pageSize,
        order_by: "likes",
        ...(typeof q.objective === "number" ? { objective: q.objective } : {}),
      },
    };
  }
  if (q.platform === "douyin") {
    // POST。sort_type 1 = 最多点赞；publish_time 只认 0/1/7/180 这几档。
    const bucket = q.periodDays == null ? "0" : q.periodDays <= 1 ? "1" : q.periodDays <= 7 ? "7" : "180";
    return {
      path: "/api/v1/douyin/search/fetch_video_search_v1",
      query: {},
      body: { keyword, cursor: 0, sort_type: "1", publish_time: bucket, content_type: "1" },
    };
  }
  // 小红书是 GET + query，且时间筛选是**中文枚举**（填错不报错，只是静默失效）。
  return {
    path: "/api/v1/xiaohongshu/app_v2/search_notes",
    query: buildQuery({
      keyword,
      page: "1",
      sort_type: "general",
      note_type: "不限",
      time_filter: q.periodDays == null ? "不限" : q.periodDays <= 7 ? "一周内" : "半年内",
    }),
  };
}

/**
 * 跑一次跨平台参考素材检索。
 *
 * 与 resolveShareVideo 同款的选路 + 自动切备域，不另起一套（P1）。
 * 归一交给 referenceSearch.ts —— 本函数只管「怎么问」，不管「怎么读」。
 */
export type ReferenceSearchOutcome = {
  result: ReferenceSearchResult;
  /**
   * 条目 id → 媒体直链。**主进程内部用，绝不跨 IPC**：这些是平台侧短时签名 URL，
   * 没有理由流到渲染层；服务层在用户点「加入素材库」时就地取用（省掉再花一次钱重查）。
   */
  mediaUrls: Record<string, string>;
};

export async function searchReferences(
  q: ReferenceSearchQuery,
  apiKey: string,
  deps: TikhubDeps = {},
): Promise<ReferenceSearchOutcome> {
  if (!trim(apiKey)) {
    throw new TikhubConnectorError("missing-key", "尚未配置 TikHub API Key。");
  }
  const keyword = trim(q.effectiveKeyword) || trim(q.keyword);
  if (!keyword) {
    throw new TikhubConnectorError("bad-response", "请先输入要搜的关键词。");
  }
  const fetchJson = deps.fetchJson || fetchTikhubJson;
  const failover = deps.failover || failoverTikhubHost;

  const host = await resolveRuntimeHost(deps);
  if (!host) {
    throw new TikhubConnectorError(
      "no-route",
      "连不上 TikHub：主线路和大陆加速线路都探测不通。请换个网络或代理后重试；也可在高级设置里手动指定线路。",
    );
  }

  const req = buildSearchRequest(q, keyword);
  let body: JsonRecord;
  try {
    body = await fetchJson(req.path, req.query, apiKey, host, req.body);
  } catch (error) {
    if (!isRoutableFailure(error)) throw error;
    const alternate = await failover(host);
    if (!alternate) {
      throw new TikhubConnectorError(
        "no-route",
        "连不上 TikHub：主线路和大陆加速线路都探测不通。请换个网络或代理后重试；也可在高级设置里手动指定线路。",
      );
    }
    body = await fetchJson(req.path, req.query, apiKey, alternate, req.body);
  }
  return {
    result: buildSearchResult(q.platform, body, q.keyword, keyword),
    mediaUrls: extractMediaUrls(q.platform, body),
  };
}
