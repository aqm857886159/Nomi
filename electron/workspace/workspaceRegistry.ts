import fs from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "../jsonFile";
import { normalizeRecentWorkspaceEntry, type RecentWorkspaceEntry, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

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

export function rememberWorkspace(settingsRoot: string, record: WorkspaceProjectRecordV2): RecentWorkspaceEntry[] {
  if (!record.lastKnownRootPath) {
    throw new Error("Workspace registry entry requires rootPath from the selected workspace");
  }

  const rootPath = path.resolve(record.lastKnownRootPath);
  const nextEntry = normalizeRecentWorkspaceEntry({
    id: record.id,
    name: record.name,
    rootPath,
    lastOpenedAt: Date.now(),
    missing: !fs.existsSync(rootPath),
  });
  // 锁内重读→改→写：与并发的 host/app 串行，杜绝「后写覆盖先写丢条目」。
  return withRegistryLock(settingsRoot, () => {
    const entries = readRecentWorkspaceEntries(settingsRoot).filter((entry) => entry.id !== record.id);
    const next = sortRecentWorkspaces([nextEntry, ...entries]);
    writeRecentWorkspaces(settingsRoot, next);
    return next;
  });
}

export function removeWorkspaceReference(settingsRoot: string, projectId: string): RecentWorkspaceEntry[] {
  return withRegistryLock(settingsRoot, () => {
    const next = readRecentWorkspaceEntries(settingsRoot).filter((entry) => entry.id !== projectId);
    writeRecentWorkspaces(settingsRoot, next);
    return next;
  });
}
