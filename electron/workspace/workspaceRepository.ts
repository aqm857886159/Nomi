import fs from "node:fs";
import path from "node:path";
import { initializeWorkspace, readWorkspaceManifest, writeWorkspaceManifest } from "./workspaceManifest";
import { listRecentWorkspaces, rememberWorkspace, removeWorkspaceReference } from "./workspaceRegistry";
import { normalizeWorkspaceProjectRecord, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

export type WorkspaceRepositoryDeps = {
  settingsRoot: string;
  defaultProjectsRoot: string;
};

// 项目来源：'native' = 在默认根（~/Documents/Nomi Projects）里新建的原生项目；
// 'folder' = 用「打开文件夹」绑定到外部目录的项目。靠目录位置派生，存量项目也能判，无需 schema 迁移。
export type WorkspaceProjectSource = "native" | "folder";

export type WorkspaceProjectSummary = Omit<WorkspaceProjectRecordV2, "payload"> & {
  rootPath: string;
  missing: boolean;
  source: WorkspaceProjectSource;
  // 列表用的封面缩略图：从 manifest 的 generationCanvas 节点结果派生（不持久化进 manifest）。
  // 修「最近项目白屏」根因——桌面 list 旧逻辑只读 manifest 现有字段、不从画布节点派生。
  thumbnail?: string;
  thumbnailUrls?: string[];
};

// rootPath 在默认根内 → native；否则 → folder（外部目录）。比较前 resolve + 规范化分隔符。
function deriveProjectSource(rootPath: string, defaultProjectsRoot: string): WorkspaceProjectSource {
  const resolvedRoot = path.resolve(defaultProjectsRoot);
  const resolvedPath = path.resolve(rootPath);
  if (resolvedPath === resolvedRoot) return "native";
  return resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) ? "native" : "folder";
}

