// 生成产物落盘的第一步：异步准备「已校验暂存件」（2026-10-16 方向 B，用户拍板）。
//
// 为什么分两步：解码校验要等 ffmpeg，主进程不能同步等（0.23.1 卡顿）；但共享的同步写入边界（writeAsset /
// moveAssetFile ……）有十几扇门，每个调用方都靠「返回时文件已经落好」安排时序、原子性和清理——把整个边界改成异步，
// 契约就对所有调用方一起变了（独立验收 V-1208 连着三轮冒同类回归，复盘见
// docs/engineering/direction-checks/2026-10-16-main-process-sync-child-wait.md「第二次复盘」）。
// 所以异步的只有这一步：
//   ① 进门（任何 await 之前）钉住调用方字节的一份拷贝；捕获项目身份（AssetWriteContext）；
//   ② 把字节 / 源文件**异步**写进本项目根下的私有暂存（与正式路径同卷）；
//   ③ 在**暂存文件**上做内容校验和异步解码——暂存只有这里持有，校验的就是之后发布的那一份；
//   ④ 产出品牌类型 VerifiedStagedAsset。
// 第二步 publishVerifiedGeneratedAsset（projectAssetStore）同步：复验项目身份 → renameSync 原子发布 → sidecar → 广播。
// 任何一步失败都只清暂存，正式路径从不出现残片。
// 受控退出（V-1208-6）：在途的准备都登记在 inflight 里，退出收尾 generated-asset-staging 中止它们（击杀解码子进程）、
// 等它们把暂存收掉，没收掉的当场删。进程被强杀来不及收的，由下次打开项目 / 下次导入按「主人进程已不在」回收（scratchCleanup）。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { JsonRecord } from "../jsonUtils";
import type { CertificationMediaEvidence } from "../providerAdapter/certificationMedia";
import { copyFileWithProgress, type AssetCopyProgress } from "./assetImportProgress";
import { sanitizeAssetMetaForKind } from "./assetPaths";
import { captureAssetWriteContext, type AssetWriteContext } from "./assetWriteContext";
import { generatedMediaKindMismatchError, generatedMediaValidationError, verifyGeneratedMediaDecodes } from "./generatedMediaDecode";
import type { LocalizedAssetType } from "./localizedAsset";
import { contentTypeFromMagicBytes, isCertifiableMediaContentType, isMarkupMasquerade } from "./mediaTypes";
import { validateGlbStructure } from "./model3dValidation";
import { registerQuitDrain } from "../quitTeardown";
import { createUploadStagingDir, reapAbandonedUploadStaging, removeScratchAfterUse, removeScratchAfterUseSync } from "./scratchCleanup";

const HEADER_BYTES = 4096;

export function isGeneratedAssetMeta(meta: JsonRecord): boolean {
  return String(meta.kind || "").toLowerCase() === "generated";
}

declare const checkedUserAssetKindBrand: unique symbol;
/** 运行时核过「不是生成产物」的 kind（渲染层 / IPC 送来的字符串）。只有 checkedUserAssetKind 产得出。 */
export type CheckedUserAssetKind = string & { readonly [checkedUserAssetKindBrand]: true };

/**
 * isGeneratedAssetMeta 的类型面：主进程里的调用方在「不收生成产物」的门上，kind 只能是写死的字面量（且不是
 * "generated"，大小写都算），或者 checkedUserAssetKind 在运行时核过的值；随手一个 string（变量、拼出来的）编译不过——
 * 它可能就装着 "generated"。生成产物只走要求说清期望类型的门（writeGeneratedAsset 等）；2026-11-07 配音走了导入
 * 用户文件的门，漏了期望类型，扣了钱存不进项目。
 */
export type NotGeneratedKind<K extends string> = K extends CheckedUserAssetKind ? K
  : string extends K ? never
  : Lowercase<K> extends "generated" ? never : K;

/** 生成产物的 meta：kind 写死 "generated"，配对的期望类型必须非空（见 projectAssetStore.copyAssetFile）。 */
export type GeneratedAssetMeta = JsonRecord & { kind: "generated" };
/** 用户东西的 meta：kind 必须写明且不是生成产物——不写 kind 的 JsonRecord 编译不过，免得「不知道是什么」溜进来。 */
export type UserAssetMeta<K extends string = string> = JsonRecord & { kind: NotGeneratedKind<K> };

/**
 * 渲染层 / IPC 送来的 kind 在这里解析一次：是生成产物（大小写都算）就以 refusal 拒，否则发出 CheckedUserAssetKind，
 * 往下的门在类型上只认它或字面量。refusal 由入口给（它的错误码是它的合同）。
 */
export function checkedUserAssetKind(value: unknown, fallback: string, refusal: string): CheckedUserAssetKind {
  const kind = String(value || fallback);
  if (isGeneratedAssetMeta({ kind })) throw new Error(refusal);
  return kind as CheckedUserAssetKind;
}

