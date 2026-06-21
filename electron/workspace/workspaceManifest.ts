import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extensionFromMime, localAssetUrl } from "../assets/assetPaths";
import { parseDataUrl } from "../assets/assetBytes";
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
import {
  workspaceAssetsGeneratedDir,
  workspaceAssetsImportedDir,
  workspaceExportsDir,
  workspaceNomiDir,
  workspaceProjectFile,
} from "./workspacePaths";
import { normalizeWorkspaceProjectRecord, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

function workspaceId(): string {
  return `workspace-${crypto.randomUUID()}`;
}

type TopLevelFieldsOptions = {
  keys: string[];
  stopBeforeKeys?: string[];
};

function isDataMediaUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:(image|video|audio)\//i.test(value);
}

function toProjectRecordObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueEmbeddedAssetPath(rootPath: string, fileName: string): { absolutePath: string; relativePath: string } {
  const assetDir = workspaceAssetsGeneratedDir(rootPath);
  fs.mkdirSync(assetDir, { recursive: true });
  const parsed = path.parse(fileName);
  const base = parsed.name || "embedded";
  const ext = parsed.ext || ".bin";
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; fs.existsSync(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(path.resolve(rootPath), absolutePath).replace(/\\/g, "/"),
  };
}

function localizeEmbeddedDataUrl(rootPath: string, projectId: string, dataUrl: string, index: number): string {
  const parsed = parseDataUrl(dataUrl);
  const ext = extensionFromMime(parsed.contentType, "bin");
  const { absolutePath, relativePath } = uniqueEmbeddedAssetPath(
    rootPath,
    `embedded-${Date.now()}-${index}.${ext}`,
  );
  fs.writeFileSync(absolutePath, parsed.bytes);
  return localAssetUrl(projectId, relativePath);
}

function localizeEmbeddedMediaUrls<T>(rootPath: string, input: T): { value: T; changed: boolean } {
  const rootRecord = toProjectRecordObject(input);
  const projectId = typeof rootRecord?.id === "string" && rootRecord.id.trim() ? rootRecord.id.trim() : "";
  if (!projectId) return { value: input, changed: false };

  let changed = false;
  let localizedCount = 0;
  const localizedByDataUrl = new Map<string, string>();

  const visit = (value: unknown): unknown => {
    if (isDataMediaUrl(value)) {
      const cached = localizedByDataUrl.get(value);
      if (cached) {
        changed = true;
        return cached;
      }
      localizedCount += 1;
      const localized = localizeEmbeddedDataUrl(rootPath, projectId, value, localizedCount);
      localizedByDataUrl.set(value, localized);
      changed = true;
      return localized;
    }
    if (Array.isArray(value)) {
      let next: unknown[] | null = null;
      for (let index = 0; index < value.length; index += 1) {
        const current = value[index];
        const localized = visit(current);
        if (localized !== current) {
          if (!next) next = [...value];
          next[index] = localized;
        }
      }
      return next ?? value;
    }
    const record = toProjectRecordObject(value);
    if (!record) return value;

    let next: Record<string, unknown> | null = null;
    for (const [key, current] of Object.entries(record)) {
      const localized = visit(current);
      if (localized !== current) {
        if (!next) next = { ...record };
        next[key] = localized;
      }
    }
    return next ?? value;
  };

  const value = visit(input) as T;
  return { value, changed };
}

export function hasWorkspaceManifest(rootPath: string): boolean {
  return fs.existsSync(workspaceProjectFile(rootPath));
}

export function readProjectJsonFileWithEmbeddedMediaSlimming(
  rootPath: string,
  filePath: string,
): unknown {
  const raw = readJsonFile(filePath);
  const localized = localizeEmbeddedMediaUrls(rootPath, raw);
  if (localized.changed) {
    writeJsonFileAtomic(filePath, localized.value);
  }
  return localized.value;
}

export function readProjectJsonTopLevelFields(
  filePath: string,
  options: TopLevelFieldsOptions,
): Record<string, unknown> | null {
  const raw = readJsonFile(filePath);
  const record = toProjectRecordObject(raw);
  if (!record) return null;

  const out: Record<string, unknown> = {};
  for (const key of options.keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      out[key] = record[key];
    }
  }
  if (options.stopBeforeKeys?.length) {
    for (const stopKey of options.stopBeforeKeys) {
      if (Object.prototype.hasOwnProperty.call(record, stopKey)) {
        break;
      }
    }
  }
  return out;
}

export function readWorkspaceManifest(rootPath: string): WorkspaceProjectRecordV2 | null {
  const filePath = workspaceProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return normalizeWorkspaceProjectRecord(
    readProjectJsonFileWithEmbeddedMediaSlimming(rootPath, filePath),
  );
}

export function readWorkspaceManifestSummary(
  rootPath: string,
): Omit<WorkspaceProjectRecordV2, "payload"> | null {
  const manifest = readWorkspaceManifest(rootPath);
  if (!manifest) return null;
  const { payload: _payload, ...summary } = manifest;
  return summary;
}

export function writeWorkspaceManifest(rootPath: string, record: WorkspaceProjectRecordV2): WorkspaceProjectRecordV2 {
  const normalized = normalizeWorkspaceProjectRecord(record);
  const localized = localizeEmbeddedMediaUrls(rootPath, normalized);
  const next = normalizeWorkspaceProjectRecord(localized.value);
  writeJsonFileAtomic(workspaceProjectFile(rootPath), next);
  return next;
}

export function ensureWorkspaceFolders(rootPath: string): void {
  fs.mkdirSync(workspaceNomiDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsGeneratedDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsImportedDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceExportsDir(rootPath), { recursive: true });
}

export function initializeWorkspace(
  rootPath: string,
  input: { name?: string; payload?: unknown } = {},
): WorkspaceProjectRecordV2 {
  ensureWorkspaceFolders(rootPath);
  const existing = readWorkspaceManifest(rootPath);
  if (existing) {
    return existing;
  }

  const resolvedRoot = path.resolve(rootPath);
  const now = Date.now();
  const record: WorkspaceProjectRecordV2 = normalizeWorkspaceProjectRecord({
    id: workspaceId(),
    name: input.name?.trim() || path.basename(resolvedRoot) || "Untitled Workspace",
    version: 2,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    revision: 0,
    lastKnownRootPath: resolvedRoot,
    payload: input.payload,
  });
  return writeWorkspaceManifest(rootPath, record);
}
