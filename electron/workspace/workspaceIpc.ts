import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasWorkspaceManifest } from "./workspaceManifest";

export type WorkspaceFolderSelection =
  | { canceled: true }
  | { canceled: false; rootPath: string }
  | { canceled: false; rejected: true; rootPath: string; reason: string };

// 外部文件夹信任边界（P1 安全根因 / 守纪律「信任边界缺失要补 denylist」）：
// 「打开文件夹」会往选中目录写 .nomi/assets/exports 并永久注册到库里。若用户误选
// 主目录本身或系统关键目录（照片/音乐/桌面/文档/下载/影片库、文件系统根、/System
// /Applications /Library 等），会污染这些目录且无法干净撤销。这里给一个从 os.homedir()
// + 平台系统根派生（不钉死绝对路径）的 denylist：命中直接拒绝并返回可读原因。
type SafetyOptions = {
  homedir?: string;
  platform?: NodeJS.Platform;
  readdir?: (dir: string) => string[];
};

export type WorkspaceFolderSafety =
  | { ok: true; isEmpty: boolean }
  | { ok: false; reason: string };

// home 下「不可作为工作区」的子目录名（系统/同步库，写入会污染用户资料）。
const PROTECTED_HOME_SUBDIRS = new Set([
  "Pictures",
  "Music",
  "Movies",
  "Videos",
  "Desktop",
  "Documents",
  "Downloads",
  "Library",
  "Applications",
  "Public",
  "Movies and TV",
]);

// 与平台无关的系统根（POSIX）。Windows 上多以盘符根/`C:\\Windows` 等表达，统一用
// 「等于文件系统根」+ 关键前缀判定，避免钉死特定卷标。
function systemRootPrefixes(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    // 故意不含 /var、/private、/tmp、/Volumes：/var/folders 与 /tmp 是用户临时目录、
    // /Volumes/<外置盘> 是放项目的合法位置。只拦真正 OS 拥有、写入即污染系统的根。
    return ["/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/cores"];
  }
  if (platform === "win32") {
    return ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"];
  }
  // Linux：同理不拦 /tmp、/var、/mnt、/media（用户可写/挂载点）。
  return ["/usr", "/bin", "/sbin", "/lib", "/boot", "/proc", "/sys", "/dev"];
}