declare const verifiedStagedAsset: unique symbol;
/** 已通过校验、躺在本项目私有暂存里的生成产物。只有 prepareVerifiedGeneratedAsset 能产出；只有它能被发布。 */
export type VerifiedStagedAsset = Readonly<{
  [verifiedStagedAsset]: true;
  context: AssetWriteContext;
  stagingDir: string;
  stagedPath: string;
  fileName: string;
  /** 按字节核过的内容类型（不是上游声明的那句）：发布照它选扩展名、记 contentType。 */
  contentType: string;
  header: Buffer;
  meta: JsonRecord;
  contentHash: string;
  size: number;
}>;

export type GeneratedStagingSource =
  | Readonly<{ bytes: Uint8Array }>
  | Readonly<{ path: string; onCopyProgress?: AssetCopyProgress }>;

function generatedMediaKind(contentType: string): "image" | "video" | "audio" | "model3d" | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return contentType === "model/gltf-binary" ? "model3d" : null;
}

async function readHeader(filePath: string): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Generated outputs are executable evidence, not ordinary user imports: fail closed before disk.
 * 判据与以前同步版完全一致（冒充网页 / 认不出字节 / 类型不符 / 格式不支持 / 认证证据不符 / GLB 结构 / 解码），
 * 只是读的是暂存文件：文件头决定类型，哈希按流算，GLB 才整份读入。
 */
/** 视频容器装音频（.mp4 / .webm）：要音频时唯一放行的「字节族和期望不同」，落盘按音频记。 */
const AUDIO_IN_VIDEO_CONTAINER: Readonly<Record<string, string>> = { "video/mp4": "audio/mp4", "video/webm": "audio/webm" };

/**
 * 在暂存件上核「这份字节就是调用方要的那一类」，再按那一类做解码校验。返回清洗后的 meta 与**按字节定的**内容类型
 * （发布照它选扩展名、记 contentType）。判据只认字节：上游声明的 content-type、地址扩展名、回执上的种类都不算数——
 * 声明和字节对不上但字节正是要的那一类（CDN 乱标），照收并按字节记；字节不是要的那一类（视频任务拿到图片 / 音频，
 * V-1213），一律不收，带 retrieval-download 码（钱已付、任务还在，可找回）。
 */
async function verifyStagedGeneratedContent(meta: JsonRecord, declaredRaw: string, wanted: LocalizedAssetType, stagedPath: string, header: Buffer, size: number, contentHash: string, signal: AbortSignal): Promise<{ meta: JsonRecord; contentType: string }> {
  if (isMarkupMasquerade(header)) throw generatedMediaValidationError("markup_masquerade");
  const detected = header.byteLength >= 12 && header.subarray(0, 4).toString("ascii") === "glTF"
    ? "model/gltf-binary"
    : contentTypeFromMagicBytes(header);
  if (!detected) throw generatedMediaValidationError("unknown_bytes");
  const audioContainer = wanted === "audio" ? AUDIO_IN_VIDEO_CONTAINER[detected] : undefined;
  const detectedKind = generatedMediaKind(detected);
  if (detectedKind !== wanted && !audioContainer) throw generatedMediaKindMismatchError(wanted, detectedKind ?? detected);
  if (!isCertifiableMediaContentType(detected) && !audioContainer) throw generatedMediaValidationError("unsupported_format");
  const contentType = audioContainer ?? detected;
  const claimed = meta.certificationEvidence && typeof meta.certificationEvidence === "object"
    ? meta.certificationEvidence as Partial<CertificationMediaEvidence>
    : undefined;
  const cleanMeta = { ...meta };
  delete cleanMeta.certificationEvidence;
  if (claimed) {
    // 认证证据是对「当时那份字节、当时那句声明」的签收：字节、大小、种类、声明一样都不能变。
    const normalizedDeclared = String(declaredRaw || "").toLowerCase().split(";", 1)[0].trim();
    const declared = !normalizedDeclared || normalizedDeclared === "application/octet-stream" ? detected : normalizedDeclared;
    if (claimed.sha256 !== contentHash || claimed.byteLength !== size || claimed.kind !== wanted
      || claimed.contentType !== declared) throw generatedMediaValidationError("evidence_mismatch");
    // 认证证据只证明「字节没变」，GLB 的结构仍要过（以前由写入边界的 validateStructuredAsset 补这一道）。
    if (wanted === "model3d") validateGlbStructure(await fs.promises.readFile(stagedPath));
    return { meta: cleanMeta, contentType };
  }
  if (wanted === "model3d") {
    validateGlbStructure(await fs.promises.readFile(stagedPath));
    return { meta: cleanMeta, contentType };
  }
  // 「这份字节能不能解码」由 generatedMediaDecode 一处裁决（判据、超时、日志都在那里）；这里只问、不评。
  await verifyGeneratedMediaDecodes({ kind: wanted, stagedPath, byteLength: size, contentType: detected, signal });
  return { meta: cleanMeta, contentType };
}

