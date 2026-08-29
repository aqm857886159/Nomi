import { Transform, Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw, crc32 } from "node:zlib";

import { fromBuffer, getFileNameLowLevel, type Entry, type ZipFile } from "yauzl";

import type { SkillZipImportPayload } from "../shared/skillImportContracts";
import {
  buildSkillPackage,
  isSafeSkillRelativePath,
  SKILL_PACKAGE_FORBIDDEN_DIRECTORIES,
  SKILL_PACKAGE_MAX_DEPTH,
  SKILL_PACKAGE_MAX_FILES,
  SKILL_PACKAGE_MAX_FILE_BYTES,
  SKILL_PACKAGE_MAX_PATH_CHARS,
  SKILL_PACKAGE_MAX_TOTAL_BYTES,
  suggestSkillImportDirName,
  type SkillPackage,
} from "./skillPackage";

const SKILL_ZIP_MAX_ENTRIES = SKILL_PACKAGE_MAX_FILES * 2;
const SKILL_ZIP_MAX_RAW_PATH_CHARS = SKILL_PACKAGE_MAX_PATH_CHARS + 161;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

type ZipRequestInspection =
  | { kind: "not_zip" }
  | { kind: "invalid"; error: string }
  | { kind: "zip"; fileName: string; bytes: Buffer };

type ScannedEntry = {
  entry: Entry;
  centralPath: string;
  centralSegments: string[];
  effectivePath: string;
  segments: string[];
  isDirectory: boolean;
};

export type ParsedSkillZip =
  | { ok: true; pkg: SkillPackage }
  | { ok: false; error: string };

function copyZipBytes(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) return Buffer.from(raw);
  if (raw instanceof Uint8Array) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return null;
}

export function inspectSkillZipImportPayload(raw: unknown): ZipRequestInspection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "not_zip" };
  const source = raw as Record<string, unknown>;
  if (source.kind !== "zip") return { kind: "not_zip" };
  const unexpected = Object.keys(source).find((key) => !["kind", "fileName", "bytes"].includes(key));
  if (unexpected) return { kind: "invalid", error: `ZIP import contains unsupported field: ${unexpected}` };
  const fileName = typeof source.fileName === "string" ? source.fileName.trim() : "";
  if (!fileName || fileName.length > 255 || fileName.includes("/") || fileName.includes("\\")
    || fileName.includes("\0") || !fileName.toLowerCase().endsWith(".zip")) {
    return { kind: "invalid", error: "ZIP import has an invalid file name" };
  }
  const bytes = copyZipBytes(source.bytes);
  if (!bytes || bytes.byteLength === 0) return { kind: "invalid", error: "ZIP import is empty" };
  if (bytes.byteLength > SKILL_PACKAGE_MAX_TOTAL_BYTES) {
    return { kind: "invalid", error: "Skill ZIP exceeds the compressed size limit" };
  }
  return { kind: "zip", fileName, bytes };
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zipFile) => {
      if (error) reject(error);
      else resolve(zipFile);
    });
  });
}

function validateRawPath(rawPath: string): string[] {
  if (!rawPath || rawPath.length > SKILL_ZIP_MAX_RAW_PATH_CHARS || rawPath.includes("\\")
    || rawPath.includes("\0") || rawPath.startsWith("/") || /^[A-Za-z]:\//.test(rawPath)) {
    throw new Error(`Unsupported Skill ZIP path: ${rawPath}`);
  }
  const withoutDirectorySuffix = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const segments = withoutDirectorySuffix.split("/");
  if (!withoutDirectorySuffix || segments.some((part) => !part || part === "." || part === ".."
    || part.startsWith(".") || SKILL_PACKAGE_FORBIDDEN_DIRECTORIES.has(part.toLowerCase()))) {
    throw new Error(`Unsupported Skill ZIP path: ${rawPath}`);
  }
  return segments;
}

function classifyEntry(entry: Entry, centralPath: string): boolean {
  if (entry.isEncrypted()) throw new Error(`Encrypted Skill ZIP entry is not supported: ${entry.fileName}`);
  const isUnix = (entry.versionMadeBy >>> 8) === 3;
  const unixType = isUnix ? ((entry.externalFileAttributes >>> 16) & 0o170000) : 0;
  const hasDirectorySuffix = entry.fileName.endsWith("/");
  if (centralPath.endsWith("/") !== hasDirectorySuffix) {
    throw new Error(`Skill ZIP raw/effective entry type mismatch: ${centralPath}`);
  }
  const hasDosDirectoryFlag = (entry.externalFileAttributes & 0x10) !== 0;

  if (unixType === 0o120000) throw new Error(`Skill ZIP symbolic link is not allowed: ${entry.fileName}`);
  if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) {
    throw new Error(`Skill ZIP special entry is not allowed: ${entry.fileName}`);
  }
  if (unixType === 0o040000) {
    if (!hasDirectorySuffix) throw new Error(`Malformed Skill ZIP directory: ${entry.fileName}`);
    return true;
  }
  if (unixType === 0o100000) {
    if (hasDirectorySuffix || hasDosDirectoryFlag) {
      throw new Error(`Malformed Skill ZIP file entry: ${entry.fileName}`);
    }
    return false;
  }
  if (hasDosDirectoryFlag && !hasDirectorySuffix) {
    throw new Error(`Malformed Skill ZIP directory: ${entry.fileName}`);
  }
  return hasDirectorySuffix;
}

