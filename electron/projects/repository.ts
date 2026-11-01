// 项目存储 —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 6 步）。
// 依赖底层 runtimePaths / jsonFile / workspace，不反向依赖 runtime（无循环）。
// 删除了原 runtime 里的死代码 uniqueDir / toSummary（全仓零调用，规则 1）。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureExportDirs } from "../export/exportPaths";
import { writeJsonFileAtomic } from "../jsonFile";
import type { JsonRecord } from "../jsonUtils";
import { PROJECT_FILE, ensureDir, getProjectLocationState, getProjectsRoot, getWorkspaceRepositoryDeps, readJson } from "../runtimePaths";
import { logWarn } from "../logging/logger";
import {
  discoverLegacyProjectsOnce,
  isLegacyProjectSuppressed,
  suppressLegacyProjectRediscovery,
} from "../workspace/legacyProjectMigration";
import {
  bindWorkspaceLocations,
  findRecentWorkspace,
  removeWorkspaceReference,
} from "../workspace/workspaceRegistry";
import { assertUserOwnedLocation } from "../workspace/workspaceLocationPolicy";
import { resolveWorkspaceRelativePath } from "../workspace/workspacePaths";
import { WorkspaceManifestLockBusyError } from "../workspace/workspaceManifestLock";
import { moveProjectFolderToTrash } from "./projectTrash";
import {
  PROJECT_DELETE_INTENTS,
  PROJECT_DELETE_STATE_CHANGED_ERROR_NAME,
  isProjectDeleteIntent,
} from "../shared/projectDeleteIntent";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  diagnoseWorkspaceProject,
  listWorkspaceProjects,
  readWorkspaceProject,
  recoverWorkspaceProject,
  resolveWorkspaceProjectDir,
  saveWorkspaceProject,
} from "../workspace/workspaceRepository";

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision?: number;
  savedAt?: number;
  thumbnail?: string;
  thumbnailUrls?: string[];
  seedKey?: string;
  /** 草稿态标记：新建空白零编辑项目。首次 save 即清除。列表照常返回它（读面不做展示上的取舍）。 */
  draft?: boolean;
  /** 列表摘要专用：这一项的数据读不出来（见 WorkspaceProjectSummary.unreadableReason）。 */
  unreadableReason?: "outside-workspace" | "unreadable";
  version: number;
  payload?: unknown;
  rootPath?: string;
  missing?: boolean;
};

/** sanitizeName 的长度上限。落盘文件名按它给「主干 + 扩展名」分预算（projectAssetStore.storedAssetFileParts）。 */
export const SANITIZED_NAME_MAX_LENGTH = 90;

/**
 * 名字的非法字符清洗 + 截断。**它不认识扩展名**：一个带扩展名的长文件名整段截到 90 字，扩展名会被截掉。
 * 落盘素材文件名别直接用它，走 projectAssetStore 的 storedAssetFileParts（只截主干）。
 */
export function sanitizeName(value: unknown, fallback = "Untitled"): string {
  const text = String(value || "").trim() || fallback;
  return text
    // eslint-disable-next-line no-control-regex -- 文件名里不许留 U+0000–U+001F 这些控制字符（Windows 保留），这里就是要匹配它们
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, SANITIZED_NAME_MAX_LENGTH)
    .trim() || fallback;
}

