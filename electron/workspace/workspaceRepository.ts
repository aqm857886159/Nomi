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

/**
 * 从 manifest（payload.generationCanvas / 顶层 generationCanvas）的前若干个"有生成结果"的节点取封面 url。
 *
 * 单一来源关系（P4 / 缩略图唯一真相源）：本函数是主进程侧（桌面 list 不经渲染层、直接读
 * manifest 派生封面）的封面派生。**算法真相源在渲染侧** `src/workbench/project/projectNormalize.ts`
 * 的 `extractThumbnailUrlsFromRaw` / `extractCanvasThumbnailUrls`——两份分属 electron(CJS,
 * rootDir=electron/) 与 renderer(ESM, src/)，跨 tsconfig 无法直接 import 共享，故以
 * 「逻辑等价 + 注释锚定 + 等价回归测试」收口：`electron/workspace/thumbnailDerive.equivalence.test.ts`
 * 用同一组 fixture 跑两份并断言输出逐字相等，任一侧改动漂移即红。改本函数务必同步那侧 + 跑等价测试。
 */
export function deriveThumbnailUrls(record: unknown, max = 4): string[] {
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
  draft?: unknown;
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
    ...(raw.draft === true ? { draft: true } : {}),
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
    // 首次真实保存 = 从草稿态 promote 为持久态：清掉 draft 标记，此后 GC 永不回收它。
    draft: undefined,
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

/**
 * 删除一个 workspace 项目（真删盘，2026-06-14 用户拍板）。
 * - native（默认根内的 Nomi 原生项目）→ fs.rmSync 整个目录，deleted:true。
 * - folder（用户用「打开文件夹」绑定的外部目录）→ **绝不碰用户的文件**，只解绑库引用，deleted:false。
 * 双重边界防误删用户目录：必须解析出真实目录、source 判 native、且严格位于默认根之下（非根本身）。
 */
export function deleteWorkspaceProject(
  projectId: string,
  deps: WorkspaceRepositoryDeps,
): { id: string; deleted: boolean } {
  const dir = resolveWorkspaceProjectDir(projectId, deps); // 解析必须在解绑引用之前
  removeWorkspaceReference(deps.settingsRoot, projectId);
  if (!dir) return { id: projectId, deleted: false };
  const root = path.resolve(deps.defaultProjectsRoot);
  const resolved = path.resolve(dir);
  const isNative =
    deriveProjectSource(resolved, deps.defaultProjectsRoot) === "native" &&
    resolved !== root &&
    resolved.startsWith(`${root}${path.sep}`);
  if (!isNative) return { id: projectId, deleted: false }; // 外部文件夹：只解绑，不删用户内容
  fs.rmSync(resolved, { recursive: true, force: true });
  return { id: projectId, deleted: true };
}

// 递归判断目录下是否有任何真实文件（忽略空日期目录与 .DS_Store）。GC 的防御纵深：
// 即便 draft/revision 判据通过，只要项目目录里有任何用户素材就绝不回收。
function dirHasRealFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dirHasRealFiles(full)) return true;
    } else if (entry.isFile()) {
      return true;
    }
  }
  return false;
}

/**
 * 启动 GC：回收「从未编辑的空白草稿」，防项目库再次堆满「未命名」垃圾（审计 P0-3）。
 * 仅当全部判据满足才删（AND，宁可漏删不可误删）：
 *   native（默认根内）+ 目录在（!missing）+ draft===true + revision===0 + assets/ 无任何真实文件。
 * folder/external 一律豁免（复用 deleteWorkspaceProject 的双重边界，绝不碰用户文件）。
 * 不变量 `revision===0 ⟺ 落盘 payload 即出生默认值` 保证「revision 0 的草稿 = 可证明的零编辑」。
 * 调用方负责「一进程一次」（见 repository.listProjects 的 once-guard），故本会话新建的草稿不会被误删。
 */
export function gcEmptyDraftWorkspaceProjects(
  deps: WorkspaceRepositoryDeps,
): { recycled: string[]; scanned: number } {
  const projects = listWorkspaceProjects(deps);
  const recycled: string[] = [];
  for (const project of projects) {
    if (project.source !== "native") continue;
    if (project.missing) continue;
    if (project.draft !== true) continue;
    if ((project.revision ?? 0) !== 0) continue;
    const dir = resolveWorkspaceProjectDir(project.id, deps);
    if (!dir) continue;
    if (dirHasRealFiles(path.join(dir, "assets"))) continue;
    const result = deleteWorkspaceProject(project.id, deps);
    if (result.deleted) recycled.push(project.id);
  }
  if (recycled.length) {
    console.info(`[gc] recycled ${recycled.length} empty draft project(s): ${recycled.join(", ")}`);
  }
  return { recycled, scanned: projects.length };
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
