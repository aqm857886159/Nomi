import fs from "node:fs";
import path from "node:path";
import { readJsonFile } from "../jsonFile";
import { migrateLegacyProjectFolder } from "./legacyProjectMigration";
import {
  initializeWorkspace,
  readWorkspaceManifest,
  readWorkspaceManifestSnapshot,
  recoverWorkspaceManifest,
  withWorkspaceManifestMutationSync,
} from "./workspaceManifest";
import {
  backfillWorkspaceOrigins,
  findRecentWorkspace,
  listRecentWorkspaces,
  rememberWorkspace,
  removeWorkspaceReference,
} from "./workspaceRegistry";
import {
  normalizeWorkspaceProjectRecord,
  workspaceProjectRecordSchema,
  type RecentWorkspaceEntry,
  type WorkspaceOrigin,
  type WorkspaceProjectSource,
  type WorkspaceProjectRecordV2,
} from "./workspaceTypes";
import { workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";

export type WorkspaceRepositoryDeps = {
  settingsRoot: string;
  defaultProjectsRoot: string;
};

export type WorkspaceProjectDiagnosticStatus =
  | "ok"
  | "not-registered"
  | "missing-folder"
  | "missing-manifest"
  | "corrupt-manifest"
  | "id-mismatch";

export type WorkspaceProjectDiagnostic = {
  projectId: string;
  rootPath?: string;
  status: WorkspaceProjectDiagnosticStatus;
  recoverable: boolean;
  backupAvailable: boolean;
};

function readValidProjectRecord(filePath: string, projectId: string): WorkspaceProjectRecordV2 | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = workspaceProjectRecordSchema.safeParse(readJsonFile(filePath));
    if (!parsed.success || parsed.data.id !== projectId) return null;
    return normalizeWorkspaceProjectRecord(parsed.data);
  } catch {
    return null;
  }
}

export function diagnoseWorkspaceProject(projectId: string, deps: WorkspaceRepositoryDeps): WorkspaceProjectDiagnostic {
  const id = String(projectId || "").trim();
  const entry = findRecentEntry(id, deps);
  if (!entry) return { projectId: id, status: "not-registered", recoverable: false, backupAvailable: false };
  const rootPath = entry.rootPath;
  if (entry.missing || !fs.existsSync(rootPath)) {
    return { projectId: id, rootPath, status: "missing-folder", recoverable: false, backupAvailable: false };
  }
  const backupAvailable = Boolean(readValidProjectRecord(workspaceProjectBackupFile(rootPath), id));
  const manifestPath = workspaceProjectFile(rootPath);
  if (!fs.existsSync(manifestPath)) {
    return { projectId: id, rootPath, status: "missing-manifest", recoverable: backupAvailable, backupAvailable };
  }
  try {
    const parsed = workspaceProjectRecordSchema.safeParse(readJsonFile(manifestPath));
    if (!parsed.success) {
      return { projectId: id, rootPath, status: "corrupt-manifest", recoverable: backupAvailable, backupAvailable };
    }
    if (parsed.data.id !== id) {
      return { projectId: id, rootPath, status: "id-mismatch", recoverable: backupAvailable, backupAvailable };
    }
    return { projectId: id, rootPath, status: "ok", recoverable: false, backupAvailable };
  } catch {
    return { projectId: id, rootPath, status: "corrupt-manifest", recoverable: backupAvailable, backupAvailable };
  }
}

export function recoverWorkspaceProject(projectId: string, deps: WorkspaceRepositoryDeps): WorkspaceProjectRecordV2 {
  const diagnostic = diagnoseWorkspaceProject(projectId, deps);
  if (!diagnostic.rootPath || !diagnostic.recoverable) {
    throw new Error(`Workspace project is not recoverable: ${projectId}`);
  }
  const recovered = recoverWorkspaceManifest(diagnostic.rootPath, projectId, Date.now());
  rememberWorkspace(deps.settingsRoot, recovered);
  return recovered;
}

export type { WorkspaceProjectSource } from "./workspaceTypes";

export type WorkspaceProjectSummary = Omit<WorkspaceProjectRecordV2, "payload"> & {
  rootPath: string;
  missing: boolean;
  source: WorkspaceProjectSource;
  // 列表用的封面：从 manifest 的 generationCanvas 节点结果派生（不持久化进 manifest）。
  // 修「最近项目白屏」根因——桌面 list 旧逻辑只读 manifest 现有字段、不从画布节点派生。
  // thumbnail/thumbnailUrls 只装可 <img> 渲染的 URL；coverVideoUrl 是无图封面时的视频兜底
  //（卡片用 <video> 首帧当封面），同样 transient、每次 list 现场派生。
  thumbnail?: string;
  thumbnailUrls?: string[];
  coverVideoUrl?: string;
};