export function normalizeProjectRecord(input: unknown): ProjectRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Project record must be an object");
  }
  const raw = input as JsonRecord;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `project-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const time = Date.now();
  return {
    ...(raw as ProjectRecord),
    id,
    name: sanitizeName(raw.name, "Untitled Project"),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : time,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : time,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    savedAt: typeof raw.savedAt === "number" ? raw.savedAt : time,
    version: typeof raw.version === "number" ? raw.version : 1,
  };
}

export function legacyProjectDirById(projectId: string): string | null {
  const root = getProjectsRoot();
  // 只找、不建：默认根不在就是找不到（「项目在哪」收敛单第 3 条）。以前这里先 ensureDir(默认根)，升级清掉安装目录后
  // 素材库、媒体解析、readProject 任何一次查找都把空的默认根建回来，列表随后把整库灰卡当成「用户删了」摘掉。
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(root, entry.name);
    if (isLegacyProjectSuppressed(projectDir)) continue;
    // 按内容（manifest id）找回项目目录。除了根 project.json（真·legacy），也查
    // .nomi/project.json（workspace 项目的清单位置）——这样「文件夹被改名/移动后
    // registry 路径失效」时，仍能扫到它，修「改名后 nomi-local 图全部 404 消失」。
    for (const projectFile of [
      path.join(projectDir, PROJECT_FILE),
      path.join(projectDir, ".nomi", PROJECT_FILE),
    ]) {
      if (!fs.existsSync(projectFile)) continue;
      const record = readJson<ProjectRecord | null>(projectFile, null);
      if (record?.id === projectId) return projectDir;
    }
  }
  return null;
}

export function projectDirById(projectId: string): string | null {
  return resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()) || legacyProjectDirById(projectId);
}

export function ensureProjectFolders(projectDir: string): void {
  ensureDir(projectDir);
  ensureDir(path.join(projectDir, "assets"));
  ensureExportDirs(projectDir);
}

function getInputRootPath(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rootPath = (input as JsonRecord).rootPath;
  return typeof rootPath === "string" && rootPath.trim() ? rootPath.trim() : null;
}

/**
 * 项目列表摘要的**唯一读面**（异步）。渲染层、MCP / 外部 Agent 的项目列表都走它，没有同步版：
 * 同步版会让渲染层 sendSync 干等主进程扫完全库（41 个项目 ≈340ms，2026-10-16 追踪），
 * 也会让主进程在扫描期间不响应别的 IPC。读盘的重活在 listWorkspaceProjects（线程池 + 限并发）。
 */
export async function listProjects(): Promise<Array<Omit<ProjectRecord, "payload">>> {
  const deps = getWorkspaceRepositoryDeps();
  // 存量 registry 的来源字段冻结由下游 listWorkspaceProjects 统一负责（同参数同进程重复调用
  // 是纯浪费的一次取锁+读表，2026-09-03 去重）。
  // 「发现」legacy 项目是对 registry **缺失项**的增量对账，不是每次启动把全库重读重注册：
  // discoverLegacyProjectsOnce 拿 settingsRoot 先跳过所有已注册目录（0 次 manifest 读），
  // 只对真正的新项目走无锁快照读；随后一次批量写 registry（而不是 N 次全量重写）。
  // 登记的是扫到的目录本身；扫到的 id 已经绑在另一个还在的文件夹上（复制出来的副本）就跳过，原登记不动。
  const discovered = discoverLegacyProjectsOnce(deps.defaultProjectsRoot, { settingsRoot: deps.settingsRoot });
  const { conflicts } = bindWorkspaceLocations(
    deps.settingsRoot,
    discovered.map((found) => ({ ...found, origin: { source: "native", nativeRootPath: deps.defaultProjectsRoot } as const })),
  );
  for (const conflict of conflicts) logWarn("workspace", "discovery-copy-skipped", { projectId: conflict.binding.id });
  // 列举只读项目、不删项目（N1，2026-10-22）：空白草稿回收曾挂在首次列举上，列举是异步的，
  // 期间排队等锁的保存会被它删掉。列表返回所有登记过的项目，不藏也不删（读面不做展示上的取舍）；
  // 删项目只有用户点删除这一扇门（check:read-path-writes 把 deleteWorkspaceProject 列为销毁门，读路径可达即红）。
  // 列表不摘登记（「项目在哪」收敛单第 1 条，用户 2026-10-29 批准）：文件夹找不到的项目照出 missing 卡、一直留在库里，
  // 直到用户自己移除或重新打开那个文件夹。「文件夹不在 = 用户删了」是错的前提——改名、挪走、升级清掉安装目录、
  // 同步盘晚挂载都是文件夹不在；06-14 起按这个前提在这里摘登记，升级后关掉再开整库项目就没了。
  const projects = await listWorkspaceProjects(deps);
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

// 「新建项目」走这里：不让渲染层指定路径，由主进程在默认根（getProjectsRoot，
// ~/Documents/Nomi Projects）下自动生成一个项目文件夹，再复用 workspace 那套
// 初始化/注册/资源落盘逻辑。这样用户「新建项目」无需每次选文件夹也能立刻开工，
// 而「打开文件夹」仍是显式选目录（见 NomiStudioApp 的两个入口）。
export function createDefaultProject(input: unknown): ProjectRecord {
  const location = getProjectLocationState();
  // 默认位置在 Nomi 自己的目录里（0.24.0 允许这样设）就拒绝新建，不静默改设置、不换目录：渲染层说清为什么、去设置换。
  // 环境变量托管的位置不判（见 workspaceLocationPolicy 文件头）。
  if (location.source !== "environment") assertUserOwnedLocation(location.path);
  const root = location.path;
  ensureDir(root);
  const rawName =
    input && typeof input === "object" && !Array.isArray(input) ? (input as JsonRecord).name : undefined;
  const folderBase = sanitizeName(rawName, "project");
  const unique = `${folderBase}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const rootPath = path.join(root, unique);
  return createWorkspaceProject(
    {
      rootPath,
      record: input,
      origin: { source: "native", nativeRootPath: root },
    },
    getWorkspaceRepositoryDeps(),
  );
}

