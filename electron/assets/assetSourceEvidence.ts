// 素材「来源记成什么」的唯一判定（docs/plan/2026-11-20-asset-source-one-home.md）。
//
// 各入口（本机导入、浏览器捕获、连接器、跨项目复制、外部助手导入）只交来源**事实**；落盘的来源结论只由这里出：
//   · finalizeAssetMeta：每一次写 sidecar 之前都过它——捕获族 originalUrl 置空 + 把调用方给的 sourceEvidence
//     当原始事实重新清洗（白名单字段、按来源类别定 usageStatus）。
//   · reconcileReuse：同一份字节已经在项目里时，这次能不能复用那条记录、要不要给它补上来源。
// 只许素材库自己的写入文件用（projectAssetStore / uploadContentStore / generatedAssetStaging）；
import { isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { isBrowserCaptureAssetKind } from "./assetPaths";
import type { AssetSourceEvidence, UsageStatus, IntendedRole } from "../connectors/connectorDefinition";
import { ASSET_PROVENANCE_ALLOWED_USAGES, ASSET_PROVENANCE_ALLOWED_ROLES } from "../connectors/connectorDefinition";
import type { ProviderNetworkConfig } from "../providerNetwork";
import type { CertificationMediaEvidence } from "../providerAdapter/certificationMedia";
import type { LocalizedAssetType } from "./localizedAsset";
import type { NotGeneratedKind, UserAssetMeta } from "./generatedAssetStaging";

/** 入口交上来的来源事实（只是输入；落盘形状由 finalizeAssetMeta 定）。 */
export type AssetSourceFact =
  | { source: "user" }
  | { source: "browser"; pageUrl: string }
  | (Omit<AssetSourceEvidence, "source" | "connectorId"> & { source: "connector"; connectorId: string });

/** moveAssetFile 仅接收非生成类素材，编译期强制带非生成 kind 与来源事实 sourceEvidence（替代已退役的 check:asset-evidence）。 */
export type MoveAssetFileMeta<K extends string = string> = UserAssetMeta<K> & { sourceEvidence: AssetSourceFact };

export type RemoteAssetImportOptions = {
  assertCurrent?: () => void;
  certificationEvidence?: CertificationMediaEvidence;
  /** 来源事实只收主进程调用方经这里给的（连接器）；渲染层 IPC 载荷里的 sourceEvidence 一律不读。 */
  sourceEvidence?: AssetSourceFact;
  /** 产出这条 URL 的那家 vendor 的自有线路配置（`Vendor.network`）。 */
  providerNetwork?: ProviderNetworkConfig;
};

/** 非生成类（connector / reference / upload 等）远端导入必填来源事实（替代已退役的 check:asset-evidence）。 */
export type NonGeneratedRemoteAssetImportOptions = Omit<RemoteAssetImportOptions, "sourceEvidence"> & { sourceEvidence: AssetSourceFact };

/** 渲染层 IPC 转发（nomi:assets:import-remote-url）专用选项：载荷不可信，严禁读载荷里的 sourceEvidence，仅由此显式标记通行。 */
export type UntrustedIpcRemoteAssetImportOptions = Pick<RemoteAssetImportOptions, "assertCurrent"> & { untrustedRendererIpc: true };

export type GeneratedRemoteAssetImportPayload = JsonRecord & { projectId: string; url: string; kind?: "generated"; expectedKind: LocalizedAssetType };
export type NonGeneratedRemoteAssetImportPayload<K extends string = string> = JsonRecord & { projectId: string; url: string; kind: NotGeneratedKind<K>; expectedKind?: null };

/**
 * 原始来源事实 → 落盘来源（P0-1 来源取证，docs/plan/2026-09-03-creative-resource-chain-epic.md）。
 *   · connector：必须有 connectorId；usageStatus 只收白名单值，缺省 rights_unknown。
 *   · browser / user：usageStatus 强制 reference_only（没核实过许可，不当可商用）。
 * 只有白名单字段能落盘；已有的时间戳原样保留（二次清洗结果不变）。
 */
function sanitizeSourceEvidence(raw: unknown): JsonRecord | undefined {
  if (!isJsonRecord(raw)) return undefined;
  const source = String(raw.source || "").trim();

  if (source === "connector") {
    const connectorId = String(raw.connectorId || "").trim();
    if (!connectorId) return undefined;
    const usageStatus = raw.usageStatus && ASSET_PROVENANCE_ALLOWED_USAGES.has(raw.usageStatus as UsageStatus)
      ? String(raw.usageStatus)
      : "rights_unknown";
    const result: JsonRecord = {
      source: "connector",
      connectorId,
      originalUrl: String(raw.originalUrl || "").trim(),
      resolvedUrl: String(raw.resolvedUrl || "").trim(),
      platform: String(raw.platform || "").trim(),
      usageStatus,
      fetchedAt: String(raw.fetchedAt || "").trim() || nowIso(),
    };
    if (raw.creator) result.creator = String(raw.creator).trim();
    if (raw.licenseId) result.licenseId = String(raw.licenseId).trim();
    if (raw.licenseUrl) result.licenseUrl = String(raw.licenseUrl).trim();
    if (raw.attribution) result.attribution = String(raw.attribution).trim();
    if (isJsonRecord(raw.licenseSnapshot)) {
      const snap: JsonRecord = { termsUrl: String(raw.licenseSnapshot.termsUrl || "").trim(), checkedAt: String(raw.licenseSnapshot.checkedAt || "").trim() };
      if (raw.licenseSnapshot.termsHash) snap.termsHash = String(raw.licenseSnapshot.termsHash).trim();
      result.licenseSnapshot = snap;
    }
    if (Array.isArray(raw.intendedRoles)) result.intendedRoles = allowedRoles(raw.intendedRoles);
    return result;
  }

  if (source === "browser") {
    const result: JsonRecord = {
      source: "browser",
      pageUrl: String(raw.pageUrl || "").trim(),
      capturedAt: String(raw.capturedAt || "").trim() || nowIso(),
      usageStatus: "reference_only",
    };
    if (raw.creator) result.creator = String(raw.creator).trim();
    if (raw.licenseId) result.licenseId = String(raw.licenseId).trim();
    if (raw.licenseUrl) result.licenseUrl = String(raw.licenseUrl).trim();
    if (Array.isArray(raw.intendedRoles)) result.intendedRoles = allowedRoles(raw.intendedRoles);
    return result;
  }

  if (source === "user") {
    const result: JsonRecord = {
      source: "user",
      capturedAt: String(raw.capturedAt || "").trim() || nowIso(),
      usageStatus: "reference_only",
    };
    if (raw.creator) result.creator = String(raw.creator).trim();
    if (Array.isArray(raw.intendedRoles)) result.intendedRoles = allowedRoles(raw.intendedRoles);
    return result;
  }

  return undefined;
}

function allowedRoles(roles: unknown[]): unknown[] {
  return roles.filter((role) => ASSET_PROVENANCE_ALLOWED_ROLES.has(role as IntendedRole));
}

/**
 * 写 sidecar 之前的唯一一道：调用方给的 meta 只是输入。
 * 隐私不变量（M0 捕捞窗评审定案）：网页捕捞类素材的 originalUrl 恒 null——否则 48h 信任窗会把用户浏览的网页 URL
 * 当参考发给生成商。来源只留清洗后的样子；清洗不出合法来源就不落 sourceEvidence。
 */
export function finalizeAssetMeta(rawMeta: JsonRecord): JsonRecord {
  const meta = isBrowserCaptureAssetKind(rawMeta.kind) ? { ...rawMeta, originalUrl: null } : rawMeta;
  if (!("sourceEvidence" in meta)) return meta;
  const { sourceEvidence: rawEvidence, ...rest } = meta;
  const sourceEvidence = sanitizeSourceEvidence(rawEvidence);
  return sourceEvidence ? { ...rest, sourceEvidence } : rest;
}

const EVIDENCE_TIMESTAMPS = new Set(["capturedAt", "fetchedAt"]);

/** 两份落盘来源是不是同一个来源：比较除时间戳外的全部白名单字段。 */
function sameSource(left: JsonRecord, right: JsonRecord): boolean {
  const strip = (value: JsonRecord) => JSON.stringify(Object.keys(value).filter((key) => !EVIDENCE_TIMESTAMPS.has(key)).sort().map((key) => [key, value[key]]));
  return strip(left) === strip(right);
}

/**
 * 同一份字节已经有一条记录（existing，读自它的 sidecar），这次又带着 incoming（已过 finalizeAssetMeta）进来：
 *   · 这次没带来源，或两边是同一个来源 → 原样复用，不改写旧记录（时间不重盖）；
 *   · 旧记录没有来源、这次有 → 复用并补上（fill）；
 *   · 两边来源不同 → 不复用，另起一条记录；旧记录不动——补来源抬不高它的 usageStatus。
 */
export function reconcileReuse(existing: JsonRecord, incoming: JsonRecord): { reuse: false } | { reuse: true; fill?: JsonRecord } {
  const incomingSource = isJsonRecord(incoming.sourceEvidence) ? incoming.sourceEvidence : undefined;
  if (!incomingSource) return { reuse: true };
  const existingSource = sanitizeSourceEvidence(existing.sourceEvidence);
  if (!existingSource) return { reuse: true, fill: incomingSource };
  return sameSource(existingSource, incomingSource) ? { reuse: true } : { reuse: false };
}
