import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hardenedFetch } from "../hardenedFetch";
import { isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { projectDirById, sanitizeName } from "../projects/repository";
import { ensureDir } from "../runtimePaths";
import { broadcastAssetsUpdated } from "./assetEvents";
import { collectFilesRecursively, parseDataUrl } from "./assetBytes";
import {
  assetBucketFromMeta,
  canonicalAssetFileName,
  assetKindFromContentType,
  contentTypeFromPath,
  extensionFromMime,
  extensionFromUrl,
  localAssetUrl,
  sanitizeAssetMetaForKind,
  stableAssetId,
} from "./assetPaths";
import { contentTypeFromMagicBytes, isCertifiableMediaContentType, resolveContentType } from "./mediaTypes";
import { validateGlbStructure } from "./model3dValidation";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { MEDIA_DECODER_PROTOCOL_WHITELIST } from "../export/mediaProbe";
import type { CertificationMediaEvidence } from "../providerAdapter/certificationMedia";

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

function contentTypeFromStoredFile(absolutePath: string): string {
  const extensionType = contentTypeFromPath(absolutePath);
  if (extensionType !== "application/octet-stream") return extensionType;
  try {
    const handle = fs.openSync(absolutePath, "r");
    const header = Buffer.alloc(4096);
    const bytesRead = fs.readSync(handle, header, 0, header.length, 0);
    fs.closeSync(handle);
    return resolveContentType(absolutePath, header.subarray(0, bytesRead));
  } catch {
    return extensionType;
  }
}

/**
 * 落盘素材的**唯一** contentType 判定。字节是事实，声明只是线索。
 *
 * 为什么要越过声明看字节（2026-08-26 火山方舟 Seedream 改图走查）：产物 URL / 厂商 header /
 * b64_json 的 `data:image/png;base64,` 前缀都可能与真实字节不符，而 contentType 一路决定
 * canonicalAssetFileName 给的扩展名 —— 于是 JPEG 字节落成 `.png`，下游按扩展名判类型的消费者
 * （workspace tree / protocol / 导出 / 拖拽）全被带偏。
 *
 * **只在同族内以字节覆盖声明**：`.m4a`(audio/mp4) 与 mp4 视频共用 ISO-BMFF 魔数，跨族覆盖会把
 * 音频误判成视频（比原 bug 更糟）。同族覆盖只纠正 png↔jpeg / mp4↔webm / mp3↔flac 这类
 * 「族对了、子类型错了」的谎，不动 kind。
 */
function effectiveContentType(fileName: string, declared: string, bytes?: Uint8Array): string {
  const normalized = String(declared || "").toLowerCase().split(";")[0].trim();
  if (normalized.startsWith("model/") && normalized !== "model/gltf-binary") {
    throw new Error("Unsupported 3D asset content type");
  }
  // 声明本身没信息量（空 / octet-stream）：交给 resolveContentType（先文件头、再扩展名）。
  if (!normalized || normalized === "application/octet-stream") return resolveContentType(fileName, bytes);
  const sniffed = bytes ? contentTypeFromMagicBytes(bytes) : null;
  if (sniffed && sniffed !== normalized && sniffed.split("/")[0] === normalized.split("/")[0]) return sniffed;
  return normalized;
}

function validateStructuredAsset(contentType: string, bytes: Uint8Array): void {
  if (contentType === "model/gltf-binary") validateGlbStructure(bytes);
}

function generatedMediaKind(contentType: string): "image" | "video" | "audio" | "model3d" | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return contentType === "model/gltf-binary" ? "model3d" : null;
}

