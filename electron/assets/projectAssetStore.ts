import { assetIdentityOf, findProjectAssetById } from "./assetReferenceIdentity";
import { contentHashForFile, isContentAddressedUpload, persistUploadBytes, persistUploadFile, storedAssetRecord } from './uploadContentStore';
import { captureAssetWriteContext, type AssetWriteContext } from './assetWriteContext';
import type { ProjectBinding } from '../shared/projectBinding';
import type { ProjectAgentAttachmentClaim, ProjectAgentAttachmentRef } from '../shared/workbenchInput'
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { ProviderNetworkConfig } from "../providerNetwork";
import { fetchProviderMedia } from "./providerMediaFetch";
import { isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { projectDirById, sanitizeName } from "../projects/repository";
import { ensureDir } from "../runtimePaths";
import { broadcastAssetsUpdated } from "./assetEvents";
import { readAssetSidecarMeta, writeAssetSidecarMeta } from "./assetSidecar";
import { absolutePathFromLocalAssetUrl } from "./localAssetFile";
import { attachStoredAssetPreview, isStoredAssetPreviewPath, type StoredAssetPreview } from "./assetPreview";
import { copyFileWithProgress, type AssetCopyProgress } from "./assetImportProgress";
import { renameSyncWithRetry, retryOnSharingViolation } from "../jsonFile";
import { createUploadStagingDirSync, reapAbandonedUploadStaging, removeScratchAfterUse, removeScratchAfterUseSync } from "./scratchCleanup";
import { collectFilesRecursively, parseDataUrl } from "./assetBytes";
import {
  assetBucketFromMeta,
  canonicalAssetFileName,
  assetKindFromContentType,
  extensionFromMime,
  extensionFromUrl,
  localAssetUrl,
  sanitizeAssetMetaForKind,
  stableAssetId,
} from "./assetPaths";
import { mediaKindFromContentType, resolveContentType } from "./mediaTypes";
import { contentTypeFromStoredFile, effectiveContentType, storedAssetFileParts, uniqueAssetPath } from "./storedAssetFile";
import { validateGlbStructure } from "./model3dValidation";
import { isGeneratedAssetMeta, prepareVerifiedGeneratedAsset, type GeneratedAssetMeta, type NotGeneratedKind, type UserAssetMeta, type VerifiedStagedAsset } from "./generatedAssetStaging";
import { localizedAssetTypeOf, type LocalizedAssetType } from "./localizedAsset";
import type { CertificationMediaEvidence } from "../providerAdapter/certificationMedia";

import type { UsageStatus, IntendedRole } from "../connectors/connectorDefinition";
import { ASSET_PROVENANCE_ALLOWED_USAGES, ASSET_PROVENANCE_ALLOWED_ROLES } from "../connectors/connectorDefinition";

type LocalAssetRecord = {
  id: string;
  name: string;
  userId: "local";
  projectId: string;
  createdAt: string;
  updatedAt: string;
  data: {
    url: string;
    relativePath: string;
    absolutePath: string;
    contentType: string;
    size: number;
    kind: string;
  } & JsonRecord;
};

function validateStructuredAsset(contentType: string, bytes: Uint8Array): void {
  if (contentType === "model/gltf-binary") validateGlbStructure(bytes);
}

/**
 * 同步写入边界不写生成产物：生成产物要先异步校验（generatedAssetStaging.prepareVerifiedGeneratedAsset），
 * 再由 publishVerifiedGeneratedAsset 同步原子发布。绕过这两步直接写，拒写（fail closed）。
 */
function assertNotUnverifiedGenerated(meta: JsonRecord): void {
  if (isGeneratedAssetMeta(meta)) throw new Error("generated_output_requires_verified_publish");
}


export function writeAsset(
  projectId: string,
  bytes: Buffer,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
  context?: AssetWriteContext,
): unknown {
  // 唯一 sidecar 写入者之一：capture 族 originalUrl 恒 null 的不变量在此收口（见 assetPaths）。
  const meta = sanitizeAssetMetaForKind(rawMeta);
  assertNotUnverifiedGenerated(meta);
  const actualContentType = effectiveContentType(fileName, contentType, bytes);
  validateStructuredAsset(actualContentType, bytes);
  const storageFileName = canonicalAssetFileName(fileName, actualContentType);
  if (isContentAddressedUpload(meta)) return persistUploadBytes(projectId, bytes, storageFileName, actualContentType, meta, context);
  context?.assertCurrent();
  const { absolutePath } = uniqueAssetPath(projectId, storageFileName, actualContentType, assetBucketFromMeta(meta), context);
  fs.writeFileSync(absolutePath, bytes);
  writeAssetSidecarMeta(absolutePath, meta);
  broadcastAssetsUpdated(projectId);
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  return storedAssetRecord(projectId, absolutePath, sanitizeName(fileName, "asset"), actualContentType, meta, contentHash, context);
}

/**
 * 生成产物进项目只有这一道关口（generatedAssetStaging 暂存 → 字节 / 解码校验 → 发布），它下面三扇写入口都要说清
 * 「这份产物应该是哪一类」（expectedKind，必填）：任务结果传任务期望，本机生产者传自己产的那一类。
 * 字节不是那一类就不发布、不登记（V-1213：付了视频的钱，落进来一张参考图）。
 */
function generatedExpectation(expectedKind: LocalizedAssetType | null): LocalizedAssetType {
  if (!expectedKind) throw new Error("generated_output_expected_kind_required");
  return expectedKind;
}

/** 生成产物的字节入口：异步准备（暂存 + 校验）→ 同步原子发布。 */
export async function writeGeneratedAsset(
  projectId: string,
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
  expectedKind: LocalizedAssetType,
  context?: AssetWriteContext,
): Promise<unknown> {
  const staged = await prepareVerifiedGeneratedAsset({ projectId, source: { bytes }, fileName, contentType, rawMeta, expectedKind, ...(context ? { context } : {}) });
  return publishVerifiedGeneratedAsset(staged);
}

/**
 * Persist a generated output at a path derived from its materialization key.
 * A retry after a crash returns the same asset instead of creating `-2` copies.
 */
export async function writeGeneratedDeterministicAsset(
  projectId: string,
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
  expectedKind: LocalizedAssetType,
  materializationKey: string,
): Promise<unknown> {
  const staged = await prepareVerifiedGeneratedAsset({ projectId, source: { bytes }, fileName, contentType, rawMeta, expectedKind });
  return publishVerifiedGeneratedAsset(staged, { materializationKey });
}

/**
 * 载荷的 kind 不定（远端取回，importRemoteAssetToStore 一处用）：生成产物走两步发布，其余照旧同步写。
 * 只在本模块里用、不导出：kind 是数据、期望类型可空，「生成产物 ⇒ 期望类型非空」在这里只有运行时能查
 * （generatedExpectation）；它的配对在公开入口 importRemoteAsset 的类型（RemoteAssetImportPayload）上。
 * 模块外的字节：生成产物走 writeGeneratedAsset，用户的东西走 writeAsset（2026-11-07 复盘必改 ①）。
 */
async function storeAssetBytes(
  projectId: string,
  bytes: Buffer,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
  expectedKind: LocalizedAssetType | null,
  context?: AssetWriteContext,
): Promise<unknown> {
  return isGeneratedAssetMeta(sanitizeAssetMetaForKind(rawMeta))
    ? writeGeneratedAsset(projectId, bytes, fileName, contentType, rawMeta, generatedExpectation(expectedKind), context)
    : writeAsset(projectId, bytes, fileName, contentType, rawMeta, context);
}

/**
 * 生成产物落盘的第二步，**同步**：复验项目身份 → 选路径 → renameSync 原子发布（暂存与正式路径同卷）→ sidecar → 广播。
 * 只收 VerifiedStagedAsset；整段不 await，所以并发发布同一资产不会交错。无论成败，暂存目录都在这里收掉。
 */
function publishVerifiedGeneratedAsset(staged: VerifiedStagedAsset, options: { materializationKey?: string } = {}): unknown {
  try {
    const { context, meta, fileName } = staged;
    const { projectId } = context;
    const actualContentType = effectiveContentType(fileName, staged.contentType, staged.header);
    context.assertCurrent();
    if (options.materializationKey === undefined) {
      const storageFileName = canonicalAssetFileName(fileName, actualContentType);
      const { absolutePath } = uniqueAssetPath(projectId, storageFileName, actualContentType, assetBucketFromMeta(meta), context);
      renameSyncWithRetry(staged.stagedPath, absolutePath);
      writeAssetSidecarMeta(absolutePath, meta);
      broadcastAssetsUpdated(projectId);
      return storedAssetRecord(projectId, absolutePath, sanitizeName(fileName, "asset"), actualContentType, meta, staged.contentHash, context);
    }
    const { stem, ext } = storedAssetFileParts(fileName, actualContentType);
    const keyHash = crypto.createHash("sha256").update(options.materializationKey).digest("hex").slice(0, 24);
    const relativePath = path.posix.join("assets", assetBucketFromMeta(meta), "materialized", `${stem}-${keyHash}${ext}`);
    const absolutePath = path.join(context.root, relativePath);
    ensureDir(path.dirname(absolutePath));
    if (fs.existsSync(absolutePath)) {
      const existingHash = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
      if (existingHash !== staged.contentHash) throw new Error("Deterministic materialization key maps to different bytes");
    } else {
      renameSyncWithRetry(staged.stagedPath, absolutePath);
    }
    // A prior attempt may have written pixels before its sidecar failed. Repair it
    // before reporting success; retain any metadata edited on the existing asset.
    fs.writeFileSync(`${absolutePath}.meta`, JSON.stringify({ ...meta, ...readAssetSidecarMeta(absolutePath) }));
    broadcastAssetsUpdated(projectId);
    const t = nowIso();
    return {
      id: stableAssetId(projectId, relativePath),
      name: sanitizeName(fileName, "asset"),
      userId: "local",
      projectId,
      createdAt: t,
      updatedAt: t,
      data: {
        ...meta,
        url: localAssetUrl(projectId, relativePath),
        relativePath,
        absolutePath,
        contentType: actualContentType,
        size: staged.size,
        contentHash: staged.contentHash,
      },
    };
  } finally {
    removeScratchAfterUseSync(staged.stagingDir);
  }
}

/** Copy an existing native file into the project without materializing it as a main-process Buffer. */
export type CopyAssetFileOptions = {
  /** 拷贝流的字节回调：导入中节点的渐显靠它驱动（没有就走原来的整块 copyFile）。 */
  onCopyProgress?: AssetCopyProgress
  /** 与拷贝并行派生的那一帧预览；落盘后由 attachStoredAssetPreview 认领，不重派生。 */
  preparedPreview?: StoredAssetPreview | Promise<StoredAssetPreview | undefined>
};

/**
 * 本机文件进项目（不把整份读进主进程内存）。meta 与期望类型**成对**写，二选一：
 *   · 生成产物：kind 写死 "generated"，期望类型必须是它该是的那一类（落盘关口按字节核）；
 *   · 用户的东西：kind 写明（字面量，或 checkedUserAssetKind 核过的），期望类型给 null。
 * 「生成产物 + null」「生成产物 + 可能为 null」「随手一个 JsonRecord / string 当 kind」都编译不过（2026-11-07 复盘必改 ①：
 * 以前签名是 JsonRecord + `LocalizedAssetType | null`，主进程里写得出生成产物不带期望类型，付费执行器要花完钱才在关口抛）。
 */
export function copyAssetFile(
  projectId: string, sourcePath: string, fileName: string, contentType: string,
  rawMeta: GeneratedAssetMeta, expectedKind: LocalizedAssetType,
  captured?: AssetWriteContext, options?: CopyAssetFileOptions,
): Promise<unknown>;
export function copyAssetFile<K extends string>(
  projectId: string, sourcePath: string, fileName: string, contentType: string,
  rawMeta: UserAssetMeta<K>, expectedKind: null,
  captured?: AssetWriteContext, options?: CopyAssetFileOptions,
): Promise<unknown>;
export function copyAssetFile(
  projectId: string, sourcePath: string, fileName: string, contentType: string,
  rawMeta: JsonRecord, expectedKind: LocalizedAssetType | null,
  captured?: AssetWriteContext, options: CopyAssetFileOptions = {},
): Promise<unknown> {
  return copyAssetFileByMeta(projectId, sourcePath, fileName, contentType, rawMeta, expectedKind, captured, options);
}

/**
 * copyAssetFile 的实现，按 meta 的 kind 分流。只在本模块里用：kind 来自数据的两处（跨项目复制读 sidecar、
 * nomi-local 引用按载荷）走它，配对要求只能在运行时查（generatedExpectation）；模块外一律走上面成对的签名。
 */
async function copyAssetFileByMeta(
  projectId: string,
  sourcePath: string,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
  /** 生成产物给它该是的那一类，其余给 null；生成产物给 null 在落盘关口被拒。 */
  expectedKind: LocalizedAssetType | null,
  captured?: AssetWriteContext,
  options: CopyAssetFileOptions = {},
): Promise<unknown> {
  const context = captured ?? await captureAssetWriteContext(projectId);
  context.assertCurrent();
  const meta = sanitizeAssetMetaForKind(rawMeta);
  // 文件头无条件读：声明对不对要靠字节验，只在 octet-stream 时读等于「只在声明已经认输时才查证」。
  const header = await (async () => {
    const handle = await fs.promises.open(sourcePath, "r");
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  })();
  const actualContentType = effectiveContentType(fileName, contentType, header);
  if (isGeneratedAssetMeta(meta)) {
    // 生成产物：拷进本项目私有暂存、在暂存件上校验、同步原子发布——校验的就是发布的那一份。
    const staged = await prepareVerifiedGeneratedAsset({ projectId, source: { path: sourcePath, onCopyProgress: options.onCopyProgress }, fileName, contentType, rawMeta: meta, expectedKind: generatedExpectation(expectedKind), context });
    return attachStoredAssetPreview(publishVerifiedGeneratedAsset(staged), await options.preparedPreview);
  }
  if (actualContentType === "model/gltf-binary") validateStructuredAsset(actualContentType, await fs.promises.readFile(sourcePath));
  const storageFileName = canonicalAssetFileName(fileName, actualContentType);
  const stored = isContentAddressedUpload(meta)
    ? await persistUploadFile(projectId, sourcePath, storageFileName, actualContentType, meta, context, options.onCopyProgress)
    : await copyNativeFileToBucket(context, sourcePath, fileName, storageFileName, actualContentType, meta, options.onCopyProgress);
  // 原生路径拷贝是本地导入 / Finder 粘贴拖入 / MCP import_asset / 跨项目复制的共用门：预览在这里派生一次。
  return attachStoredAssetPreview(stored, await options.preparedPreview);
}

// 拷贝仍然先落暂存、再 link 进桶（AssetWriteContext 那条「写回世代必须还是发起时那个项目」的规矩不动）；
// 本次只把**字节回调**接进来：进度是拷贝过程的副产物，不是另一条写盘路（P1：不开第二条）。
async function copyNativeFileToBucket(context: AssetWriteContext, sourcePath: string, fileName: string, storageFileName: string, contentType: string, meta: JsonRecord, onCopyProgress?: AssetCopyProgress): Promise<unknown> {
  context.assertCurrent();
  const { projectId } = context;
  reapAbandonedUploadStaging(context.root);
  const staging = createUploadStagingDirSync(context.root);
  const snapshot = path.join(staging, 'content');
  try {
    await copyFileWithProgress(sourcePath, snapshot, onCopyProgress);
    const contentHash = await contentHashForFile(snapshot);
    context.assertCurrent();
    const { absolutePath } = uniqueAssetPath(projectId, storageFileName, contentType, assetBucketFromMeta(meta), context);
    retryOnSharingViolation(() => fs.linkSync(snapshot, absolutePath));
    writeAssetSidecarMeta(absolutePath, meta);
    broadcastAssetsUpdated(projectId);
    return storedAssetRecord(projectId, absolutePath, sanitizeName(fileName, "asset"), contentType, meta, contentHash, context);
  } finally { await removeScratchAfterUse(staging); }
}

/**
 * Copy an already stored project asset by project id + relative path.
 *
 * This is deliberately narrower than copy-files: renderer code never submits
 * an arbitrary native path. The source project directory and realpath are
 * checked in main before the existing media validation/copy boundary runs.
 */
export async function copyProjectAsset(input: {
  sourceProjectId: string
  targetProjectId: string
  relativePath: string
}): Promise<unknown> {
  const sourceProjectId = String(input.sourceProjectId || '').trim()
  const targetProjectId = String(input.targetProjectId || '').trim()
  const relativePath = String(input.relativePath || '').replace(/\\/g, '/').trim()
  if (!sourceProjectId || !targetProjectId || !relativePath) throw new Error('sourceProjectId, targetProjectId and relativePath are required')
  if (path.posix.isAbsolute(relativePath) || relativePath.split('/').some((segment) => segment === '..')) {
    throw new Error('asset relativePath is unsafe')
  }
  const sourceRoot = projectDirById(sourceProjectId)
  if (!sourceRoot) throw new Error('Source project not found')
  const targetRoot = projectDirById(targetProjectId)
  if (!targetRoot) throw new Error('Target project not found')
  const resolvedRoot = path.resolve(sourceRoot)
  const sourcePath = path.resolve(resolvedRoot, relativePath)
  if (sourcePath !== resolvedRoot && !sourcePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('asset path escapes source project')
  }
  const realRoot = await fs.promises.realpath(resolvedRoot)
  const realSourcePath = await fs.promises.realpath(sourcePath)
  if (realSourcePath !== realRoot && !realSourcePath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('asset path escapes source project')
  }
  const stat = await fs.promises.stat(realSourcePath)
  if (!stat.isFile()) throw new Error('source asset is not a file')
  const storedContentType = contentTypeFromStoredFile(realSourcePath)
  return copyAssetFileByMeta(
    targetProjectId,
    realSourcePath,
    path.basename(relativePath),
    storedContentType,
    readAssetSidecarMeta(realSourcePath),
    // 跨项目复制一份已落过关的产物：它该是的就是它存着的那一类（关口照样重核字节）。
    localizedAssetTypeOf(mediaKindFromContentType(storedContentType)),
  )
}

export function moveAssetFile(
  projectId: string,
  sourcePath: string,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
): unknown {
  // 唯一 sidecar 写入者之二：与 writeAsset 同一道 capture 族隐私收口。
  const meta = sanitizeAssetMetaForKind(rawMeta);
  assertNotUnverifiedGenerated(meta);
  // 同 copyAssetFile：无条件读文件头，否则撒谎的声明永远没人查证。
  const header = (() => {
    const handle = fs.openSync(sourcePath, "r");
    try {
      const bytes = Buffer.alloc(4096);
      const bytesRead = fs.readSync(handle, bytes, 0, bytes.length, 0);
      return bytes.subarray(0, bytesRead);
    } finally {
      fs.closeSync(handle);
    }
  })();
  const actualContentType = effectiveContentType(fileName, contentType, header);
  if (actualContentType === "model/gltf-binary") validateStructuredAsset(actualContentType, fs.readFileSync(sourcePath));
  const storageFileName = canonicalAssetFileName(fileName, actualContentType);
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, storageFileName, actualContentType, assetBucketFromMeta(meta));
  try {
    // 刚下载 / 刚生成的文件常被杀毒实时扫描短暂开着：改名先按共享冲突退避重试。
    renameSyncWithRetry(sourcePath, absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.copyFileSync(sourcePath, absolutePath);
    // 已经拷进项目：删源文件只是收尾，删不掉不能把这次落盘报成失败。
    removeScratchAfterUseSync(sourcePath);
  }
  const stat = fs.statSync(absolutePath);
  writeAssetSidecarMeta(absolutePath, meta);
  broadcastAssetsUpdated(projectId);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: stableAssetId(projectId, relativePath),
    name: sanitizeName(fileName, "asset"),
    userId: "local",
    projectId,
    createdAt: t,
    updatedAt: t,
    data: {
      ...meta,
      url,
      relativePath,
      absolutePath,
      contentType: actualContentType,
      size: stat.size,
    },
  };
}

