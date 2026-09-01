import { ipcMain, shell } from "electron";
import path from "node:path";
import { assertTrustedSender } from "../ipcSenderGuard";
import { inspectWorkspaceSync, quarantineWorkspaceConflict } from "./workspaceSync";

type ProjectLookup = (projectId: string) => unknown;

export function registerWorkspaceSyncIpc(deps: { readProject: ProjectLookup }): void {
  ipcMain.handle("nomi:workspace:sync-inspect", (event, projectId: unknown) => {
    assertTrustedSender(event);
    const id = String(projectId || "").trim();
    if (!id) throw new Error("projectId is required");
    const project = deps.readProject(id) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");
    return inspectWorkspaceSync(rootPath);
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
