import { ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { readProject } from "../../projects/repository";
import { workspaceNomiDir } from "../../workspace/workspacePaths";

const SETTINGS_FILE_NAME = "browser-prompt-extraction.json";

function browserPromptExtractionSettingsFile(projectId: string): string {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("projectId is required");
  const project = readProject(id) as { lastKnownRootPath?: unknown } | null;
  const rootPath = typeof project?.lastKnownRootPath === "string" ? path.resolve(project.lastKnownRootPath) : "";
  if (!rootPath) throw new Error("Project folder is unavailable");
  const dir = workspaceNomiDir(rootPath);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, SETTINGS_FILE_NAME);
}

function normalizeSettingsPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("settings must be an object");
  }
  return value as Record<string, unknown>;
}

function writeJsonAtomic(filePath: string, payload: Record<string, unknown>): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function registerBrowserPromptExtractionSettingsIpc(): void {
  ipcMain.handle("browser:prompt-extraction-settings:read", async (_event, payload: { projectId?: unknown }) => {
    const filePath = browserPromptExtractionSettingsFile(String(payload?.projectId || ""));
    if (!fs.existsSync(filePath)) return { ok: true, settings: null };
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, settings: normalizeSettingsPayload(JSON.parse(raw)) };
  });

  ipcMain.handle("browser:prompt-extraction-settings:write", async (_event, payload: { projectId?: unknown; settings?: unknown }) => {
    const filePath = browserPromptExtractionSettingsFile(String(payload?.projectId || ""));
    const settings = normalizeSettingsPayload(payload?.settings);
    writeJsonAtomic(filePath, settings);
    return { ok: true, settings };
  });
}
