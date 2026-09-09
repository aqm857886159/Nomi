// TikHub connector 的主进程编排层：凭据读取 + 解析 + 落项目素材（带 AssetSourceEvidence）。
//
// 凭据复用 catalog 的 safeStorage 存储（apiKeysByVendor['tikhub']），不另起加密管线（P1）。
// 解析出的直链原样进 importRemoteAsset（现有下载/校验/落盘链路，走 hardenedFetch）。
import { readCatalog, upsertModelCatalogVendorApiKey, clearModelCatalogVendorApiKey } from "../catalog/catalogStore";
import { apiKeyDecryptStatus, decryptApiKeyRecord, type ApiKeyDecryptStatus } from "../catalog/secrets";
import { importRemoteAsset } from "../assets/projectAssetStore";
import { nowIso, trim, type JsonRecord } from "../jsonUtils";
import type { AssetSourceEvidence } from "./connectorDefinition";
import {
  TIKHUB_CONNECTOR_ID,
  TikhubConnectorError,
  resolveShareVideo,
  searchReferences,
  verifyTikhubApiKey,
  getTikhubTestOrigin,
  type ResolvedShareVideo,
} from "./tikhubConnector";
import {
  isReferencePlatform,
  type ReferencePlatform,
  type ReferenceSearchResult,
} from "../shared/contracts/referenceSearch";
import { getTikhubRouteStatus, setTikhubRouteMode, type TikhubRouteStatus } from "./tikhubRoute";

/** 读 TikHub 明文 key（仅主进程内部用于出站；绝不跨 IPC 回渲染层）。 */
function readTikhubApiKey(): string {
  const state = readCatalog();
  return decryptApiKeyRecord(state.apiKeysByVendor[TIKHUB_CONNECTOR_ID]);
}

export type TikhubKeyStatus = {
  /** 复用凭据层的 ApiKeyDecryptStatus 单一 owner（secrets.ts），不另立词表。 */
  status: ApiKeyDecryptStatus;
  hasKey: boolean;
};

/** key 配置态（渲染层据此显示「已连接/未配置」，永不返回 key 明文）。 */
export function getTikhubKeyStatus(): TikhubKeyStatus {
  const state = readCatalog();
  const status = apiKeyDecryptStatus(state.apiKeysByVendor[TIKHUB_CONNECTOR_ID]);
  return { status, hasKey: status === "ok" };
}

/**
 * 存 TikHub key —— **先真实校验再落盘**（杜绝「乱填也显示已连接」的假成功，D4）。
 * 顺序 load-bearing：先对鉴权账户端点打一发验 key，**通过了才**写进凭据库；
 * 无效 key(401→auth) / 线路不通(no-route/upstream) 直接抛，绝不落盘一个坏 key。
 * 这样返回 status:'ok' 时，凭据库里躺的一定是刚校验过的有效 key（渲染层据此显示「已连接」才诚实）。
 */
export async function saveTikhubApiKey(payload: unknown): Promise<TikhubKeyStatus> {
  const apiKey = trim((payload as JsonRecord)?.apiKey);
  if (!apiKey) throw new TikhubConnectorError("missing-key", "API Key 不能为空。");
  await verifyTikhubApiKey(apiKey); // 校验失败在此抛出（auth/quota/no-route/…），下面的落盘不会执行
  upsertModelCatalogVendorApiKey(TIKHUB_CONNECTOR_ID, { apiKey, enabled: true });
  return getTikhubKeyStatus();
}

/** 清除 TikHub key。 */
export function clearTikhubApiKey(): TikhubKeyStatus {
  clearModelCatalogVendorApiKey(TIKHUB_CONNECTOR_ID);
  return getTikhubKeyStatus();
}

/** 线路状态（高级设置「线路」行读它：当前 mode + 生效域 + 候选域）。永不触网。 */
export function getTikhubRoute(): TikhubRouteStatus {
  return getTikhubRouteStatus();
}

/** 存手动线路模式（auto / 强制 io / 强制 dev）；回自动会清 sticky 让下次重新实测。 */
export function setTikhubRoute(payload: unknown): TikhubRouteStatus {
  setTikhubRouteMode((payload as JsonRecord)?.mode);
  return getTikhubRouteStatus();
}

/** 只解析（不落盘）——返回直链 + 平台 + 计费提示，供 UI 在落素材/拆解前展示费用确认。 */
export async function resolveTikhubShareUrl(payload: unknown): Promise<ResolvedShareVideo> {
  const shareText = trim((payload as JsonRecord)?.shareUrl ?? (payload as JsonRecord)?.shareText);
  if (!shareText) throw new TikhubConnectorError("unsupported-platform", "请粘贴分享链接。");
  return resolveShareVideo(shareText, readTikhubApiKey());
}

export type TikhubImportResult = {
  asset: unknown;
  resolved: ResolvedShareVideo;
};

/**
 * 解析 + 落成项目视频素材（一次 trusted 主进程调用）。素材带 AssetSourceEvidence
 * （source=connector、usageStatus:'rights_unknown'）。用户随后用现有节点拆解它。
 */
