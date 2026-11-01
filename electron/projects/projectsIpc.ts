// 项目仓库域的 IPC 注册器（2026-08-26 从 main.ts 抽出：main.ts 顶到 800 行门岗上限，
// 而这一族本来就是同一个主题——项目记录的增删改查 + 诊断/恢复，放一起比散在巨壳里清楚）。
//
// 同步（registerSyncIpc）与异步（ipcMain.handle）两套并存是既有约定：渲染层在启动早期
// 需要同步读项目清单，其余路径走异步。异步这几条全部经 assertTrustedSender——项目记录
// 是用户数据的真相源，写入口不能对非主窗口内容开放。
import { ipcMain } from "electron";

import { sweepAbandonedUploadStaging } from "../assets/scratchCleanup";
import { assertTrustedSender } from "../ipcSenderGuard";
import { projectDirById } from "./repository";
import { measureProjectOpenMainStageSync } from "./projectOpenTimeline";
import { applyCanvasNodePatch } from "./projectCanvasWrite";
import type { ProjectBinding } from "../shared/projectBinding";

import { logError } from '../logging/logger'
import { projectSaveFailure, type ProjectSaveFailure } from '../shared/contracts/projectSaveFailure'
import type { IpcResult } from '../shared/contracts/ipcResult'

type RegisterSyncIpc = (channel: string, handler: (...args: never[]) => unknown) => void;

export type ProjectsIpcDeps = {
  registerSyncIpc: RegisterSyncIpc;
  listProjects: () => Promise<unknown>;
  createProject: (record: unknown) => unknown;
  readProject: (projectId: string) => unknown;
  saveProject: (projectId: string, record: unknown) => unknown;
  /** intent 来自渲染层确认框，未经校验（主进程 deleteProject 自己核，缺失 / 不认识即拒绝）。 */
  deleteProject: (projectId: string, intent: unknown) => Promise<unknown>;
  diagnoseProject: (projectId: string) => unknown;
  recoverProject: (projectId: string) => unknown;
};

/**
 * 打开项目时顺手收上一个进程留下的生成 / 上传暂存（`.nomi-upload-*`，V-1208-6）：放到下一轮事件循环、异步做，
 * 不挡打开；扫的判据（主人进程已不在才收）在 scratchCleanup。
 */
export function sweepProjectUploadStagingSoon(projectId: string, resolveRoot: (projectId: string) => string | null = projectDirById): void {
  setImmediate(() => {
    try {
      const root = projectId ? resolveRoot(projectId) : null;
      if (root) void sweepAbandonedUploadStaging(root);
    } catch {
      // 打开项目不因收尾失败；下次打开 / 导入再收。
    }
  });
}

export function registerProjectsIpc(deps: ProjectsIpcDeps): void {
  const {
    registerSyncIpc,
    listProjects,
    createProject,
    readProject,
    saveProject,
    deleteProject,
    diagnoseProject,
    recoverProject,
  } = deps;

  // 项目列表只有这一条读口，且是异步的：没有同步版（sendSync 会让渲染层干等主进程扫完全库）。
  ipcMain.handle("nomi:projects:list-async", (event) => {
    assertTrustedSender(event);
    return listProjects();
  });
  registerSyncIpc("nomi:projects:create", ((record: unknown) => {
    if (record && typeof record === "object" && typeof (record as { rootPath?: unknown }).rootPath === "string") {
      throw new Error("Use nomi:workspace:open-folder to create or open folder-backed projects");
    }
    return createProject(record);
  }) as (...args: never[]) => unknown);
  registerSyncIpc("nomi:projects:read", readProject as (...args: never[]) => unknown);
  ipcMain.handle("nomi:projects:read-async", (event, projectId: unknown) => {
    assertTrustedSender(event);
    const id = String(projectId || "");
    const record = measureProjectOpenMainStageSync("read-project", () => readProject(id));
    sweepProjectUploadStagingSoon(id);
    return record;
  });
  ipcMain.handle("nomi:projects:diagnose", (event, projectId: unknown) => {
    assertTrustedSender(event);
    return diagnoseProject(String(projectId || ""));
  });
  ipcMain.handle("nomi:projects:recover", (event, projectId: unknown) => {
    assertTrustedSender(event);
    return recoverProject(String(projectId || ""));
  });
  ipcMain.handle("nomi:projects:save-async", async (event, projectId: unknown, record: unknown): Promise<IpcResult<unknown, ProjectSaveFailure>> => {
    let stage: ProjectSaveFailure['stage'] = 'authorize'
    try {
      assertTrustedSender(event)
      stage = 'save-project'
      return { ok: true, value: await saveProject(String(projectId || ""), record) }
    } catch (error) {
      const reason = projectSaveFailure(error, stage)
      logError('workspace', 'project-save-rejected', undefined, { channel: 'nomi:projects:save-async', reason: reason.kind, code: reason.code, errno: reason.errno, syscall: reason.syscall, stage: reason.stage })
      return { ok: false, error: 'project-save-failed', reason }
    }
  });
  ipcMain.handle("nomi:projects:apply-canvas-node-patch", (event, input: unknown) => {
      assertTrustedSender(event);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid canvas node patch");
      const value = input as Record<string, unknown>;
      const projectId = typeof value.projectId === "string" ? value.projectId : "";
      const nodeId = typeof value.nodeId === "string" ? value.nodeId : "";
      const patch = value.patch && typeof value.patch === "object" && !Array.isArray(value.patch)
        ? value.patch as Record<string, unknown>
        : null;
      if (!projectId || !nodeId || !patch) throw new Error("Invalid canvas node patch");
      return applyCanvasNodePatch({ projectId, nodeId, patch, expectedBinding: value.expectedBinding as ProjectBinding | undefined });
    });
  // 删除是异步的：项目文件夹要进系统回收站（shell.trashItem，⑭）。原来的同步通道（sendSync 等删完）同一提交删掉。
  ipcMain.handle("nomi:projects:delete", (event, projectId: unknown, intent: unknown) => {
    assertTrustedSender(event);
    return deleteProject(String(projectId || ""), intent);
  });
}