type RemoteAssetImportOptions = {
  assertCurrent?: () => void;
  certificationEvidence?: CertificationMediaEvidence;
  /**
   * 产出这条 URL 的那家 vendor 的自有线路配置（`Vendor.network`）。
   *
   * 不带它就是 2026-09-06 验收那个不对称的另一半：给某家供应商单独配了代理时，提交走那条代理、
   * 取回却走应用默认线路——同一次生成的两半在两条路上。谁产的 URL 就用谁的路。
   * 传配置而不是传 dispatcher，是为了让连接池的生命周期收在本模块内（建了必关，只属于这一次下载），
   * 不散给每一个调用方各记一遍。
   */
  providerNetwork?: ProviderNetworkConfig;
};

// 运行时白名单：从 connectorDefinition.ts 导入，单一真相源，不在此处重复成员列表。
const VALID_USAGE_STATUSES = ASSET_PROVENANCE_ALLOWED_USAGES;
const VALID_INTENDED_ROLES = ASSET_PROVENANCE_ALLOWED_ROLES;

/**
 * Sanitize a caller-supplied source-evidence record into the provenance shape
 * (docs/plan/2026-09-03-creative-resource-chain-epic.md P0-1).
 *
 * 三类来源：
 *   · connector  : 经 ConnectorDefinition 摄取；必须有 connectorId；
 *                  旧 sidecar 的 rightsStatus:"unknown" 自动迁移成 usageStatus:"rights_unknown"。
 *   · browser    : 用户从浏览器手工导入；usageStatus 强制为 reference_only（诚实默认）。
 *   · user       : 用户从本地文件导入；usageStatus 强制为 reference_only。
 *
 * 只有白名单字段能穿越到 sidecar，防止 untrusted payload 污染。
 * 新写入路径必须带 usageStatus，缺失时按 source 类型降到最保守的默认值（fail-closed）。
 */
