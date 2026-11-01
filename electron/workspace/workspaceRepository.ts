import { assertProjectAgentBinding, sameProjectAgentBinding, type ProjectBinding } from "../shared/projectBinding";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import pLimit from "p-limit";
import { readJsonFile } from "../jsonFile";
import { migrateLegacyProjectFolder } from "./legacyProjectMigration";
import {
  initializeWorkspace,
  isWorkspaceBoundaryError,
  readWorkspaceManifest,
  readWorkspaceManifestSnapshot,
  readWorkspaceManifestSnapshotAsync,
  recoverWorkspaceManifest,
  withWorkspaceManifestStagedMutation,
} from "./workspaceManifest";
import {
  assertWorkspaceFolderBindable,
  backfillWorkspaceOrigins,
  bindWorkspaceLocation,
  findRecentWorkspace,
  listRecentWorkspaces,
  listRecentWorkspacesAsync,
  readWorkspaceFolderProjectId,
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
import { writeWorkspaceSyncBaseline } from "./workspaceSyncBaseline";
import { WorkspaceManifestLockBusyError, releaseWorkspaceManifestLock, tryAcquireWorkspaceManifestLock } from "./workspaceManifestLock";
import { logWarn } from "../logging/logger";

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
  bindWorkspaceLocation(deps.settingsRoot, { id: recovered.id, name: recovered.name, rootPath: diagnostic.rootPath });
  return normalizeWorkspaceProjectRecord({ ...recovered, lastKnownRootPath: diagnostic.rootPath });
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
  /**
   * 这一项的数据读不出来（不是暂时忙）：卡片置灰、不能打开，删除只解绑登记、不删盘。
   * outside-workspace = 项目数据经链接指向了项目文件夹外，按边界规则拒读；unreadable = 其余读不出来的情况。
   */
  unreadableReason?: WorkspaceProjectUnreadableReason;
};

export type WorkspaceProjectUnreadableReason = "outside-workspace" | "unreadable";

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
  // 已经是项目的文件夹（改名 / 挪走后重开、或复制出来的副本）：往里写任何东西之前先核，撞上还在的原件就拒绝，
  // 两个文件夹都不碰（收敛单不变量 ⑤）。
  const existingId = readWorkspaceFolderProjectId(rootPath);
  if (existingId) assertWorkspaceFolderBindable(deps.settingsRoot, { id: existingId, name: "", rootPath });
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
  // 登记的是用户这次打开 / 新建的目录，不是清单里创建时写下的 lastKnownRootPath（改名 / 挪走后它就是旧路径）。
  bindWorkspaceLocation(deps.settingsRoot, { id: record.id, name: record.name, rootPath, origin: input.origin ?? fallbackOrigin });
  const manifestPath = workspaceProjectFile(rootPath);
  if (fs.existsSync(manifestPath)) {
    const contentHash = crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
    writeWorkspaceSyncBaseline(deps.settingsRoot, record.id, { rootPath, revision: record.revision, contentHash });
  }
  return normalizeWorkspaceProjectRecord({ ...record, lastKnownRootPath: rootPath });
}

/** 项目库一次列举里，同时在飞的盘读个数上限（线程池默认 4 个线程，再多只是排队、还会和别的读盘抢）。 */
export const WORKSPACE_LIST_IO_CONCURRENCY = 6;

/**
 * 列出全部已登记项目的摘要（项目库的唯一读面，**异步**：清单快照、文件夹在不在都走线程池，
 * 限并发读，列举期间主进程事件循环照常转——此前是同步一口气扫完，41 个项目约占主进程 340–480ms，
 * 保存 / 生成事件 / 别的 IPC 全在后面排队）。
 * 例外：快照读不出来（含内嵌 data URL 需要加锁瘦身、构建产物地址需要迁移）的那一个项目仍走加锁同步读，
 * 它是项目自己的一次性修复，不是每次列表的常态成本。
 */