function persistedProjectSource(entry: RecentWorkspaceEntry): WorkspaceProjectSource {
  return entry.source === "native" && entry.nativeRootPath ? "native" : "folder";
}

export type ProjectCover = {
  /** 可直接 <img> 渲染的封面 URL（图片结果 / 视频 poster / 3D 快照，最多 max 个）。 */
  imageUrls: string[];
  /** imageUrls 为空时的兜底：首个视频结果的 url（卡片用 <video> 首帧渲染）。 */
  videoUrl?: string;
};

/**
 * 从 manifest（payload.generationCanvas / 顶层 generationCanvas）的节点结果派生项目封面
 * ——按 `result.type` 分媒体类型：视频/音频的 url 塞进 <img> 必然「加载失败」，所以
 * imageUrls 只收可 <img> 渲染的 URL（image 的 url/thumbnailUrl、video/model3d 的 poster），
 * 无图封面时以首个视频 url 作 videoUrl 兜底；text/audio 跳过；type 缺失按旧行为当图取（脏数据降级）。
 *
 * 单一来源关系（P4 / 封面派生唯一真相源）：本函数是主进程侧（桌面 list 不经渲染层、直接读
 * manifest 派生封面）的副本。**算法真相源在渲染侧** `src/workbench/project/projectCoverDerive.ts`
 * 的 `deriveProjectCoverFromRaw` / `deriveProjectCoverFromNodes`——两份分属 electron(CJS,
 * rootDir=electron/) 与 renderer(ESM, src/)，跨 tsconfig 无法直接 import 共享，故以
 * 「逻辑等价 + 注释锚定 + 等价回归测试」收口：`electron/workspace/thumbnailDerive.equivalence.test.ts`
 * 用同一组 fixture 跑两份并断言输出逐字相等，任一侧改动漂移即红。改本函数务必同步那侧 + 跑等价测试。
 */