export function createProject(input: unknown): ProjectRecord {
  const rootPath = getInputRootPath(input);
  if (rootPath) {
    assertUserOwnedLocation(rootPath);
    return createWorkspaceProject(
      { rootPath, record: input, origin: { source: "folder" } },
      getWorkspaceRepositoryDeps(),
    );
  }

  // 无 rootPath ＝「新建项目」：落到默认根的自动文件夹，而不是报错。
  return createDefaultProject(input);
}

export function readProject(projectId: string): ProjectRecord | null {
  const id = String(projectId || "").trim();
  const workspaceRecord = readWorkspaceProject(id, getWorkspaceRepositoryDeps());
  if (workspaceRecord) return workspaceRecord;

  const projectDir = legacyProjectDirById(id);
  if (!projectDir) return null;
  return normalizeProjectRecord(readJson<ProjectRecord>(path.join(projectDir, PROJECT_FILE), {} as ProjectRecord));
}

export function diagnoseProject(projectId: string) {
  return diagnoseWorkspaceProject(String(projectId || "").trim(), getWorkspaceRepositoryDeps());
}

export function recoverProject(projectId: string): ProjectRecord {
  return recoverWorkspaceProject(String(projectId || "").trim(), getWorkspaceRepositoryDeps());
}

export async function saveProject(projectId: string, input: unknown): Promise<ProjectRecord> {
  const id = String(projectId || "").trim();
  if (findRecentWorkspace(getWorkspaceRepositoryDeps().settingsRoot, id)) {
    return saveWorkspaceProject(id, input, getWorkspaceRepositoryDeps());
  }

  if (input && typeof input === "object" && "expectedBinding" in input) throw new Error("project_binding_stale");
  const projectDir = legacyProjectDirById(id);
  if (!projectDir) throw new Error("Cannot save unknown workspace project");
  const record = normalizeProjectRecord({ ...(input as JsonRecord), id });
  ensureProjectFolders(projectDir);
  writeJsonFileAtomic(path.join(projectDir, PROJECT_FILE), record);
  return record;
}

function readableWorkspaceDir(id: string, deps: ReturnType<typeof getWorkspaceRepositoryDeps>): string | null {
  try {
    return resolveWorkspaceProjectDir(id, deps);
  } catch {
    return null;
  }
}

/**
 * 只从项目库解除登记，不碰项目内容（「从项目库移除」）。
 * 读得出来的目录要抑制下次启动的 legacy 重发现，否则它会自己回到库里：默认根内的项目（启动发现会扫默认根），
 * 以及根目录还有旧版 project.json 的外部文件夹。按登记路径读不出来（改名了）就按 id 在默认根里找：不抑制的话，重启后对账会把刚移除的它接回来。
 * 两边都读不出来（越界 / 损坏 / 不在了）= null：不往任何目录里写东西。
 */
function unbindProject(id: string): { id: string; deleted: false } {
  const deps = getWorkspaceRepositoryDeps();
  const workspaceDir = readableWorkspaceDir(id, deps) ?? legacyProjectDirById(id);
  if (findRecentWorkspace(deps.settingsRoot, id)) removeWorkspaceReference(deps.settingsRoot, id);
  const insideDefaultRoot = workspaceDir !== null && path.resolve(workspaceDir).startsWith(`${path.resolve(deps.defaultProjectsRoot)}${path.sep}`);
  if (workspaceDir && (insideDefaultRoot || fs.existsSync(path.join(workspaceDir, PROJECT_FILE)))) suppressLegacyProjectRediscovery(workspaceDir);
  return { id, deleted: false };
}

