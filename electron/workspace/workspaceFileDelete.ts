import { requestRenderer } from '../capabilityCore/rendererBridge'
import { ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { assertTrustedSender, assertTrustedUiSender } from "../ipcSenderGuard";
import { resolveWorkspaceFilePath } from "./workspaceFileIndex";
import { broadcastAssetsUpdated } from "../assets/assetEvents";
import type { ChildWindowProjectIssuer } from "../assets/projectInteractionCapture";

type ProjectReader = (projectId: string) => unknown | null;

export function registerWorkspaceFileDeleteIpc({ readProject, childWindowProject }: { readProject: ProjectReader; childWindowProject: ChildWindowProjectIssuer }): void {
  // Child UI expresses deletion intent; the main renderer owns reference planning and undo.
  ipcMain.handle("nomi:workspace:delete-assets", async (event, payload) => {
    assertTrustedUiSender(event);
    const raw = payload as { projectId?: unknown; relativePaths?: unknown } | null;
    const projectId = typeof raw?.projectId === 'string' ? raw.projectId.trim() : '';
    const relativePaths = Array.isArray(raw?.relativePaths) ? [...new Set(raw.relativePaths.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => value.trim()))] : [];
    if (!projectId) throw new Error('projectId is required');
    const child = childWindowProject(event.sender);
    if (child && child.binding.projectId !== projectId) throw new Error('project_binding_stale');
    child?.assertCurrent();
    return requestRenderer('assets.delete-files', { projectId, relativePaths, ...(child ? { projectBinding: child.binding } : {}) }, 30_000);
  });
  // Physical trash accepts only the main UI. Child windows must use the domain command above.
  ipcMain.handle("nomi:workspace:delete-files", async (event, payload) => {
    assertTrustedSender(event);
    const projectId = String((payload as { projectId?: unknown } | null)?.projectId || "").trim();
    const rawRelativePaths = (payload as { relativePaths?: unknown } | null)?.relativePaths;
    const relativePaths = Array.isArray(rawRelativePaths)
      ? [...new Set(rawRelativePaths.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
    if (!projectId) throw new Error("projectId is required");
    // 素材盒浮层窗没有自己的项目会话：只能删父窗口此刻已提交的那个项目里的文件，随父会话一起失效。
    const child = childWindowProject(event.sender);
    if (child && child.binding.projectId !== projectId) throw Object.assign(new Error("project_binding_stale"), { code: "project_binding_stale" });
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
        child?.assertCurrent();
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

    // 删文件也是素材写入：和落盘一样广播，素材库两个页签、「所有项目」那份清单都靠这一个信号刷新。
    // 以前只有写入广播、删除不广播，各调用方删完自己手动重拉；延后真删（撤销窗口过后）没人重拉，
    // 列表就一直挂着一个已经进了回收站的文件（2026-10-24）。
    if (deletedCount > 0) broadcastAssetsUpdated(projectId);
    return { ok: failedCount === 0, deletedCount, failedCount };
  });
}
