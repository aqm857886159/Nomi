import { ipcMain, shell } from "electron";
import path from "node:path";
import { assertTrustedSender } from "../ipcSenderGuard";
import { getSettingsRoot } from "../settings/settingsRoot";
import { inspectWorkspaceSync, quarantineWorkspaceConflict } from "./workspaceSync";
import { readWorkspaceSyncBaseline, writeWorkspaceSyncBaseline } from "./workspaceSyncBaseline";

type ProjectLookup = (projectId: string) => unknown;

export function registerWorkspaceSyncIpc(deps: { readProject: ProjectLookup }): void {
  ipcMain.handle("nomi:workspace:sync-inspect", (event, payload: unknown) => {
    assertTrustedSender(event);
    const id = typeof payload === "object" && payload !== null
      ? String((payload as { projectId?: unknown }).projectId || "").trim()
      : String(payload || "").trim();
    const adopt = typeof payload === "object" && payload !== null && (payload as { adopt?: unknown }).adopt === true;
    if (!id) throw new Error("projectId is required");
    const project = deps.readProject(id) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    const settingsRoot = getSettingsRoot();
    const baseline = readWorkspaceSyncBaseline(settingsRoot, id, rootPath);
    const inspection = inspectWorkspaceSync(rootPath, baseline ? { revision: baseline.revision, contentHash: baseline.contentHash } : undefined);
    if ((baseline === null || adopt) && inspection.observedRevision !== null && inspection.contentHash) {
      writeWorkspaceSyncBaseline(settingsRoot, id, { rootPath, revision: inspection.observedRevision, contentHash: inspection.contentHash });
      // Adoption is an explicit acknowledgement: re-read against the new
      // baseline so the UI reflects the state the user just accepted.
      return inspectWorkspaceSync(rootPath, undefined);
    }
    return inspection;
  });

  ipcMain.handle("nomi:workspace:sync-reveal", (event, projectId: unknown) => {
    assertTrustedSender(event);
    const id = String(projectId || "").trim();
    if (!id) throw new Error("projectId is required");
    const project = deps.readProject(id) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    void shell.openPath(rootPath);
    return { ok: true };
  });

  ipcMain.handle("nomi:workspace:sync-copy-conflict", (event, payload: unknown) => {
    assertTrustedSender(event);
    const id = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    const source = (payload as { source?: unknown } | null)?.source === "local" ? "local" : "remote";
    if (!id) throw new Error("projectId is required");
    const project = deps.readProject(id) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    return { path: quarantineWorkspaceConflict(rootPath, source) };
  });
}
