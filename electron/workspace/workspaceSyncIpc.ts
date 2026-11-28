import { ipcMain, shell } from "electron";
import path from "node:path";
import { assertTrustedSender } from "../ipcSenderGuard";
import { getSettingsRoot } from "../settings/settingsRoot";
import pLimit from "p-limit";
import type { WorkspaceSyncInspection } from "../shared/workspaceSyncContracts";
import { listRegisteredWorkspaceRoots } from "./workspaceRegistry";
import { inspectWorkspaceSync, quarantineWorkspaceConflict } from "./workspaceSync";
import { readWorkspaceSyncBaseline, writeWorkspaceSyncBaseline } from "./workspaceSyncBaseline";

type ProjectLookup = (projectId: string) => unknown | Promise<unknown>;

/** 批量检查同时在飞的项目数。每个项目内部还有素材探测（workspaceSync 里另有进程级上限）。 */
export const SYNC_INSPECT_BATCH_CONCURRENCY = 2;

/**
 * 查一个项目的同步状态；单个「重新检查」与批量共用这一份（含「首次检查记下基线 / 用户确认时采纳新版本」）。
 */
export async function inspectProjectSync(
  settingsRoot: string,
  id: string,
  rootPath: string,
  adopt: boolean,
  inspect: typeof inspectWorkspaceSync = inspectWorkspaceSync,
): Promise<WorkspaceSyncInspection> {
  const baseline = readWorkspaceSyncBaseline(settingsRoot, id, rootPath);
  const inspection = await inspect(rootPath, id, baseline ? { revision: baseline.revision, contentHash: baseline.contentHash } : undefined);
  if ((baseline === null || adopt) && inspection.observedRevision !== null && inspection.contentHash) {
    writeWorkspaceSyncBaseline(settingsRoot, id, { rootPath, revision: inspection.observedRevision, contentHash: inspection.contentHash });
    // Adoption is an explicit acknowledgement: re-read against the new
    // baseline so the UI reflects the state the user just accepted.
    return inspect(rootPath, id, undefined);
  }
  return inspection;
}

/**
 * 项目库卡片的批量状态检查：限并发地逐个查，查不了的（没登记 / 文件夹没了 / 读失败）返回 null——
 * 卡片据此「不显示徽标」，而不是显示一个错的状态。结果以 id 为键一次性回给渲染层。
 */
export async function inspectProjectsSyncBatch(
  settingsRoot: string,
  projectIds: readonly string[],
  deps: {
    rootPathOf: (projectId: string) => string | null;
    inspect?: typeof inspectWorkspaceSync;
    concurrency?: number;
  },
): Promise<Record<string, WorkspaceSyncInspection | null>> {
  const limit = pLimit(deps.concurrency ?? SYNC_INSPECT_BATCH_CONCURRENCY);
  const ids = [...new Set(projectIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const entries = await Promise.all(
    ids.map((id) =>
      limit(async (): Promise<readonly [string, WorkspaceSyncInspection | null]> => {
        const rootPath = deps.rootPathOf(id);
        if (!rootPath) return [id, null];
        try {
          return [id, await inspectProjectSync(settingsRoot, id, rootPath, false, deps.inspect)];
        } catch {
          return [id, null];
        }
      }),
    ),
  );
  return Object.fromEntries(entries);
}

export function registerWorkspaceSyncIpc(deps: { readProject: ProjectLookup }): void {
  ipcMain.handle("nomi:workspace:sync-inspect", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const id = typeof payload === "object" && payload !== null
      ? String((payload as { projectId?: unknown }).projectId || "").trim()
      : String(payload || "").trim();
    const adopt = typeof payload === "object" && payload !== null && (payload as { adopt?: unknown }).adopt === true;
    if (!id) throw new Error("projectId is required");
    const project = (await deps.readProject(id)) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    return inspectProjectSync(getSettingsRoot(), id, rootPath, adopt);
  });

  ipcMain.handle("nomi:workspace:sync-inspect-many", async (event, projectIds: unknown) => {
    assertTrustedSender(event);
    const ids = Array.isArray(projectIds) ? projectIds.map((id) => String(id || "")) : [];
    const settingsRoot = getSettingsRoot();
    const roots = listRegisteredWorkspaceRoots(settingsRoot);
    return inspectProjectsSyncBatch(settingsRoot, ids, { rootPathOf: (id) => roots.get(id) ?? null });
  });

  ipcMain.handle("nomi:workspace:sync-reveal", async (event, projectId: unknown) => {
    assertTrustedSender(event);
    const id = String(projectId || "").trim();
    if (!id) throw new Error("projectId is required");
    const project = (await deps.readProject(id)) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    void shell.openPath(rootPath);
    return { ok: true };
  });

  ipcMain.handle("nomi:workspace:sync-copy-conflict", async (event, payload: unknown) => {
    assertTrustedSender(event);
    const id = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    const source = (payload as { source?: unknown } | null)?.source === "local" ? "local" : "remote";
    if (!id) throw new Error("projectId is required");
    const project = (await deps.readProject(id)) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    return { path: quarantineWorkspaceConflict(rootPath, source) };
  });
}
