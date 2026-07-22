// 捕捞源分型 + 结构化错误码 + 捕捞几何/命名纯函数（2026-07-22 审计：「一次动作、分层兑现」；
// 每种失败必须映射到一个可行动下一步，不再折叠成通用「请重试」）。纯函数层，只依赖类型，配单测。
import type { Rectangle } from "electron";
import path from "node:path";
import { BROWSER_MEDIA_MAX_BYTES } from "./browserMediaValidation";
import type { BrowserResourceCaptureRectPayload, BrowserViewRecord } from "../core/browserViewTypes";

export type BrowserCaptureErrorCode =
  | "forbidden" // 401/403/防盗链——网站拒绝，可能要登录
  | "not-found" // 404/410——链接失效
  | "html-not-media" // 返回 HTML 冒充媒体（防盗链页/人机验证页）
  | "too-large" // 超 200MB 限额
  | "timeout" // 下载超时
  | "blocked-by-client" // 客户端安全策略拦截
  | "mse-stream" // MediaSource 流媒体——没有可下载原件
  | "network" // 连接层失败（DNS/断网/重置/中断）
  | "unknown";

const CAPTURE_ERROR_STRIP_PATTERN = /^\[nomi-capture:([a-z-]+)\]\s*/i;
// 查找不锚定行首：渲染层拿到的是 IPC 包裹后的 message（Error invoking remote method …: Error: [nomi-capture:…]）。
const CAPTURE_ERROR_FIND_PATTERN = /\[nomi-capture:([a-z-]+)\]/i;

/** 结构化捕捞错误：`[nomi-capture:<code>] 人话`。code 经 IPC 存活在 message 里，渲染层解析。 */
export function captureError(code: BrowserCaptureErrorCode, message: string, cause?: unknown): Error {
  const clean = String(message || "").replace(CAPTURE_ERROR_STRIP_PATTERN, "");
  return new Error(`[nomi-capture:${code}] ${clean}`, cause !== undefined ? { cause } : undefined);
}

export function captureErrorCode(reason: string): BrowserCaptureErrorCode | null {
  const match = CAPTURE_ERROR_FIND_PATTERN.exec(String(reason || ""));
  return match ? (match[1]!.toLowerCase() as BrowserCaptureErrorCode) : null;
}

/** 把下载层抛出的原始错误归类成错误码（importBrowserMedia 汇合点统一包装）。 */
export function classifyDownloadError(reason: string): BrowserCaptureErrorCode {
  const text = String(reason || "");
  const existing = captureErrorCode(text);
  if (existing) return existing;
  if (/HTTP\s*(401|403)/i.test(text)) return "forbidden";
  if (/HTTP\s*(404|410)/i.test(text)) return "not-found";
  if (/不是图片或视频|内容无法识别|媒体类型不匹配/i.test(text)) return "html-not-media";
  if (/too large|超过\s*200/i.test(text)) return "too-large";
  if (/timed out|超时/i.test(text)) return "timeout";
  if (/ERR_BLOCKED_BY_CLIENT/i.test(text)) return "blocked-by-client";
  if (/ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_|NETWORK_|ADDRESS_|PROXY_|TIMED_OUT)/i.test(text)) return "network";
  if (/Media download (interrupted|cancelled)/i.test(text)) return "network";
  return "unknown";
}

/** 捕捞源三分型：data（就地解码）/ blob（页面上下文，需再分普通 blob vs MSE）/ http（会话下载）。 */
export function classifyBrowserMediaSource(url: string): "data" | "blob" | "http" {
  const value = String(url || "");
  if (/^data:/i.test(value)) return "data";
  if (/^blob:/i.test(value)) return "blob";
  return "http";
}

const DATA_URL_PATTERN = /^data:([^;,]*)((?:;[^;,]+)*),([\s\S]*)$/;

/** data: URL 就地解码：大小限额与 HTTP 路对齐（200MB），magic 校验交给上层 resolveBrowserMediaContentType。 */
export function decodeDataUrlMedia(dataUrl: string): { buffer: Buffer; declaredContentType: string } {
  const match = DATA_URL_PATTERN.exec(String(dataUrl || ""));
  if (!match) throw captureError("html-not-media", "data: URL 无法解析");
  const declaredContentType = (match[1] || "application/octet-stream").trim().toLowerCase();
  const isBase64 = /;base64/i.test(match[2] || "");
  const payload = match[3] || "";
  // 先按编码长度预检，避免超限内容先整段解码进内存。
  const estimatedBytes = isBase64 ? Math.floor((payload.length * 3) / 4) : payload.length;
  if (estimatedBytes > BROWSER_MEDIA_MAX_BYTES) throw captureError("too-large", "data: 素材超过 200MB 上限");
  let buffer: Buffer;
  try {
    buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  } catch (error) {
    throw captureError("html-not-media", "data: URL 内容无法解码", error);
  }
  if (buffer.byteLength === 0) throw captureError("html-not-media", "data: URL 内容为空");
  if (buffer.byteLength > BROWSER_MEDIA_MAX_BYTES) throw captureError("too-large", "data: 素材超过 200MB 上限");
  return { buffer, declaredContentType };
}

export function safeTempFileName(fileName: string): string {
  const baseName = Array.from(path.basename(fileName))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || '<>:"/\\|?*'.includes(char) ? "_" : char;
    })
    .join("")
    .trim();
  return baseName || `browser-resource-${Date.now()}.bin`;
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

export function normalizeLocalCaptureRect(
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
