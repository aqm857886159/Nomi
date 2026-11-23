import fs from "node:fs";
import path from "node:path";
import { renameSyncOnce, renameSyncWithRetry } from "../jsonFile";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { probeMediaMetadata, runBoundedProcess, type MediaProbeMetadata } from "../export/mediaProbe";
import { logWarn } from "../logging/logger";
import type { JsonRecord } from "../jsonUtils";
import { localAssetUrl } from "./assetPaths";
import { mediaKindFromContentType } from "./mediaTypes";
import { mergeAssetSidecarMeta, readAssetSidecarMeta } from "./assetSidecar";
import { CANVAS_PREVIEW_LONG_EDGE_PX, type CanvasPreviewState } from "../shared/canvas/canvasMediaPreview";

/**
 * 落盘素材的画布预览（source / preview 分离的唯一 owner）。
 *
 * 为什么住在资产落盘边界而不是画布：画布上每个节点画的是「这张卡在屏幕上那么大」的图，
 * 不是 4K/8K 原图；而原图必须原样留给编辑 / 导出 / 大图预览。谁把文件放进项目
 * （生成结果本地化、本地导入、补救本地化……）谁就在这里顺手派生一份预览，
 * 画布层只消费 `thumbnailUrl`，不再各自决定「这次要不要解码原图」。
 *
 * 派生规则（随输入 derive，不 hardcode 一种输出）：
 * - 图片：长边 > PREVIEW_LONG_EDGE_PX 才出预览；源有 alpha（ffprobe pix_fmt）→ `.preview.png`，
 *   否则 `.preview.jpg`。长边不超过阈值的源本身就是预览尺寸，不复制一份。
 * - 视频：抽首帧做 poster（`.preview.jpg`），画布首屏只挂 `<img>`，交互后才创建 `<video>`。
 * - 预览文件与源同目录同名前缀，素材库列表按 isStoredAssetPreviewPath 过滤，不冒充用户素材。
 * - 任何一步失败都只是「没有预览」：源 URL 仍是唯一真相；但回执上必须写明 previewState = 'missing'，
 *   画布据此走显式的「预览缺失」分支（被计数），而不是把源地址填进 thumbnailUrl 冒充预览。
 */
export const PREVIEW_LONG_EDGE_PX = CANVAS_PREVIEW_LONG_EDGE_PX;

const PREVIEW_MARKER = ".preview.";
const FFMPEG_PREVIEW_TIMEOUT_MS = 60_000;
/** 视频 poster 抽帧不超过 2s；再往后 seek 一段 4K 10-bit HEVC 就要解码几十帧。 */
const VIDEO_POSTER_SEEK_SECONDS = 0;

export function isStoredAssetPreviewPath(absolutePath: string): boolean {
  return path.basename(absolutePath).includes(PREVIEW_MARKER);
}

/** ffprobe pix_fmt 里带 alpha 通道的一族：rgba/bgra/argb/abgr、ya8/ya16、yuva*、gbrap*、pal8（调色板可带透明）。 */
export function pixelFormatHasAlpha(pixelFormat: string | undefined): boolean {
  const format = String(pixelFormat || "").toLowerCase();
  if (!format) return false;
  return /^(rgba|bgra|argb|abgr|ya8|ya16|pal8|gbrap|yuva)/.test(format);
}

