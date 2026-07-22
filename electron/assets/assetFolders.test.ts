// 素材文件夹落盘 store 专项测试（素材面收敛 2026-07-22 转正）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAssetFolders,
  normalizeAssetFoldersState,
  saveAssetFolders,
  setAssetFoldersDirResolverForTests,
} from "./assetFolders";

const tempRoots: string[] = [];
let projectRoot = "";

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-assetfolders-"));
  tempRoots.push(projectRoot);
  setAssetFoldersDirResolverForTests((projectId) => (projectId === "proj-a" ? projectRoot : null));
});

afterEach(() => {
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("assetFolders · per-project .nomi/folders.json", () => {
  it("save → get 落盘往返；文件在 .nomi/folders.json", () => {
    const saved = saveAssetFolders({
      projectId: "proj-a",
      state: {
        version: 1,
        folders: [{ id: "f1", label: "主角参考", order: 0 }],
        assignments: { "nomi-local://asset/p/a.png": "f1" },
      },
    });
    expect(saved.ok).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".nomi", "folders.json"))).toBe(true);
    const loaded = getAssetFolders({ projectId: "proj-a" });
    expect(loaded.ok).toBe(true);
    expect(loaded.state.folders).toEqual([{ id: "f1", label: "主角参考", order: 0 }]);
    expect(loaded.state.assignments["nomi-local://asset/p/a.png"]).toBe("f1");
  });

  it("项目定位不到 → ok:false（迁移器判无家可归）；未建过 → ok:true 空态", () => {
    expect(getAssetFolders({ projectId: "global" }).ok).toBe(false);
    const fresh = getAssetFolders({ projectId: "proj-a" });
    expect(fresh.ok).toBe(true);
    expect(fresh.state.folders).toEqual([]);
  });

  it("normalize 清洗：悬空归属（folderId 不存在）与空名文件夹被剔除，顺序按 order 排", () => {
    const state = normalizeAssetFoldersState({
      folders: [
        { id: "f2", label: "B夹", order: 5 },
        { id: "f1", label: "A夹", order: 1 },
        { id: "", label: "无id" },
        { id: "f3", label: "   " },
      ],
      assignments: { "url-a": "f1", "url-b": "ghost-folder", "": "f1" },
    });
    expect(state.folders.map((folder) => folder.id)).toEqual(["f1", "f2"]);
    expect(state.assignments).toEqual({ "url-a": "f1" });
  });

  it("损坏文件按空态返回不炸面板", () => {
    fs.mkdirSync(path.join(projectRoot, ".nomi"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".nomi", "folders.json"), "{broken", "utf8");
    const loaded = getAssetFolders({ projectId: "proj-a" });
    expect(loaded.ok).toBe(true);
    expect(loaded.state.folders).toEqual([]);
  });
});
