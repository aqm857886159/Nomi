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
  type ResolvedShareVideo,
} from "./tikhubConnector";
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

/** 存 TikHub key（走 catalog 唯一写入口，含非法字符守门 + safeStorage 加密）。 */
export function saveTikhubApiKey(payload: unknown): TikhubKeyStatus {
  const apiKey = trim((payload as JsonRecord)?.apiKey);
  if (!apiKey) throw new TikhubConnectorError("missing-key", "API Key 不能为空。");
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
 * （source=connector、rightsStatus:'unknown'）。用户随后用现有节点拆解它。
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
    rightsStatus: "unknown",
    fetchedAt: nowIso(),
  };
  const asset = await importRemoteAsset({
    projectId,
    url: resolved.playUrl,
    kind: "imported",
    fileName: resolved.videoId ? `${resolved.platform}-${resolved.videoId}.mp4` : `${resolved.platform}-video.mp4`,
    sourceEvidence: evidence,
  });
  return { asset, resolved };
}