export function sanitizeSourceEvidence(raw: unknown): JsonRecord | undefined {
  if (!isJsonRecord(raw)) return undefined;
  const source = String(raw.source || "").trim();

  // ── connector 来源 ───────────────────────────────────────────────────────
  if (source === "connector") {
    const connectorId = String(raw.connectorId || "").trim();
    if (!connectorId) return undefined;

    // 旧 sidecar 迁移：rightsStatus:"unknown" → usageStatus:"rights_unknown"
    let usageStatus: string = "rights_unknown";
    if (raw.usageStatus && VALID_USAGE_STATUSES.has(raw.usageStatus as UsageStatus)) {
      usageStatus = String(raw.usageStatus);
    } else if (raw.rightsStatus === "unknown") {
      usageStatus = "rights_unknown";
    }

    const result: JsonRecord = {
      source: "connector",
      connectorId,
      originalUrl: String(raw.originalUrl || "").trim(),
      resolvedUrl: String(raw.resolvedUrl || "").trim(),
      platform: String(raw.platform || "").trim(),
      usageStatus,
      fetchedAt: String(raw.fetchedAt || "").trim() || nowIso(),
    };
    // 可选扩展字段（白名单）
    if (raw.creator) result.creator = String(raw.creator).trim();
    if (raw.licenseId) result.licenseId = String(raw.licenseId).trim();
    if (raw.licenseUrl) result.licenseUrl = String(raw.licenseUrl).trim();
    if (raw.attribution) result.attribution = String(raw.attribution).trim();
    if (isJsonRecord(raw.licenseSnapshot)) {
      const snap: JsonRecord = { termsUrl: String(raw.licenseSnapshot.termsUrl || "").trim(), checkedAt: String(raw.licenseSnapshot.checkedAt || "").trim() };
      if (raw.licenseSnapshot.termsHash) snap.termsHash = String(raw.licenseSnapshot.termsHash).trim();
      result.licenseSnapshot = snap;
    }
    if (Array.isArray(raw.intendedRoles)) {
      result.intendedRoles = raw.intendedRoles.filter((r) => VALID_INTENDED_ROLES.has(r as IntendedRole));
    }
    return result;
  }

  // ── browser 来源 ─────────────────────────────────────────────────────────
  if (source === "browser") {
    const pageUrl = String(raw.pageUrl || "").trim();
    const capturedAt = String(raw.capturedAt || "").trim() || nowIso();
    // 浏览器导入：usageStatus 强制为 reference_only（诚实默认，没核实过许可不能当作可商用）
    const result: JsonRecord = {
      source: "browser",
      pageUrl,
      capturedAt,
      usageStatus: "reference_only",
    };
    if (raw.creator) result.creator = String(raw.creator).trim();
    if (raw.licenseId) result.licenseId = String(raw.licenseId).trim();
    if (raw.licenseUrl) result.licenseUrl = String(raw.licenseUrl).trim();
    if (Array.isArray(raw.intendedRoles)) {
      result.intendedRoles = raw.intendedRoles.filter((r) => VALID_INTENDED_ROLES.has(r as IntendedRole));
    }
    return result;
  }

  // ── user（本地文件）来源 ─────────────────────────────────────────────────
  if (source === "user") {
    // 本地文件导入：usageStatus 强制为 reference_only（来源不明，不推断可商用）
    const result: JsonRecord = {
      source: "user",
      capturedAt: String(raw.capturedAt || "").trim() || nowIso(),
      usageStatus: "reference_only",
    };
    if (raw.creator) result.creator = String(raw.creator).trim();
    if (Array.isArray(raw.intendedRoles)) {
      result.intendedRoles = raw.intendedRoles.filter((r) => VALID_INTENDED_ROLES.has(r as IntendedRole));
    }
    return result;
  }

  return undefined;
}

