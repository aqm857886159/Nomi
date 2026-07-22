import fs from "node:fs";

export const BROWSER_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

export function mediaTypeFromContentType(contentType: string): "image" | "video" | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return null;
}

// ── 黑帧 / 空帧判定（MSE 当前帧诚实性）─────────────────────────────────
// B站等的播放器首轮可能是纯黑阻断画面；把全黑「当前帧」当成功卡是假进度（复测 P1）。
// 落库前算亮度均值 + 方差，纯黑/纯色空帧拒绝，提示用户先播放到有效画面。

/** BGRA 位图（nativeImage.getBitmap()）按 stride 采样算亮度均值/方差。空/异常 → 全零（判为空帧）。 */
export function bgraLumaStats(bitmap: Uint8Array | Buffer, stride = 4): { mean: number; variance: number } {
  const pixelStride = Math.max(1, Math.floor(stride)) * 4;
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i + 3 < bitmap.length; i += pixelStride) {
    // getBitmap() 是 B,G,R,A 序。
    const luma = 0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2];
    sum += luma;
    sumSq += luma * luma;
    count += 1;
  }
  if (count === 0) return { mean: 0, variance: 0 };
  const mean = sum / count;
  return { mean, variance: Math.max(0, sumSq / count - mean * mean) };
}

/**
 * 「无有效画面」判据：方差极低 = 整帧几乎纯色（纯黑阻断画面 YMIN=YMAX=YAVG → 方差≈0）；
 * 叠加「近黑且低方差」兜住带轻噪的黑帧。阈值保守，避免误伤有内容的暗场景（其方差远高于此）。
 */
export function isBlankFrameLuma(meanLuma: number, lumaVariance: number): boolean {
  return lumaVariance <= 4 || (meanLuma <= 12 && lumaVariance <= 12);
}

/**
 * 动图判定（GIF/动画 WebP）：诚实标注「动态图」而非笼统「网页原图」。纯 header 检测，误判从宽（宁少标）。
 * - 动画 WebP：RIFF/WEBP + VP8X chunk 动画标志位（flags & 0x02），或出现 ANMF chunk。
 * - 动画 GIF：GIF8 + NETSCAPE2.0 应用扩展，或图像分隔符（0x2C）出现多于一次。
 */
export function detectAnimatedImage(bytes: Uint8Array | Buffer, contentType: string): boolean {
  const type = String(contentType || "").toLowerCase();
  const buffer = Buffer.from(bytes.buffer ?? bytes, (bytes as Buffer).byteOffset ?? 0, bytes.length);
  if (type.includes("webp") || (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")) {
    if (buffer.subarray(12, 16).toString("ascii") === "VP8X" && buffer.length > 20 && (buffer[20] & 0x02) !== 0) return true;
    return buffer.includes(Buffer.from("ANMF", "ascii"));
  }
  const head6 = buffer.subarray(0, 6).toString("ascii");
  if (type.includes("gif") || head6 === "GIF87a" || head6 === "GIF89a") {
    if (buffer.includes(Buffer.from("NETSCAPE2.0", "ascii"))) return true;
    let separators = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      if (buffer[i] === 0x2c) separators += 1;
      if (separators > 1) return true;
    }
  }
  return false;
}

function sniffBrowserMediaContentType(bytes: Uint8Array): string | null {
  const startsWith = (...values: number[]): boolean => values.every((value, index) => bytes[index] === value);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF87a" || Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "AVI ") {
    return "video/x-msvideo";
  }
  if (startsWith(0x42, 0x4d)) return "image/bmp";
  if (startsWith(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)) return "image/tiff";
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "OggS") return "video/ogg";
  if (startsWith(0x00, 0x00, 0x01, 0xba) || startsWith(0x00, 0x00, 0x01, 0xb3)) return "video/mpeg";
  const fileTypeBrand = Buffer.from(bytes.subarray(4, 12)).toString("ascii");
  if (/^ftyp(?:avif|avis)/.test(fileTypeBrand)) return "image/avif";
  if (/^ftyp(?:heic|heix|hevc|hevx|mif1|msf1)/.test(fileTypeBrand)) return "image/heic";
  if (/^ftypqt\s*/i.test(fileTypeBrand)) return "video/quicktime";
  if (/^ftypm4v/i.test(fileTypeBrand)) return "video/x-m4v";
  if (fileTypeBrand.startsWith("ftyp")) return "video/mp4";
  const textPrefix = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(textPrefix)) return "image/svg+xml";
  return null;
}

export function resolveBrowserMediaContentType(
  reportedContentType: string,
  requestedMediaType: "image" | "video" | null,
  bytes: Uint8Array,
): { contentType: string; mediaType: "image" | "video" } {
  const reported = String(reportedContentType || "").split(";")[0]?.trim().toLowerCase() || "";
  const reportedMediaType = mediaTypeFromContentType(reported);
  const sniffed = sniffBrowserMediaContentType(bytes);
  const sniffedMediaType = sniffed ? mediaTypeFromContentType(sniffed) : null;
  if (reportedMediaType) {
    if (requestedMediaType && reportedMediaType !== requestedMediaType) {
      throw new Error(`网页返回的媒体类型不匹配（${reported}）`);
    }
    if (!sniffed || !sniffedMediaType || sniffedMediaType !== reportedMediaType) {
      throw new Error(`网页响应头声称是媒体，但内容无法识别（${reported}）`);
    }
    // 同属图片/视频时以魔数为准，避免 `image/jpeg` + PNG 正文被落成错误扩展。
    return { contentType: sniffed, mediaType: sniffedMediaType };
  }
  if (reported && reported !== "application/octet-stream") {
    throw new Error(`网页返回的不是图片或视频（${reported}）`);
  }
  if (!sniffed || !sniffedMediaType || (requestedMediaType && sniffedMediaType !== requestedMediaType)) {
    throw new Error("网页返回的不是可识别的图片或视频");
  }
  return { contentType: sniffed, mediaType: sniffedMediaType };
}

export async function streamBrowserMediaResponseToFile(
  response: Response,
  savePath: string,
  maxBytes = BROWSER_MEDIA_MAX_BYTES,
): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Media is too large to import");
  }
  if (!response.body) throw new Error("Downloaded media file is empty");
  const reader = response.body.getReader();
  const file = await fs.promises.open(savePath, "wx");
  const header = Buffer.alloc(4096);
  let headerBytes = 0;
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("media too large").catch(() => undefined);
        throw new Error("Media is too large to import");
      }
      if (headerBytes < header.byteLength) {
        const copyBytes = Math.min(chunk.byteLength, header.byteLength - headerBytes);
        chunk.copy(header, headerBytes, 0, copyBytes);
        headerBytes += copyBytes;
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const result = await file.write(chunk, offset, chunk.byteLength - offset, null);
        if (result.bytesWritten <= 0) throw new Error("Media download could not be written");
        offset += result.bytesWritten;
      }
    }
  } finally {
    await file.close();
  }
  if (totalBytes <= 0) throw new Error("Downloaded media file is empty");
  return header.subarray(0, headerBytes);
}
