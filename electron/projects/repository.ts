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
import { PROJECT_FILE, ensureDir, getProjectsRoot, getWorkspaceRepositoryDeps, readJson } from "../runtimePaths";
import {
  discoverLegacyProjectsOnce,
  isLegacyProjectSuppressed,
  resetLegacyDiscoveryGuard,
  suppressLegacyProjectRediscovery,
} from "../workspace/legacyProjectMigration";
import {
  findRecentWorkspace,
  rememberWorkspaces,
  removeWorkspaceReference,
} from "../workspace/workspaceRegistry";
import { resolveWorkspaceRelativePath } from "../workspace/workspacePaths";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  diagnoseWorkspaceProject,
  gcEmptyDraftWorkspaceProjects,
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
  /** 草稿态标记：新建空白零编辑项目，启动 GC 会回收。首次 save 即清除。见 workspaceRepository.gcEmptyDraftWorkspaceProjects。 */
  draft?: boolean;
  version: number;
  payload?: unknown;
  rootPath?: string;
  missing?: boolean;
};

export function sanitizeName(value: unknown, fallback = "Untitled"): string {
  const text = String(value || "").trim() || fallback;
  return text
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 90)
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
  ensureDir(root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
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

// 启动 GC「一进程一次」guard（仿 discoverLegacyProjectsOnce）：首次列举 = App 启动加载库，
// 此刻盘上任何 draft 必来自上一个进程（本进程还没新建过）→ 回收它们是安全的；本会话之后新建的
// 草稿在 GC 之后才产生，guard 保证只跑一次 → 永不误删当前会话项目。挂在 listProjects 而非 main.ts，
// 既守住「启动一次」语义，又不越界改 main.ts（范围外）。
let emptyDraftGcDone = false;

export function resetEmptyDraftGcGuard(): void {
  emptyDraftGcDone = false;
}

export function listProjects(): Array<Omit<ProjectRecord, "payload">> {
  const deps = getWorkspaceRepositoryDeps();
  // 存量 registry 的来源字段冻结由下游 listWorkspaceProjects 统一负责（同参数同进程重复调用
  // 是纯浪费的一次取锁+读表，2026-09-03 去重）。
  // 「发现」legacy 项目是对 registry **缺失项**的增量对账，不是每次启动把全库重读重注册：
  // discoverLegacyProjectsOnce 拿 settingsRoot 先跳过所有已注册目录（0 次 manifest 读），
  // 只对真正的新项目走无锁快照读；随后一次批量写 registry（而不是 N 次全量重写）。
  const discovered = discoverLegacyProjectsOnce(deps.defaultProjectsRoot, { settingsRoot: deps.settingsRoot });
  rememberWorkspaces(
    deps.settingsRoot,
    discovered.map((record) => ({
      record,
      origin: { source: "native", nativeRootPath: deps.defaultProjectsRoot } as const,
    })),
  );
  // 启动首次列举顺手回收上个进程遗留的空白草稿（默认根存在才跑，避免根被移走时雪崩）。
  if (!emptyDraftGcDone) {
    emptyDraftGcDone = true;
    if (fs.existsSync(deps.defaultProjectsRoot)) {
      gcEmptyDraftWorkspaceProjects(deps);
    }
  }
  const projects = listWorkspaceProjects(deps);
  // 自愈对齐磁盘 ↔ registry:native 项目(Nomi 自管目录,~/Documents/Nomi Projects 内)
  // 若文件夹已不存在 = 真删(本地盘不会临时消失),从 registry 摘除引用,不再当幽灵卡片展示。
  // 防雪崩:仅当默认根本身仍存在时才清;根整体不可访问(被移走/同步中)则全部保留,等其回归。
  // external「打开文件夹」绑定的 missing 一律保留——外部盘/目录可能临时卸载,回来即恢复。
  const alive = projects.filter((project) => {
    const entry = project.missing ? findRecentWorkspace(deps.settingsRoot, project.id) : null;
    const nativeRootExists = Boolean(
      entry?.source === "native" && entry.nativeRootPath && fs.existsSync(entry.nativeRootPath),
    );
    if (project.missing && project.source === "native" && nativeRootExists) {
      removeWorkspaceReference(deps.settingsRoot, project.id);
      return false;
    }
    return true;
  });
  return alive.sort((a, b) => b.updatedAt - a.updatedAt);
}

// 显式同步：清掉一次性发现 guard 并立即重新发现 + 重注册（首次启动后、用户手动刷新库、
// 或外部改动磁盘项目集合时调用）。返回最新列表，避免调用方再单独跑一次 listProjects。
export function syncLegacyProjects(): Array<Omit<ProjectRecord, "payload">> {
  resetLegacyDiscoveryGuard();
  return listProjects();
}

// 「新建项目」走这里：不让渲染层指定路径，由主进程在默认根（getProjectsRoot，
// ~/Documents/Nomi Projects）下自动生成一个项目文件夹，再复用 workspace 那套
// 初始化/注册/资源落盘逻辑。这样用户「新建项目」无需每次选文件夹也能立刻开工，
// 而「打开文件夹」仍是显式选目录（见 NomiStudioApp 的两个入口）。
export function createDefaultProject(input: unknown): ProjectRecord {
  const root = getProjectsRoot();
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

export function saveProject(projectId: string, input: unknown): ProjectRecord {
  const id = String(projectId || "").trim();
  if (readWorkspaceProject(id, getWorkspaceRepositoryDeps())) {
    return saveWorkspaceProject(id, input, getWorkspaceRepositoryDeps());
  }

  const projectDir = legacyProjectDirById(id);
  if (!projectDir) throw new Error("Cannot save unknown workspace project");
  const record = normalizeProjectRecord({ ...(input as JsonRecord), id });
  ensureProjectFolders(projectDir);
  writeJsonFileAtomic(path.join(projectDir, PROJECT_FILE), record);
  return record;
}

export function deleteProject(projectId: string): { id: string; deleted: boolean } {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("projectId is required");
  if (readWorkspaceProject(id, getWorkspaceRepositoryDeps())) {
    const workspaceDir = resolveWorkspaceProjectDir(id, getWorkspaceRepositoryDeps());
    // 真删盘:native 项目整目录 fs.rmSync;外部「打开文件夹」绑定只解绑、绝不删用户内容。
    const result = deleteWorkspaceProject(id, getWorkspaceRepositoryDeps());
    // 仅外部文件夹(未真删、目录仍在)需抑制下次 list 的 legacy 重发现;native 已真删无需抑制。
    if (!result.deleted && workspaceDir && fs.existsSync(path.join(workspaceDir, PROJECT_FILE))) {
      suppressLegacyProjectRediscovery(workspaceDir);
    }
    return result;
  }

  const projectDir = legacyProjectDirById(id);
  if (!projectDir) return { id, deleted: false };
  if (fs.existsSync(path.join(projectDir, ".nomi", PROJECT_FILE))) {
    suppressLegacyProjectRediscovery(projectDir);
    return { id, deleted: false };
  }
  const root = path.resolve(getProjectsRoot());
  const resolvedProjectDir = path.resolve(projectDir);
  const rootWithSep = `${root}${path.sep}`;
  if (resolvedProjectDir === root || !resolvedProjectDir.startsWith(rootWithSep)) {
    throw new Error("Refusing to delete a path outside the projects root");
  }
  fs.rmSync(resolvedProjectDir, { recursive: true, force: true });
  return { id, deleted: true };
}

export function resolveProjectRelativePath(projectId: string, relativePath: string): string {
  const projectDir = projectDirById(String(projectId || "").trim());
  if (!projectDir) throw new Error("Project not found");
  const value = String(relativePath || "");
  if (!value.trim()) return path.resolve(projectDir);
  return resolveWorkspaceRelativePath(projectDir, value);
}