function scanCentralDirectory(zipFile: ZipFile): Promise<ScannedEntry[]> {
  if (zipFile.entryCount > SKILL_ZIP_MAX_ENTRIES) {
    return Promise.reject(new Error(`Skill ZIP entry count exceeds ${SKILL_ZIP_MAX_ENTRIES}`));
  }
  return new Promise((resolve, reject) => {
    const entries: ScannedEntry[] = [];
    const centralPaths = new Set<string>();
    const effectivePaths = new Set<string>();
    let settled = false;
    const cleanup = (): void => {
      zipFile.removeListener("entry", onEntry);
      zipFile.removeListener("end", onEnd);
      zipFile.removeListener("error", onError);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(entries);
    };
    const onError = (error: Error): void => finish(error);
    const onEnd = (): void => finish();
    const onEntry = (entry: Entry): void => {
      try {
        if (entries.length >= SKILL_ZIP_MAX_ENTRIES) {
          throw new Error(`Skill ZIP entry count exceeds ${SKILL_ZIP_MAX_ENTRIES}`);
        }
        const centralPath = getFileNameLowLevel(
          entry.generalPurposeBitFlag,
          entry.fileNameRaw,
          [],
          true,
        );
        const centralSegments = validateRawPath(centralPath);
        const segments = validateRawPath(entry.fileName);
        const isDirectory = classifyEntry(entry, centralPath);
        const canonicalCentralPath = canonicalPath(centralSegments);
        const canonicalEffectivePath = canonicalPath(segments);
        if (centralPaths.has(canonicalCentralPath) || effectivePaths.has(canonicalEffectivePath)) {
          throw new Error(`Skill ZIP contains duplicate or colliding path: ${entry.fileName}`);
        }
        centralPaths.add(canonicalCentralPath);
        effectivePaths.add(canonicalEffectivePath);
        entries.push({
          entry,
          centralPath,
          centralSegments,
          effectivePath: entry.fileName,
          segments,
          isDirectory,
        });
        zipFile.readEntry();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    zipFile.on("entry", onEntry);
    zipFile.on("end", onEnd);
    zipFile.on("error", onError);
    zipFile.readEntry();
  });
}

function canonicalPath(segments: string[]): string {
  return segments.map((part) => part.normalize("NFC").toLowerCase()).join("/");
}

function rejectFileDirectoryCollisions(
  entries: ScannedEntry[],
  pathKind: "central" | "effective",
): void {
  const byPath = new Map(entries.map((item) => [
    canonicalPath(pathKind === "central" ? item.centralSegments : item.segments),
    item,
  ]));
  for (const item of entries) {
    const segments = pathKind === "central" ? item.centralSegments : item.segments;
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = canonicalPath(segments.slice(0, depth));
      const ancestorEntry = byPath.get(ancestor);
      if (ancestorEntry && !ancestorEntry.isDirectory) {
        const ancestorPath = pathKind === "central"
          ? ancestorEntry.centralPath
          : ancestorEntry.effectivePath;
        throw new Error(`Skill ZIP file conflicts with nested path: ${ancestorPath}`);
      }
    }
  }
}

function resolveWrapper(entries: ScannedEntry[]): string {
  const skillEntries = entries.filter((item) => !item.isDirectory && item.segments.at(-1) === "SKILL.md");
  if (skillEntries.length !== 1) throw new Error("Skill ZIP must contain exactly one SKILL.md");
  const skillEntry = skillEntries[0];
  if (skillEntry.segments.length === 1) return "";
  if (skillEntry.segments.length === 2) return `${skillEntry.segments[0]}/`;
  throw new Error("Skill ZIP may contain only one wrapping directory");
}

function isSafeDirectoryPath(relativePath: string): boolean {
  if (!relativePath || relativePath.length > SKILL_PACKAGE_MAX_PATH_CHARS) return false;
  const segments = relativePath.split("/");
  return segments.length <= SKILL_PACKAGE_MAX_DEPTH
    && segments.every((part) => part && part !== "." && part !== ".." && !part.startsWith(".")
      && !SKILL_PACKAGE_FORBIDDEN_DIRECTORIES.has(part.toLowerCase()));
}

function bindRelativePaths(entries: ScannedEntry[], wrapper: string): Array<ScannedEntry & { relativePath: string }> {
  return entries.map((item) => {
    if (wrapper && item.effectivePath === wrapper) return { ...item, relativePath: "" };
    if (wrapper && !item.effectivePath.startsWith(wrapper)) {
      throw new Error(`Skill ZIP contains content outside its wrapping directory: ${item.effectivePath}`);
    }
    const relativePath = wrapper ? item.effectivePath.slice(wrapper.length) : item.effectivePath;
    const pathWithoutSuffix = item.isDirectory && relativePath.endsWith("/")
      ? relativePath.slice(0, -1)
      : relativePath;
    if (item.isDirectory ? (pathWithoutSuffix && !isSafeDirectoryPath(pathWithoutSuffix))
      : !isSafeSkillRelativePath(pathWithoutSuffix)) {
      throw new Error(`Unsupported Skill package path: ${pathWithoutSuffix || item.effectivePath}`);
    }
    return { ...item, relativePath: pathWithoutSuffix };
  });
}

function openRawEntryStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, { decodeFileData: false }, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

async function readEntryText(
  zipFile: ZipFile,
  item: ScannedEntry & { relativePath: string },
  total: { bytes: number },
): Promise<string> {
  if (item.entry.uncompressedSize > SKILL_PACKAGE_MAX_FILE_BYTES) {
    throw new Error(`Skill ZIP file exceeds the size limit: ${item.relativePath}`);
  }
  if (item.entry.compressionMethod !== 0 && item.entry.compressionMethod !== 8) {
    throw new Error(`Unsupported Skill ZIP compression method: ${item.entry.compressionMethod}`);
  }
  if (item.entry.compressionMethod === 0
    && item.entry.compressedSize !== item.entry.uncompressedSize) {
    throw new Error(`Skill ZIP stored size mismatch: ${item.relativePath}`);
  }
  const stream = await openRawEntryStream(zipFile, item.entry);
  const chunks: Buffer[] = [];
  let rawBytes = 0;
  let actualBytes = 0;
  let checksum = 0;
  const rawCounter = new Transform({
    transform(value, _encoding, callback) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      rawBytes += chunk.byteLength;
      callback(null, chunk);
    },
  });
  const collector = new Writable({
    write(value, _encoding, callback) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      actualBytes += chunk.byteLength;
      total.bytes += chunk.byteLength;
      if (actualBytes > SKILL_PACKAGE_MAX_FILE_BYTES || total.bytes > SKILL_PACKAGE_MAX_TOTAL_BYTES) {
        callback(new Error(`Skill ZIP expanded content exceeds the size limit: ${item.relativePath}`));
        return;
      }
      checksum = crc32(chunk, checksum);
      chunks.push(chunk);
      callback();
    },
  });
  const inflater = item.entry.compressionMethod === 8 ? createInflateRaw() : null;
  if (inflater) {
    await pipeline(stream, rawCounter, inflater, collector);
  } else {
    await pipeline(stream, rawCounter, collector);
  }
  if (rawBytes !== item.entry.compressedSize) {
    throw new Error(`Skill ZIP compressed size mismatch: ${item.relativePath}`);
  }
  if (inflater && inflater.bytesWritten !== item.entry.compressedSize) {
    throw new Error(`Skill ZIP compressed data mismatch: ${item.relativePath}`);
  }
  if (actualBytes !== item.entry.uncompressedSize) {
    throw new Error(`Skill ZIP size mismatch: ${item.relativePath}`);
  }
  if ((checksum >>> 0) !== (item.entry.crc32 >>> 0)) {
    throw new Error(`Skill ZIP CRC mismatch: ${item.relativePath}`);
  }
  try {
    return utf8Decoder.decode(Buffer.concat(chunks, actualBytes));
  } catch {
    throw new Error(`Skill ZIP file is not valid UTF-8 text: ${item.relativePath}`);
  }
}