export type StoredAssetPreview = {
  /** 预览文件绝对路径；源本身已是预览尺寸时为 undefined（调用方直接用源）。 */
  previewPath?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

function previewScaleFilter(): string {
  const edge = PREVIEW_LONG_EDGE_PX;
  return `scale='if(gt(iw,ih),min(iw,${edge}),-2)':'if(gt(iw,ih),-2,min(ih,${edge}))'`;
}

function ensureDirFor(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function previewPathFor(absolutePath: string, extension: "png" | "jpg"): string {
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}${PREVIEW_MARKER}${extension}`);
}

let pendingPreviewSeq = 0;

/**
 * 这一次派生自己的临时输出（同目录、带预览标记，素材库列表照样过滤掉）。同一素材可能有好几个请求同时在派生
 * （补预览、导入、物化……）：每个请求只写、只删自己的临时文件，正式预览名只在成功后原子发布一次。
 * 这样取消某一个请求，绝不会删掉别人已经发布、sidecar 已经指着的那份正式预览（V-1209 复验）。
 */
function pendingPreviewPathFor(previewPath: string): string {
  pendingPreviewSeq += 1;
  const parsed = path.parse(previewPath);
  return path.join(parsed.dir, `${parsed.name}.pending-${process.pid}-${Date.now().toString(36)}-${pendingPreviewSeq}${parsed.ext}`);
}

/** 把这次的临时输出发布成正式预览：别人已经先发布了就用别人的、丢掉自己的；发布失败也只删自己的。 */
function publishPendingPreview(pendingPath: string, previewPath: string): boolean {
  try {
    if (!fs.existsSync(previewPath)) renameSyncOnce(pendingPath, previewPath);
  } catch (error) {
    logWarn("assets", "asset-preview-publish-failed", { previewPath }, error);
  }
  try { fs.rmSync(pendingPath, { force: true }); } catch { /* non-fatal */ }
  return fs.existsSync(previewPath);
}

function previewExtensionFor(kind: "image" | "video", probe: MediaProbeMetadata): "png" | "jpg" {
  return kind === "image" && pixelFormatHasAlpha(probe.pixelFormat) ? "png" : "jpg";
}

/**
 * 预览派生被取消（发起它的项目已经关了 / 换了、窗口没了）。与「派生失败」不同：失败 = 回执记 missing；
 * 取消 = 这次什么都不算——不写 sidecar、不留产物、不给事实，调用方原样放弃。
 */
export class AssetPreviewCancelledError extends Error {
  constructor() {
    super("asset preview derivation cancelled");
    this.name = "AssetPreviewCancelledError";
  }
}

export function isAssetPreviewCancelled(error: unknown): error is AssetPreviewCancelledError {
  return error instanceof AssetPreviewCancelledError;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AssetPreviewCancelledError();
}

/** 派生的取消信号（可选）：一路传到 ffprobe / ffmpeg 子进程，取消即杀进程（runBoundedProcess）。 */
export type AssetPreviewOptions = { signal?: AbortSignal };

async function runFfmpegPreview(args: string[], signal?: AbortSignal): Promise<boolean> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return false;
  const result = await runBoundedProcess(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    timeoutMs: FFMPEG_PREVIEW_TIMEOUT_MS,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    ...(signal ? { signal } : {}),
  });
  return result.code === 0;
}

/**
 * 为一份图片/视频派生画布预览。拿不到预览就返回不带 previewPath 的结果；唯一会抛的是取消
 * （options.signal 已中止：杀掉子进程、删掉没写完的产物，抛 AssetPreviewCancelledError）。
 *
 * `previewOwnerPath` 让预览落在「源以外的地方」：本地导入在**拷贝开始前**就要先出一帧，
 * 而那一刻素材还没落盘、内容寻址路径还不知道，预览只能先落在项目内的暂存位置
 * （绝不写进用户自己的目录）；拷完由 attachStoredAssetPreview 认领过去，不重派生第二次。
 */
export async function createStoredAssetPreview(
  absolutePath: string,
  contentType: string,
  options: { previewOwnerPath?: string } & AssetPreviewOptions = {},
): Promise<StoredAssetPreview> {
  const { signal } = options;
  throwIfCancelled(signal);
  // 能派生预览的只有图和视频；kind 本身不在这里判（mediaTypes 单源），这里只收窄到这两种。
  const mediaKind = mediaKindFromContentType(contentType);
  const kind = mediaKind === "image" || mediaKind === "video" ? mediaKind : null;
  if (!kind || !absolutePath || !fs.existsSync(absolutePath)) return {};
  let probe: MediaProbeMetadata;
  try {
    probe = await probeMediaMetadata(absolutePath, signal ? { signal } : {});
  } catch {
    throwIfCancelled(signal);
    // SVG 等 ffprobe 不认的格式：没有预览，源即预览。
    return {};
  }
  throwIfCancelled(signal);
  const dimensions = probe.width && probe.height ? { width: probe.width, height: probe.height } : {};
  const duration = kind === "video" && probe.durationSeconds ? { durationSeconds: probe.durationSeconds } : {};
  if (kind === "image" && (!probe.width || !probe.height || Math.max(probe.width, probe.height) <= PREVIEW_LONG_EDGE_PX)) {
    return { ...dimensions };
  }
  if (options.previewOwnerPath) ensureDirFor(options.previewOwnerPath);
  const previewPath = previewPathFor(options.previewOwnerPath || absolutePath, previewExtensionFor(kind, probe));
  if (fs.existsSync(previewPath)) return { previewPath, ...dimensions, ...duration };
  // ffmpeg 只写这一次自己的临时文件；成功后才发布成正式预览名（见 pendingPreviewPathFor）。
  const pendingPath = pendingPreviewPathFor(previewPath);
  const args = kind === "video"
    ? ["-ss", String(VIDEO_POSTER_SEEK_SECONDS), "-i", absolutePath, "-an", "-sn", "-frames:v", "1", "-vf", previewScaleFilter(), "-q:v", "4", pendingPath]
    : pendingPath.endsWith(".png")
      ? ["-i", absolutePath, "-frames:v", "1", "-vf", previewScaleFilter(), pendingPath]
      : ["-i", absolutePath, "-frames:v", "1", "-vf", previewScaleFilter(), "-q:v", "4", pendingPath];
  try {
    const ok = await runFfmpegPreview(args, signal);
    if (!signal?.aborted && ok && fs.existsSync(pendingPath) && fs.statSync(pendingPath).size > 0 && publishPendingPreview(pendingPath, previewPath)) {
      return { previewPath, ...dimensions, ...duration };
    }
  } catch (error) {
    if (!signal?.aborted) logWarn("assets", "asset-preview-failed", { absolutePath }, error);
  }
  // 失败或被取消：只删这一次自己的临时文件，绝不碰正式预览（它可能是别的请求刚发布的）。
  try { fs.rmSync(pendingPath, { force: true }); } catch { /* non-fatal */ }
  throwIfCancelled(signal);
  return { ...dimensions, ...duration };
}

type StoredRecordLike = {
  projectId?: unknown;
  data?: JsonRecord & { absolutePath?: unknown; relativePath?: unknown; contentType?: unknown };
};

/**
 * attach 之后记录 `data` 上多出来的字段。图 / 视频一定带 previewState（落盘回执的预览事实，见
 * shared/canvas/canvasMediaPreview）；其余字段可选：没派生出预览就没有小图地址。
 */
export type StoredAssetPreviewFields = {
  thumbnailRelativePath?: string;
  thumbnailUrl?: string;
  previewState?: CanvasPreviewState;
  width?: number;
  height?: number;
  durationSeconds?: number;
};
export type WithStoredAssetPreview<T> = T extends { data?: infer D } ? Omit<T, "data"> & { data: D & StoredAssetPreviewFields } : T;

/**
 * 给 writeAsset / copyAssetFile 返回的记录补上 `thumbnailRelativePath` / `thumbnailUrl` / `width` / `height`，
 * 并把它们写回 sidecar（下次列表、重开项目都能直接读到，不用重新派生）。
 * 记录不是落盘产物（比如 nomi-local 引用桩）时原样返回。
 */
export async function attachStoredAssetPreview<T>(record: T, prepared?: StoredAssetPreview, options: AssetPreviewOptions = {}): Promise<WithStoredAssetPreview<T>> {
  throwIfCancelled(options.signal);
  const stored = record as StoredRecordLike;
  const absolutePath = typeof stored?.data?.absolutePath === "string" ? stored.data.absolutePath : "";
  const relativePath = typeof stored?.data?.relativePath === "string" ? stored.data.relativePath : "";
  const projectId = typeof stored?.projectId === "string" ? stored.projectId : "";
  const contentType = typeof stored?.data?.contentType === "string" ? stored.data.contentType : "";
  if (!absolutePath || !relativePath || !projectId || !contentType) return record as WithStoredAssetPreview<T>;
  const mediaKind = mediaKindFromContentType(contentType);
  const visual = mediaKind === "image" || mediaKind === "video";
  const sidecar = readAssetSidecarMeta(absolutePath);
  const cachedThumbnail = typeof sidecar.thumbnailRelativePath === "string" ? sidecar.thumbnailRelativePath : "";
  const cachedWidth = typeof sidecar.width === "number" ? sidecar.width : undefined;
  const cachedHeight = typeof sidecar.height === "number" ? sidecar.height : undefined;
  // 预览永远与源同目录：只认「源旁边那份」，不信 sidecar 里可能过期的目录。
  if (cachedThumbnail && fs.existsSync(path.join(path.dirname(absolutePath), path.basename(cachedThumbnail)))) {
    return withPreviewFields(record, projectId, { thumbnailRelativePath: cachedThumbnail, width: cachedWidth, height: cachedHeight, ...(visual ? { previewState: "ready" as const } : {}) });
  }
  // 源本身就有界（上次探测过的尺寸 ≤ 上限，或是矢量图）：不必再起一次 ffprobe。
  if (mediaKind === "image" && (isVectorImage(contentType) || isBoundedImage(cachedWidth, cachedHeight))) {
    return withPreviewFields(record, projectId, { width: cachedWidth, height: cachedHeight, previewState: "source" });
  }
  const preview = adoptPreparedPreview(absolutePath, prepared) ?? await createStoredAssetPreview(absolutePath, contentType, options);
  // 派生完到写 sidecar 之间被取消：这一次不登记、不给事实。已发布的正式预览是完整的共享产物，
  // 别的请求可能已经拿它登记了 sidecar——不删（下次要时直接复用）。
  throwIfCancelled(options.signal);
  const thumbnailRelativePath = preview.previewPath
    ? relativePath.replace(/[^/]+$/, path.basename(preview.previewPath))
    : "";
  const patch: JsonRecord = {
    ...(thumbnailRelativePath ? { thumbnailRelativePath } : {}),
    ...(preview.width ? { width: preview.width } : {}),
    ...(preview.height ? { height: preview.height } : {}),
    ...(preview.durationSeconds ? { durationSeconds: preview.durationSeconds } : {}),
  };
  if (Object.keys(patch).length > 0) mergeAssetSidecarMeta(absolutePath, patch);
  const previewState: CanvasPreviewState | undefined = !visual
    ? undefined
    : thumbnailRelativePath
      ? "ready"
      : mediaKind === "image" && isBoundedImage(preview.width, preview.height) ? "source" : "missing";
  return withPreviewFields(record, projectId, {
    thumbnailRelativePath,
    width: preview.width,
    height: preview.height,
    durationSeconds: preview.durationSeconds,
    ...(previewState ? { previewState } : {}),
  });
}

function isVectorImage(contentType: string): boolean {
  return contentType.toLowerCase().split(";")[0]?.trim() === "image/svg+xml";
}

function isBoundedImage(width: number | undefined, height: number | undefined): boolean {
  return Boolean(width && height && Math.max(width, height) <= PREVIEW_LONG_EDGE_PX);
}

/**
 * 认领「拷贝前先派生的那一帧」：把暂存预览挪到源旁边的正式位置。
 * 认领成功 = 画布上正在渐显的那张图和最终挂的那张图是同一个文件，拷完不再切一次。
 */
function adoptPreparedPreview(absolutePath: string, prepared?: StoredAssetPreview): StoredAssetPreview | null {
  const scratchPath = prepared?.previewPath;
  if (!scratchPath || !fs.existsSync(scratchPath)) return prepared?.width || prepared?.durationSeconds ? { ...prepared, previewPath: undefined } : null;
  const extension = path.extname(scratchPath).slice(1).toLowerCase() === "png" ? "png" : "jpg";
  const previewPath = previewPathFor(absolutePath, extension);
  try {
    renameSyncWithRetry(scratchPath, previewPath);
    return { ...prepared, previewPath };
  } catch (error) {
    logWarn("assets", "asset-preview-adopt-failed", { scratchPath, previewPath }, error);
    try { fs.rmSync(scratchPath, { force: true }); } catch { /* non-fatal */ }
    return null;
  }
}

/** 导入失败/走了别的分支时丢掉暂存预览，别在项目里留孤儿文件。 */
export function discardPreparedPreview(prepared?: StoredAssetPreview): void {
  if (!prepared?.previewPath) return;
  try { fs.rmSync(prepared.previewPath, { force: true }); } catch { /* non-fatal */ }
}

type AttachedPreview = {
  thumbnailRelativePath?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  previewState?: CanvasPreviewState;
};

function withPreviewFields<T>(record: T, projectId: string, attached: AttachedPreview): WithStoredAssetPreview<T> {
  const stored = record as StoredRecordLike;
  const { thumbnailRelativePath, width, height, durationSeconds, previewState } = attached;
  return {
    ...record,
    data: {
      ...stored.data,
      ...(thumbnailRelativePath ? { thumbnailRelativePath, thumbnailUrl: localAssetUrl(projectId, thumbnailRelativePath) } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      ...(previewState ? { previewState } : {}),
    },
  } as WithStoredAssetPreview<T>;
}
