import { dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertTrustedSender } from "../ipcSenderGuard";
import { ensureDir, getProjectLocationState, type ProjectLocationState } from "../runtimePaths";
import { backfillWorkspaceOrigins } from "../workspace/workspaceRegistry";
import { writeProjectsRoot } from "./projectLocationSettings";
import { getSettingsRoot } from "./settingsRoot";

export type ProjectLocationError =
  | "not-directory"
  | "not-writable"
  | "open-failed"
  | "managed-by-environment";

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

function ensureProjectLocationDirectory(rootPath: string): ProjectLocationError | null {
  const resolved = path.resolve(rootPath);
  try {
    if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) return "not-directory";
    ensureDir(resolved);
    return fs.statSync(resolved).isDirectory() ? null : "not-directory";
  } catch {
    return "not-writable";
  }
}

export function getProjectLocationResponse(): ProjectLocationResult {
  return { ok: true, location: getProjectLocationState() };
}

export function checkProjectLocation(): ProjectLocationResult {
  const location = getProjectLocationState();
  const validationError = validateProjectLocationRoot(location.path);
  return validationError ? { ok: false, error: validationError } : { ok: true, location };
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
  const validationError = ensureProjectLocationDirectory(location.path);
  if (validationError) return { ok: false, error: validationError };

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
