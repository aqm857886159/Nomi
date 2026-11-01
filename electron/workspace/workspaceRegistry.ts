import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { retryOnSharingViolation, writeJsonFileAtomic } from "../jsonFile";
import { workspaceFolderCopyError } from "../shared/contracts/projectLocation";
import { workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";
import {
  normalizeRecentWorkspaceEntry,
  type RecentWorkspaceEntry,
  type WorkspaceOrigin,
} from "./workspaceTypes";

function readRecentWorkspaceEntries(settingsRoot: string): RecentWorkspaceEntry[] {
  const registryPath = recentWorkspacesPath(settingsRoot);
  if (!fs.existsSync(registryPath)) {
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry) => normalizeRecentWorkspaceEntry(entry));
}

function writeRecentWorkspaces(settingsRoot: string, entries: RecentWorkspaceEntry[]): void {
  writeJsonFileAtomic(recentWorkspacesPath(settingsRoot), entries);
}

/**
 * 跨进程锁：把注册表的「读→改→写」串行化。根因（2026-06-30 钉死，确定性复现：两进程各写 60 条→丢 60 条）——
 * 原来的登记写是无锁 read-modify-write，多个 headless host / app 同时建项目时各读旧表、各写自己那条 →
 * 后写覆盖先写 → 条目丢 → readProject 找不到 →「项目不存在」。多 agent 并发驱动 + app 同时跑必中。
 * 用原子 mkdir 做锁（跨进程有效），自旋退避；3s 上限 + 陈旧锁兜底，绝不死等（最坏退化回原无锁行为）。
 */
function withRegistryLock<T>(settingsRoot: string, fn: () => T): T {
  const lockDir = `${recentWorkspacesPath(settingsRoot)}.lock`;
  const spin = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 3000;
  let locked = false;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      locked = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") break; // 锁机制异常→不阻塞，退化回无锁
      if (Date.now() > deadline) {
        // 陈旧锁兜底：持锁进程崩溃残留 → 超时夺锁，绝不永久死等。
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
          fs.mkdirSync(lockDir);
          locked = true;
        } catch {
          /* 夺锁失败也继续（最坏=退化回原行为，不卡死） */
        }
        break;
      }
      Atomics.wait(spin, 0, 0, 10); // 同步退避 10ms 再抢
    }
  }
  try {
    return fn();
  } finally {
    if (locked) {
      try {
        // 杀毒 / 同步盘短暂开着这个目录时 Windows 删不掉（EPERM/EBUSY）：先短退避重试，
        // 否则留下的 .lock 会让下一次注册表读写在主线程上干等 3 秒才夺锁。
        retryOnSharingViolation(() => fs.rmdirSync(lockDir));
      } catch {
        /* 已释放 */
      }
    }
  }
}

function sortRecentWorkspaces(entries: RecentWorkspaceEntry[]): RecentWorkspaceEntry[] {
  return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
}

function withMissingState(entry: RecentWorkspaceEntry): RecentWorkspaceEntry {
  return {
    ...entry,
    missing: !fs.existsSync(entry.rootPath),
  };
}

export function recentWorkspacesPath(settingsRoot: string): string {
  return path.join(path.resolve(settingsRoot), "recent-workspaces.json");
}

export function listRecentWorkspaces(settingsRoot: string): RecentWorkspaceEntry[] {
  return sortRecentWorkspaces(readRecentWorkspaceEntries(settingsRoot).map((entry) => withMissingState(entry)));
}

/**
 * 项目库列表用的异步读：注册表本身是一个小 JSON（一次同步读），「文件夹还在不在」这一项
 * 逐个项目一次 stat——几十个项目就是几十次系统调用，放线程池里并发做（上限由调用方给），不占主进程事件循环。
 */