export function deriveProjectCover(record: unknown, max = 4): ProjectCover {
  const r = record as { payload?: unknown; generationCanvas?: unknown } | null;
  const payload = r?.payload;
  const gc =
    (payload && typeof payload === "object"
      ? (payload as { generationCanvas?: unknown }).generationCanvas
      : undefined) ?? r?.generationCanvas;
  const nodes = (gc as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return { imageUrls: [] };
  const imageUrls: string[] = [];
  let videoUrl: string | undefined;
  for (const n of nodes) {
    if (imageUrls.length >= max) break;
    if (!n || typeof n !== "object") continue;
    const result = (n as { result?: { type?: unknown; url?: unknown; thumbnailUrl?: unknown } }).result;
    if (!result || typeof result !== "object") continue;
    const type = typeof result.type === "string" ? result.type : "";
    const url = typeof result.url === "string" ? result.url : "";
    const thumbnailUrl = typeof result.thumbnailUrl === "string" ? result.thumbnailUrl : "";
    const imageCandidate =
      type === "image"
        ? url || thumbnailUrl
        : type === "video" || type === "model3d"
          ? thumbnailUrl
          : type === "text" || type === "audio"
            ? ""
            : url || thumbnailUrl;
    // 过短 url（length <= 4）视为脏值过滤——与旧派生语义一致。
    if (imageCandidate.length > 4) {
      imageUrls.push(imageCandidate);
      continue;
    }
    if (!videoUrl && type === "video" && url.length > 4) videoUrl = url;
  }
  return videoUrl ? { imageUrls, videoUrl } : { imageUrls };
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

function hasLegacyProjectFile(rootPath: string): boolean {
  try {
    const filePath = path.join(path.resolve(rootPath), "project.json");
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findRecentEntry(projectId: string, deps: WorkspaceRepositoryDeps) {
  return listRecentWorkspaces(deps.settingsRoot).find((entry) => entry.id === projectId) ?? null;
}

function readManifestOrMigrateLegacy(rootPath: string): WorkspaceProjectRecordV2 | null {
  const manifest = readWorkspaceManifestSnapshot(rootPath) ?? readWorkspaceManifest(rootPath);
  if (manifest) return manifest;
  if (!hasLegacyProjectFile(rootPath)) return null;
  return migrateLegacyProjectFolder(rootPath);
}

export function createWorkspaceProject(
  input: { rootPath: string; record: unknown; origin?: WorkspaceOrigin },
  deps: WorkspaceRepositoryDeps,
): WorkspaceProjectRecordV2 {
  const rootPath = path.resolve(input.rootPath);
  const raw = asRecordInput(input.record);
  const initialized = initializeWorkspace(rootPath, {
    ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
    name: inputName(raw),
    ...(typeof raw.seedKey === "string" && raw.seedKey.trim() ? { seedKey: raw.seedKey.trim() } : {}),
    ...(raw.draft === true ? { draft: true } : {}),
    payload: inputPayload(input.record),
  });
  const record = normalizeWorkspaceProjectRecord(initialized);
  const defaultRoot = path.resolve(deps.defaultProjectsRoot);
  const fallbackOrigin: WorkspaceOrigin =
    rootPath !== defaultRoot && rootPath.startsWith(`${defaultRoot}${path.sep}`)
      ? { source: "native", nativeRootPath: defaultRoot }
      : { source: "folder" };
  rememberWorkspace(deps.settingsRoot, record, input.origin ?? fallbackOrigin);
  return record;
}

export function listWorkspaceProjects(deps: WorkspaceRepositoryDeps): WorkspaceProjectSummary[] {
  backfillWorkspaceOrigins(deps.settingsRoot, deps.defaultProjectsRoot);
  return listRecentWorkspaces(deps.settingsRoot).map((entry) => {
    const source = persistedProjectSource(entry);
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
    const manifest = readWorkspaceManifestSnapshot(entry.rootPath) ?? readWorkspaceManifest(entry.rootPath);
    if (!manifest || manifest.id !== entry.id) {
      if (hasLegacyProjectFile(entry.rootPath)) {
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
          false,
          source,
        );
      }
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
        false,
        source,
      );
    }
    const summary = withoutPayload({ ...manifest, lastKnownRootPath: entry.rootPath }, entry.rootPath, false, source);
    const cover = deriveProjectCover(manifest);
    return {
      ...summary,
      ...(cover.imageUrls.length ? { thumbnailUrls: cover.imageUrls, thumbnail: cover.imageUrls[0] } : {}),
      ...(cover.videoUrl ? { coverVideoUrl: cover.videoUrl } : {}),
    };
  });
}

export function readWorkspaceProject(
  projectId: string,
  deps: WorkspaceRepositoryDeps,
): WorkspaceProjectRecordV2 | null {
  const entry = findRecentEntry(projectId, deps);
  if (!entry || entry.missing) {
    return null;
  }
  const manifest = readManifestOrMigrateLegacy(entry.rootPath);
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
  const written = withWorkspaceManifestMutationSync(entry.rootPath, (context) => {
    const existing = context.current;
    if (!existing || existing.id !== projectId) {
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
    const backupCandidate =
      !existing.immutableProjectUuid &&
      context.currentBackup?.immutableProjectUuid &&
      context.currentBackup.projectGeneration
        ? {
            ...(context.currentRaw ?? existing),
            immutableProjectUuid: context.currentBackup.immutableProjectUuid,
            projectGeneration: context.currentBackup.projectGeneration,
          }
        : (context.currentRaw ?? existing);
    context.replaceBackup(backupCandidate);
    return context.replace(next);
  });
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
  backfillWorkspaceOrigins(deps.settingsRoot, deps.defaultProjectsRoot);
  const entry = findRecentWorkspace(deps.settingsRoot, projectId);
  const dir = resolveWorkspaceProjectDir(projectId, deps); // 解析必须在解绑引用之前
  removeWorkspaceReference(deps.settingsRoot, projectId);
  if (!dir || entry?.source !== "native" || !entry.nativeRootPath) {
    return { id: projectId, deleted: false };
  }
  const resolved = path.resolve(dir);
  const nativeRoot = path.resolve(entry.nativeRootPath);
  const isNative = resolved !== nativeRoot && resolved.startsWith(`${nativeRoot}${path.sep}`);
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
 *
 * `projects` 由调用方传入已列举好的库快照：GC 唯一需要的输入就是「当前这批项目」，
 * 而它的调用方（listProjects）本来就要为自己再列举一次同一批。自己再列一遍 = 把
 * 372 次 manifest 快照读整整做两遍，实测占冷启动列举总耗时的 55-63%（727/996/837ms
 * of 1310/1598/1323ms，346 项目真实库）。判据只读 summary 字段（source/missing/draft/
 * revision）与磁盘 assets/，与列举时刻的快照一致，故复用不改变任何回收判定。
 * 不给默认值——留 `projects = listWorkspaceProjects(deps)` 这种兜底就等于把旧的
 * 双份列举留成可达路径（P1：不留并行版）。
 */
export function gcEmptyDraftWorkspaceProjects(
  deps: WorkspaceRepositoryDeps,
  projects: WorkspaceProjectSummary[],
): { recycled: string[]; scanned: number } {
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
  const manifest = readManifestOrMigrateLegacy(entry.rootPath);
  if (!manifest || manifest.id !== projectId) {
    return null;
  }
  return entry.rootPath;
}
