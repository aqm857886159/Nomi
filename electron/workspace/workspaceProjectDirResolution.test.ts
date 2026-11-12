// 「这个编号的项目在哪个目录」只认一次（设计卡 docs/plan/2026-11-12-gen-landing-stall-cut1.md ★9 第 1–4 条）。
// 生成落地时每张图要问十几次；以前每问一次都整读、解析一遍项目文件。现在认过一次就记凭据（登记的目录 + 项目文件的 stat），
// 凭据对得上直接回目录；登记改了、目录没了、项目文件被换了，都要拿到新答案或 null，不许给旧目录。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  removeWorkspaceProjectReference,
  resolveWorkspaceProjectDir,
  saveWorkspaceProject,
  type WorkspaceRepositoryDeps,
} from "./workspaceRepository";
import { workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";
import { recentWorkspacesPath } from "./workspaceRegistry";
import { WorkspaceProjectIdentityUnavailableError } from "./workspaceTypes";

const tempRoots: string[] = [];

function replaceAtomically(from: string, to: string): void {
  const incoming = `${to}.incoming`;
  fs.copyFileSync(from, incoming);
  fs.renameSync(incoming, to);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeTempDir(name = "nomi-project-dir-resolution-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function deps(): WorkspaceRepositoryDeps {
  return { settingsRoot: makeTempDir("nomi-project-dir-settings-"), defaultProjectsRoot: makeTempDir("nomi-project-dir-default-") };
}

/** 数「读项目文件」：项目文件（.nomi/project.json）被 readFileSync 读了几次。 */
function countManifestReads(rootPath: string): () => number {
  const manifest = path.resolve(workspaceProjectFile(rootPath));
  const spy = vi.spyOn(fs, "readFileSync");
  return () => spy.mock.calls.filter(([file]) => typeof file === "string" && path.resolve(file) === manifest).length;
}

function rewriteRegistry(settingsRoot: string, map: (entry: { id: string; rootPath: string }) => { id: string; rootPath: string }): void {
  const file = recentWorkspacesPath(settingsRoot);
  const registry = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ id: string; rootPath: string }>;
  fs.writeFileSync(file, JSON.stringify(registry.map(map), null, 2));
}

describe("resolveWorkspaceProjectDir remembers the folder it already verified", () => {
  it("reads the project file at most once across many resolutions of the same id", () => {
    const root = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Landing", payload: { scenes: [] } } }, repoDeps);
    const reads = countManifestReads(root);

    for (let index = 0; index < 50; index += 1) expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    expect(reads()).toBeLessThanOrEqual(1);
  });

  it("a save from this process keeps the remembered folder: the next resolution does not re-read the project file", async () => {
    const root = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Saved", payload: {} } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    await saveWorkspaceProject(created.id, { name: "Saved", payload: { scenes: [1] } }, repoDeps);
    const reads = countManifestReads(root);
    for (let index = 0; index < 10; index += 1) expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    expect(reads()).toBe(0);
  });

  it("deleted from the library (registry entry removed) → null, not the old folder", async () => {
    const root = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Unbound", payload: {} } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    removeWorkspaceProjectReference(created.id, repoDeps);

    expect(fs.existsSync(root)).toBe(true);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBeNull();
  });

  it("native project moved to the trash → null", async () => {
    const repoDeps = deps();
    const root = path.join(repoDeps.defaultProjectsRoot, "native-project");
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Native", payload: {} } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    await deleteWorkspaceProject(created.id, repoDeps, async (folder) => { fs.rmSync(folder, { recursive: true, force: true }); });

    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBeNull();
  });

  it("folder moved away (no longer exists) → null", () => {
    const root = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Moved", payload: {} } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    fs.renameSync(root, `${root}-moved`);
    tempRoots.push(`${root}-moved`);

    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBeNull();
  });

  it("re-registered to another folder by this process (open the moved folder) → the new folder", () => {
    const root = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Relocated", payload: {} } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    const moved = `${root}-relocated`;
    fs.renameSync(root, moved);
    tempRoots.push(moved);
    createWorkspaceProject({ rootPath: moved, record: {} }, repoDeps);

    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(moved));
  });

  it("same id pointed at another folder by another process (registry rewritten on disk) → the new folder, never the remembered one", () => {
    const root = makeTempDir();
    const copy = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Twin", payload: {} } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));
    fs.cpSync(path.join(root, ".nomi"), path.join(copy, ".nomi"), { recursive: true });

    rewriteRegistry(repoDeps.settingsRoot, (entry) => (entry.id === created.id ? { ...entry, rootPath: path.resolve(copy) } : entry));

    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(copy));
  });

  it("folder still there but its project file now belongs to another project (id differs) → null", () => {
    const root = makeTempDir();
    const otherRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Original", payload: {} } }, repoDeps);
    const other = createWorkspaceProject({ rootPath: otherRoot, record: { name: "Someone else", payload: { big: "x".repeat(10) } } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    // 别的程序 / 同步盘把另一个项目的清单（连同备份）换了进来：先写临时文件再改名，和原子写盘同形。
    replaceAtomically(workspaceProjectFile(otherRoot), workspaceProjectFile(root));
    if (fs.existsSync(workspaceProjectBackupFile(otherRoot))) replaceAtomically(workspaceProjectBackupFile(otherRoot), workspaceProjectBackupFile(root));
    else fs.rmSync(workspaceProjectBackupFile(root), { force: true });

    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBeNull();
    expect(resolveWorkspaceProjectDir(other.id, repoDeps)).toBe(path.resolve(otherRoot));
  });

  it("only the project file swapped (backup still the original) fails closed exactly as before, never the remembered folder", async () => {
    const root = makeTempDir();
    const otherRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Original", payload: {} } }, repoDeps);
    await saveWorkspaceProject(created.id, { name: "Original", payload: { saved: 1 } }, repoDeps);
    createWorkspaceProject({ rootPath: otherRoot, record: { name: "Someone else", payload: {} } }, repoDeps);
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));

    replaceAtomically(workspaceProjectFile(otherRoot), workspaceProjectFile(root));

    // 修前每次都整读，主文件和备份编号对不上就抛身份不可用；记住答案之后凭据一变也照样走到这一步。
    expect(() => resolveWorkspaceProjectDir(created.id, repoDeps)).toThrow(WorkspaceProjectIdentityUnavailableError);
  });

  it("migrates a legacy project folder on the first resolution, once", () => {
    const root = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject({ rootPath: root, record: { name: "Legacy", payload: {} } }, repoDeps);
    // 退回旧格式：只有根上的 project.json，没有 .nomi 清单。
    const legacyRecord = { id: created.id, name: "Legacy", createdAt: Date.now(), updatedAt: Date.now(), payload: { legacy: true } };
    fs.rmSync(path.join(root, ".nomi"), { recursive: true, force: true });
    fs.writeFileSync(path.join(root, "project.json"), JSON.stringify(legacyRecord));

    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBe(path.resolve(root));
    expect(fs.existsSync(workspaceProjectFile(root))).toBe(true);
    const reads = countManifestReads(root);
    resolveWorkspaceProjectDir(created.id, repoDeps);
    resolveWorkspaceProjectDir(created.id, repoDeps);
    resolveWorkspaceProjectDir(created.id, repoDeps);

    expect(reads()).toBeLessThanOrEqual(1);
  });
});