export async function listRecentWorkspacesAsync(
  settingsRoot: string,
  limit: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<RecentWorkspaceEntry[]> {
  const entries = readRecentWorkspaceEntries(settingsRoot);
  const withState = await Promise.all(
    entries.map((entry) =>
      limit(async () => ({
        ...entry,
        missing: !(await fsp.access(entry.rootPath).then(() => true, () => false)),
      })),
    ),
  );
  return sortRecentWorkspaces(withState);
}

/** 只要已登记项目的 id（不查盘）：「有没有在跑的任务」这类只按 id 找别处记录的读法用它，不必拿全库摘要。 */
export function listRegisteredProjectIds(settingsRoot: string): string[] {
  return readRecentWorkspaceEntries(settingsRoot).map((entry) => entry.id);
}

/** id → 项目文件夹路径（只读注册表，不查盘）：批量状态检查按 id 找文件夹用，不必每个项目都读一遍清单。 */
export function listRegisteredWorkspaceRoots(settingsRoot: string): Map<string, string> {
  return new Map(readRecentWorkspaceEntries(settingsRoot).map((entry) => [entry.id, path.resolve(entry.rootPath)]));
}

export function findRecentWorkspace(
  settingsRoot: string,
  projectId: string,
): RecentWorkspaceEntry | null {
  const id = String(projectId || "").trim();
  if (!id) return null;
  const entry = readRecentWorkspaceEntries(settingsRoot).find((item) => item.id === id);
  return entry ? withMissingState(entry) : null;
}

function storedOrigin(entry: RecentWorkspaceEntry | undefined): WorkspaceOrigin | undefined {
  if (entry?.source === "native" && entry.nativeRootPath) {
    return { source: "native", nativeRootPath: path.resolve(entry.nativeRootPath) };
  }
  return entry?.source === "folder" ? { source: "folder" } : undefined;
}

function strictDescendantOf(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

/**
 * 老 registry 没有来源字段。切换默认位置前，必须用“旧默认根”冻结一次来源；之后永不重算。
 */
export function backfillWorkspaceOrigins(
  settingsRoot: string,
  defaultProjectsRoot: string,
): void {
  const nativeRootPath = path.resolve(defaultProjectsRoot);
  return withRegistryLock(settingsRoot, () => {
    const entries = readRecentWorkspaceEntries(settingsRoot);
    let changed = false;
    const next = entries.map((entry) => {
      if (storedOrigin(entry)) return entry;
      changed = true;
      return normalizeRecentWorkspaceEntry({
        ...entry,
        ...(strictDescendantOf(nativeRootPath, entry.rootPath)
          ? { source: "native", nativeRootPath }
          : { source: "folder" }),
      });
    });
    const sorted = sortRecentWorkspaces(next);
    if (changed) writeRecentWorkspaces(settingsRoot, sorted);
  });
}

/**
 * 「项目 id → 项目文件夹」的一条登记（概念 project.location 的唯一写入口，收敛单 2026-10-29）。
 * rootPath 必须由调用方显式给出：用户这次打开 / 新建的目录、保存与恢复时登记里的同一路径、启动对账扫到的目录。
 * 这里不收清单 record：清单里的 lastKnownRootPath 是创建时写下的旧提示，改名 / 挪走 / 复制之后就是错的
 * （05-31 起登记抄它，选文件夹打开改名后的目录却登记成旧路径——用户报的「提示文件夹不存在」）。
 */
export type WorkspaceLocationBinding = {
  id: string;
  name: string;
  rootPath: string;
  origin?: WorkspaceOrigin;
};

/** 同一个 id 已经绑在另一个还装着它的文件夹上：要绑的是副本（或原件被复制后的另一份）。 */
export type WorkspaceLocationConflict = {
  binding: WorkspaceLocationBinding;
  boundRootPath: string;
  boundName: string;
};

/**
 * 这个文件夹现在装的是哪个项目：依次读 .nomi/project.json、.nomi 里的备份（只剩备份时打开会从它恢复）、老格式根上
 * project.json 的 id 字段。只读文件、不取清单锁、不写。
 */
export function readWorkspaceFolderProjectId(rootPath: string): string | null {
  const candidates = [
    () => workspaceProjectFile(rootPath),
    () => workspaceProjectBackupFile(rootPath),
    () => path.join(path.resolve(rootPath), "project.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(candidate(), "utf8")) as { id?: unknown } | null;
      if (raw && typeof raw === "object" && typeof raw.id === "string" && raw.id.trim()) return raw.id.trim();
    } catch {
      // 不在 / 读不出 / 越界：看下一个
    }
  }
  return null;
}

function sameFolder(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (path.relative(a, b) === "") return true;
  try {
    return path.relative(fs.realpathSync(a), fs.realpathSync(b)) === "";
  } catch {
    return false;
  }
}

/**
 * 不变量 ⑤：同一个 id 已经登记在另一个文件夹上、那个文件夹还在而且还装着这个 id → 不改绑（协调 2026-10-29：先拒绝，
 * 「改用哪个」的确认框走设计流程后再做）。原登记的文件夹不在了、或已经不是这个项目 → 可以改绑（改名 / 挪走后重开）。
 */
function liveBindingConflict(entries: RecentWorkspaceEntry[], binding: WorkspaceLocationBinding): WorkspaceLocationConflict | null {
  const existing = entries.find((entry) => entry.id === binding.id);
  if (!existing || sameFolder(existing.rootPath, binding.rootPath)) return null;
  if (readWorkspaceFolderProjectId(existing.rootPath) !== binding.id) return null;
  return { binding, boundRootPath: existing.rootPath, boundName: existing.name };
}

function assertExplicitBinding(binding: WorkspaceLocationBinding): void {
  if (!binding || typeof binding.id !== "string" || !binding.id.trim()) throw new Error("bindWorkspaceLocation requires a project id");
  if (typeof binding.rootPath !== "string" || !binding.rootPath.trim()) {
    throw new Error("bindWorkspaceLocation requires the rootPath the user opened or created");
  }
}

/** 单条与批量共用的合并（唯一实现，P1）。 */
function mergeWorkspaceBinding(entries: RecentWorkspaceEntry[], binding: WorkspaceLocationBinding): RecentWorkspaceEntry[] {
  const existing = entries.find((entry) => entry.id === binding.id);
  const rootPath = path.resolve(binding.rootPath);
  // 位置没变：已冻结的来源优先（保存 / 恢复 / 再发现都不能把外部项目改成 native）。
  // 位置变了（改名 / 挪走后重开、启动对账接回）：来源描述的是新位置，由调用方说。
  const samePlace = existing ? sameFolder(existing.rootPath, rootPath) : false;
  const effectiveOrigin = samePlace ? (storedOrigin(existing) ?? binding.origin) : (binding.origin ?? storedOrigin(existing));
  const nextEntry = normalizeRecentWorkspaceEntry({
    id: binding.id,
    name: binding.name,
    rootPath,
    lastOpenedAt: Date.now(),
    missing: !fs.existsSync(rootPath),
    ...effectiveOrigin,
  });
  return [nextEntry, ...entries.filter((entry) => entry.id !== binding.id)];
}

/** 打开文件夹在往里写任何东西（初始化、补备份）之前先问一句：绑上去会不会撞上一个还在的原件。 */
export function assertWorkspaceFolderBindable(settingsRoot: string, binding: Pick<WorkspaceLocationBinding, "id" | "rootPath" | "name">): void {
  const conflict = liveBindingConflict(readRecentWorkspaceEntries(settingsRoot), binding);
  if (conflict) throw workspaceFolderCopyError({ projectName: conflict.boundName, originalRootPath: conflict.boundRootPath });
}

/** 单条登记：新建 / 打开 / 保存 / 恢复。撞上还在的原件抛 WorkspaceFolderCopyError，登记不动。 */
export function bindWorkspaceLocation(settingsRoot: string, binding: WorkspaceLocationBinding): RecentWorkspaceEntry[] {
  assertExplicitBinding(binding);
  // 锁内重读→改→写：与并发的 host/app 串行，杜绝「后写覆盖先写丢条目」。
  return withRegistryLock(settingsRoot, () => {
    const entries = readRecentWorkspaceEntries(settingsRoot);
    const conflict = liveBindingConflict(entries, binding);
    if (conflict) throw workspaceFolderCopyError({ projectName: conflict.boundName, originalRootPath: conflict.boundRootPath });
    const next = sortRecentWorkspaces(mergeWorkspaceBinding(entries, binding));
    writeRecentWorkspaces(settingsRoot, next);
    return next;
  });
}

/**
 * 批量登记（启动对账一次登记 N 个，性能根因边界三）：一次取锁、一次读、一次写。逐条登记在「发现阶段一次登记 N 个项目」时
 * 是 O(n²) 写放大（实测 346 条 = 1752ms）。合并语义与单条完全一致；撞上还在的原件的那条跳过、原登记不动，冲突照实返回
 * （默认根里复制一份后只是重启，登记不再在原件和副本之间来回改绑——特征测试 2g）。空数组不取锁、不写盘。
 */
export function bindWorkspaceLocations(
  settingsRoot: string,
  bindings: WorkspaceLocationBinding[],
): { entries: RecentWorkspaceEntry[]; conflicts: WorkspaceLocationConflict[] } {
  for (const binding of bindings) assertExplicitBinding(binding);
  if (!bindings.length) {
    return { entries: sortRecentWorkspaces(readRecentWorkspaceEntries(settingsRoot)), conflicts: [] };
  }

  return withRegistryLock(settingsRoot, () => {
    let entries = readRecentWorkspaceEntries(settingsRoot);
    const conflicts: WorkspaceLocationConflict[] = [];
    for (const binding of bindings) {
      const conflict = liveBindingConflict(entries, binding);
      if (conflict) {
        conflicts.push(conflict);
        continue;
      }
      entries = mergeWorkspaceBinding(entries, binding);
    }
    const next = sortRecentWorkspaces(entries);
    if (conflicts.length < bindings.length) writeRecentWorkspaces(settingsRoot, next);
    return { entries: next, conflicts };
  });
}

/**
 * 发现阶段的对账输入（性能根因边界一）：registry 里已知的 rootPath 集合，已 `path.resolve`
 * 归一化。发现阶段据此跳过已注册目录——不读它们的 manifest、也不重注册它们。
 */
export function listRegisteredRootPaths(settingsRoot: string): Set<string> {
  const known = new Set<string>();
  for (const entry of readRecentWorkspaceEntries(settingsRoot)) {
    if (!entry.rootPath) continue;
    known.add(path.resolve(entry.rootPath));
    // registry 存的是 path.resolve 过的路径，而扫盘拿到的目录可能经由符号链接
    // （macOS 的 /tmp → /private/tmp）。两侧都登记 realpath，保证能对上。
    try {
      known.add(fs.realpathSync(entry.rootPath));
    } catch {
      /* 目录已不存在：resolve 版本已登记，足够跳过 */
    }
  }
  return known;
}

export function removeWorkspaceReference(settingsRoot: string, projectId: string): RecentWorkspaceEntry[] {
  return withRegistryLock(settingsRoot, () => {
    const next = readRecentWorkspaceEntries(settingsRoot).filter((entry) => entry.id !== projectId);
    writeRecentWorkspaces(settingsRoot, next);
    return next;
  });
}
