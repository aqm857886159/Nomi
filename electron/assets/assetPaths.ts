// 资产路径 / MIME 纯 helper —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 3 步）。
// 全部为无副作用纯函数（只做字符串 / path / hash 运算，不碰 fs）。
import crypto from "node:crypto";
import path from "node:path";
import type { JsonRecord } from "../jsonUtils";

export function extensionFromMime(contentType: string, fallback = "bin"): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  if (type === "model/gltf-binary") return "glb";
  if (type === "application/json") return "json";
  return fallback;
}

export function extensionFromUrl(url: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
    return ext.slice(0, 8) || "bin";
  } catch {
    return "bin";
  }
}

export function localAssetUrl(projectId: string, relativePath: string): string {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function contentTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".json") return "application/json";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".csv") return "text/csv";
  return "application/octet-stream";
}

export function assetKindFromContentType(contentType: string): string {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("model/")) return "model3d";
  if (
    contentType === "application/json" ||
    contentType.startsWith("text/") ||
    contentType.includes("pdf") ||
    contentType.includes("officedocument")
  ) {
    return "document";
  }
  return "file";
}

export function stableAssetId(projectId: string, relativePath: string): string {
  const digest = crypto.createHash("sha1").update(`${projectId}:${relativePath}`).digest("hex").slice(0, 20);
  return `asset-${digest}`;
}

export function assetBucketFromMeta(meta: JsonRecord): "generated" | "imported" {
  const kind = String(meta.kind || "").toLowerCase();
  return kind === "upload" || kind === "imported" || kind === "local" ? "imported" : "generated";
}
