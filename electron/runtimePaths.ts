// 运行时基础设施层 —— 路径 / 目录 / JSON 读取的共享地基（见
// docs/plan/2026-06-04-runtime-split-execution.md）。projects / assets / catalog /
// skills 等域都依赖这一层；先抽出来才能解开它们之间的循环依赖。
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { WorkspaceRepositoryDeps } from "./workspace/workspaceRepository";

export const PROJECT_FILE = "project.json";
export const PROJECT_ROOT_ENV = "NOMI_PROJECTS_DIR";
export const CATALOG_FILE = "model-catalog.json";
export const SKILLS_ROOT_ENV = "NOMI_SKILLS_DIR";
/** 评测/测试隔离:覆盖 settings 根(catalog + workspace 注册表),防 eval 临时项目污染全局状态。 */
export const SETTINGS_ROOT_ENV = "NOMI_SETTINGS_DIR";

export function getProjectsRoot(): string {
  const configured = String(process.env[PROJECT_ROOT_ENV] || "").trim();
  return configured || path.join(app.getPath("documents"), "Nomi Projects");
}

export function getSettingsRoot(): string {
  const configured = String(process.env[SETTINGS_ROOT_ENV] || "").trim();
  return configured || app.getPath("userData");
}

export function getWorkspaceRepositoryDeps(): WorkspaceRepositoryDeps {
  return {
    settingsRoot: getSettingsRoot(),
    defaultProjectsRoot: getProjectsRoot(),
  };
}

export function getSkillsRoots(): string[] {
  const candidates = [
    String(process.env[SKILLS_ROOT_ENV] || "").trim(),
    path.join(process.cwd(), "skills"),
    path.join(app.getAppPath(), "skills"),
    path.join(__dirname, "../skills"),
    path.join(process.resourcesPath || "", "skills"),
  ].filter(Boolean);
  return Array.from(new Set(candidates.map((item) => path.resolve(item))));
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
