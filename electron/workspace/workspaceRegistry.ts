import fs from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "../jsonFile";
import {
  normalizeRecentWorkspaceEntry,
  type RecentWorkspaceEntry,
  type WorkspaceOrigin,
  type WorkspaceProjectRecordV2,
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
 * rememberWorkspace 是无锁 read-modify-write，多个 headless host / app 同时建项目时各读旧表、各写自己那条 →
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
        fs.rmdirSync(lockDir);
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
): RecentWorkspaceEntry[] {
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
    return sorted.map((entry) => withMissingState(entry));
  });
}

/**
 * 单条合并逻辑（唯一实现）：把一条 record+origin 合进给定条目集合并返回新集合。
 * 单条 `rememberWorkspace` 与批量 `rememberWorkspaces` 共用它——不留两份并行实现（P1）。
 */
function mergeWorkspaceEntry(
  currentEntries: RecentWorkspaceEntry[],
  record: WorkspaceProjectRecordV2,
  origin?: WorkspaceOrigin,
): RecentWorkspaceEntry[] {
  const existing = currentEntries.find((entry) => entry.id === record.id);
  // 已冻结的来源优先：保存/恢复/legacy 再发现都不能把外部项目改成 native。
  const effectiveOrigin = storedOrigin(existing) ?? origin;
  const rootPath = path.resolve(record.lastKnownRootPath as string);
  const nextEntry = normalizeRecentWorkspaceEntry({
    id: record.id,
    name: record.name,
    rootPath,
    lastOpenedAt: Date.now(),
    missing: !fs.existsSync(rootPath),
    ...effectiveOrigin,
  });
  return [nextEntry, ...currentEntries.filter((entry) => entry.id !== record.id)];
}

function assertRegistrableRecord(record: WorkspaceProjectRecordV2): void {
  if (!record.lastKnownRootPath) {
    throw new Error("Workspace registry entry requires rootPath from the selected workspace");
  }
}

export function rememberWorkspace(
  settingsRoot: string,
  record: WorkspaceProjectRecordV2,
  origin?: WorkspaceOrigin,
): RecentWorkspaceEntry[] {
  assertRegistrableRecord(record);

  // 锁内重读→改→写：与并发的 host/app 串行，杜绝「后写覆盖先写丢条目」。
  return withRegistryLock(settingsRoot, () => {
    const next = sortRecentWorkspaces(mergeWorkspaceEntry(readRecentWorkspaceEntries(settingsRoot), record, origin));
    writeRecentWorkspaces(settingsRoot, next);
    return next;
  });
}

/**
 * 批量注册（性能根因边界三）：一次取锁、一次读、一次写地合并 N 条记录。
 *
 * 逐条 `rememberWorkspace` 在「发现阶段一次注册 N 个项目」时是 O(n²) 写放大——每条都要
 * 取锁 + 重读整表 + 全量重写（实测 346 条 = 1752ms）。批量入口把它压成一次 IO；合并语义
 * 与单条完全一致（共用 `mergeWorkspaceEntry`）。空数组不取锁、不写盘。
 */
export function rememberWorkspaces(
  settingsRoot: string,
  records: Array<{ record: WorkspaceProjectRecordV2; origin?: WorkspaceOrigin }>,
): RecentWorkspaceEntry[] {
  for (const { record } of records) assertRegistrableRecord(record);
  if (!records.length) {
    return sortRecentWorkspaces(readRecentWorkspaceEntries(settingsRoot));
  }

  return withRegistryLock(settingsRoot, () => {
    let entries = readRecentWorkspaceEntries(settingsRoot);
    for (const { record, origin } of records) {
      entries = mergeWorkspaceEntry(entries, record, origin);
    }
    const next = sortRecentWorkspaces(entries);
    writeRecentWorkspaces(settingsRoot, next);
    return next;
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