export async function importTikhubShareUrl(payload: unknown): Promise<TikhubImportResult> {
  const raw = (payload || {}) as JsonRecord;
  const projectId = trim(raw.projectId);
  const shareText = trim(raw.shareUrl ?? raw.shareText);
  if (!projectId) throw new TikhubConnectorError("bad-response", "缺少 projectId。");
  if (!shareText) throw new TikhubConnectorError("unsupported-platform", "请粘贴分享链接。");

  const resolved = await resolveShareVideo(shareText, readTikhubApiKey());
  const evidence: AssetSourceEvidence = {
    source: "connector",
    connectorId: TIKHUB_CONNECTOR_ID,
    originalUrl: shareText,
    resolvedUrl: resolved.playUrl,
    platform: resolved.platform,
    usageStatus: "rights_unknown",
    fetchedAt: nowIso(),
  };
  const asset = await importRemoteAsset({
    projectId,
    url: resolved.playUrl,
    kind: "reference",
    fileName: resolved.videoId ? `${resolved.platform}-${resolved.videoId}.mp4` : `${resolved.platform}-video.mp4`,
    sourceEvidence: evidence,
  }, (() => {
    const testOrigin = getTikhubTestOrigin();
    return testOrigin ? { trustedPrivateOrigin: testOrigin } : undefined;
  })());
  return { asset, resolved };
}

// ── 找参考：检索 + 把选中的一条落成项目素材 ───────────────────────────────────

/**
 * 上一次检索的「条目 id → 媒体直链」。**只在主进程内存里**，不跨 IPC。
 *
 * 为什么要缓存而不是落地时再查一次：三个平台的检索响应里**本来就带媒体直链**
 * （抖音 play_addr / 小红书 h264 master_url / 广告库 video_url.720p），再查一次
 * 等于白花一次计费请求。为什么不把直链放进 ReferenceItem：那些是**平台侧短时签名 URL**，
 * 没有理由让它们流到渲染层。
 *
 * 生命周期刻意简单：每次新检索整个替换（用户就是「搜完立刻点一条」）。
 * 取不到就明确报错让用户重搜，**不静默回退成再花一次钱**。
 */
let lastReferenceMedia: { platform: ReferencePlatform; urls: Record<string, string> } | null = null;

/** 跑一次检索。中文关键词打英文索引平台时由本层决定是否转译（当前：不自动译，先诚实回显现状）。 */
export async function searchTikhubReferences(payload: unknown): Promise<ReferenceSearchResult> {
  const raw = (payload || {}) as JsonRecord;
  const platform = raw.platform;
  if (!isReferencePlatform(platform)) {
    throw new TikhubConnectorError("unsupported-platform", "不支持的参考平台。");
  }
  const keyword = trim(raw.keyword);
  const query = {
    platform,
    keyword,
    effectiveKeyword: trim(raw.effectiveKeyword) || undefined,
    countryCode: trim(raw.countryCode) || undefined,
    objective: typeof raw.objective === "number" ? raw.objective : undefined,
    periodDays: typeof raw.periodDays === "number" ? raw.periodDays : undefined,
  };
  const { result, mediaUrls } = await searchReferences(query, readTikhubApiKey());
  // 直链来自**同一次响应**（纯提取、不再发请求），留在主进程备落地用。
  lastReferenceMedia = { platform, urls: mediaUrls };
  return result;
}

export type ReferenceImportResult = {
  asset: unknown;
  platform: ReferencePlatform;
  itemId: string;
};

/**
 * 把检索结果里选中的一条落成项目视频素材。
 *
 * 素材 usageStatus 取 **`reference_only`**（比贴链接那条的 `rights_unknown` 更保守）——
 * 这些是**平台上别人正在跑的商业素材**，只该当参考看，不该直接进成片（D4：缺口明着标）。
 */
export async function importTikhubReference(payload: unknown): Promise<ReferenceImportResult> {
  const raw = (payload || {}) as JsonRecord;
  const projectId = trim(raw.projectId);
  const platform = raw.platform;
  const itemId = trim(raw.itemId);
  if (!projectId) throw new TikhubConnectorError("bad-response", "缺少 projectId。");
  if (!isReferencePlatform(platform)) throw new TikhubConnectorError("unsupported-platform", "不支持的参考平台。");
  if (!itemId) throw new TikhubConnectorError("bad-response", "缺少要导入的条目 id。");

  const cached = lastReferenceMedia;
  const mediaUrl = cached && cached.platform === platform ? cached.urls[itemId] : "";
  if (!mediaUrl) {
    throw new TikhubConnectorError(
      "no-play-url",
      "这条参考的下载地址已过期（平台给的是短时链接）。重新搜一次再加入即可。",
    );
  }

  const evidence: AssetSourceEvidence = {
    source: "connector",
    connectorId: TIKHUB_CONNECTOR_ID,
    originalUrl: mediaUrl,
    resolvedUrl: mediaUrl,
    platform,
    usageStatus: "reference_only",
    fetchedAt: nowIso(),
  };
  const asset = await importRemoteAsset({
    projectId,
    url: mediaUrl,
    kind: "reference",
    fileName: `${platform}-ref-${itemId}.mp4`,
    sourceEvidence: evidence,
  }, (() => {
    const testOrigin = getTikhubTestOrigin();
    return testOrigin ? { trustedPrivateOrigin: testOrigin } : undefined;
  })());
  return { asset, platform, itemId };
}
