import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceProject, readWorkspaceProject, saveWorkspaceProject, type WorkspaceRepositoryDeps } from "./workspaceRepository";

const tempRoots: string[] = [];
afterEach(() => { for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function makeTempDir(prefix = "nomi-content-save-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}
function deps(): WorkspaceRepositoryDeps {
  return { settingsRoot: makeTempDir("nomi-content-save-settings-"), defaultProjectsRoot: makeTempDir("nomi-content-save-projects-") };
}

// 自动保存只拥有 payload。矩阵：渲染层发来的记录带着「打开那一刻」的旧值（或根本不带 name），
// 每个不归它管的字段都必须以盘上现值为准，不被旧快照盖回去。
describe("content saves never overwrite fields the renderer does not own", () => {
  const staleFieldMatrix: Array<[string, unknown]> = [
    ["createdAt", 1],
    ["immutableProjectUuid", "00000000-0000-4000-8000-000000000000"],
    ["projectGeneration", 99],
    ["thumbStyle", "stale-style"],
    ["seedKey", "stale-seed"],
    ["lastKnownRootPath", "/stale/root"],
    ["draft", true],
  ];

  it.each(staleFieldMatrix)("keeps the on-disk %s", async (field, staleValue) => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: selectedRoot, record: { name: "Original", payload: { draft: 1 } } }, repoDeps);
    await saveWorkspaceProject(created.id, { name: "Renamed elsewhere", payload: { draft: 2 } }, repoDeps);
    const onDisk = readWorkspaceProject(created.id, repoDeps) as unknown as Record<string, unknown>;

    const saved = await saveWorkspaceProject(created.id, { [field]: staleValue, payload: { draft: 3 } }, repoDeps) as unknown as Record<string, unknown>;

    expect(saved[field]).toEqual(onDisk[field]);
    expect(saved.name).toBe("Renamed elsewhere");
    expect(saved.payload).toEqual({ draft: 3 });
  });
});
