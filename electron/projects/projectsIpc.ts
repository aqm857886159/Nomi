// 项目仓库域的 IPC 注册器（2026-08-26 从 main.ts 抽出：main.ts 顶到 800 行门岗上限，
// 而这一族本来就是同一个主题——项目记录的增删改查 + 诊断/恢复，放一起比散在巨壳里清楚）。
//
// 同步（registerSyncIpc）与异步（ipcMain.handle）两套并存是既有约定：渲染层在启动早期
// 需要同步读项目清单，其余路径走异步。异步这几条全部经 assertTrustedSender——项目记录
// 是用户数据的真相源，写入口不能对非主窗口内容开放。
import { ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";

type RegisterSyncIpc = (channel: string, handler: (...args: never[]) => unknown) => void;

export type ProjectsIpcDeps = {
  registerSyncIpc: RegisterSyncIpc;
  listProjects: () => unknown;
  createProject: (record: unknown) => unknown;
  readProject: (projectId: string) => unknown;
  saveProject: (projectId: string, record: unknown) => unknown;
  deleteProject: (projectId: string) => unknown;
  diagnoseProject: (projectId: string) => unknown;
  recoverProject: (projectId: string) => unknown;
};

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

  registerSyncIpc("nomi:projects:list", listProjects as (...args: never[]) => unknown);
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
    return readProject(String(projectId || ""));
  });
  ipcMain.handle("nomi:projects:diagnose", (event, projectId: unknown) => {
    assertTrustedSender(event);
    return diagnoseProject(String(projectId || ""));
  });
  ipcMain.handle("nomi:projects:recover", (event, projectId: unknown) => {
    assertTrustedSender(event);
    return recoverProject(String(projectId || ""));
  });
  registerSyncIpc("nomi:projects:save", saveProject as (...args: never[]) => unknown);
  ipcMain.handle("nomi:projects:save-async", (event, projectId: unknown, record: unknown) => {
    assertTrustedSender(event);
    return saveProject(String(projectId || ""), record);
  });
  registerSyncIpc("nomi:projects:delete", deleteProject as (...args: never[]) => unknown);
}
