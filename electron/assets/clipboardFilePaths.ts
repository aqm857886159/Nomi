import path from "node:path";

const URI_FORMATS = new Set(["public.file-url", "text/uri-list", "text/plain"]);
const WINDOWS_FORMATS = new Set(["FileNameW", "FileName"]);

function isAbsoluteFilePath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function decodeFileUri(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    const pathname = decodeURIComponent(url.pathname);
    // URI paths are a cross-platform protocol. Preserve POSIX paths even when
    // the host running Nomi is Windows; only drive/UNC forms use win32 syntax.
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      const drivePath = pathname.slice(1);
      return process.platform === "win32" ? path.win32.normalize(drivePath) : drivePath;
    }
    if (url.host && url.host !== "localhost") {
      const unc = `//${url.host}${pathname}`;
      return process.platform === "win32" ? path.win32.normalize(unc) : unc;
    }
    return path.posix.normalize(pathname);
  } catch {
    return null;
  }
}

function normalizeCandidate(value: string, format: string): string | null {
  const candidate = value.replace(/^\uFEFF/, "").replace(/\0+$/, "").trim();
  if (!candidate) return null;
  if (URI_FORMATS.has(format)) {
    const filePath = decodeFileUri(candidate);
    if (filePath && isAbsoluteFilePath(filePath)) return filePath;
    return format === "text/plain" && isAbsoluteFilePath(candidate) ? candidate : null;
  }
  return WINDOWS_FORMATS.has(format) && isAbsoluteFilePath(candidate) ? candidate : null;
}

function decodeCandidates(format: string, bytes: Buffer): string[] {
  if (format === "FileNameW") return bytes.toString("utf16le").split("\0");
  if (WINDOWS_FORMATS.has(format) || URI_FORMATS.has(format)) return bytes.toString("utf8").split(/[\0\r\n]+/);
  return [];
}

/** Extract absolute local file paths from OS clipboard payloads. */
export function parseClipboardFilePaths(format: string, bytes: Buffer): string[] {
  const normalizedFormat = String(format || "").trim();
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const candidate of decodeCandidates(normalizedFormat, bytes)) {
    if (normalizedFormat === "text/uri-list" && candidate.trim().startsWith("#")) continue;
    const filePath = normalizeCandidate(candidate, normalizedFormat);
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    paths.push(filePath);
  }
  return paths;
}

export const CLIPBOARD_FILE_PATH_FORMATS = ["public.file-url", "text/uri-list", "text/plain", "FileNameW", "FileName"] as const;