export async function parseSkillZipPackage(
  request: Pick<SkillZipImportPayload, "fileName"> & { bytes: Buffer },
  exportedAt: number,
): Promise<ParsedSkillZip> {
  let zipFile: ZipFile | null = null;
  try {
    if (request.bytes.byteLength > SKILL_PACKAGE_MAX_TOTAL_BYTES) {
      throw new Error("Skill ZIP exceeds the compressed size limit");
    }
    zipFile = await openZip(request.bytes);
    const entries = await scanCentralDirectory(zipFile);
    if (!entries.length) throw new Error("Skill ZIP is empty");
    rejectFileDirectoryCollisions(entries, "central");
    rejectFileDirectoryCollisions(entries, "effective");
    const wrapper = resolveWrapper(entries);
    const bound = bindRelativePaths(entries, wrapper);
    const fileEntries = bound.filter((item) => !item.isDirectory);
    if (fileEntries.length > SKILL_PACKAGE_MAX_FILES) {
      throw new Error(`Skill ZIP file count exceeds ${SKILL_PACKAGE_MAX_FILES}`);
    }
    const declaredTotal = fileEntries.reduce((sum, item) => sum + item.entry.uncompressedSize, 0);
    if (declaredTotal > SKILL_PACKAGE_MAX_TOTAL_BYTES) {
      throw new Error("Skill ZIP declared content exceeds the size limit");
    }

    const files: Record<string, string> = Object.create(null) as Record<string, string>;
    const actualTotal = { bytes: 0 };
    for (const item of fileEntries) {
      files[item.relativePath] = await readEntryText(zipFile, item, actualTotal);
    }
    const dirName = suggestSkillImportDirName(files["SKILL.md"] ?? "", request.fileName);
    return { ok: true, pkg: buildSkillPackage(dirName, files, exportedAt) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    zipFile?.close();
  }
}