function matchesRawSystemPath(rawPath: string, platform: NodeJS.Platform): boolean {
  const raw = String(rawPath || "").trim();
  if (!raw) return false;
  if (raw === "/" || raw === "\\") return true;
  if (/^[a-zA-Z]:[\\/]*$/.test(raw)) return true;

  if (platform === "win32") {
    const normalized = raw.replace(/\//g, "\\").toLowerCase();
    return systemRootPrefixes(platform).some((prefix) => {
      const candidate = prefix.toLowerCase();
      return normalized === candidate || normalized.startsWith(`${candidate}\\`);
    });
  }

  const normalized = raw.replace(/\\/g, "/");
  return systemRootPrefixes(platform).some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function isProtectedSystemPath(rawPath: string, resolved: string, homedir: string, platform: NodeJS.Platform): boolean {
  if (matchesRawSystemPath(rawPath, platform)) return true;
  const root = path.parse(resolved).root;
  // 文件系统根本身。
  if (resolved === root || resolved === path.parse(root).root) return true;
  // home 根本身。
  if (resolved === path.resolve(homedir)) return true;
  // home 下的系统/同步库子目录（精确到第一层：~/Pictures 等）。
  const homeRel = path.relative(path.resolve(homedir), resolved);
  if (homeRel && !homeRel.startsWith("..") && !path.isAbsolute(homeRel)) {
    const firstSegment = homeRel.split(path.sep)[0];
    if (firstSegment && PROTECTED_HOME_SUBDIRS.has(firstSegment) && homeRel.split(path.sep).length === 1) {
      return true;
    }
  }
  // 平台系统根（前缀匹配，含目录本身与其内部）。
  for (const prefix of systemRootPrefixes(platform)) {
    if (resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)) return true;
  }
  return false;
}

/**
 * 评估某路径能否安全地作为 Nomi 工作区。
 * - 命中危险目录 denylist → `{ ok: false, reason }`（可读中文原因）。
 * - 安全 → `{ ok: true, isEmpty }`：isEmpty=false 表示目录已有非 Nomi 内容，IPC/UI 层据此
 *   要求用户二次确认（避免在塞满文件的目录里悄悄初始化工作区）。已是 Nomi 工作区
 *   （含 .nomi/project.json）的目录视为 isEmpty=true（可直接打开，无需确认）。
 */
export function assessWorkspaceFolderSafety(rootPath: string, options: SafetyOptions = {}): WorkspaceFolderSafety {
  const rawRootPath = String(rootPath || "").trim();
  if (!rawRootPath) {
    return { ok: false, reason: "未选择有效的文件夹" };
  }
  const homedir = path.resolve(options.homedir ?? os.homedir());
  const platform = options.platform ?? process.platform;
  const resolved = path.resolve(rawRootPath);

  if (isProtectedSystemPath(rawRootPath, resolved, homedir, platform)) {
    return {
      ok: false,
      reason: `“${resolved}” 是主目录或系统关键目录，不能作为 Nomi 项目文件夹（会污染你的照片/音乐/系统文件）。请新建或另选一个空文件夹。`,
    };
  }

  // 已是 Nomi 工作区 → 直接可打开，不算「非空需确认」。
  if (hasWorkspaceManifest(resolved)) {
    return { ok: true, isEmpty: true };
  }

  const readdir = options.readdir ?? ((dir: string) => fs.readdirSync(dir));
  let entries: string[] = [];
  try {
    entries = readdir(resolved);
  } catch {
    // 读不到（尚不存在/将由 createDirectory 新建）→ 视为空目录，可安全初始化。
    return { ok: true, isEmpty: true };
  }
  // 忽略隐藏的系统噪声文件（.DS_Store 等），它们不构成「用户内容」。
  const meaningful = entries.filter((name) => name !== ".DS_Store" && name !== "Thumbs.db");
  return { ok: true, isEmpty: meaningful.length === 0 };
}

type WorkspaceFolderDialogProperty = "openDirectory" | "createDirectory";

export type WorkspaceFolderDialog = {
  showOpenDialog: (options: { properties: WorkspaceFolderDialogProperty[]; title?: string; buttonLabel?: string }) => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
};

type WorkspaceProjectCreator = (record: unknown) => unknown;

export type WorkspaceOpenFolderPayload = {
  rootPath: string;
  initialize?: boolean;
  name?: string;
};

export type WorkspaceOpenFolderDeps = {
  createProject: WorkspaceProjectCreator;
  selectedRootPaths?: ReadonlySet<string>;
  // 第二参 isEmpty=false 表示目标目录已有非 Nomi 内容，UI 应让用户二次确认再初始化。
  confirmInitialize?: (rootPath: string, info: { isEmpty: boolean }) => Promise<boolean> | boolean;
  homedir?: string;
};

export async function selectWorkspaceFolder(
  dialog: WorkspaceFolderDialog,
  options: { homedir?: string } = {},
): Promise<WorkspaceFolderSelection> {
  const result = await dialog.showOpenDialog({
    title: "选择 Nomi 项目文件夹",
    buttonLabel: "打开文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }
  const rootPath = path.resolve(result.filePaths[0]);
  // 选中即校验：命中危险目录直接回 rejected + 原因，让上层弹错而不是默默往里写。
  const safety = assessWorkspaceFolderSafety(rootPath, { homedir: options.homedir });
  if (!safety.ok) {
    return { canceled: false, rejected: true, rootPath, reason: safety.reason };
  }
  return { canceled: false, rootPath };
}

export async function openWorkspaceFolder(payload: WorkspaceOpenFolderPayload, deps: WorkspaceOpenFolderDeps): Promise<unknown> {
  const rawRootPath = String(payload.rootPath || "").trim();
  if (!rawRootPath) {
    throw new Error("rootPath is required");
  }
  const rootPath = path.resolve(rawRootPath);
  if (deps.selectedRootPaths && !deps.selectedRootPaths.has(rootPath)) {
    throw new Error("Workspace folder must be selected with native picker first");
  }

  // 防御纵深：真正落盘的入口再校验一次危险目录（select 之后路径可能被改、或直接调 open）。
  const safety = assessWorkspaceFolderSafety(rootPath, { homedir: deps.homedir });
  if (!safety.ok) {
    throw new Error(safety.reason);
  }

  const hasManifest = hasWorkspaceManifest(rootPath);
  if (!hasManifest && !payload.initialize) {
    throw new Error("Workspace folder is not initialized");
  }
  if (!hasManifest && payload.initialize) {
    // 把「目录是否非空」信号透传给确认回调：非空（已有用户文件）时 UI 应额外提示，
    // 避免在塞满照片/文档的目录里悄悄初始化工作区（IPC 层只给信号，不改 UI）。
    const confirmed = await deps.confirmInitialize?.(rootPath, { isEmpty: safety.isEmpty });
    if (!confirmed) {
      throw new Error("Workspace initialization canceled");
    }
  }

  const record = payload.name ? { rootPath, name: payload.name } : { rootPath };
  return deps.createProject(record);
}
