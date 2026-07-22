// L4 诚实视觉降级（吸收 claude/bold-sinoussi-2a0c04 Phase1，升级为分型引擎的一层）：
// 按 URL 拿不回原件时，把屏幕上已渲染的像素诚实地捕下来——元素截图（图片）/当前帧（MSE 视频）。
// capturePage 在合成器层、JS 沙箱外，天然绕过 CORS/canvas 污染/防盗链；代价只有屏幕分辨率，
// 所以产物必须带 captureQuality 标注，绝不冒充原图/原视频。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeImage, type WebContents } from "electron";
import { captureFileName } from "../captureNaming";
import type { BrowserDownloadResult, BrowserResourceCaptureRectPayload, BrowserViewRecord } from "../core/browserViewTypes";
import { captureError, decodeDataUrlMedia, normalizeLocalCaptureRect, safeTempFileName } from "./browserCaptureSource";
import { bgraLumaStats, isBlankFrameLuma } from "./browserMediaValidation";

// 纯黑/纯色空帧（如 B站首轮阻断画面）不落库——否则是「假成功卡」（复测 P1）。落库前分析产物像素。
function rejectBlankCurrentFrame(image: Electron.NativeImage): void {
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) return;
  const stats = bgraLumaStats(image.getBitmap());
  if (isBlankFrameLuma(stats.mean, stats.variance)) {
    throw captureError("black-frame", "视频当前是黑屏/无画面——先在页面里播放到有清晰画面的一帧，再保存当前帧");
  }
}

// 普通 blob（File/Blob 对象 URL）页面内 fetch 立刻成功；MediaSource 的对象 URL fetch 必然 TypeError——
// 这是无站点特判区分「可下载 blob」与「MSE 流」的通用探针。超时按可下载处理（下载路自有失败分类）。
export async function pageBlobIsMediaSource(contents: WebContents, blobUrl: string): Promise<boolean> {
  try {
    const verdict = await contents.executeJavaScript(
      `
(() => {
  const probe = fetch(${JSON.stringify(blobUrl)}).then((response) => {
    try { if (response.body && response.body.cancel) response.body.cancel(); } catch (error) {}
    return 'file';
  }, () => 'mse');
  const timeout = new Promise((resolve) => { setTimeout(() => resolve('file'), 3000); });
  return Promise.race([probe, timeout]);
})()`,
      true,
    );
    return verdict === "mse";
  } catch {
    return false;
  }
}

/**
 * 视觉降级之定位：在页面里按媒体 URL 找到可见元素（img/video/source/背景图），滚进视口，
 * 返回它的页面本地矩形。找不到返回 null（改由捕捞时冻结的 lastResourceCapture 兜，或彻底失败）。
 */
async function locateMediaElementRect(
  contents: WebContents,
  mediaUrl: string,
): Promise<BrowserResourceCaptureRectPayload | null> {
  try {
    const script = `(() => {
      const target = ${JSON.stringify(mediaUrl)};
      const hit = (value) => typeof value === 'string' && value.indexOf(target) !== -1;
      const media = Array.from(document.querySelectorAll('img,video,source'));
      let element = media.find((node) => hit(node.currentSrc) || hit(node.src) || hit(node.getAttribute && node.getAttribute('src')) || hit(node.srcset));
      if (element && element.tagName === 'SOURCE' && element.parentElement) element = element.parentElement;
      if (!element) {
        element = Array.from(document.querySelectorAll('*')).find((node) => {
          const background = getComputedStyle(node).backgroundImage;
          return background && background.indexOf(target) !== -1;
        });
      }
      if (!element) return null;
      try { element.scrollIntoView({ block: 'center', inline: 'center' }); } catch (error) {}
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1) return null;
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    })()`;
    const rect = (await contents.executeJavaScript(script, true)) as BrowserResourceCaptureRectPayload | null;
    return rect && typeof rect === "object" ? rect : null;
  } catch {
    return null;
  }
}

function saveCapturedPngToTemp(mediaUrl: string, bytes: Buffer, stemHint: string): BrowserDownloadResult {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-browser-capture-"));
  const fileName = safeTempFileName(captureFileName(mediaUrl, "image/png", "image", stemHint));
  const absolutePath = path.join(tempDir, fileName.toLowerCase().endsWith(".png") ? fileName : `${fileName}.png`);
  fs.writeFileSync(absolutePath, bytes);
  return {
    absolutePath,
    fileName: path.basename(absolutePath),
    contentType: "image/png",
    mediaType: "image",
    cleanupDir: tempDir,
  };
}

