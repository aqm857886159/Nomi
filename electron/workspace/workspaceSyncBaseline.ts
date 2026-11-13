import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
import type { SyncSharingRetryOptions } from "../sharingRetry";

const SCHEMA_VERSION = 1;
const BASELINE_FILE = "workspace-sync-baseline.json";

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

function readStore(settingsRoot: string): BaselineStore {
  try {
    const raw = readJsonFile(baselinePath(settingsRoot)) as Partial<BaselineStore>;
    if (raw.schemaVersion !== SCHEMA_VERSION || !raw.projects || typeof raw.projects !== "object") {
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
  } catch {
    return { schemaVersion: SCHEMA_VERSION, projects: {} };
  }
}

export function readWorkspaceSyncBaseline(settingsRoot: string, projectId: string, rootPath: string): WorkspaceSyncBaseline | null {
  const baseline = readStore(settingsRoot).projects[String(projectId || "").trim()];
  if (!baseline || baseline.rootPath !== path.resolve(rootPath)) return null;
  return baseline;
}

/** `noWait`：保存提交之后的后台补写显式传，撞上占用不原地睡、立即抛，由调用方用定时器再来。其余调用方不传，行为逐字不变。 */
export function writeWorkspaceSyncBaseline(
  settingsRoot: string,
  projectId: string,
  baseline: WorkspaceSyncBaseline,
  options: SyncSharingRetryOptions = {},
): void {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("projectId is required");
  const store = readStore(settingsRoot);
  store.projects[id] = { rootPath: path.resolve(baseline.rootPath), revision: baseline.revision, contentHash: baseline.contentHash };
  writeJsonFileAtomic(baselinePath(settingsRoot), store, options);
}