/**
 * 远端（http / data: / nomi-local）导入的载荷。运行时 kind 不写时，http / data: 当生成产物，nomi-local 当 upload；
 * 类型上按最严的读：不写 kind 或写 "generated"，就必须给出它该是的那一类，给 null 编译不过；用户的东西
 * （reference / upload）把 kind 写明，期望类型不写或给 null。渲染层经 IPC 来的载荷不过类型系统，
 * 主进程照样按 localizedAssetTypeOf 再读一遍，生成产物没说清在落盘关口被拒（generatedExpectation）。
 */
export type RemoteAssetImportPayload<K extends string = string> = JsonRecord & { projectId: string; url: string } & (
  | { kind?: "generated"; expectedKind: LocalizedAssetType }
  | { kind: NotGeneratedKind<K>; expectedKind?: null }
);

export async function importRemoteAsset<K extends string = string>(payload: RemoteAssetImportPayload<K>, options: RemoteAssetImportOptions = {}): Promise<unknown> {
  // 画布预览（图片缩略 / 视频 poster）在落盘边界统一派生：三种来源（项目内引用 / data: / http(s)）出同一扇门。
  return attachStoredAssetPreview(await importRemoteAssetToStore(payload, options));
}

async function importRemoteAssetToStore(payload: unknown, options: RemoteAssetImportOptions): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  const url = String(raw.url || "").trim();
  if (!projectId) throw new Error("projectId is required");
  if (!url) throw new Error("url is required");
  const context = await captureAssetWriteContext(projectId, raw.projectBinding as ProjectBinding | undefined, options.assertCurrent);
  const sourceEvidence = sanitizeSourceEvidence(raw.sourceEvidence);
  // 生成产物应是哪一类，由调用方说（渲染层 / 主进程都一样）；没说或说不清，生成产物在关口被拒。
  const expectedKind = localizedAssetTypeOf(raw.expectedKind);
  if (url.startsWith("nomi-local://")) {
    // Reuse the canonical original, not a synthetic URL receipt or preview. The same
    // identity must be valid for Agent claims, generation references and history.
    const absolutePath = absolutePathFromLocalAssetUrl(url, projectId);
    context.assertCurrent();
    if (!absolutePath || !fs.existsSync(absolutePath) || isStoredAssetPreviewPath(absolutePath)) throw new Error("project_agent_attachment_invalid");
    const relativePath = path.relative(context.root, absolutePath).replace(/\\/g, "/");
    const existing = findProjectAssetById(stableAssetId(projectId, relativePath), cursor => listProjectAssets({ projectId, limit: 500, cursor }));
    if (existing) {
      const identity = assetIdentityOf(existing);
      if (!identity) throw new Error("project_agent_attachment_invalid");
      return { ...existing, data: { ...existing.data, ...identity } };
    }
    // Workspace media may live outside assets/. Admit it through the existing
    // original-byte store before returning an attachable identity.
    return copyAssetFileByMeta(projectId, absolutePath, path.basename(absolutePath),
      contentTypeFromStoredFile(absolutePath), { kind: raw.kind || "upload" }, expectedKind, context);
  }
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const ext = extensionFromMime(parsed.contentType, "bin");
    return storeAssetBytes(
      projectId,
      parsed.bytes,
      String(raw.fileName || `asset-${Date.now()}.${ext}`),
      options.certificationEvidence?.contentType || parsed.contentType,
      { kind: raw.kind || "generated", originalUrl: null, ...(sourceEvidence ? { sourceEvidence } : {}), ...(options.certificationEvidence ? { certificationEvidence: options.certificationEvidence } : {}) },
      expectedKind,
      context,
    );
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s), data, and nomi-local assets are supported");
  const fetched = await fetchProviderMedia(url, {
    ...(options.providerNetwork ? { providerNetwork: options.providerNetwork } : {}),
  });
  const bytes = fetched.bytes;
  const hintedContentType = fetched.contentType || "application/octet-stream";
  const rawFileName = String(raw.fileName || path.basename(new URL(url).pathname) || "").trim();
  const contentType = options.certificationEvidence?.contentType || (hintedContentType.toLowerCase().split(";")[0] === "application/octet-stream"
    ? resolveContentType(rawFileName || url, bytes)
    : hintedContentType);
  const ext = extensionFromMime(contentType, extensionFromUrl(url));
  const fileName = rawFileName || `asset-${Date.now()}.${ext}`;
  return storeAssetBytes(projectId, bytes, fileName.includes(".") ? fileName : `${fileName}.${ext}`, contentType, {
    kind: raw.kind || "generated",
    originalUrl: url,
    ownerNodeId: raw.ownerNodeId || null,
    ...(sourceEvidence ? { sourceEvidence } : {}),
    ...(options.certificationEvidence ? { certificationEvidence: options.certificationEvidence } : {}),
  }, expectedKind, context);
}

