import fs from "node:fs";
import path from "node:path";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { probeMediaMetadata, runBoundedProcess, type MediaProbeMetadata } from "../export/mediaProbe";
import { logWarn } from "../logging/logger";
import type { JsonRecord } from "../jsonUtils";
import { localAssetUrl } from "./assetPaths";
import { mergeAssetSidecarMeta, readAssetSidecarMeta } from "./assetSidecar";

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
 * - 任何一步失败都只是「没有预览」：源 URL 仍是唯一真相，调用方回落到源。
 */
export const PREVIEW_LONG_EDGE_PX = 1024;

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

function previewPathFor(absolutePath: string, extension: "png" | "jpg"): string {
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}${PREVIEW_MARKER}${extension}`);
}

function previewExtensionFor(kind: "image" | "video", probe: MediaProbeMetadata): "png" | "jpg" {
  return kind === "image" && pixelFormatHasAlpha(probe.pixelFormat) ? "png" : "jpg";
}

async function runFfmpegPreview(args: string[]): Promise<boolean> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return false;
  const result = await runBoundedProcess(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    timeoutMs: FFMPEG_PREVIEW_TIMEOUT_MS,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
  });
  return result.code === 0;
}

/**
 * 为一份已落盘的图片/视频派生画布预览。永不抛：拿不到预览就返回不带 previewPath 的结果。
 */
export async function createStoredAssetPreview(absolutePath: string, contentType: string): Promise<StoredAssetPreview> {
  const kind = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : null;
  if (!kind || !absolutePath || !fs.existsSync(absolutePath)) return {};
  let probe: MediaProbeMetadata;
  try {
    probe = await probeMediaMetadata(absolutePath);
  } catch {
    // SVG 等 ffprobe 不认的格式：没有预览，源即预览。
    return {};
  }
  const dimensions = probe.width && probe.height ? { width: probe.width, height: probe.height } : {};
  const duration = kind === "video" && probe.durationSeconds ? { durationSeconds: probe.durationSeconds } : {};
  if (kind === "image" && (!probe.width || !probe.height || Math.max(probe.width, probe.height) <= PREVIEW_LONG_EDGE_PX)) {
    return { ...dimensions };
  }
  const previewPath = previewPathFor(absolutePath, previewExtensionFor(kind, probe));
  if (fs.existsSync(previewPath)) return { previewPath, ...dimensions, ...duration };
  const args = kind === "video"
    ? ["-ss", String(VIDEO_POSTER_SEEK_SECONDS), "-i", absolutePath, "-an", "-sn", "-frames:v", "1", "-vf", previewScaleFilter(), "-q:v", "4", previewPath]
    : previewPath.endsWith(".png")
      ? ["-i", absolutePath, "-frames:v", "1", "-vf", previewScaleFilter(), previewPath]
      : ["-i", absolutePath, "-frames:v", "1", "-vf", previewScaleFilter(), "-q:v", "4", previewPath];
  try {
    const ok = await runFfmpegPreview(args);
    if (ok && fs.existsSync(previewPath) && fs.statSync(previewPath).size > 0) return { previewPath, ...dimensions, ...duration };
  } catch (error) {
    logWarn("assets", "asset-preview-failed", { absolutePath }, error);
  }
  try { fs.rmSync(previewPath, { force: true }); } catch { /* non-fatal */ }
  return { ...dimensions, ...duration };
}

type StoredRecordLike = {
  projectId?: unknown;
  data?: JsonRecord & { absolutePath?: unknown; relativePath?: unknown; contentType?: unknown };
};

/** attach 之后记录 `data` 上多出来的字段（都可选：没派生出预览就没有）。 */
export type StoredAssetPreviewFields = {
  thumbnailRelativePath?: string;
  thumbnailUrl?: string;
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
export async function attachStoredAssetPreview<T>(record: T): Promise<WithStoredAssetPreview<T>> {
  const stored = record as StoredRecordLike;
  const absolutePath = typeof stored?.data?.absolutePath === "string" ? stored.data.absolutePath : "";
  const relativePath = typeof stored?.data?.relativePath === "string" ? stored.data.relativePath : "";
  const projectId = typeof stored?.projectId === "string" ? stored.projectId : "";
  const contentType = typeof stored?.data?.contentType === "string" ? stored.data.contentType : "";
  if (!absolutePath || !relativePath || !projectId || !contentType) return record as WithStoredAssetPreview<T>;
  const sidecar = readAssetSidecarMeta(absolutePath);
  const cachedThumbnail = typeof sidecar.thumbnailRelativePath === "string" ? sidecar.thumbnailRelativePath : "";
  const cachedWidth = typeof sidecar.width === "number" ? sidecar.width : undefined;
  const cachedHeight = typeof sidecar.height === "number" ? sidecar.height : undefined;
  // 预览永远与源同目录：只认「源旁边那份」，不信 sidecar 里可能过期的目录。
  if (cachedThumbnail && fs.existsSync(path.join(path.dirname(absolutePath), path.basename(cachedThumbnail)))) {
    return withPreviewFields(record, projectId, cachedThumbnail, cachedWidth, cachedHeight);
  }
  const preview = await createStoredAssetPreview(absolutePath, contentType);
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
  return withPreviewFields(record, projectId, thumbnailRelativePath, preview.width, preview.height, preview.durationSeconds);
}

function withPreviewFields<T>(record: T, projectId: string, thumbnailRelativePath: string, width?: number, height?: number, durationSeconds?: number): WithStoredAssetPreview<T> {
  const stored = record as StoredRecordLike;
  return {
    ...record,
    data: {
      ...stored.data,
      ...(thumbnailRelativePath ? { thumbnailRelativePath, thumbnailUrl: localAssetUrl(projectId, thumbnailRelativePath) } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
    },
  } as WithStoredAssetPreview<T>;
}
