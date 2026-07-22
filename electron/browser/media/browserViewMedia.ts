import { BrowserWindow } from "electron";
import type { DownloadItem, Rectangle, WebContents } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureFileName } from "../captureNaming";
import { bringBrowserViewToFront } from "../core/browserViewUtils";
import { BROWSER_MEDIA_MAX_BYTES, mediaTypeFromContentType, resolveBrowserMediaContentType, streamBrowserMediaResponseToFile } from "./browserMediaValidation";
import type {
  BrowserDownloadResult,
  BrowserPromptScreenshotSelectionResult,
  BrowserResourceCapturePayload,
  BrowserResourceCaptureRectPayload,
  BrowserViewImportMediaPayload,
  BrowserViewPromptImagePayload,
  BrowserViewPromptScreenshotPayload,
  BrowserViewRecord,
} from "../core/browserViewTypes";

export const BROWSER_PROMPT_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const browserBlobDownloadQueues = new Map<number, Promise<void>>();

async function enqueueBrowserBlobDownload<T>(contents: WebContents, task: () => Promise<T>): Promise<T> {
  const previous = browserBlobDownloadQueues.get(contents.id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.then(() => undefined, () => undefined);
  browserBlobDownloadQueues.set(contents.id, settled);
  try {
    return await run;
  } finally {
    if (browserBlobDownloadQueues.get(contents.id) === settled) browserBlobDownloadQueues.delete(contents.id);
  }
}

function normalizeBrowserMediaUrl(url: unknown, baseUrl: string): string {
  const value = String(url || "").trim();
  const parsed = new URL(value, baseUrl || undefined);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "blob:") {
    throw new Error("Only http(s) and page blob media URLs are supported");
  }
  return parsed.toString();
}

function normalizeBrowserMediaType(value: unknown): "image" | "video" | null {
  return value === "video" || value === "image" ? value : null;
}

function safeHeaderUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeTempFileName(fileName: string): string {
  const baseName = Array.from(path.basename(fileName))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || '<>:"/\\|?*'.includes(char) ? "_" : char;
    })
    .join("")
    .trim();
  return baseName || `browser-resource-${Date.now()}.bin`;
}

function fallbackContentTypeForMediaType(mediaType: "image" | "video" | null): string {
  return mediaType === "video" ? "video/mp4" : "image/png";
}

function normalizeDownloadedContentType(
  contentType: string,
  requestedMediaType: "image" | "video" | null,
): string {
  const normalized = String(contentType || "").split(";")[0]?.trim().toLowerCase() || "";
  if (!normalized || normalized === "application/octet-stream") {
    return fallbackContentTypeForMediaType(requestedMediaType);
  }
  return normalized;
}

function acceptHeaderForMediaType(mediaType: "image" | "video" | null): string {
  if (mediaType === "video") return "video/webm,video/mp4,video/*,*/*;q=0.8";
  if (mediaType === "image") return "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
  return "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/webm,video/mp4,video/*,*/*;q=0.8";
}

// 会话内媒体请求 init 单源：cookies/cache/credentials 走页面 session，referrer 交给 Chromium 按
// strict-origin-when-cross-origin 规范推导。**绝不手写 Referer**——Electron v31 net-fetch 不过滤
// forbidden header，跨源完整 URL 的 Referer 直通 Chromium 网络栈、与 referrer 政策相抵触，
// 被拦成 net::ERR_BLOCKED_BY_CLIENT（2026-07-22 审计 15 站实测根因：同 URL 无 Referer 直测 200，
// 带手写 Referer 全军覆没）。`referrer` 选项同样不传：net-fetch 源码只转发 referrerPolicy、丢弃 referrer。
export function browserMediaFetchInit(
  requestedMediaType: "image" | "video" | null,
  signal?: AbortSignal,
): RequestInit {
  return {
    credentials: "include",
    redirect: "follow",
    referrerPolicy: "strict-origin-when-cross-origin",
    ...(signal ? { signal } : {}),
    headers: { Accept: acceptHeaderForMediaType(requestedMediaType) },
  };
}

