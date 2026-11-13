// 落盘文件的类型与位置：一份字节进项目时「它是什么类型、叫什么名、放在哪」的唯一裁法。
// 写入口（projectAssetStore 的 writeAsset / copyAssetFile / moveAssetFile / 生成产物发布）与列表、
// 本地导入都只问这里，不各写各的。这里不写文件内容、不写 sidecar、不广播（uniqueAssetPath 只建当天的目录），
// 2026-11-07 从 projectAssetStore 按职责拆出（文件体积冻结线，配音落盘修复那一轮）。
import fs from "node:fs";
import path from "node:path";
import { projectDirById, sanitizeName, SANITIZED_NAME_MAX_LENGTH } from "../projects/repository";
import { ensureDir } from "../runtimePaths";
import { canonicalAssetFileName, contentTypeFromPath, type AssetBucket } from "./assetPaths";
import type { AssetWriteContext } from "./assetWriteContext";
import { contentTypeFromMagicBytes, resolveContentType } from "./mediaTypes";

/** 已落盘文件的内容类型：先按扩展名，认不出再嗅文件头。列表与补封面共用这一份判定。 */
export function contentTypeFromStoredFile(absolutePath: string): string {
  const extensionType = contentTypeFromPath(absolutePath);
  if (extensionType !== "application/octet-stream") return extensionType;
  try {
    const handle = fs.openSync(absolutePath, "r");
    const header = Buffer.alloc(4096);
    const bytesRead = fs.readSync(handle, header, 0, header.length, 0);
    fs.closeSync(handle);
    return resolveContentType(absolutePath, header.subarray(0, bytesRead));
  } catch {
    return extensionType;
  }
}

/**
 * 落盘素材的**唯一** contentType 判定。字节是事实，声明只是线索。
 *
 * 为什么要越过声明看字节（2026-08-26 火山方舟 Seedream 改图走查）：产物 URL / 厂商 header /
 * b64_json 的 `data:image/png;base64,` 前缀都可能与真实字节不符，而 contentType 一路决定
 * canonicalAssetFileName 给的扩展名 —— 于是 JPEG 字节落成 `.png`，下游按扩展名判类型的消费者
 * （workspace tree / protocol / 导出 / 拖拽）全被带偏。
 *
 * **只在同族内以字节覆盖声明**：`.m4a`(audio/mp4) 与 mp4 视频共用 ISO-BMFF 魔数，跨族覆盖会把
 * 音频误判成视频（比原 bug 更糟）。同族覆盖只纠正 png↔jpeg / mp4↔webm / mp3↔flac 这类
 * 「族对了、子类型错了」的谎，不动 kind。
 */
export function effectiveContentType(fileName: string, declared: string, bytes?: Uint8Array): string {
  const normalized = String(declared || "").toLowerCase().split(";")[0].trim();
  if (normalized.startsWith("model/") && normalized !== "model/gltf-binary") {
    throw new Error("Unsupported 3D asset content type");
  }
  // 声明本身没信息量（空 / octet-stream）：交给 resolveContentType（先文件头、再扩展名）。
  if (!normalized || normalized === "application/octet-stream") return resolveContentType(fileName, bytes);
  const sniffed = bytes ? contentTypeFromMagicBytes(bytes) : null;
  if (sniffed && sniffed !== normalized && sniffed.split("/")[0] === normalized.split("/")[0]) return sniffed;
  return normalized;
}

/**
 * 落盘文件名的**唯一**裁法：扩展名取自字节嗅出的内容类型（canonicalAssetFileName），**只截主干**；后缀不是
 * 合法扩展名（`.[a-z0-9]{1,8}`）就整段算主干、另补 `.bin`。以前整段交给 sanitizeName 截到 90 字——供应商 URL 的
 * 长 basename 连扩展名一起被截掉落成 `.bin`，出了 App（下载、双击、MCP 预览、再上传）就认不出（2026-09-26）。
 */
export function storedAssetFileParts(fileName: string, contentType: string): { stem: string; ext: string } {
  const parsed = path.parse(canonicalAssetFileName(fileName, contentType));
  const ext = /^\.[a-z0-9]{1,8}$/i.test(parsed.ext) ? parsed.ext : ".bin";
  const rawStem = ext === parsed.ext ? parsed.name : parsed.base;
  const stem = sanitizeName(rawStem, "asset").slice(0, SANITIZED_NAME_MAX_LENGTH - ext.length).trim();
  return { stem: stem || "asset", ext };
}

export function uniqueAssetPath(
  projectId: string,
  fileName: string,
  contentType: string,
  bucket: AssetBucket = "generated",
  context?: AssetWriteContext,
): { absolutePath: string; relativePath: string } {
  const projectDir = context?.root ?? projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  const today = new Date().toISOString().slice(0, 10);
  const assetDir = path.join(projectDir, "assets", bucket, today);
  ensureDir(assetDir);
  const { stem: base, ext } = storedAssetFileParts(fileName, contentType);
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; fs.existsSync(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(projectDir, absolutePath).replace(/\\/g, "/"),
  };
}
