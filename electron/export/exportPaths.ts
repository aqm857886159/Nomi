import fs from "node:fs";
import path from "node:path";

export function ensureExportDirs(projectDir: string): { exportsDir: string; cacheDir: string } {
  const resolvedProjectDir = path.resolve(projectDir);
  const exportsDir = path.join(resolvedProjectDir, "exports");
  const cacheDir = path.join(resolvedProjectDir, ".nomi", "jobs");
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return { exportsDir, cacheDir };
}

function sanitizeOutputBaseName(value: string | undefined): string {
  const cleaned = String(value || "nomi-export")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "nomi-export";
}

function sanitizePathSegment(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "job";
}

export function createExportTempDir(projectDir: string, jobId: string): string {
  const { cacheDir } = ensureExportDirs(projectDir);
  const tempDir = path.join(cacheDir, sanitizePathSegment(jobId));
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export function createSafeOutputPaths(options: {
  projectDir: string;
  outputName?: string;
  extension: "mp4" | "webm";
}): { finalPath: string; partialPath: string; relativeFinalPath: string } {
  const { exportsDir } = ensureExportDirs(options.projectDir);
  const resolvedProjectDir = path.resolve(options.projectDir);
  const stamp = localTimestamp();
  const base = `${sanitizeOutputBaseName(options.outputName)}-${stamp}`;
  let finalPath = path.join(exportsDir, `${base}.${options.extension}`);
  let suffix = 2;
  while (fs.existsSync(finalPath) || fs.existsSync(partialPathFor(finalPath, options.extension))) {
    finalPath = path.join(exportsDir, `${base}-${suffix}.${options.extension}`);
    suffix += 1;
  }
  return {
    finalPath,
    partialPath: partialPathFor(finalPath, options.extension),
    relativeFinalPath: path.relative(resolvedProjectDir, finalPath).split(path.sep).join("/"),
  };
}

// 导出文件名时间戳用本地时间（YYYYMMDDHHmm），与渲染端 createTimelineExportFilename 口径一致。
// 旧实现用 toISOString()（UTC），UTC+8 用户导出会得到早 8 小时、常跨到前一天的文件名。
function localTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function partialPathFor(finalPath: string, extension: "mp4" | "webm"): string {
  return finalPath.replace(new RegExp(`\\.${extension}$`), `.partial.${extension}`);
}

export function assertProjectExportRelativePath(relativePath: string): string {
  const normalized = String(relativePath || "").trim().replace(/\\/g, "/");
  if (
    !normalized.startsWith("exports/") ||
    normalized.includes("..") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    path.isAbsolute(normalized)
  ) {
    throw new Error("Path must be relative to the current project's exports folder");
  }
  return normalized;
}
