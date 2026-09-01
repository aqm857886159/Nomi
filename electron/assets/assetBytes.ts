import fs from "node:fs";
import path from "node:path";

// 从 runtime.ts 拆出（巨壳门岗·只减不增，相5 资产 I/O 拆分的第一步）：
// 纯字节/路径 helper，无 runtime 状态依赖。

/** 递归收集目录下所有文件的绝对路径（目录不存在 → 空）。 */
export function collectFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

/** 解析 data: URL → 字节 + contentType（非法即抛）。 */
export function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } {
  // RFC 2397: data:[<mediatype>][;base64],<data> — <mediatype> may carry extra
  // parameters (`;charset=utf-8`, `;utf8`, …). Match the whole parameter run up
  // to the comma rather than only `;base64`, so an inline `data:image/svg+xml;utf8,…`
  // (very common for seeded SVG thumbnails) parses instead of throwing.
  const match = dataUrl.match(/^data:([^;,]+)?((?:;[^,]*)*),([\s\S]*)$/);
  if (!match) throw new Error("Invalid data URL");
  const contentType = match[1] || "application/octet-stream";
  const isBase64 = /;base64\b/i.test(match[2] || "");
  const encoded = match[3] || "";
  // Non-base64 payloads are percent-encoded text; tolerate a literal (already
  // decoded) payload if decodeURIComponent chokes on stray `%`.
  let bytes: Buffer;
  if (isBase64) {
    bytes = Buffer.from(encoded, "base64");
  } else {
    try {
      bytes = Buffer.from(decodeURIComponent(encoded));
    } catch {
      bytes = Buffer.from(encoded);
    }
  }
  return { bytes, contentType };
}