/** Generated outputs are executable evidence, not ordinary user imports: fail closed before disk. */
function validatedGeneratedMeta(meta: JsonRecord, declaredRaw: string, bytes: Uint8Array, sourcePath?: string): JsonRecord {
  if (String(meta.kind || "").toLowerCase() !== "generated") return meta;
  const prefix = Buffer.from(bytes.subarray(0, 4096)).toString("utf8").trimStart();
  if (/^(?:<!doctype\s+html|<html\b|<\?xml\b|<svg\b|<(?:error|response|message)\b)/i.test(prefix)) {
    throw new Error("Generated media validation failed (markup_masquerade)");
  }
  const detected = bytes.byteLength >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "glTF"
    ? "model/gltf-binary"
    : contentTypeFromMagicBytes(bytes);
  const normalizedDeclared = String(declaredRaw || "").toLowerCase().split(";", 1)[0].trim();
  const declared = !normalizedDeclared || normalizedDeclared === "application/octet-stream"
    ? detected || normalizedDeclared
    : normalizedDeclared;
  const expectedKind = generatedMediaKind(declared);
  if (!expectedKind) return meta;
  if (!detected) throw new Error("Generated media validation failed (unknown_bytes)");
  const detectedKind = generatedMediaKind(detected);
  const ambiguousAudioContainer = expectedKind === "audio"
    && (declared === "audio/mp4" && detected === "video/mp4"
      || declared === "audio/webm" && detected === "video/webm");
  if (!detectedKind || (detectedKind !== expectedKind && !ambiguousAudioContainer)) {
    throw new Error("Generated media validation failed (kind_mismatch)");
  }
  if (!isCertifiableMediaContentType(detected) && !ambiguousAudioContainer) {
    throw new Error("Generated media validation failed (unsupported_format)");
  }
  const claimed = meta.certificationEvidence && typeof meta.certificationEvidence === "object"
    ? meta.certificationEvidence as Partial<CertificationMediaEvidence>
    : undefined;
  const cleanMeta = { ...meta };
  delete cleanMeta.certificationEvidence;
  if (claimed) {
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (claimed.sha256 !== digest || claimed.byteLength !== bytes.byteLength || claimed.kind !== expectedKind
      || claimed.contentType !== declared) throw new Error("Generated media validation failed (evidence_mismatch)");
    return cleanMeta;
  }
  if (expectedKind === "model3d") {
    validateGlbStructure(bytes);
    return cleanMeta;
  }
  const map = expectedKind === "audio" ? "0:a:0" : "0:v:0";
  const decodeLimit = expectedKind === "video" ? ["-frames:v", "1"] : expectedKind === "audio" ? ["-t", "1"] : ["-frames:v", "1"];
  // MP4/MOV commonly stores its index (moov atom) at the end of the file.
  // Feeding such a container through stdin makes ffmpeg report "partial file"
  // because a pipe cannot seek. Validate the exact bytes from a 0600 temporary
  // file when the caller has not already got a Nomi-owned path.
  let validationPath = sourcePath;
  let validationDir = "";
  if (!validationPath || !fs.existsSync(validationPath)) {
    validationDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generated-validation-"));
    validationPath = path.join(validationDir, "artifact.media");
    fs.writeFileSync(validationPath, Buffer.from(bytes), { mode: 0o600, flag: "wx" });
  }
  try {
    const result = spawnSync(resolveFfmpegPath(), [
      "-hide_banner", "-v", "error", "-xerror", "-err_detect", "explode",
      "-protocol_whitelist", MEDIA_DECODER_PROTOCOL_WHITELIST,
      "-i", validationPath, "-map", map, ...decodeLimit, "-f", "null", "-",
    ], { timeout: 12_000, maxBuffer: 64 * 1024, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error("Generated media validation failed (decode_failed)");
    return cleanMeta;
  } finally {
    if (validationDir) fs.rmSync(validationDir, { recursive: true, force: true });
  }
}

async function writeAssetSidecarMetaAsync(absolutePath: string, meta: JsonRecord): Promise<void> {
  const sidecar: JsonRecord = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) sidecar[key] = value;
  }
  if (Object.keys(sidecar).length === 0) return;
  try {
    await fs.promises.writeFile(`${absolutePath}.meta`, JSON.stringify(sidecar));
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

function stableStoredAssetId(projectId: string, relativePath: string): string {
  return stableAssetId(projectId, relativePath);
}

function stableLocalReferenceId(projectId: string, url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0] === projectId && parts.length > 1) return stableStoredAssetId(projectId, parts.slice(1).join("/"));
  } catch {
    // Fall through to a deterministic reference identity for malformed legacy URLs.
  }
  return stableStoredAssetId(projectId, url);
}