/**
 * 删除项目：严格照用户在确认框里确认过的意图执行（electron/shared/projectDeleteIntent.ts）。
 * 确认框按列表那一刻的卡片说话，这里在删除这一刻执行；两刻之间状态可能变了，所以这里**不自己判断该删多少**：
 *   · unbind：只解除登记，绝不删盘——哪怕此刻项目又读得出来了（V-plibrary2：灰卡确认「只解绑」后 .nomi 被挪回，
 *     旧写法在删除这一刻重读、读得出来就整目录删了）；
 *   · delete-files：清单此刻读不出来（读的时候抛错）= 和确认时对不上，拒绝，让界面刷新后重新确认；锁忙照常报忙。
 *     读得出来：项目文件夹进系统回收站（moveProjectFolderToTrash，⑭），进不了就原样报错、什么都不删。
 *     文件夹此刻已经不在（删了、改名、盘没插，库页还没刷新）：没有东西可进回收站，只解除登记，回 deleted:false，界面如实说「只从项目库移除了」。
 */
export async function deleteProject(projectId: string, intent: unknown): Promise<{ id: string; deleted: boolean }> {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("projectId is required");
  if (!isProjectDeleteIntent(intent)) throw new Error(`Project delete intent is required (${PROJECT_DELETE_INTENTS.join(" / ")})`);
  const deps = getWorkspaceRepositoryDeps();
  if (intent === "unbind") return unbindProject(id);
  let readable: ReturnType<typeof readWorkspaceProject>;
  try {
    readable = readWorkspaceProject(id, deps);
  } catch (error) {
    if (error instanceof WorkspaceManifestLockBusyError || !findRecentWorkspace(deps.settingsRoot, id)) throw error;
    const changed = new Error(`${PROJECT_DELETE_STATE_CHANGED_ERROR_NAME}: project data is no longer readable; refresh and confirm again`);
    changed.name = PROJECT_DELETE_STATE_CHANGED_ERROR_NAME;
    Object.defineProperty(changed, "cause", { configurable: true, value: error });
    throw changed;
  }
  if (readable) {
    const workspaceDir = resolveWorkspaceProjectDir(id, deps);
    // native 项目整个文件夹进系统回收站（能还原）；外部「打开文件夹」绑定只解绑、绝不碰用户内容。
    const result = await deleteWorkspaceProject(id, deps, moveProjectFolderToTrash);
    // 仅外部文件夹(未真删、目录仍在)需抑制下次 list 的 legacy 重发现;native 已真删无需抑制。
    if (!result.deleted && workspaceDir && fs.existsSync(path.join(workspaceDir, PROJECT_FILE))) {
      suppressLegacyProjectRediscovery(workspaceDir);
    }
    return result;
  }

  // 回 false 就一定摘了登记（projectDeleteFlow 按这个说话）。下面进回收站的只剩没有登记、根上只有旧版 project.json 的老格式项目。
  const projectDir = findRecentWorkspace(deps.settingsRoot, id) ? null : legacyProjectDirById(id);
  if (!projectDir || fs.existsSync(path.join(projectDir, ".nomi", PROJECT_FILE))) return unbindProject(id);
  const root = path.resolve(getProjectsRoot());
  const resolvedProjectDir = path.resolve(projectDir);
  const rootWithSep = `${root}${path.sep}`;
  if (resolvedProjectDir === root || !resolvedProjectDir.startsWith(rootWithSep)) {
    throw new Error("Refusing to delete a path outside the projects root");
  }
  await moveProjectFolderToTrash(resolvedProjectDir); // 老格式项目同样进回收站；进不了就原样报错，绝不永久删除
  return { id, deleted: true };
}

export function resolveProjectRelativePath(projectId: string, relativePath: string): string {
  const projectDir = projectDirById(String(projectId || "").trim());
  if (!projectDir) throw new Error("Project not found");
  const value = String(relativePath || "");
  if (!value.trim()) return path.resolve(projectDir);
  return resolveWorkspaceRelativePath(projectDir, value);
}
