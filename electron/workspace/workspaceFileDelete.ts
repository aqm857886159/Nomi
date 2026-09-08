import { ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { assertTrustedUiSender } from "../ipcSenderGuard";
import { resolveWorkspaceFilePath } from "./workspaceFileIndex";

type ProjectReader = (projectId: string) => unknown | null;

export function registerWorkspaceFileDeleteIpc({ readProject }: { readProject: ProjectReader }): void {
  // 破坏性：把用户项目里的文件扔进废纸篓。只认 Nomi 自有 UI 面——素材盒浮层窗的右键删除
  // 也走这条（用户点了确认弹窗却收到权限错误，是这类里最难看的一种）。远端网页仍够不到：
  // 它是无 preload 的 WebContentsView，不隶属任何登记窗口。
  ipcMain.handle("nomi:workspace:delete-files", async (event, payload) => {
    assertTrustedUiSender(event);
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
