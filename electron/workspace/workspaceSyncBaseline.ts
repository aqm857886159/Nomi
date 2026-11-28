import path from "node:path";
import pLimit from "p-limit";
import { readJsonFile, readJsonFileAsync, writeJsonFileAtomic, writeJsonFileAtomicAsync } from "../jsonFile";

const SCHEMA_VERSION = 1;
const BASELINE_FILE = "workspace-sync-baseline.json";
const baselineAsyncQueues = new Map<string, ReturnType<typeof pLimit>>();
const activeAsyncBaselineWrites = new Map<string, Map<string, WorkspaceSyncBaseline>>();

export type WorkspaceSyncBaseline = {
  rootPath: string;
  revision: number;
  contentHash: string;
};

type BaselineStore = {
  schemaVersion: typeof SCHEMA_VERSION;
  projects: Record<string, WorkspaceSyncBaseline>;
};

function baselinePath(settingsRoot: string): string {
  return path.join(path.resolve(settingsRoot), BASELINE_FILE);
}

function normalizeStore(raw: Partial<BaselineStore> | null | undefined): BaselineStore {
  if (!raw || raw.schemaVersion !== SCHEMA_VERSION || !raw.projects || typeof raw.projects !== "object") {
    return { schemaVersion: SCHEMA_VERSION, projects: {} };
  }
  const projects: Record<string, WorkspaceSyncBaseline> = {};
  for (const [projectId, value] of Object.entries(raw.projects)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Partial<WorkspaceSyncBaseline>;
    const revision = item.revision;
    if (
      typeof item.rootPath === "string" &&
      typeof revision === "number" &&
      Number.isInteger(revision) &&
      revision >= 0 &&
      typeof item.contentHash === "string" &&
      item.contentHash.length > 0
    ) {
      projects[projectId] = { rootPath: path.resolve(item.rootPath), revision, contentHash: item.contentHash };
    }
  }
  return { schemaVersion: SCHEMA_VERSION, projects };
}

function readStore(settingsRoot: string): BaselineStore {
  try {
    return normalizeStore(readJsonFile(baselinePath(settingsRoot)) as Partial<BaselineStore>);
  } catch {
    return { schemaVersion: SCHEMA_VERSION, projects: {} };
  }
}

async function readStoreAsync(settingsRoot: string): Promise<BaselineStore> {
  try {
    return normalizeStore((await readJsonFileAsync(baselinePath(settingsRoot))) as Partial<BaselineStore>);
  } catch {
    return { schemaVersion: SCHEMA_VERSION, projects: {} };
  }
}

export function readWorkspaceSyncBaseline(settingsRoot: string, projectId: string, rootPath: string): WorkspaceSyncBaseline | null {
  const baseline = readStore(settingsRoot).projects[String(projectId || "").trim()];
  if (!baseline || baseline.rootPath !== path.resolve(rootPath)) return null;
  return baseline;
}

/**
 * 这台机器自己刚写了项目文件（不是用户编辑、走的也不是保存漏斗，例如给老项目补身份）之后，把基线跟上——
 * **只在基线就是写之前那份内容时**才跟：基线和写前不一样，说明在这之前另一台电脑已经改过，冲突照报、不动基线。
 * 没有基线记录（这台机器从没查过这个项目）也不动：第一次检查会自己记。
 */
export function followWorkspaceSyncBaselineAfterOwnWrite(
  settingsRoot: string,
  projectId: string,
  write: { beforeHash: string; after: { revision: number; contentHash: string } },
): "followed" | "diverged" | "absent" {
  const id = String(projectId || "").trim();
  const target = baselinePath(settingsRoot);
  const store = readStore(settingsRoot);
  const baseline = store.projects[id];
  if (!baseline) return "absent";
  if (baseline.contentHash !== write.beforeHash) return "diverged";
  const updated = { rootPath: baseline.rootPath, revision: write.after.revision, contentHash: write.after.contentHash };
  store.projects[id] = updated;
  writeJsonFileAtomic(target, store);
  activeAsyncBaselineWrites.get(target)?.set(id, updated);
  return "followed";
}

export function writeWorkspaceSyncBaseline(settingsRoot: string, projectId: string, baseline: WorkspaceSyncBaseline): void {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("projectId is required");
  const target = baselinePath(settingsRoot);
  const store = readStore(settingsRoot);
  const updated = { rootPath: path.resolve(baseline.rootPath), revision: baseline.revision, contentHash: baseline.contentHash };
  store.projects[id] = updated;
  writeJsonFileAtomic(target, store);
  activeAsyncBaselineWrites.get(target)?.set(id, updated);
}

export async function writeWorkspaceSyncBaselineAsync(
  settingsRoot: string,
  projectId: string,
  baseline: WorkspaceSyncBaseline,
): Promise<void> {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("projectId is required");
  const target = baselinePath(settingsRoot);
  const limit = baselineAsyncQueues.get(target) ?? pLimit(1);
  baselineAsyncQueues.set(target, limit);
  try {
    await limit(async () => {
      const concurrentSync = new Map<string, WorkspaceSyncBaseline>();
      activeAsyncBaselineWrites.set(target, concurrentSync);
      try {
        const store = await readStoreAsync(settingsRoot);
        store.projects[id] = {
          rootPath: path.resolve(baseline.rootPath),
          revision: baseline.revision,
          contentHash: baseline.contentHash,
        };
        for (const [syncId, syncBaseline] of concurrentSync) store.projects[syncId] = syncBaseline;
        concurrentSync.clear();
        for (;;) {
          await writeJsonFileAtomicAsync(target, store);
          if (concurrentSync.size === 0) break;
          for (const [syncId, syncBaseline] of concurrentSync) store.projects[syncId] = syncBaseline;
          concurrentSync.clear();
        }
      } finally {
        activeAsyncBaselineWrites.delete(target);
      }
    });
  } finally {
    if (baselineAsyncQueues.get(target) === limit && limit.activeCount === 0 && limit.pendingCount === 0) {
      baselineAsyncQueues.delete(target);
    }
  }
}
