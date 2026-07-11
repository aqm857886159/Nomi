import { ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceFilePath } from "./workspaceFileIndex";

type ProjectReader = (projectId: string) => unknown | null;

export function registerWorkspaceFileDeleteIpc({ readProject }: { readProject: ProjectReader }): void {
  ipcMain.handle("nomi:workspace:delete-files", async (_event, payload) => {
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    const rawRelativePaths = (payload as { relativePaths?: unknown } | null)?.relativePaths;
    const relativePaths = Array.isArray(rawRelativePaths)
      ? [...new Set(rawRelativePaths.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
    if (!projectId) throw new Error("projectId is required");
    if (!relativePaths.length) return { ok: true, deletedCount: 0, failedCount: 0 };

    const project = readProject(projectId) as { lastKnownRootPath?: unknown } | null;
    const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
    if (!rootPath) throw new Error("Project folder is unavailable");

    let deletedCount = 0;
    let failedCount = 0;
    for (const relativePath of relativePaths) {
      try {
        const absolutePath = resolveWorkspaceFilePath(rootPath, relativePath);
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) throw new Error("Only files can be deleted");
        await shell.trashItem(absolutePath);
        const metaPath = `${absolutePath}.meta`;
        if (fs.existsSync(metaPath)) {
          await shell.trashItem(metaPath).catch(() => fs.rmSync(metaPath, { force: true }));
        }
        deletedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    return { ok: failedCount === 0, deletedCount, failedCount };
  });
}