function urlsMatch(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

function downloadItemMatchesUrl(item: DownloadItem, url: string): boolean {
  return [item.getURL(), ...item.getURLChain()].some((candidate) => urlsMatch(candidate, url));
}

export function normalizeCaptureSourceRect(
  record: BrowserViewRecord,
  rect: BrowserResourceCaptureRectPayload | undefined,
): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
  const width = Math.round(Number(rect?.width));
  const height = Math.round(Number(rect?.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const viewWidth = Math.max(1, record.lastBounds.width);
  const viewHeight = Math.max(1, record.lastBounds.height);
  const boundedWidth = Math.min(width, viewWidth);
  const boundedHeight = Math.min(height, viewHeight);
  const localLeft = Math.min(Math.max(0, Math.round(Number(rect?.left) || 0)), viewWidth - boundedWidth);
  const localTop = Math.min(Math.max(0, Math.round(Number(rect?.top) || 0)), viewHeight - boundedHeight);
  const left = record.lastBounds.x + localLeft;
  const top = record.lastBounds.y + localTop;
  return {
    left,
    top,
    right: left + boundedWidth,
    bottom: top + boundedHeight,
    width: boundedWidth,
    height: boundedHeight,
  };
}

function normalizeLocalCaptureRect(
  record: BrowserViewRecord,
  rect: BrowserResourceCaptureRectPayload | undefined,
): Rectangle | null {
  const width = Math.round(Number(rect?.width));
  const height = Math.round(Number(rect?.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const viewWidth = Math.max(1, record.lastBounds.width);
  const viewHeight = Math.max(1, record.lastBounds.height);
  const boundedWidth = Math.min(width, viewWidth);
  const boundedHeight = Math.min(height, viewHeight);
  const x = Math.min(Math.max(0, Math.round(Number(rect?.left) || 0)), viewWidth - boundedWidth);
  const y = Math.min(Math.max(0, Math.round(Number(rect?.top) || 0)), viewHeight - boundedHeight);
  return { x, y, width: boundedWidth, height: boundedHeight };
}


export async function captureBrowserResource(record: BrowserViewRecord): Promise<void> {
  const win = BrowserWindow.fromId(record.ownerWindowId);
  if (!win || win.isDestroyed()) return;
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return;
  try {
    const captured = (await contents.executeJavaScript(
      "(() => window.__nomiReadBrowserResourceCapture?.() || null)()",
      true,
    )) as BrowserResourceCapturePayload | null;
    const url = typeof captured?.url === "string" ? captured.url.trim() : "";
    const mediaType = normalizeBrowserMediaType(captured?.mediaType);
    if (!url || !mediaType) {
      win.webContents.send("browser:view:resource-capture", {
        ok: false,
        viewId: record.viewId,
        tabId: record.tabId,
        reason: "empty",
      });
      return;
    }
    const sourceRect = normalizeCaptureSourceRect(record, captured?.sourceRect);
    win.webContents.send("browser:view:resource-capture", {
      ok: true,
      viewId: record.viewId,
      tabId: record.tabId,
      url,
      mediaType,
      title: typeof captured?.title === "string" ? captured.title : "",
      fileName: typeof captured?.fileName === "string" ? captured.fileName : "",
      pageUrl: typeof captured?.pageUrl === "string" ? captured.pageUrl : "",
      pageTitle: typeof captured?.pageTitle === "string" ? captured.pageTitle : "",
      sourceRect: sourceRect || undefined,
    });
  } catch (error) {
    win.webContents.send("browser:view:resource-capture", {
      ok: false,
      viewId: record.viewId,
      tabId: record.tabId,
      reason: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function downloadHttpBrowserMediaFromPageSession(
  record: BrowserViewRecord,
  mediaUrl: string,
  fallbackName: unknown,
  requestedMediaType: "image" | "video" | null,
): Promise<BrowserDownloadResult> {
  const contents = record.view.webContents;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-browser-capture-"));
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, 120_000);

  try {
    const response = await contents.session.fetch(mediaUrl, browserMediaFetchInit(requestedMediaType, abortController.signal));
    if (!response.ok) throw new Error(`网页素材下载失败（HTTP ${response.status}）`);
    const stagingPath = path.join(tempDir, "download.part");
    const header = await streamBrowserMediaResponseToFile(response, stagingPath);
    const resolved = resolveBrowserMediaContentType(
      response.headers.get("content-type") || "",
      requestedMediaType,
      header,
    );
    const tempFileName = safeTempFileName(
      captureFileName(mediaUrl, resolved.contentType, resolved.mediaType, fallbackName),
    );
    const savePath = path.join(tempDir, tempFileName);
    await fs.promises.rename(stagingPath, savePath);
    return {
      absolutePath: savePath,
      fileName: tempFileName,
      contentType: resolved.contentType,
      mediaType: resolved.mediaType,
      cleanupDir: tempDir,
    };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (timedOut || (error instanceof Error && error.name === "AbortError")) {
      throw new Error("Media download timed out", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadBrowserBlobFromPageViewUnqueued(
  record: BrowserViewRecord,
  mediaUrl: string,
  fallbackName: unknown,
  requestedMediaType: "image" | "video" | null,
): Promise<BrowserDownloadResult> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) throw new Error("Browser view is unavailable");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-browser-capture-"));
  let activeItem: DownloadItem | null = null;
  let downloadExceededLimit = false;

  return new Promise<BrowserDownloadResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      activeItem?.cancel();
      finish(new Error("Media download timed out"));
    }, 120_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      contents.session.removeListener("will-download", handleWillDownload);
    };

    const finish = (error: Error | null, result?: BrowserDownloadResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        reject(error);
        return;
      }
      if (!result) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        reject(new Error("Media download failed"));
        return;
      }
      resolve(result);
    };

    const handleWillDownload = (_event: Electron.Event, item: DownloadItem, downloadContents: WebContents): void => {
      if (downloadContents !== contents) return;
      if (!downloadItemMatchesUrl(item, mediaUrl)) return;

      activeItem = item;
      const initialTotalBytes = item.getTotalBytes();
      if (initialTotalBytes > BROWSER_MEDIA_MAX_BYTES) {
        item.cancel();
        finish(new Error("Media is too large to import"));
        return;
      }

      const fallbackContentType = fallbackContentTypeForMediaType(requestedMediaType);
      const itemContentType = normalizeDownloadedContentType(item.getMimeType() || fallbackContentType, requestedMediaType);
      const tempFileName = safeTempFileName(
        captureFileName(
          mediaUrl,
          itemContentType,
          requestedMediaType || mediaTypeFromContentType(itemContentType) || "image",
          item.getFilename() || fallbackName,
        ),
      );
      const savePath = path.join(tempDir, tempFileName);
      item.setSavePath(savePath);

      item.on("updated", () => {
        if (item.getReceivedBytes() > BROWSER_MEDIA_MAX_BYTES) {
          downloadExceededLimit = true;
          item.cancel();
        }
      });
      item.once("done", (_doneEvent, state) => {
        if (state !== "completed") {
          finish(new Error(downloadExceededLimit ? "Media is too large to import" : `Media download ${state}`));
          return;
        }
        if (!fs.existsSync(savePath)) {
          finish(new Error("Downloaded media file is missing"));
          return;
        }
        const stat = fs.statSync(savePath);
        if (!stat.isFile() || stat.size <= 0) {
          finish(new Error("Downloaded media file is empty"));
          return;
        }
        if (stat.size > BROWSER_MEDIA_MAX_BYTES) {
          finish(new Error("Media is too large to import"));
          return;
        }
        const fileDescriptor = fs.openSync(savePath, "r");
        const header = Buffer.alloc(4096);
        let headerBytes: number;
        try {
          headerBytes = fs.readSync(fileDescriptor, header, 0, header.byteLength, 0);
        } finally {
          fs.closeSync(fileDescriptor);
        }
        let resolved: { contentType: string; mediaType: "image" | "video" };
        try {
          resolved = resolveBrowserMediaContentType(
            item.getMimeType() || itemContentType || fallbackContentType,
            requestedMediaType,
            header.subarray(0, headerBytes),
          );
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        const verifiedFileName = safeTempFileName(
          captureFileName(mediaUrl, resolved.contentType, resolved.mediaType, item.getFilename() || fallbackName),
        );
        const verifiedSavePath = path.join(tempDir, verifiedFileName);
        if (verifiedSavePath !== savePath) fs.renameSync(savePath, verifiedSavePath);
        finish(null, {
          absolutePath: verifiedSavePath,
          fileName: verifiedFileName,
          contentType: resolved.contentType,
          mediaType: resolved.mediaType,
          cleanupDir: tempDir,
        });
      });
    };

    contents.session.on("will-download", handleWillDownload);
    try {
      // blob: 是页面本地对象 URL，不走网络——不需要也不该带任何请求头（Referer 见 browserMediaFetchInit 注释）。
      contents.downloadURL(mediaUrl);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function downloadBrowserBlobFromPageView(
  record: BrowserViewRecord,
  mediaUrl: string,
  fallbackName: unknown,
  requestedMediaType: "image" | "video" | null,
): Promise<BrowserDownloadResult> {
  const contents = record.view.webContents;
  return enqueueBrowserBlobDownload(contents, () =>
    downloadBrowserBlobFromPageViewUnqueued(record, mediaUrl, fallbackName, requestedMediaType));
}

export async function downloadBrowserMediaFromPageView(
  record: BrowserViewRecord,
  mediaUrl: string,
  fallbackName: unknown,
  requestedMediaType: "image" | "video" | null,
): Promise<BrowserDownloadResult> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) throw new Error("Browser view is unavailable");
  if (mediaUrl.startsWith("blob:")) {
    return downloadBrowserBlobFromPageView(record, mediaUrl, fallbackName, requestedMediaType);
  }
  return downloadHttpBrowserMediaFromPageSession(record, mediaUrl, fallbackName, requestedMediaType);
}

export async function importBrowserMedia(record: BrowserViewRecord, payload: BrowserViewImportMediaPayload): Promise<unknown> {
  const projectId = String(payload.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const contents = record.view.webContents;
  const pageUrl = contents.getURL();
  const mediaUrl = normalizeBrowserMediaUrl(payload.url, pageUrl);
  const requestedMediaType = normalizeBrowserMediaType(payload.mediaType);
  const download = await downloadBrowserMediaFromPageView(
    record,
    mediaUrl,
    payload.fileName || payload.title,
    requestedMediaType,
  );

  try {
    const { moveAssetFile } = await import("../../runtime");
    return moveAssetFile(
      projectId,
      download.absolutePath,
      captureFileName(
        mediaUrl,
        download.contentType,
        download.mediaType || requestedMediaType || "image",
        payload.fileName || payload.title || download.fileName,
      ),
      download.contentType,
      {
        kind: "browser-capture",
        // M0 捕捞评审定案：网页 URL 绝不进 originalUrl（48h 信任窗会把它发给生成商）。
        // projectAssetStore 的 sanitizeAssetMetaForKind 对 capture 族有兜底，这里显式写明意图。
        originalUrl: null,
        pageUrl: safeHeaderUrl(pageUrl) || null,
        title: payload.title || null,
        mediaType: download.mediaType || requestedMediaType || null,
      },
    );
  } finally {
    fs.rmSync(download.cleanupDir, { recursive: true, force: true });
  }
}

export function assertPromptReferenceDataUrlSize(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength < 0 || byteLength > BROWSER_PROMPT_IMAGE_MAX_BYTES) {
    throw new Error("图片过大，无法用于提示词提取（最大 16 MB）");
  }
}

async function dataUrlFromFile(filePath: string, contentType: string): Promise<string> {
  const mime = normalizeDownloadedContentType(contentType, "image");
  const stat = await fs.promises.stat(filePath);
  assertPromptReferenceDataUrlSize(stat.size);
  const bytes = await fs.promises.readFile(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function movePromptReferenceFile(input: {
  projectId: string;
  absolutePath: string;
  fileName: string;
  contentType: string;
  sourceUrl?: string;
  pageUrl?: string;
  title?: unknown;
}): Promise<unknown | null> {
  if (!input.projectId) return null;
  const { moveAssetFile } = await import("../../runtime");
  return moveAssetFile(input.projectId, input.absolutePath, input.fileName, input.contentType, {
    kind: "browser-prompt-reference",
    originalUrl: input.sourceUrl || null,
    pageUrl: safeHeaderUrl(input.pageUrl || "") || null,
    title: input.title || null,
    mediaType: "image",
  });
}

export async function captureBrowserPromptImage(
  record: BrowserViewRecord,
  payload: BrowserViewPromptImagePayload,
): Promise<unknown> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) throw new Error("Browser view is unavailable");
  const projectId = String(payload.projectId || "").trim();
  const pageUrl = contents.getURL();
  const mediaUrl = normalizeBrowserMediaUrl(payload.url, pageUrl);
  const download = await downloadBrowserMediaFromPageView(record, mediaUrl, payload.fileName || payload.title, "image");

  try {
    if (download.mediaType && download.mediaType !== "image") throw new Error("The selected resource is not an image");
    const contentType = normalizeDownloadedContentType(download.contentType, "image");
    const dataUrl = await dataUrlFromFile(download.absolutePath, contentType);
    const fileName = captureFileName(mediaUrl, contentType, "image", payload.fileName || payload.title || download.fileName);
    const asset = await movePromptReferenceFile({
      projectId,
      absolutePath: download.absolutePath,
      fileName,
      contentType,
      sourceUrl: mediaUrl,
      pageUrl,
      title: payload.title,
    });
    const referenceUrl =
      asset && typeof asset === "object" && "data" in asset && typeof (asset as { data?: { url?: unknown } }).data?.url === "string"
        ? String((asset as { data: { url: string } }).data.url)
        : dataUrl;
    return {
      dataUrl,
      referenceUrl,
      fileName,
      title: typeof payload.title === "string" ? payload.title : "",
      sourceUrl: mediaUrl,
      pageUrl,
      pageTitle: contents.getTitle(),
      ...(asset ? { asset } : {}),
    };
  } finally {
    fs.rmSync(download.cleanupDir, { recursive: true, force: true });
  }
}

export async function selectBrowserPromptScreenshotRect(record: BrowserViewRecord): Promise<BrowserPromptScreenshotSelectionResult> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return { ok: false, reason: "error", message: "Browser view is unavailable" };
  const owner = BrowserWindow.fromId(record.ownerWindowId);
  if (!owner || owner.isDestroyed()) return { ok: false, reason: "error", message: "Browser window is unavailable" };
  if (record.lastBounds.width <= 0 || record.lastBounds.height <= 0) {
    return { ok: false, reason: "error", message: "Browser view bounds are unavailable" };
  }
  try {
    bringBrowserViewToFront(record);
    record.view.setBounds(record.lastBounds);
    record.view.setVisible(true);
    contents.focus();
  } catch {
    // Focusing can fail while the view is navigating; executeJavaScript below will surface real failures.
  }
  const script = `
(() => new Promise((resolve) => {
  const existing = document.getElementById('__nomi_prompt_screenshot_selection__');
  if (existing && existing.parentElement) existing.parentElement.removeChild(existing);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const viewport = () => ({
    width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
    height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1),
  });
  const pointFromEvent = (event) => {
    const bounds = viewport();
    return {
      x: clamp(event.clientX, 0, bounds.width),
      y: clamp(event.clientY, 0, bounds.height),
    };
  };
  const rectFromPoints = (start, end) => {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);
    return { left, top, width: right - left, height: bottom - top };
  };

  const overlay = document.createElement('div');
  overlay.id = '__nomi_prompt_screenshot_selection__';
  overlay.tabIndex = -1;
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'cursor:crosshair',
    'background:rgba(0,0,0,.42)',
    'outline:none',
    'user-select:none',
    'touch-action:none',
    'pointer-events:auto'
  ].join(';');

  const hint = document.createElement('div');
  hint.textContent = '拖拽选择截图区域，Esc 取消';
  hint.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:18px',
    'transform:translateX(-50%)',
    'height:32px',
    'display:flex',
    'align-items:center',
    'padding:0 12px',
    'border-radius:999px',
    'background:rgba(17,24,39,.88)',
    'color:#fff',
    'font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'box-shadow:0 10px 24px rgba(15,23,42,.24)',
    'pointer-events:none'
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    'display:none',
    'border:2px solid #fff',
    'border-radius:10px',
    'background:rgba(255,255,255,.08)',
    'box-shadow:0 0 0 9999px rgba(0,0,0,.34),0 12px 32px rgba(0,0,0,.28)',
    'pointer-events:none'
  ].join(';');

  const sizeLabel = document.createElement('div');
  sizeLabel.style.cssText = [
    'position:absolute',
    'right:8px',
    'bottom:8px',
    'height:22px',
    'display:flex',
    'align-items:center',
    'padding:0 7px',
    'border-radius:999px',
    'background:rgba(17,24,39,.82)',
    'color:#fff',
    'font:600 11px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
  ].join(';');
  box.appendChild(sizeLabel);
  (document.body || document.documentElement).appendChild(overlay);
  overlay.appendChild(hint);
  overlay.appendChild(box);

  let start = null;
  let settled = false;

  const render = (rect) => {
    box.style.display = 'block';
    box.style.left = Math.round(rect.left) + 'px';
    box.style.top = Math.round(rect.top) + 'px';
    box.style.width = Math.round(rect.width) + 'px';
    box.style.height = Math.round(rect.height) + 'px';
    sizeLabel.textContent = Math.round(rect.width) + ' x ' + Math.round(rect.height);
  };
  const cleanup = () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKeyDown, true);
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  };
  const finish = (rect) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(rect);
  };
  function onPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      finish(null);
      return;
    }
    start = pointFromEvent(event);
    render({ left: start.x, top: start.y, width: 0, height: 0 });
  }
  function onPointerMove(event) {
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    render(rectFromPoints(start, pointFromEvent(event)));
  }
  function onPointerUp(event) {
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = rectFromPoints(start, pointFromEvent(event));
    finish(rect.width >= 8 && rect.height >= 8 ? rect : null);
  }
  function onCancel(event) {
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  }
  function onContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  }
  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('keydown', onKeyDown, true);
  try { overlay.focus({ preventScroll: true }); } catch {}
}))()
`;
  try {
    const selected = (await contents.executeJavaScript(script, true)) as BrowserResourceCaptureRectPayload | null;
    const rect = normalizeLocalCaptureRect(record, selected ?? undefined);
    if (!rect) return { ok: false, reason: "cancelled" };
    return {
      ok: true,
      rect: {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (!owner.isDestroyed()) owner.focus();
  }
}

export async function captureBrowserPromptScreenshot(
  record: BrowserViewRecord,
  payload: BrowserViewPromptScreenshotPayload,
): Promise<unknown> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) throw new Error("Browser view is unavailable");
  const projectId = String(payload.projectId || "").trim();
  const pageUrl = contents.getURL();
  const localCaptureRect = normalizeLocalCaptureRect(record, payload.sourceRect);
  const image = localCaptureRect ? await contents.capturePage(localCaptureRect) : await contents.capturePage();
  if (image.isEmpty()) throw new Error("Screenshot is empty");
  const contentType = "image/png";
  const dataUrl = image.toDataURL();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-browser-prompt-screenshot-"));
  const fileName = safeTempFileName(String(payload.fileName || payload.title || `browser-screenshot-${Date.now()}.png`));
  const absolutePath = path.join(tempDir, fileName.endsWith(".png") ? fileName : `${fileName}.png`);
  fs.writeFileSync(absolutePath, image.toPNG());
  try {
    const asset = await movePromptReferenceFile({
      projectId,
      absolutePath,
      fileName: path.basename(absolutePath),
      contentType,
      sourceUrl: pageUrl,
      pageUrl,
      title: payload.title || contents.getTitle(),
    });
    const referenceUrl =
      asset && typeof asset === "object" && "data" in asset && typeof (asset as { data?: { url?: unknown } }).data?.url === "string"
        ? String((asset as { data: { url: string } }).data.url)
        : dataUrl;
    const sourceRect = normalizeCaptureSourceRect(
      record,
      localCaptureRect
        ? {
            left: localCaptureRect.x,
            top: localCaptureRect.y,
            width: localCaptureRect.width,
            height: localCaptureRect.height,
          }
        : {
            left: 0,
            top: 0,
            width: record.lastBounds.width,
            height: record.lastBounds.height,
          },
    );
    return {
      dataUrl,
      referenceUrl,
      fileName: path.basename(absolutePath),
      title: typeof payload.title === "string" ? payload.title : contents.getTitle(),
      sourceUrl: pageUrl,
      pageUrl,
      pageTitle: contents.getTitle(),
      ...(sourceRect ? { sourceRect } : {}),
      ...(asset ? { asset } : {}),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