export function writeAsset(
  projectId: string,
  bytes: Buffer,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
): unknown {
  // 唯一 sidecar 写入者之一：capture 族 originalUrl 恒 null 的不变量在此收口（见 assetPaths）。
  const meta = validatedGeneratedMeta(sanitizeAssetMetaForKind(rawMeta), contentType, bytes);
  const actualContentType = effectiveContentType(fileName, contentType, bytes);
  validateStructuredAsset(actualContentType, bytes);
  const storageFileName = canonicalAssetFileName(fileName, actualContentType);
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, storageFileName, assetBucketFromMeta(meta));
  fs.writeFileSync(absolutePath, bytes);
  writeAssetSidecarMeta(absolutePath, meta);
  broadcastAssetsUpdated(projectId);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: stableStoredAssetId(projectId, relativePath),
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
      contentType: actualContentType,
      size: bytes.byteLength,
    },
  };
}

/**
 * Persist a generated output at a path derived from its materialization key.
 * A retry after a crash returns the same asset instead of creating `-2` copies.
 */
export function writeDeterministicAsset(
  projectId: string,
  bytes: Buffer,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
  materializationKey: string,
): unknown {
  const meta = validatedGeneratedMeta(sanitizeAssetMetaForKind(rawMeta), contentType, bytes);
  const actualContentType = effectiveContentType(fileName, contentType, bytes);
  validateStructuredAsset(actualContentType, bytes);
  const storageFileName = canonicalAssetFileName(fileName, actualContentType);
  const parsed = path.parse(sanitizeName(storageFileName, "asset"));
  const keyHash = crypto.createHash("sha256").update(materializationKey).digest("hex").slice(0, 24);
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  const bucket = assetBucketFromMeta(meta);
  const relativePath = path.posix.join("assets", bucket, "materialized", `${parsed.name || "asset"}-${keyHash}${parsed.ext || ".bin"}`);
  const absolutePath = path.join(projectDir, relativePath);
  ensureDir(path.dirname(absolutePath));
  if (fs.existsSync(absolutePath)) {
    const existingHash = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
    const nextHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (existingHash !== nextHash) throw new Error("Deterministic materialization key maps to different bytes");
  } else {
    fs.writeFileSync(absolutePath, bytes);
  }
  // A prior attempt may have written pixels before its sidecar failed. Repair it
  // before reporting success; retain any metadata edited on the existing asset.
  fs.writeFileSync(`${absolutePath}.meta`, JSON.stringify({ ...meta, ...readAssetSidecarMeta(absolutePath) }));
  broadcastAssetsUpdated(projectId);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: stableStoredAssetId(projectId, relativePath),
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
      contentType: actualContentType,
      size: bytes.byteLength,
    },
  };
}

/** Copy an existing native file into the project without materializing it as a main-process Buffer. */
export async function copyAssetFile(
  projectId: string,
  sourcePath: string,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
): Promise<unknown> {
  let meta = sanitizeAssetMetaForKind(rawMeta);
  // 文件头无条件读：声明对不对要靠字节验，只在 octet-stream 时读等于「只在声明已经认输时才查证」。
  const header = await (async () => {
    const handle = await fs.promises.open(sourcePath, "r");
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  })();
  const actualContentType = effectiveContentType(fileName, contentType, header);
  if (String(meta.kind || "").toLowerCase() === "generated") meta = validatedGeneratedMeta(meta, contentType, await fs.promises.readFile(sourcePath), sourcePath);
  if (actualContentType === "model/gltf-binary") validateStructuredAsset(actualContentType, await fs.promises.readFile(sourcePath));
  const storageFileName = canonicalAssetFileName(fileName, actualContentType);
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, storageFileName, assetBucketFromMeta(meta));
  await fs.promises.copyFile(sourcePath, absolutePath);
  const stat = await fs.promises.stat(absolutePath);
  await writeAssetSidecarMetaAsync(absolutePath, meta);
  broadcastAssetsUpdated(projectId);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: stableStoredAssetId(projectId, relativePath),
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
      contentType: actualContentType,
      size: stat.size,
    },
  };
}

