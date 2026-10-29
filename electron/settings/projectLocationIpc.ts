import { dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertTrustedSender } from "../ipcSenderGuard";
import { ensureDir, getProjectLocationState, type ProjectLocationSource, type ProjectLocationState } from "../runtimePaths";
import { findAppOwnedLocation } from "../workspace/workspaceLocationPolicy";
import { backfillWorkspaceOrigins } from "../workspace/workspaceRegistry";
import { writeProjectsRoot } from "./projectLocationSettings";
import { getSettingsRoot } from "./settingsRoot";

export type ProjectLocationError =
  | "not-directory"
  | "not-writable"
  | "open-failed"
  | "managed-by-environment"
  /** 在 Nomi 自己的目录里（安装目录 / 应用数据 / 系统临时目录）：升级、卸载或系统清理会把项目删掉。 */
  | "inside-app"
  /** 文件夹现在不存在（检查 / 打开只报、不建）。 */
  | "missing";

export type ProjectLocationResult =
  | { ok: true; location: ProjectLocationState; canceled?: boolean }
  | { ok: false; error: ProjectLocationError };

type PickerResult = { canceled: boolean; filePaths: string[] };
type ValidateRoot = (rootPath: string) => ProjectLocationError | null;

export type ProjectLocationPickerDeps = {
  showOpenDialog: (options: OpenDialogOptions) => Promise<PickerResult>;
  validateRoot?: ValidateRoot;
};

export type ProjectLocationRevealDeps = {
  openPath: (rootPath: string) => Promise<string>;
};

export function validateProjectLocationRoot(rootPath: string): ProjectLocationError | null {
  const resolved = path.resolve(rootPath);
  let probePath = "";
  let probeFd: number | undefined;
  try {
    if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) return "not-directory";
    ensureDir(resolved);
    if (!fs.statSync(resolved).isDirectory()) return "not-directory";
    probePath = path.join(
      resolved,
      `.nomi-write-probe-${process.pid}-${crypto.randomUUID()}`,
    );
    probeFd = fs.openSync(probePath, "wx");
    fs.closeSync(probeFd);
    probeFd = undefined;
    fs.unlinkSync(probePath);
    probePath = "";
    return null;
  } catch {
    return "not-writable";
  } finally {
    if (probeFd !== undefined) {
      try {
        fs.closeSync(probeFd);
      } catch {
        // 校验失败，保留原设置；清理继续尽力而为。
      }
    }
    if (probePath) {
      try {
        fs.unlinkSync(probePath);
      } catch {
        // probe 未成功创建或目录已不可访问。
      }
    }
  }
}

/** 文件夹在不在、是不是文件夹：只 stat，不建。 */
function statProjectLocation(resolved: string): ProjectLocationError | null {
  try {
    return fs.statSync(resolved).isDirectory() ? null : "not-directory";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "not-writable";
  }
}

/**
 * 「检查目录」只报、不建、不写（「项目在哪」收敛单第 7 条）：以前它先建目录再写一个探针文件，升级清掉安装目录后
 * 点一次「检查」就把空的默认根建回来，列表随后把整库灰卡当成「用户删了」摘掉。
 * 可写用 access(W_OK) 判：Windows 上它不看 ACL（Node 文档写明的限制），真写不进去在新建项目时报。
 * 环境变量托管的位置不判应用目录（见 workspaceLocationPolicy 文件头）。
 */
export function inspectProjectLocationRoot(rootPath: string, source: ProjectLocationSource): ProjectLocationError | null {
  const resolved = path.resolve(rootPath);
  if (source !== "environment" && findAppOwnedLocation(resolved)) return "inside-app";
  const statError = statProjectLocation(resolved);
  if (statError) return statError;
  try {
    fs.accessSync(resolved, fs.constants.W_OK);
    return null;
  } catch {
    return "not-writable";
  }
}

export function getProjectLocationResponse(): ProjectLocationResult {
  return { ok: true, location: getProjectLocationState() };
}

export function checkProjectLocation(): ProjectLocationResult {
  const location = getProjectLocationState();
  const inspectionError = inspectProjectLocationRoot(location.path, location.source);
  return inspectionError ? { ok: false, error: inspectionError } : { ok: true, location };
}

export async function pickProjectLocation(
  deps: ProjectLocationPickerDeps = {
    showOpenDialog: (options) => dialog.showOpenDialog(options),
  },
): Promise<ProjectLocationResult> {
  const current = getProjectLocationState();
  if (current.source === "environment") return { ok: false, error: "managed-by-environment" };

  const result = await deps.showOpenDialog({
    defaultPath: current.path,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: true, canceled: true, location: current };
  }

  const selectedRoot = path.resolve(result.filePaths[0]);
  // 先判是不是 Nomi 自己的目录（这一步不经可注入的 validateRoot，入口拒绝不能被绕开），再建目录、试写。
  if (findAppOwnedLocation(selectedRoot)) return { ok: false, error: "inside-app" };
  const validationError = (deps.validateRoot || validateProjectLocationRoot)(selectedRoot);
  if (validationError) return { ok: false, error: validationError };

  backfillWorkspaceOrigins(getSettingsRoot(), current.path);
  writeProjectsRoot(selectedRoot);
  return getProjectLocationResponse();
}

export function resetProjectLocation(): ProjectLocationResult {
  const current = getProjectLocationState();
  if (current.source === "environment") {
    return { ok: false, error: "managed-by-environment" };
  }
  backfillWorkspaceOrigins(getSettingsRoot(), current.path);
  writeProjectsRoot(null);
  return getProjectLocationResponse();
}

export async function revealProjectLocation(
  deps: ProjectLocationRevealDeps = { openPath: (rootPath) => shell.openPath(rootPath) },
): Promise<ProjectLocationResult> {
  const location = getProjectLocationState();
  // 「打开位置」只打开、不建（收敛单第 7 条）：文件夹不在就照实说。
  const statError = statProjectLocation(path.resolve(location.path));
  if (statError) return { ok: false, error: statError };

  try {
    const openError = await deps.openPath(location.path);
    return openError ? { ok: false, error: "open-failed" } : { ok: true, location };
  } catch {
    return { ok: false, error: "open-failed" };
  }
}

export function registerProjectLocationIpc(): void {
  // 这四条决定「项目库落在磁盘哪里」并能弹原生目录选择器 / 用 shell 打开目录：
  // 全是文件系统作用域，非主窗口内容不得触碰。
  ipcMain.handle("nomi:settings:project-location-get", (event) => {
    assertTrustedSender(event);
    return getProjectLocationResponse();
  });
  ipcMain.handle("nomi:settings:project-location-check", (event) => {
    assertTrustedSender(event);
    return checkProjectLocation();
  });
  ipcMain.handle("nomi:settings:project-location-pick", (event) => {
    assertTrustedSender(event);
    return pickProjectLocation();
  });
  ipcMain.handle("nomi:settings:project-location-reset", (event) => {
    assertTrustedSender(event);
    return resetProjectLocation();
  });
  ipcMain.handle("nomi:settings:project-location-reveal", (event) => {
    assertTrustedSender(event);
    return revealProjectLocation();
  });
}
