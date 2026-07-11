import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hardenedFetch } from "../hardenedFetch";
import { isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { projectDirById, sanitizeName } from "../projects/repository";
import { ensureDir } from "../runtimePaths";
import { collectFilesRecursively, parseDataUrl } from "./assetBytes";
import {
  assetBucketFromMeta,
  assetKindFromContentType,
  contentTypeFromPath,
  extensionFromMime,
  extensionFromUrl,
  localAssetUrl,
  stableAssetId,
} from "./assetPaths";

type LocalAssetRecord = {
  id: string;
  name: string;
  userId: "local";
  projectId: string;
  createdAt: string;
  updatedAt: string;
  data: {
    url: string;
    relativePath: string;
    absolutePath: string;
    contentType: string;
    size: number;
    kind: string;
  } & JsonRecord;
};

function readAssetSidecarMeta(absolutePath: string): JsonRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${absolutePath}.meta`, "utf8"));
    return isJsonRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAssetSidecarMeta(absolutePath: string, meta: JsonRecord): void {
  const sidecar: JsonRecord = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) sidecar[key] = value;
  }
  if (Object.keys(sidecar).length === 0) return;
  try {
    fs.writeFileSync(`${absolutePath}.meta`, JSON.stringify(sidecar));
  } catch {
    /* non-fatal */
  }
}

function uniqueAssetPath(
  projectId: string,
  fileName: string,
  bucket: "generated" | "imported" = "generated",
): { absolutePath: string; relativePath: string } {
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  const today = new Date().toISOString().slice(0, 10);
  const assetDir = path.join(projectDir, "assets", bucket, today);
  ensureDir(assetDir);
  const parsed = path.parse(sanitizeName(fileName, "asset.bin"));
  const base = parsed.name || "asset";
  const ext = parsed.ext || ".bin";
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; fs.existsSync(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(projectDir, absolutePath).replace(/\\/g, "/"),
  };
}

export function writeAsset(
  projectId: string,
  bytes: Buffer,
  fileName: string,
  contentType: string,
  meta: JsonRecord,
): unknown {
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, fileName, assetBucketFromMeta(meta));
  fs.writeFileSync(absolutePath, bytes);
  writeAssetSidecarMeta(absolutePath, meta);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: `asset-${crypto.randomUUID()}`,
    name: sanitizeName(fileName, "asset"),
    userId: "local",
    projectId,
    createdAt: t,
    updatedAt: t,
    data: {
      ...meta,
      url,
      relativePath,
      absolutePath,
      contentType,
      size: bytes.byteLength,
    },
  };
}

export function moveAssetFile(
  projectId: string,
  sourcePath: string,
  fileName: string,
  contentType: string,
  meta: JsonRecord,
): unknown {
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, fileName, assetBucketFromMeta(meta));
  try {
    fs.renameSync(sourcePath, absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.copyFileSync(sourcePath, absolutePath);
    fs.rmSync(sourcePath, { force: true });
  }
  const stat = fs.statSync(absolutePath);
  writeAssetSidecarMeta(absolutePath, meta);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: `asset-${crypto.randomUUID()}`,
    name: sanitizeName(fileName, "asset"),
    userId: "local",
    projectId,
    createdAt: t,
    updatedAt: t,
    data: {
      ...meta,
      url,
      relativePath,
      absolutePath,
      contentType,
      size: stat.size,
    },
  };
}

export async function importRemoteAsset(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  const url = String(raw.url || "").trim();
  if (!projectId) throw new Error("projectId is required");
  if (!url) throw new Error("url is required");
  if (url.startsWith("nomi-local://")) {
    return {
      id: `asset-${crypto.randomUUID()}`,
      name: String(raw.fileName || "local asset"),
      userId: "local",
      projectId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      data: { url, kind: raw.kind || "local" },
    };
  }
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const ext = extensionFromMime(parsed.contentType, "bin");
    return writeAsset(
      projectId,
      parsed.bytes,
      String(raw.fileName || `asset-${Date.now()}.${ext}`),
      parsed.contentType,
      { kind: raw.kind || "generated", originalUrl: null },
    );
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s), data, and nomi-local assets are supported");
  const fetched = await hardenedFetch(url, {
    timeoutMs: 60_000,
    maxBytes: 200 * 1024 * 1024,
    allowContentTypes: ["image/", "video/", "audio/", "application/octet-stream"],
  });
  const contentType = fetched.contentType || "application/octet-stream";
  const bytes = fetched.bytes;
  const ext = extensionFromMime(contentType, extensionFromUrl(url));
  const fileName = String(raw.fileName || path.basename(new URL(url).pathname) || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName.includes(".") ? fileName : `${fileName}.${ext}`, contentType, {
    kind: raw.kind || "generated",
    originalUrl: url,
    ownerNodeId: raw.ownerNodeId || null,
  });
}

export function listProjectAssets(payload: unknown): { items: LocalAssetRecord[]; cursor: string | null } {
  const raw = payload as JsonRecord | undefined;
  const projectId = String(raw?.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) return { items: [], cursor: null };
  const assetsDir = path.join(projectDir, "assets");
  const requestedLimit = typeof raw?.limit === "number" && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : 200;
  const limit = Math.max(1, Math.min(500, requestedLimit));
  const offset = Math.max(0, Number.parseInt(String(raw?.cursor || "0"), 10) || 0);
  const kindFilter = typeof raw?.kind === "string" && raw.kind.trim() ? raw.kind.trim() : "";
  const records = collectFilesRecursively(assetsDir)
    .flatMap((absolutePath): LocalAssetRecord[] => {
      try {
        if (absolutePath.endsWith(".meta")) return [];
        const stat = fs.statSync(absolutePath);
        const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, "/");
        const contentType = contentTypeFromPath(absolutePath);
        const sidecarMeta = readAssetSidecarMeta(absolutePath);
        const mediaKind = assetKindFromContentType(contentType);
        const sidecarKind =
          typeof sidecarMeta.kind === "string" && sidecarMeta.kind.trim() ? sidecarMeta.kind.trim() : "";
        const kind = sidecarKind || mediaKind;
        if (kindFilter && kind !== kindFilter) return [];
        const createdAt = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString();
        const updatedAt = new Date(stat.mtimeMs).toISOString();
        return [
          {
            id: stableAssetId(projectId, relativePath),
            name: path.basename(absolutePath),
            userId: "local",
            projectId,
            createdAt,
            updatedAt,
            data: {
              ...sidecarMeta,
              url: localAssetUrl(projectId, relativePath),
              relativePath,
              absolutePath,
              contentType,
              size: stat.size,
              kind,
              mediaType:
                typeof sidecarMeta.mediaType === "string" && sidecarMeta.mediaType
                  ? sidecarMeta.mediaType
                  : mediaKind === "image" || mediaKind === "video" || mediaKind === "audio"
                    ? mediaKind
                    : undefined,
            },
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const items = records.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    cursor: nextOffset < records.length ? String(nextOffset) : null,
  };
}