type PrepareInput = {
  projectId: string;
  source: GeneratedStagingSource;
  fileName: string;
  contentType: string;
  rawMeta: JsonRecord;
  /** 这份产物**应该**是哪一类（任务期望 / 生产者自己产的那一类）。必填：落盘关口不知道要什么，就挡不住「付了视频的钱落一张图」。 */
  expectedKind: LocalizedAssetType;
  context?: AssetWriteContext;
};

/** 在途的准备：退出收尾据此中止、等待、兜底删暂存。 */
type InflightPrepare = { controller: AbortController; stagingDir?: string; settled: Promise<unknown> };
const inflight = new Set<InflightPrepare>();
let quitting = false;

/**
 * 退出收尾：不再接新的准备；中止在途的（解码子进程被击杀），等它们自己收掉暂存；仍在的当场删。
 * 登记在模块加载时（早于本地任务的排空），所以本地任务等的那次导入会先被这里放开，不会一直等到超时。
 */
export async function drainGeneratedAssetStaging(): Promise<void> {
  quitting = true;
  const entries = [...inflight];
  for (const entry of entries) entry.controller.abort(new Error("generated_staging_quit"));
  await Promise.allSettled(entries.map((entry) => entry.settled));
  for (const entry of entries) if (entry.stagingDir) removeScratchAfterUseSync(entry.stagingDir);
}

export function registerGeneratedAssetStagingQuitDrain(): () => void {
  return registerQuitDrain("generated-asset-staging", drainGeneratedAssetStaging, { required: false, timeoutMs: 1_500 });
}
registerGeneratedAssetStagingQuitDrain();

/** Vitest isolation hook. */
export function resetGeneratedAssetStagingForTests(): void {
  quitting = false;
  inflight.clear();
}

export function prepareVerifiedGeneratedAsset(input: PrepareInput): Promise<VerifiedStagedAsset> {
  // ① 钉字节必须在任何 await 之前：调用方之后改它自己的 Buffer，碰不到这份（V-1208-1）。
  const pinned = "bytes" in input.source ? Buffer.from(input.source.bytes) : undefined;
  if (quitting) return Promise.reject(new Error("generated_staging_quit"));
  const entry: InflightPrepare = { controller: new AbortController(), settled: Promise.resolve() };
  const settled = prepareOwned(input, pinned, entry).finally(() => { inflight.delete(entry); });
  entry.settled = settled.catch(() => undefined);
  inflight.add(entry);
  return settled;
}

async function prepareOwned(input: PrepareInput, pinned: Buffer | undefined, entry: InflightPrepare): Promise<VerifiedStagedAsset> {
  const signal = entry.controller.signal;
  const meta = sanitizeAssetMetaForKind(input.rawMeta);
  if (!isGeneratedAssetMeta(meta)) throw new Error("prepareVerifiedGeneratedAsset only stages generated outputs");
  const context = input.context ?? await captureAssetWriteContext(input.projectId);
  if (context.projectId !== input.projectId) throw Object.assign(new Error("project_binding_stale"), { code: "project_binding_stale" });
  context.assertCurrent();
  reapAbandonedUploadStaging(context.root);
  signal.throwIfAborted();
  const stagingDir = await createUploadStagingDir(context.root);
  entry.stagingDir = stagingDir;
  const stagedPath = path.join(stagingDir, "content");
  try {
    signal.throwIfAborted();
    // ② 大文件写盘都在这里、都是异步的；同步发布只剩 rename。
    if (pinned) await fs.promises.writeFile(stagedPath, pinned, { flag: "wx", mode: 0o600 });
    else if ("path" in input.source) await copyFileWithProgress(input.source.path, stagedPath, input.source.onCopyProgress);
    signal.throwIfAborted();
    const [header, stat, contentHash] = await Promise.all([readHeader(stagedPath), fs.promises.stat(stagedPath), sha256OfFile(stagedPath)]);
    signal.throwIfAborted();
    // ③ 在暂存文件上校验。
    const verified = await verifyStagedGeneratedContent(meta, input.contentType, input.expectedKind, stagedPath, header, stat.size, contentHash, signal);
    signal.throwIfAborted();
    return Object.freeze({
      context, stagingDir, stagedPath, fileName: input.fileName, contentType: verified.contentType,
      header, meta: verified.meta, contentHash, size: stat.size,
    }) as VerifiedStagedAsset;
  } catch (error) {
    await removeScratchAfterUse(stagingDir);
    throw error;
  }
}