/**
 * Copy an already stored project asset by project id + relative path.
 *
 * This is deliberately narrower than copy-files: renderer code never submits
 * an arbitrary native path. The source project directory and realpath are
 * checked in main before the existing media validation/copy boundary runs.
 */
export async function copyProjectAsset(input: {
  sourceProjectId: string
  targetProjectId: string
  relativePath: string
}): Promise<unknown> {
  const sourceProjectId = String(input.sourceProjectId || '').trim()
  const targetProjectId = String(input.targetProjectId || '').trim()
  const relativePath = String(input.relativePath || '').replace(/\\/g, '/').trim()
  if (!sourceProjectId || !targetProjectId || !relativePath) throw new Error('sourceProjectId, targetProjectId and relativePath are required')
  if (path.posix.isAbsolute(relativePath) || relativePath.split('/').some((segment) => segment === '..')) {
    throw new Error('asset relativePath is unsafe')
  }
  const sourceRoot = projectDirById(sourceProjectId)
  if (!sourceRoot) throw new Error('Source project not found')
  const targetRoot = projectDirById(targetProjectId)
  if (!targetRoot) throw new Error('Target project not found')
  const resolvedRoot = path.resolve(sourceRoot)
  const sourcePath = path.resolve(resolvedRoot, relativePath)
  if (sourcePath !== resolvedRoot && !sourcePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('asset path escapes source project')
  }
  const realRoot = await fs.promises.realpath(resolvedRoot)
  const realSourcePath = await fs.promises.realpath(sourcePath)
  if (realSourcePath !== realRoot && !realSourcePath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('asset path escapes source project')
  }
  const stat = await fs.promises.stat(realSourcePath)
  if (!stat.isFile()) throw new Error('source asset is not a file')
  return copyAssetFile(
    targetProjectId,
    realSourcePath,
    path.basename(relativePath),
    contentTypeFromStoredFile(realSourcePath),
    readAssetSidecarMeta(realSourcePath),
  )
}

export function moveAssetFile(
  projectId: string,
  sourcePath: string,
  fileName: string,
  contentType: string,
  rawMeta: JsonRecord,
): unknown {
  // 唯一 sidecar 写入者之二：与 writeAsset 同一道 capture 族隐私收口。
  let meta = sanitizeAssetMetaForKind(rawMeta);
  // 同 copyAssetFile：无条件读文件头，否则撒谎的声明永远没人查证。
  const header = (() => {
    const handle = fs.openSync(sourcePath, "r");
    try {
      const bytes = Buffer.alloc(4096);
      const bytesRead = fs.readSync(handle, bytes, 0, bytes.length, 0);
      return bytes.subarray(0, bytesRead);
    } finally {
      fs.closeSync(handle);
    }
  })();
  const actualContentType = effectiveContentType(fileName, contentType, header);
  if (String(meta.kind || "").toLowerCase() === "generated") meta = validatedGeneratedMeta(meta, contentType, fs.readFileSync(sourcePath), sourcePath);
  if (actualContentType === "model/gltf-binary") validateStructuredAsset(actualContentType, fs.readFileSync(sourcePath));
  const storageFileName = canonicalAssetFileName(fileName, actualContentType);
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, storageFileName, assetBucketFromMeta(meta));
  try {
    fs.renameSync(sourcePath, absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.copyFileSync(sourcePath, absolutePath);
    fs.rmSync(sourcePath, { force: true });
  }
  const stat = fs.statSync(absolutePath);
  writeAssetSidecarMeta(absolutePath, meta);
  broadcastAssetsUpdated(projectId);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: stableStoredAssetId(projectId, relativePath),
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
      contentType: actualContentType,
      size: stat.size,
    },
  };
}