/**
 * 「所见即所得」元素截图：按 URL 下载不到原件时（防盗链/签名过期/登录墙），把该元素在屏幕上
 * 已渲染的像素 capturePage 下来。rect 优先用捕捞时冻结、与本次 url 匹配且新鲜（120s）的快照；
 * 否则现场按 url 定位。产物标注 captureQuality='screenshot'。
 */
export async function captureMediaScreenshotFallback(
  record: BrowserViewRecord,
  mediaUrl: string,
): Promise<BrowserDownloadResult | null> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return null;

  const recent = record.lastResourceCapture;
  let rawRect: BrowserResourceCaptureRectPayload | undefined =
    recent && recent.url === mediaUrl && Date.now() - recent.capturedAt < 120_000 ? recent.sourceRect : undefined;
  if (!rawRect) rawRect = (await locateMediaElementRect(contents, mediaUrl)) || undefined;
  const rect = normalizeLocalCaptureRect(record, rawRect);
  if (!rect) return null;

  // 等两帧，确保 scrollIntoView 后的画面已合成再截。
  try {
    await contents.executeJavaScript("new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(0))))", true);
  } catch {
    // 即便没等到帧也照截，最坏截到滚动前的画面。
  }

  const image = await contents.capturePage(rect);
  if (image.isEmpty()) return null;
  return saveCapturedPngToTemp(mediaUrl, image.toPNG(), "capture.png");
}

/**
 * MSE 视频「当前帧」：页面内把 <video> 当前画面画进 canvas，拿原生分辨率 PNG；
 * 跨域污染画不了 → 退元素矩形 capturePage（合成器像素，分辨率=屏幕显示尺寸）。
 * 产物是图片、标注 captureQuality='frame'——诚实兑现「保存当前帧」，不冒充完整视频。
 */
export async function captureVideoCurrentFrame(
  record: BrowserViewRecord,
  mediaUrl: string,
): Promise<BrowserDownloadResult | null> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return null;
  let probe: { dataUrl?: string; rect?: BrowserResourceCaptureRectPayload } | null;
  try {
    probe = (await contents.executeJavaScript(
      `
(() => {
  const target = ${JSON.stringify(mediaUrl)};
  const videos = Array.from(document.querySelectorAll('video'));
  const video = videos.find((node) => node.currentSrc === target || node.src === target) || videos.find((node) => node.currentSrc || node.src);
  if (!video) return null;
  const box = video.getBoundingClientRect();
  const rect = { left: box.left, top: box.top, width: box.width, height: box.height };
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  if (width >= 2 && height >= 2) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, width, height);
        return { dataUrl: canvas.toDataURL('image/png'), rect };
      }
    } catch (error) {
      // 跨域污染 canvas —— 退 capturePage
    }
  }
  return { rect };
})()`,
      true,
    )) as { dataUrl?: string; rect?: BrowserResourceCaptureRectPayload } | null;
  } catch {
    return null;
  }
  if (!probe) return null;
  if (typeof probe.dataUrl === "string" && probe.dataUrl.startsWith("data:image/")) {
    try {
      const { buffer } = decodeDataUrlMedia(probe.dataUrl);
      // 黑帧拒绝在解码后、落库前（canvas 路能拿到真实视频像素，最可靠）。black-frame 错误往上抛，不吞。
      rejectBlankCurrentFrame(nativeImage.createFromBuffer(buffer));
      return saveCapturedPngToTemp(mediaUrl, buffer, "frame.png");
    } catch (error) {
      if (error instanceof Error && /\[nomi-capture:black-frame\]/i.test(error.message)) throw error;
      // dataURL 解码异常 → 退 capturePage
    }
  }
  const rect = normalizeLocalCaptureRect(record, probe.rect);
  if (!rect) return null;
  const image = await contents.capturePage(rect);
  if (image.isEmpty()) return null;
  rejectBlankCurrentFrame(image);
  return saveCapturedPngToTemp(mediaUrl, image.toPNG(), "frame.png");
}