/** 从 manifest（payload.generationCanvas / 顶层 generationCanvas）的前若干个"有生成结果"的节点取封面 url。 */
function deriveThumbnailUrls(record: unknown, max = 4): string[] {
  const r = record as { payload?: unknown; generationCanvas?: unknown } | null;
  const payload = r?.payload as { generationCanvas?: unknown } | undefined;
  const gc = (payload && typeof payload === "object" ? payload.generationCanvas : undefined) ?? r?.generationCanvas;
  const nodes = (gc as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const urls: string[] = [];
  for (const n of nodes) {
    if (urls.length >= max) break;
    const result = (n as { result?: { url?: unknown; thumbnailUrl?: unknown } } | null)?.result;
    const url = (typeof result?.url === "string" && result.url) || (typeof result?.thumbnailUrl === "string" && result.thumbnailUrl) || "";
    if (typeof url === "string" && url.length > 4) urls.push(url);
  }
  return urls;
}

type RecordInput = {
  id?: unknown;
  name?: unknown;
  seedKey?: unknown;
  payload?: unknown;
};

function asRecordInput(input: unknown): RecordInput {
  return input && typeof input === "object" ? (input as RecordInput) : { payload: input };
}

function inputName(input: unknown, fallback?: string): string | undefined {
  const value = asRecordInput(input).name;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function inputPayload(input: unknown): unknown {
  const objectInput = asRecordInput(input);
  return Object.prototype.hasOwnProperty.call(objectInput, "payload") ? objectInput.payload : input;
}

function withoutPayload(
  record: WorkspaceProjectRecordV2,
  rootPath: string,
  missing: boolean,
  source: WorkspaceProjectSource,
): WorkspaceProjectSummary {
  const { payload: _payload, ...summary } = record;
  return {
    ...summary,
    rootPath,
    missing,
    source,
  };
}

function findRecentEntry(projectId: string, deps: WorkspaceRepositoryDeps) {
  return listRecentWorkspaces(deps.settingsRoot).find((entry) => entry.id === projectId) ?? null;
}

export function createWorkspaceProject(
  input: { rootPath: string; record: unknown },
  deps: WorkspaceRepositoryDeps,
): WorkspaceProjectRecordV2 {
  void deps.defaultProjectsRoot;
  const rootPath = path.resolve(input.rootPath);
  const raw = asRecordInput(input.record);
  const initialized = initializeWorkspace(rootPath, {
    name: inputName(raw),
    payload: inputPayload(input.record),
  });
  const record = normalizeWorkspaceProjectRecord({
    ...initialized,
    ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
    ...(typeof raw.seedKey === "string" && raw.seedKey.trim() ? { seedKey: raw.seedKey.trim() } : {}),
    lastKnownRootPath: rootPath,
  });
  writeWorkspaceManifest(rootPath, record);
  rememberWorkspace(deps.settingsRoot, record);
  return record;
}

export function listWorkspaceProjects(deps: WorkspaceRepositoryDeps): WorkspaceProjectSummary[] {
  return listRecentWorkspaces(deps.settingsRoot).map((entry) => {
    const source = deriveProjectSource(entry.rootPath, deps.defaultProjectsRoot);
    if (entry.missing) {
      return withoutPayload(
        normalizeWorkspaceProjectRecord({
          id: entry.id,
          name: entry.name,
          version: 2,
          createdAt: entry.lastOpenedAt,
          updatedAt: entry.lastOpenedAt,
          savedAt: entry.lastOpenedAt,
          revision: 0,
          lastKnownRootPath: entry.rootPath,
        }),
        entry.rootPath,
        true,
        source,
      );
    }
    const manifest = readWorkspaceManifest(entry.rootPath);
    if (!manifest || manifest.id !== entry.id) {
      return withoutPayload(
        normalizeWorkspaceProjectRecord({
          id: entry.id,
          name: entry.name,
          version: 2,
          createdAt: entry.lastOpenedAt,
          updatedAt: entry.lastOpenedAt,
          savedAt: entry.lastOpenedAt,
          revision: 0,
          lastKnownRootPath: entry.rootPath,
        }),
        entry.rootPath,
        true,
        source,
      );
    }
    const summary = withoutPayload({ ...manifest, lastKnownRootPath: entry.rootPath }, entry.rootPath, false, source);
    const thumbnailUrls = deriveThumbnailUrls(manifest);
    return thumbnailUrls.length ? { ...summary, thumbnailUrls, thumbnail: thumbnailUrls[0] } : summary;
  });
}

export function readWorkspaceProject(projectId: string, deps: WorkspaceRepositoryDeps): WorkspaceProjectRecordV2 | null {
  const entry = findRecentEntry(projectId, deps);
  if (!entry || entry.missing) {
    return null;
  }
  const manifest = readWorkspaceManifest(entry.rootPath);
  if (!manifest || manifest.id !== projectId) {
    return null;
  }
  return normalizeWorkspaceProjectRecord({ ...manifest, lastKnownRootPath: entry.rootPath });
}

export function saveWorkspaceProject(
  projectId: string,
  record: unknown,
  deps: WorkspaceRepositoryDeps,
): WorkspaceProjectRecordV2 {
  const entry = findRecentEntry(projectId, deps);
  if (!entry || entry.missing) {
    throw new Error(`Workspace project not found: ${projectId}`);
  }
  const existing = readWorkspaceProject(projectId, deps);
  if (!existing) {
    throw new Error(`Workspace project not found: ${projectId}`);
  }
  const now = Date.now();
  const next = normalizeWorkspaceProjectRecord({
    ...existing,
    name: inputName(record, existing.name),
    updatedAt: now,
    savedAt: now,
    revision: existing.revision + 1,
    payload: inputPayload(record),
    lastKnownRootPath: entry.rootPath,
  });
  const written = writeWorkspaceManifest(entry.rootPath, next);
  rememberWorkspace(deps.settingsRoot, written);
  return written;
}

export function removeWorkspaceProjectReference(
  projectId: string,
  deps: WorkspaceRepositoryDeps,
): { id: string; deleted: boolean } {
  removeWorkspaceReference(deps.settingsRoot, projectId);
  return { id: projectId, deleted: false };
}

export function resolveWorkspaceProjectDir(projectId: string, deps: WorkspaceRepositoryDeps): string | null {
  const entry = findRecentEntry(projectId, deps);
  if (!entry || entry.missing || !fs.existsSync(entry.rootPath)) {
    return null;
  }
  const manifest = readWorkspaceManifest(entry.rootPath);
  if (!manifest || manifest.id !== projectId) {
    return null;
  }
  return entry.rootPath;
}