export async function listWorkspaceProjects(deps: WorkspaceRepositoryDeps): Promise<WorkspaceProjectSummary[]> {
  backfillWorkspaceOrigins(deps.settingsRoot, deps.defaultProjectsRoot);
  const limit = pLimit(WORKSPACE_LIST_IO_CONCURRENCY);
  const entries = await listRecentWorkspacesAsync(deps.settingsRoot, limit);
  const summaries = await Promise.all(
    entries.map((entry) =>
      limit(async (): Promise<WorkspaceProjectSummary> => {
        const source = persistedProjectSource(entry);
        // 注册表里有、但清单读不出来 / 文件夹不在：用注册表里记的名字和最近打开时间兜一张卡，坏项目不从列表里消失。
        const registryCard = (missing: boolean): WorkspaceProjectSummary =>
          withoutPayload(
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
            missing,
            source,
          );
        if (entry.missing) return registryCard(true);
        // 每一项的读取错误只落在这一张卡上，绝不让一项拖垮整页（V-plibrary N2）：
        // 别的写者正锁着清单 = 暂时的，退回普通登记卡、下次刷新就好；其余读不出来 = 置灰卡，说清原因。
        let manifest: WorkspaceProjectRecordV2 | null;
        try {
          manifest = (await readWorkspaceManifestSnapshotAsync(entry.rootPath)) ?? readWorkspaceManifest(entry.rootPath);
        } catch (error) {
          if (error instanceof WorkspaceManifestLockBusyError) return registryCard(false);
          const unreadableReason: WorkspaceProjectUnreadableReason = isWorkspaceBoundaryError(error) ? "outside-workspace" : "unreadable";
          logWarn("workspace", "list-item-unreadable", { reason: unreadableReason }, error);
          return { ...registryCard(false), unreadableReason };
        }
        if (!manifest || manifest.id !== entry.id) return registryCard(false);
        const summary = withoutPayload({ ...manifest, lastKnownRootPath: entry.rootPath }, entry.rootPath, false, source);
        const cover = deriveProjectCover(manifest);
        return {
          ...summary,
          ...(cover.imageUrls.length ? { thumbnailUrls: cover.imageUrls, thumbnail: cover.imageUrls[0] } : {}),
          ...(cover.videoUrl ? { coverVideoUrl: cover.videoUrl } : {}),
        };
      }),
    ),
  );
  // 读面只给事实、不做展示上的取舍：所有登记过的项目都在（V-plibrary2 r3，用户 2026-10-22 拍板 B）。
  // 项目库页面、全部项目素材、MCP 项目列表、工作流来源名、走查都读这一份，都默认「列表 = 所有登记过的项目」；
  // 曾在这里藏「零编辑空白草稿」，刚新建、还没保存的项目就从 MCP 与走查的列表里消失了。
  // 列表也不删任何东西（N1：回收挂在列举上会和排队中的保存并发，删掉用户刚保存的草稿）。
  return summaries;
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

export async function saveWorkspaceProject(
  projectId: string,
  record: unknown,
  deps: WorkspaceRepositoryDeps,
): Promise<WorkspaceProjectRecordV2> {
  const entry = findRecentEntry(projectId, deps);
  if (!entry || entry.missing) {
    throw new Error(`Workspace project not found: ${projectId}`);
  }
  const written = await withWorkspaceManifestStagedMutation(entry.rootPath, (context) => {
    const existing = context.current;
    if (!existing || existing.id !== projectId) {
      throw new Error(`Workspace project not found: ${projectId}`);
    }
    const expectedBinding = record && typeof record === "object" ? (record as { expectedBinding?: ProjectBinding }).expectedBinding : undefined;
    if (expectedBinding !== undefined) {
      assertProjectAgentBinding(expectedBinding);
      if (!sameProjectAgentBinding(expectedBinding, { projectId: existing.id,
        immutableProjectUuid: existing.immutableProjectUuid ?? "", projectGeneration: existing.projectGeneration ?? 0 })) throw new Error("project_binding_stale");
    }
    const now = Date.now();
    const next = normalizeWorkspaceProjectRecord({
      ...existing,
      // 首次真实保存 = 从草稿态 promote 为持久态：清掉 draft 标记，此后它永远显示在项目库里。
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
  bindWorkspaceLocation(deps.settingsRoot, { id: written.id, name: written.name, rootPath: entry.rootPath });
  const manifestPath = workspaceProjectFile(entry.rootPath);
  const contentHash = crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  writeWorkspaceSyncBaseline(deps.settingsRoot, written.id, { rootPath: entry.rootPath, revision: written.revision, contentHash });
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
 * 删除一个 workspace 项目（⑭，用户 2026-10-22 拍板：进系统回收站、可以恢复，绝不永久删除）。
 * - native（默认根内的 Nomi 原生项目）→ 整个文件夹交给 `moveToTrash`（electron/projects/projectTrash.ts 的系统回收站），
 *   **成功并核过原路径不在了才解绑登记**；进不了回收站就原样抛出，登记和文件都不动。
 * - folder（用户用「打开文件夹」绑定的外部目录）→ **绝不碰用户的文件**，只解绑库引用，deleted:false。
 * 双重边界防误删用户目录：必须解析出真实目录、source 判 native、且严格位于默认根之下（非根本身）。
 * workspace 层不 import electron：回收站由调用方注入（主进程传 shell.trashItem 的那一份）。
 */
export async function deleteWorkspaceProject(
  projectId: string,
  deps: WorkspaceRepositoryDeps,
  moveToTrash: (folder: string) => Promise<void>,
): Promise<{ id: string; deleted: boolean }> {
  backfillWorkspaceOrigins(deps.settingsRoot, deps.defaultProjectsRoot);
  const entry = findRecentWorkspace(deps.settingsRoot, projectId);
  const dir = resolveWorkspaceProjectDir(projectId, deps); // 解析必须在解绑引用之前
  const resolved = dir ? path.resolve(dir) : null;
  const nativeRoot = entry?.source === "native" && entry.nativeRootPath ? path.resolve(entry.nativeRootPath) : null;
  const isNative = Boolean(resolved && nativeRoot && resolved !== nativeRoot && resolved.startsWith(`${nativeRoot}${path.sep}`));
  if (!resolved || !isNative) {
    removeWorkspaceReference(deps.settingsRoot, projectId); // 外部文件夹 / 解析不出：只解绑，不碰用户内容
    return { id: projectId, deleted: false };
  }
  // 别的写者此刻正锁着这个项目（另一个 Nomi 窗口 / 另一台电脑经同步盘）：照常报「正被别处占用」，不删。
  // 这一步只拿来探「别处占用」，所以**只把 WorkspaceManifestLockBusyError 往外抛**：取锁 / 放锁碰到别的错（只读卷、没权限写
  // .nomi：EROFS / EACCES / EPERM…）不是占用，往外抛会绕过回收站那一步的分类，界面把真原因说成「可能有别的程序正占用它的
  // 文件夹」（V-library-trash 建议 1，真只读卷实测）。这里吞掉，让 moveToTrash 去试、去报真原因（进不了就抛，登记不摘、文件不动）。
  try {
    releaseWorkspaceManifestLock(tryAcquireWorkspaceManifestLock(resolved));
  } catch (error) {
    if (error instanceof WorkspaceManifestLockBusyError) throw error;
  }
  await moveToTrash(resolved); // 失败就抛：登记不摘、文件不动
  removeWorkspaceReference(deps.settingsRoot, projectId);
  return { id: projectId, deleted: true };
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
