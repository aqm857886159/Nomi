import path from "node:path";
import type { ContextMenuParams } from "electron";
import { contentTypeFromPath, extensionFromMime, extensionFromUrl } from "../assets/assetPaths";
import { sanitizeName } from "../projects/repository";

export type BrowserCaptureMediaKind = "image" | "video";

export type BrowserCaptureMediaTarget = {
  kind: BrowserCaptureMediaKind;
  url: string;
  suggestedName: string;
};

export function browserCaptureMediaTarget(params: Pick<ContextMenuParams, "mediaType" | "srcURL" | "suggestedFilename">): BrowserCaptureMediaTarget | null {
  if (params.mediaType !== "image" && params.mediaType !== "video") return null;
  const url = String(params.srcURL || "").trim();
  if (!url || (!/^https?:\/\//i.test(url) && !url.startsWith("data:"))) return null;
  return {
    kind: params.mediaType,
    url,
    suggestedName: String(params.suggestedFilename || "").trim(),
  };
}

export function browserCaptureFileName(input: {
  url: string;
  contentType: string;
  suggestedName?: string;
  fallbackKind: BrowserCaptureMediaKind;
}): string {
  const fromSuggestion = String(input.suggestedName || "").trim();
  const fromUrl = (() => {
    try {
      return path.basename(new URL(input.url).pathname);
    } catch {
      return "";
    }
  })();
  const fallbackExt = input.fallbackKind === "video" ? "mp4" : "png";
  const ext = extensionFromMime(input.contentType, extensionFromUrl(input.url) || fallbackExt);
  const rawName = fromSuggestion || fromUrl || `browser-capture-${Date.now()}.${ext}`;
  const safeName = sanitizeName(rawName, `browser-capture.${ext}`);
  return path.extname(safeName) ? safeName : `${safeName}.${ext}`;
}

export function browserCaptureContentType(input: {
  responseType: string;
  fileName: string;
  fallbackKind: BrowserCaptureMediaKind;
}): string {
  const responseType = String(input.responseType || "").split(";")[0].trim().toLowerCase();
  if (responseType.startsWith("image/") || responseType.startsWith("video/")) return responseType;
  const fromName = contentTypeFromPath(input.fileName);
  if (fromName.startsWith("image/") || fromName.startsWith("video/")) return fromName;
  return input.fallbackKind === "video" ? "video/mp4" : "image/png";
}
