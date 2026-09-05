// 本地文件 → 项目素材的导入（从 runtime.ts 抽出：它是素材 IO，不是任务执行，放这更内聚，
// 也给 runtime 这个已知巨壳腾出空间）。writeAsset 仍在 runtime（单向依赖，无循环）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { copyAssetFile, writeAsset } from "../runtime";
import { extensionFromMime } from "./assetPaths";
import { resolveContentType } from "./mediaTypes";
import { parseLocalAssetUrl } from "../protocol/localProtocol";
import {
  ensurePlayableVideoBytes,
  playableMp4FileName,
  transcodeFileToPlayableMp4IfNeeded,
} from "./videoImportNormalize";
import type { JsonRecord } from "../jsonUtils";
import { logWarn } from "../logging/logger";

function bytesFromPayload(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("bytes must be an ArrayBuffer");
}

type ImportLocalFileOptions = { allowSourcePath?: boolean };

async function importNativeSourcePath(
  raw: JsonRecord,
  sourcePath: string,
  projectId: string,
  fileName: string,
  contentType: string,
): Promise<unknown> {
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile()) throw new Error("source file is unavailable");
  let effectiveContentType = contentType;
  if (contentType.toLowerCase().split(";")[0] === "application/octet-stream" && (!path.extname(fileName) || path.extname(fileName).toLowerCase() === ".bin")) {
    const handle = await fs.promises.open(sourcePath, "r");
    try {
      const header = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      effectiveContentType = resolveContentType(fileName, header.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
  const baseMeta = { kind: raw.kind || "upload", originalName: raw.fileName || null };
  if (!effectiveContentType.startsWith("video/")) {
    return copyAssetFile(projectId, sourcePath, fileName, effectiveContentType, baseMeta);
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "nomi-video-native-import-"));
  try {
    try {
      const transcoded = await transcodeFileToPlayableMp4IfNeeded(sourcePath, fileName, tempDir);
      if (transcoded) {
        return await copyAssetFile(projectId, transcoded.outputPath, playableMp4FileName(fileName), "video/mp4", {
          ...baseMeta,
          playbackNormalizedFrom: transcoded.reason,
        });
      }
    } catch (error) {
      logWarn("assets", "video-normalize-failed-import-original-file", undefined, error);
    }
    return await copyAssetFile(projectId, sourcePath, fileName, effectiveContentType, baseMeta);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

export async function importLocalFile(payload: unknown, options: ImportLocalFileOptions = {}): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const hintedContentType = String(raw.contentType || "application/octet-stream");
  const sourcePath = options.allowSourcePath ? String(raw.sourcePath || "").trim() : "";
  if (sourcePath) {
    const rawName = String(raw.fileName || path.basename(sourcePath) || `asset-${Date.now()}.bin`);
    return importNativeSourcePath(raw, sourcePath, projectId, rawName, hintedContentType);
  }
  const bytes = bytesFromPayload(raw.bytes);
  const rawFileName = String(raw.fileName || "").trim();
  const contentType = hintedContentType.toLowerCase().split(";")[0] === "application/octet-stream" && (!path.extname(rawFileName) || path.extname(rawFileName).toLowerCase() === ".bin")
    ? resolveContentType(rawFileName, bytes)
    : hintedContentType;
  const ext = extensionFromMime(contentType, "bin");
  const fileName = rawFileName || `asset-${Date.now()}.${ext}`;
  // 视频先过可播放归一化（HEVC/AVI 等 Chromium 解不了的转 H.264 MP4；失败回退原字节不挡导入）。
  const normalized = contentType.startsWith("video/")
    ? await ensurePlayableVideoBytes(bytes, fileName, contentType)
    : null;
  return writeAsset(
    projectId,
    normalized?.bytes ?? bytes,
    normalized?.fileName ?? fileName,
    normalized?.contentType ?? contentType,
    {
      kind: raw.kind || "upload",
      originalName: raw.fileName || null,
      ...(normalized?.playbackNormalizedFrom ? { playbackNormalizedFrom: normalized.playbackNormalizedFrom } : {}),
    },
  );
}

/**
 * 自愈产物的复用标记（存在源文件旁，内容是上次 writeAsset 返回的 DTO）。
 *
 * 为什么要它：播放守卫已从画布节点提到各播放面共用（时间轴/大图/预览…），同一份坏资产会被多个面
 * 各触发一次自愈。没有复用的话每次都重转一遍 4K 视频、再落一份新拷贝——CPU 和磁盘都成倍浪费，
 * 用户还会在素材库里看到一堆同名副本。转码是纯函数式的（同一份源 → 同一个可播产物），可安全复用。
 */
function healedMarkerPath(sourcePath: string): string {
  return `${sourcePath}.playable`;
}

/** 读复用标记；产物已被删/标记损坏 → null（当没修过，重修一次）。 */
function readHealedAsset(sourcePath: string): unknown | null {
  try {
    const marker = JSON.parse(fs.readFileSync(healedMarkerPath(sourcePath), "utf8")) as {
      data?: { url?: unknown };
    };
    const url = typeof marker?.data?.url === "string" ? marker.data.url.trim() : "";
    // 按 nomi-local URL 反查磁盘路径（而非存 absolutePath）：项目整体被搬走后仍然对得上。
    const resolved = url ? parseLocalAssetUrl(url) : null;
    if (!resolved || !fs.existsSync(resolved.filePath)) return null;
    return marker;
  } catch {
    return null;
  }
}

/**
 * 懒自愈（渲染侧播放守卫在 decode 失败时调）：已落盘的 nomi-local 视频资产播不了 →
 * 就地探测 + 转码成新 MP4 资产，返回新资产 DTO；本就可播/无法处理 → null。
 * 覆盖两类存量：① 归一化上线前导入的 HEVC ② 供应商直接回 HEVC 的生成产物（生成落地不做前置转码，
 * 不为没坏的 4K 输出白付转码——坏了才修）。原文件保留（导出/上游引用不受影响）。
 */
export async function ensurePlayableAsset(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const parsed = parseLocalAssetUrl(String(raw.url || "").trim());
  if (!parsed) return null;
  const { projectId, filePath } = parsed;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  const reused = readHealedAsset(filePath);
  if (reused) return reused;
  const sourceName = path.basename(filePath);
  const transcoded = await transcodeFileToPlayableMp4IfNeeded(filePath, sourceName);
  if (!transcoded) return null;
  try {
    const outputBytes = fs.readFileSync(transcoded.outputPath);
    const asset = writeAsset(projectId, outputBytes, playableMp4FileName(sourceName), "video/mp4", {
      kind: "upload",
      originalName: sourceName,
      playbackNormalizedFrom: transcoded.reason,
    });
    // 标记写失败不影响本次自愈（大不了下次重转一遍），所以吞掉异常。
    try {
      fs.writeFileSync(healedMarkerPath(filePath), JSON.stringify(asset));
    } catch {
      /* 标记只是优化，不是正确性依赖 */
    }
    return asset;
  } finally {
    fs.rmSync(transcoded.outputPath, { force: true });
  }
}
