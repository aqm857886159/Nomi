import fs from "node:fs";
import path from "node:path";
import { MEDIA_TYPES, type MediaKind } from "../assets/mediaTypes";

export type WorkspaceFileKind = "directory" | "text" | "image" | "video" | "audio" | "document" | "file";

export type WorkspaceFileNode = {
  id: string;
  name: string;
  relativePath: string;
  kind: WorkspaceFileKind;
  contentType?: string;
  size?: number;
  updatedAt?: string;
  children?: WorkspaceFileNode[];
};

export type WorkspaceFileListResult = {
  items: WorkspaceFileNode[];
  truncated: boolean;
};

const SKIPPED_NAMES = new Set([".git", "node_modules"]);
const SKIPPED_RELATIVE_PATHS = new Set([".nomi/cache"]);
const BROWSER_PRIVATE_ASSET_KINDS = new Set(["browser-capture", "browser-upload"]);

// 从媒体类型单一真相源派生(不再手维护第二张表)。WorkspaceFileKind 无 model3d,
// 故把 model3d 映射成 "file"(保持 .glb 在文件树仍是通用文件,行为不变)。
function toWorkspaceKind(kind: MediaKind): WorkspaceFileKind {
  return kind === "model3d" ? "file" : kind;
}
const CONTENT_TYPES: Record<string, { kind: WorkspaceFileKind; contentType: string }> = Object.fromEntries(
  MEDIA_TYPES.map((entry) => [entry.ext, { kind: toWorkspaceKind(entry.kind), contentType: entry.contentType }]),
);

function toRelative(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

export function resolveWorkspaceFilePath(rootPath: string, relativePath: string): string {
  const root = path.resolve(String(rootPath || ""));
  const raw = String(relativePath || "").trim().replace(/\\/g, "/");
  const segments = raw.split("/");
  if (
    !root ||
    !raw ||
    raw.includes("\0") ||
    raw.startsWith("/") ||
    raw.startsWith("//") ||
    path.isAbsolute(raw) ||
    /^[a-zA-Z]:\//.test(raw) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("relativePath is invalid");
  }
  const absolutePath = path.resolve(root, raw);
  if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
    throw new Error("relativePath escapes workspace");
  }
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(absolutePath);
  if (!realTarget.startsWith(`${realRoot}${path.sep}`) && realTarget !== realRoot) {
    throw new Error("relativePath escapes workspace");
  }
  return absolutePath;
}

function classify(filePath: string): { kind: WorkspaceFileKind; contentType: string } {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || { kind: "file", contentType: "application/octet-stream" };
}

function readAssetSidecarKind(absolutePath: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${absolutePath}.meta`, "utf8")) as { kind?: unknown } | null;
    return typeof parsed?.kind === "string" ? parsed.kind.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

function shouldSkipWorkspaceFile(absolutePath: string, name: string): boolean {
  if (name.endsWith(".meta")) return true;
  return BROWSER_PRIVATE_ASSET_KINDS.has(readAssetSidecarKind(absolutePath));
}

function sortNodes(a: WorkspaceFileNode, b: WorkspaceFileNode): number {
  if (a.kind === "directory" && b.kind !== "directory") return -1;
  if (a.kind !== "directory" && b.kind === "directory") return 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export function listWorkspaceFiles(input: { rootPath: string; maxFiles?: number; includeHidden?: boolean }): WorkspaceFileListResult {
  const rootPath = path.resolve(String(input.rootPath || ""));
  const maxFiles = Math.max(1, Math.min(2000, Math.floor(input.maxFiles || 500)));
  let seen = 0;
  let truncated = false;

  function scanDir(dir: string): WorkspaceFileNode[] {
    if (truncated) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory — e.g. macOS TCC-protected library bundles such as
      // ~/Music/Music or ~/Pictures/Photos Library.photoslibrary throw EPERM even
      // with Full Disk Access. Skip its contents instead of failing the whole listing.
      return [];
    }
    const nodes: WorkspaceFileNode[] = [];
    for (const entry of entries) {
      if (truncated) break;
      if (!input.includeHidden && entry.name.startsWith(".")) continue;
      if (SKIPPED_NAMES.has(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);
      const relativePath = toRelative(rootPath, absolutePath);
      if (SKIPPED_RELATIVE_PATHS.has(relativePath)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && shouldSkipWorkspaceFile(absolutePath, entry.name)) continue;
      seen += 1;
      if (seen > maxFiles) {
        truncated = true;
        break;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absolutePath);
      } catch {
        // Unreadable entry (permission denied / vanished mid-scan) — skip it.
        continue;
      }
      if (entry.isDirectory()) {
        nodes.push({
          id: relativePath,
          name: entry.name,
          relativePath,
          kind: "directory",
          updatedAt: new Date(stat.mtimeMs).toISOString(),
          children: scanDir(absolutePath),
        });
      } else if (entry.isFile()) {
        const type = classify(entry.name);
        nodes.push({
          id: relativePath,
          name: entry.name,
          relativePath,
          kind: type.kind,
          contentType: type.contentType,
          size: stat.size,
          updatedAt: new Date(stat.mtimeMs).toISOString(),
        });
      }
    }
    return nodes.sort(sortNodes);
  }

  if (!fs.existsSync(rootPath)) return { items: [], truncated: false };
  return { items: scanDir(rootPath), truncated };
}