type RemoteAssetImportOptions = {
  /** 仅供 main 进程内部已配置的本地生成服务使用；renderer IPC 无法注入第二参数。 */
  trustedPrivateOrigin?: string;
  certificationEvidence?: CertificationMediaEvidence;
};

/**
 * Sanitize a caller-supplied source-evidence record into the connector provenance
 * shape (docs/plan/2026-09-01-tikhub-connector-v1.md). Only whitelisted fields
 * survive so an untrusted payload cannot smuggle arbitrary metadata into the
 * sidecar. rightsStatus is pinned to 'unknown': connector-ingested media is never
 * inferred to be commercially usable.
 */
export function sanitizeSourceEvidence(raw: unknown): JsonRecord | undefined {
  if (!isJsonRecord(raw) || raw.source !== "connector") return undefined;
  const connectorId = String(raw.connectorId || "").trim();
  if (!connectorId) return undefined;
  return {
    source: "connector",
    connectorId,
    originalUrl: String(raw.originalUrl || "").trim(),
    resolvedUrl: String(raw.resolvedUrl || "").trim(),
    platform: String(raw.platform || "").trim(),
    rightsStatus: "unknown",
    fetchedAt: String(raw.fetchedAt || "").trim() || nowIso(),
  };
}

export async function importRemoteAsset(payload: unknown, options: RemoteAssetImportOptions = {}): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  const url = String(raw.url || "").trim();
  if (!projectId) throw new Error("projectId is required");
  if (!url) throw new Error("url is required");
  const sourceEvidence = sanitizeSourceEvidence(raw.sourceEvidence);
  if (url.startsWith("nomi-local://")) {
    return {
      id: stableLocalReferenceId(projectId, url),
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
      options.certificationEvidence?.contentType || parsed.contentType,
      { kind: raw.kind || "generated", originalUrl: null, ...(sourceEvidence ? { sourceEvidence } : {}), ...(options.certificationEvidence ? { certificationEvidence: options.certificationEvidence } : {}) },
    );
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s), data, and nomi-local assets are supported");
  const fetched = await hardenedFetch(url, {
    timeoutMs: 60_000,
    maxBytes: 200 * 1024 * 1024,
    allowContentTypes: ["image/", "video/", "audio/", "application/octet-stream"],
    ...(options.trustedPrivateOrigin ? { allowedPrivateOrigins: [options.trustedPrivateOrigin] } : {}),
  });
  const bytes = fetched.bytes;
  const hintedContentType = fetched.contentType || "application/octet-stream";
  const rawFileName = String(raw.fileName || path.basename(new URL(url).pathname) || "").trim();
  const contentType = options.certificationEvidence?.contentType || (hintedContentType.toLowerCase().split(";")[0] === "application/octet-stream"
    ? resolveContentType(rawFileName || url, bytes)
    : hintedContentType);
  const ext = extensionFromMime(contentType, extensionFromUrl(url));
  const fileName = rawFileName || `asset-${Date.now()}.${ext}`;
  return writeAsset(projectId, bytes, fileName.includes(".") ? fileName : `${fileName}.${ext}`, contentType, {
    kind: raw.kind || "generated",
    originalUrl: url,
    ownerNodeId: raw.ownerNodeId || null,
    ...(sourceEvidence ? { sourceEvidence } : {}),
    ...(options.certificationEvidence ? { certificationEvidence: options.certificationEvidence } : {}),
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
        const contentType = contentTypeFromStoredFile(absolutePath);
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