export function listProjectAssets(payload: unknown): { items: LocalAssetRecord[]; cursor: string | null } {
  const raw = payload as JsonRecord | undefined;
  const projectId = String(raw?.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) return { items: [], cursor: null };
  const assetsDir = path.join(projectDir, "assets");
  const requestedLimit = typeof raw?.limit === "number" && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : 200;
  const limit = Math.max(1, Math.min(500, requestedLimit));
  const offset = Math.max(0, Number.parseInt(String(raw?.cursor || "0"), 10) || 0);
  const kindFilter = typeof raw?.kind === "string" && raw.kind.trim() ? raw.kind.trim() : "";
  const records = collectFilesRecursively(assetsDir)
    .flatMap((absolutePath): LocalAssetRecord[] => {
      try {
        // 画布预览是源文件的派生物，不是独立素材：留在源旁边便于本地解析，但不进素材库列表。
        if (absolutePath.endsWith(".meta") || isStoredAssetPreviewPath(absolutePath)) return [];
        const stat = fs.statSync(absolutePath);
        const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, "/");
        const contentType = contentTypeFromStoredFile(absolutePath);
        const sidecarMeta = readAssetSidecarMeta(absolutePath);
        const mediaKind = assetKindFromContentType(contentType);
        const sidecarKind =
          typeof sidecarMeta.kind === "string" && sidecarMeta.kind.trim() ? sidecarMeta.kind.trim() : "";
        const kind = sidecarKind || mediaKind;
        if (kindFilter && kind !== kindFilter) return [];
        const createdAt = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString();
        const updatedAt = new Date(stat.mtimeMs).toISOString();
        return [
          {
            id: stableAssetId(projectId, relativePath),
            name: path.basename(absolutePath),
            userId: "local",
            projectId,
            createdAt,
            updatedAt,
            data: {
              ...sidecarMeta,
              url: localAssetUrl(projectId, relativePath),
              relativePath,
              absolutePath,
              contentType,
              size: stat.size,
              kind,
              mediaType:
                typeof sidecarMeta.mediaType === "string" && sidecarMeta.mediaType
                  ? sidecarMeta.mediaType
                  : mediaKind === "image" || mediaKind === "video" || mediaKind === "audio"
                    ? mediaKind
                    : undefined,
            },
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const items = records.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    cursor: nextOffset < records.length ? String(nextOffset) : null,
  };
}

function projectAgentAttachmentClaim(value: unknown): ProjectAgentAttachmentClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("project_agent_attachment_invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "assetId" && key !== "version") ||
    typeof record.assetId !== "string" ||
    !record.assetId.trim() ||
    record.version !== 1
  ) {
    throw new Error("project_agent_attachment_invalid");
  }
  return Object.freeze({ assetId: record.assetId, version: 1 });
}

/**
 * 一份项目素材的**可引用身份**（内容哈希 + 版本）。全仓只此一处算它。
 *
 * 版本恒 1 是内容寻址的推论，不是占位：素材按 `sha256/<hash>/` 落盘，改内容就是另一份素材、另一个
 * `assetId`（`core.ts` 导入那条路同样写死 1）。
 */

/**
 * assetId → 可引用身份。**模型只知道 assetId**（`look_at_media` 返回的就是它），内容哈希与版本
 * 归项目素材库管；生成计划的参考素材由宿主在这里补齐，而不是要求模型发明它拿不到的字段
 * （2026-09-18 根因，与「多镜不再要求模型发明 candidate」同一条纪律）。
 * 素材不属于本项目、或文件已经不在盘上 → `undefined`，由调用方给出人话拒绝。
 */
export function resolveProjectAssetReferenceIdentity(
  projectId: string,
  assetId: string,
): Readonly<{ contentHash: string; version: 1; kind?: "image" | "video" | "audio" }> | undefined {
  const wanted = assetId.trim();
  if (!wanted) return undefined;
  const asset = findProjectAssetById(wanted, cursor => listProjectAssets({ projectId, limit: 500, cursor }));
  if (!asset || asset.projectId !== projectId) return undefined;
  const identity = assetIdentityOf(asset);
  if (!identity) return undefined;
  // 参考的种类归素材本身（媒体类型），不归调用方——传输层按它选图片 / 视频通道。
  const contentType = asset.data.contentType;
  const mediaKind = typeof contentType === "string" ? assetKindFromContentType(contentType) : undefined;
  return mediaKind === "image" || mediaKind === "video" || mediaKind === "audio" ? { ...identity, kind: mediaKind } : identity;
}

/** Resolve untrusted renderer claims against the exact main-owned project asset index. */
export function resolveProjectAgentAttachmentClaims(
  projectId: string,
  rawClaims: readonly unknown[],
): readonly ProjectAgentAttachmentRef[] {
  if (!Array.isArray(rawClaims)) throw new Error("project_agent_attachment_invalid");
  const claims = rawClaims.map(projectAgentAttachmentClaim);
  const claimedIds = new Set<string>();

  return Object.freeze(claims.map((claim) => {
    if (claimedIds.has(claim.assetId)) throw new Error("project_agent_attachment_invalid");
    claimedIds.add(claim.assetId);
    const asset = findProjectAssetById(claim.assetId, cursor => listProjectAssets({ projectId, limit: 500, cursor }));
    if (!asset || asset.projectId !== projectId) throw new Error("project_agent_attachment_invalid");
    const absolutePath = asset.data.absolutePath;
    const relativePath = asset.data.relativePath;
    if (typeof absolutePath !== "string" || typeof relativePath !== "string") {
      throw new Error("project_agent_attachment_invalid");
    }
    const identity = assetIdentityOf(asset);
    if (!identity) throw new Error("project_agent_attachment_invalid");
    const { contentHash } = identity;
    const contentType = asset.data.contentType;
    const size = asset.data.size;
    if (typeof contentType !== "string" || !Number.isSafeInteger(size) || (size as number) < 0) {
      throw new Error("project_agent_attachment_invalid");
    }
    return Object.freeze({
      assetId: asset.id,
      contentHash,
      version: identity.version,
      display: Object.freeze({
        url: localAssetUrl(projectId, relativePath),
        fileName: path.basename(absolutePath),
        contentType,
        sizeBytes: size as number,
        kind: contentType.startsWith("image/") ? "image" as const : "file" as const,
      }),
    });
  }));
}
