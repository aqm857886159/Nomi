// 捕捞素材的纯命名/校验核（可单测，无 Electron 依赖）。
import { extensionFromMime } from "../assets/assetPaths";

/** 捕捞只吃这三类 URL：http(s)（经 session 下载）、blob（页面上下文解析）、data:image（就地解码）。 */
export function isCapturableMediaUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^blob:/i.test(url) || /^data:image\//i.test(url);
}

/**
 * 从媒体 URL + contentType 推捕捞文件名：优先 URL 路径里的原名（去 query、防目录穿越），
 * 无可读名（data:/blob:/裸路径）→ `capture-<时间戳>`；扩展名一律由 contentType derive（URL 上的骗不了）。
 */
export function captureFileName(mediaUrl: string, contentType: string, kindHint: "image" | "video" | "screenshot"): string {
  const ext = extensionFromMime(contentType, kindHint === "video" ? "mp4" : "png");
  let base = "";
  if (/^https?:\/\//i.test(mediaUrl)) {
    try {
      const pathname = new URL(mediaUrl).pathname;
      const last = pathname.split("/").filter(Boolean).pop() || "";
      // 先解码再验证（%2F 解码后才现形为 /），拒含 .. 的名——防目录穿越进文件名。
      const stem = decodeURIComponentSafe(last.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 60));
      if (/^[\w\-. ()一-鿿]+$/u.test(stem) && stem.trim() && !stem.includes("..")) base = stem;
    } catch {
      // URL 解析失败 → 走兜底名
    }
  }
  if (!base) base = `${kindHint === "screenshot" ? "screenshot" : "capture"}-${Date.now()}`;
  return `${base}.${ext}`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
