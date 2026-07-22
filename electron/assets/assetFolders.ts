// 素材文件夹（素材面收敛 2026-07-22 转正）：per-project 落盘 `.nomi/folders.json`。
// 前身是素材盒的 localStorage 私账（清缓存即丢、别的面看不见、按 projectId||'global' 分桶分裂）；
// 转正后随项目走、素材库为唯一消费者。范式照 memory/projectMemory.ts（resolver 可注入供单测）。
// 归属键 = 素材 renderUrl（素材池双源的去重身份，画布节点/落盘文件两视图通用）。
import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";

export type AssetFolder = {
  id: string;
  label: string;
  order: number;
};

export type AssetFoldersState = {
  version: 1;
  folders: AssetFolder[];
  /** 素材 renderUrl → folderId（不认识的 folderId 读取时清洗掉）。 */
  assignments: Record<string, string>;
};

export const EMPTY_ASSET_FOLDERS_STATE: AssetFoldersState = { version: 1, folders: [], assignments: {} };

let projectDirResolver: (projectId: string) => string | null = (projectId) =>
  resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());

export function setAssetFoldersDirResolverForTests(resolver: (projectId: string) => string | null): void {
  projectDirResolver = resolver;
}

function foldersFilePath(projectId: string): string | null {
  const root = projectDirResolver(projectId);
  if (!root) return null;
  return path.join(root, ".nomi", "folders.json");
}

export function normalizeAssetFoldersState(input: unknown): AssetFoldersState {
  if (!input || typeof input !== "object") return { ...EMPTY_ASSET_FOLDERS_STATE };
  const raw = input as { folders?: unknown; assignments?: unknown };
  const folders: AssetFolder[] = Array.isArray(raw.folders)
    ? raw.folders
        .filter((folder): folder is { id: unknown; label: unknown; order?: unknown } => Boolean(folder) && typeof folder === "object")
        .map((folder, index) => ({
          id: String(folder.id ?? "").trim(),
          label: String(folder.label ?? "").trim(),
          order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : index,
        }))
        .filter((folder) => folder.id && folder.label)
    : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const assignments: Record<string, string> = {};
  if (raw.assignments && typeof raw.assignments === "object") {
    for (const [key, value] of Object.entries(raw.assignments as Record<string, unknown>)) {
      if (key && typeof value === "string" && folderIds.has(value)) assignments[key] = value;
    }
  }
  folders.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return { version: 1, folders, assignments };
}

export function getAssetFolders(payload: { projectId?: unknown }): { ok: boolean; state: AssetFoldersState; error?: string } {
  const projectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
  if (!projectId) return { ok: false, state: { ...EMPTY_ASSET_FOLDERS_STATE }, error: "projectId required" };
  const file = foldersFilePath(projectId);
  // 项目定位不到（已删/global 桶）≠「还没建过文件夹」：前者 ok:false（迁移器据此判无家可归），
  // 后者 ok:true 空态（正常首用）。
  if (!file) return { ok: false, state: { ...EMPTY_ASSET_FOLDERS_STATE }, error: "project dir not found" };
  if (!fs.existsSync(file)) return { ok: true, state: { ...EMPTY_ASSET_FOLDERS_STATE } };
  try {
    return { ok: true, state: normalizeAssetFoldersState(JSON.parse(fs.readFileSync(file, "utf8"))) };
  } catch {
    // 文件损坏按空态返回（不炸面板）；下次保存会重建。
    return { ok: true, state: { ...EMPTY_ASSET_FOLDERS_STATE } };
  }
}

export function saveAssetFolders(payload: { projectId?: unknown; state?: unknown }): { ok: boolean; state: AssetFoldersState; error?: string } {
  const projectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
  if (!projectId) return { ok: false, state: { ...EMPTY_ASSET_FOLDERS_STATE }, error: "projectId required" };
  const file = foldersFilePath(projectId);
  if (!file) return { ok: false, state: { ...EMPTY_ASSET_FOLDERS_STATE }, error: "project dir not found" };
  const state = normalizeAssetFoldersState(payload?.state);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
    return { ok: true, state };
  } catch (error) {
    return { ok: false, state, error: error instanceof Error ? error.message : String(error) };
  }
}
