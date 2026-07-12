// 资产路径 / MIME 纯 helper —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 3 步）。
// 全部为无副作用纯函数（只做字符串 / path / hash 运算，不碰 fs）。
import crypto from "node:crypto";
import path from "node:path";
import type { JsonRecord } from "../jsonUtils";
import { contentTypeFromExtension, extensionFromContentType } from "./mediaTypes";

export function extensionFromMime(contentType: string, fallback = "bin"): string {
  return extensionFromContentType(contentType) ?? fallback;
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
  return contentTypeFromExtension(path.extname(filePath)) ?? "application/octet-stream";
}

export function assetKindFromContentType(contentType: string): string {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
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

// 浏览器捕捞/上传的 kind 族（单一真相源：workspaceFileIndex 等消费方从这里 import，别再抄本地副本）。
export const BROWSER_CAPTURE_ASSET_KINDS: ReadonlySet<string> = new Set(["browser-capture", "browser-upload"]);

export function isBrowserCaptureAssetKind(kind: unknown): boolean {
  return BROWSER_CAPTURE_ASSET_KINDS.has(String(kind || "").toLowerCase());
}

export function assetBucketFromMeta(meta: JsonRecord): "generated" | "imported" {
  const kind = String(meta.kind || "").toLowerCase();
  // 网页捕捞和浏览器上传都属于外来素材，与上传/导入同桶，不冒充生成产物。
  return kind === "upload" || kind === "imported" || kind === "local" || isBrowserCaptureAssetKind(kind)
    ? "imported"
    : "generated";
}

// 隐私不变量（M0 捕捞窗评审定案，收敛后对浏览器面同样生效）：网页捕捞类素材的
// originalUrl 恒 null——否则 48h 信任窗会把用户浏览的网页 URL 当参考发给生成商
// （泄露浏览记录 + 防盗链 URL 在厂商侧必挂）。generated/provider 素材不受影响，
// 它们的 originalUrl=厂商临时链正是信任窗的设计本意。pageUrl 仅本地溯源、无读取方。
export function sanitizeAssetMetaForKind(meta: JsonRecord): JsonRecord {
  if (!isBrowserCaptureAssetKind(meta.kind)) return meta;
  return { ...meta, originalUrl: null };
}
