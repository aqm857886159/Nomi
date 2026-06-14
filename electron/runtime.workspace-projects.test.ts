import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, deleteProject, listProjects, readProject, resolveProjectRelativePath, saveProject } from "./runtime";
import { workspaceProjectFile } from "./workspace/workspacePaths";

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "documents") return mockedDocumentsRoot;
      if (name === "userData") return mockedUserDataRoot;
      return mockedUserDataRoot;
    },
    getAppPath: () => process.cwd(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
  mockedDocumentsRoot = makeTempDir("nomi-runtime-documents-");
  mockedUserDataRoot = makeTempDir("nomi-runtime-user-data-");
  delete process.env.NOMI_PROJECTS_DIR;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NOMI_PROJECTS_DIR;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-runtime-workspace-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

describe("runtime workspace project APIs", () => {
  it("createProject accepts rootPath and writes .nomi/project.json", () => {
    const workspaceRoot = makeTempDir();

    const created = createProject({ rootPath: workspaceRoot, name: "Runtime Workspace", payload: { scenes: [] } });

    expect(created).toMatchObject({
      name: "Runtime Workspace",
      version: 2,
      payload: { scenes: [] },
    });
    expect(fs.existsSync(workspaceProjectFile(workspaceRoot))).toBe(true);
    expect(listProjects()[0]).toMatchObject({ id: created.id, name: "Runtime Workspace", missing: false });
  });

  it("readProject finds a workspace project outside the default projects root", () => {
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const workspaceRoot = makeTempDir();

    const created = createProject({ rootPath: workspaceRoot, name: "Outside Default", payload: { script: "hello" } });

    expect(workspaceRoot.startsWith(defaultRoot)).toBe(false);
    expect(readProject(created.id)).toEqual(created);
  });

  it("saveProject updates workspace manifest payload", () => {
    const workspaceRoot = makeTempDir();
    const created = createProject({ rootPath: workspaceRoot, name: "Save Runtime", payload: { draft: 1 } });
    vi.setSystemTime(new Date("2026-05-31T12:30:00Z"));

    const saved = saveProject(created.id, { name: "Saved Runtime", payload: { draft: 2 } });
    const raw = JSON.parse(fs.readFileSync(workspaceProjectFile(workspaceRoot), "utf8"));

    expect(saved).toMatchObject({
      id: created.id,
      name: "Saved Runtime",
      updatedAt: Date.parse("2026-05-31T12:30:00Z"),
      savedAt: Date.parse("2026-05-31T12:30:00Z"),
      revision: (created.revision ?? 0) + 1,
      payload: { draft: 2 },
    });
    expect(raw.payload).toEqual({ draft: 2 });
  });

  it("deleteProject 对外部「打开文件夹」项目只解绑,绝不删用户目录", () => {
    // makeTempDir() 在默认根之外 = 外部文件夹(folder source):真删盘绝不碰用户内容。
    const workspaceRoot = makeTempDir();
    const created = createProject({ rootPath: workspaceRoot, name: "Remove Reference", payload: {} });

    const result = deleteProject(created.id);

    expect(result).toEqual({ id: created.id, deleted: false });
    expect(readProject(created.id)).toBeNull();
    expect(fs.existsSync(workspaceProjectFile(workspaceRoot))).toBe(true);
  });

  it("deleteProject 对 native(默认根内)项目真删盘:整目录消失", () => {
    const nativeRoot = path.join(mockedDocumentsRoot, "Nomi Projects", "Native Proj");
    const created = createProject({ rootPath: nativeRoot, name: "Native Proj", payload: {} });

    const result = deleteProject(created.id);

    expect(result).toEqual({ id: created.id, deleted: true });
    expect(readProject(created.id)).toBeNull();
    expect(fs.existsSync(nativeRoot)).toBe(false); // 真删盘:目录不再存在
  });

  it("listProjects migrates legacy projects from the default projects root into the workspace registry", () => {
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const legacyRoot = path.join(defaultRoot, "Legacy Project");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(
      path.join(legacyRoot, "project.json"),
      JSON.stringify({
        id: "legacy-id",
        name: "Legacy Project",
        version: 1,
        createdAt: 100,
        updatedAt: 200,
        savedAt: 300,
        revision: 2,
        payload: { old: true },
      }),
    );

    const projects = listProjects();

    expect(projects).toEqual([expect.objectContaining({ id: "legacy-id", name: "Legacy Project", version: 2 })]);
    expect(fs.existsSync(workspaceProjectFile(legacyRoot))).toBe(true);
    expect(readProject("legacy-id")?.payload).toEqual({ old: true });
  });

  it("resolveProjectRelativePath rejects symlink escapes from a workspace project", () => {
    const workspaceRoot = makeTempDir();
    const outsideRoot = makeTempDir("nomi-runtime-outside-");
    const created = createProject({ rootPath: workspaceRoot, name: "Symlink Runtime", payload: {} });
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "secret");
    fs.symlinkSync(outsideRoot, path.join(workspaceRoot, "linked-outside"), "dir");

    expect(() => resolveProjectRelativePath(created.id, "linked-outside/secret.txt")).toThrow(/inside the selected workspace|escapes project root/i);
  });

  it("deleteProject does not make migrated legacy projects reappear on the next list", () => {
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const legacyRoot = path.join(defaultRoot, "Deleted Legacy");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(
      path.join(legacyRoot, "project.json"),
      JSON.stringify({ id: "delete-legacy-id", name: "Deleted Legacy", version: 1, payload: {} }),
    );
    expect(listProjects()).toEqual([expect.objectContaining({ id: "delete-legacy-id" })]);

    // 迁移后该 legacy 项目位于默认根内 = native,真删盘:整目录消失,自然不会再被 list 重发现。
    expect(deleteProject("delete-legacy-id")).toEqual({ id: "delete-legacy-id", deleted: true });

    expect(fs.existsSync(legacyRoot)).toBe(false);
    expect(listProjects()).toEqual([]);
    expect(readProject("delete-legacy-id")).toBeNull();
  });

  it("createProject without a rootPath auto-creates a folder under the default projects root", () => {
    // 「新建项目」入口：不带 rootPath 时不再报错，而是在默认根下自动建项目文件夹，
    // 复用 workspace 的初始化/注册/资源落盘（这样用户不必每次选文件夹）。
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");

    const created = createProject({ name: "No Folder", payload: { scenes: [] } });

    expect(created).toMatchObject({ name: "No Folder", version: 2, payload: { scenes: [] } });
    expect(fs.existsSync(defaultRoot)).toBe(true);
    const summary = listProjects().find((item) => item.id === created.id);
    expect(summary).toMatchObject({ id: created.id, name: "No Folder", missing: false });
    const rootPath = summary?.rootPath ?? "";
    expect(rootPath.startsWith(defaultRoot)).toBe(true);
    expect(fs.existsSync(workspaceProjectFile(rootPath))).toBe(true);
    expect(readProject(created.id)).toEqual(created);
  });

  it("does not create new fixed-root projects when saving an unknown project id", () => {
    expect(() => saveProject("missing-id", { name: "Missing", payload: {} })).toThrow(/workspace project/i);
    expect(listProjects()).toEqual([]);
  });

  it("listProjects derives source: native for default-root projects, folder for external ones", () => {
    // 「新建项目」→ 落默认根 → native；「打开文件夹」绑外部目录 → folder。
    // 靠目录位置派生，无需 schema 迁移（项目卡来源徽标 #B 的数据来源）。
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const externalRoot = makeTempDir("nomi-runtime-external-");

    const nativeProject = createProject({ name: "Native One", payload: { scenes: [] } });
    const folderProject = createProject({ rootPath: externalRoot, name: "Folder One", payload: { scenes: [] } });

    expect(externalRoot.startsWith(defaultRoot)).toBe(false);

    const projects = listProjects();
    const native = projects.find((item) => item.id === nativeProject.id);
    const folder = projects.find((item) => item.id === folderProject.id);

    expect(native).toMatchObject({ id: nativeProject.id, source: "native" });
    expect(folder).toMatchObject({ id: folderProject.id, source: "folder" });
  });

  it("listProjects self-heals: prunes native projects whose folder was deleted outside the app", () => {
    // 用户在 app 外手删了 native 项目目录(或某操作删文件没清 registry)→ 幽灵卡片。
    // 列举时自愈:native 文件夹没了 = 真删,直接从 registry 摘除,不再返回。
    const nativeProject = createProject({ name: "Native Ghost", payload: { scenes: [] } });
    const rootPath = listProjects().find((item) => item.id === nativeProject.id)?.rootPath ?? "";
    expect(rootPath).not.toBe("");

    // 模拟「文件夹被外部删除」。
    fs.rmSync(rootPath, { recursive: true, force: true });

    // 第一次列举即自愈:幽灵消失。
    expect(listProjects().find((item) => item.id === nativeProject.id)).toBeUndefined();
    // registry 已物理摘除:再列举仍不在(不是每次现算)。
    expect(listProjects()).toEqual([]);
    expect(readProject(nativeProject.id)).toBeNull();
  });

  it("listProjects keeps external folder projects when their root is temporarily unavailable", () => {
    // 外部「打开文件夹」绑定的盘可能临时卸载(U盘/外置盘/网络盘)→ missing 是临时态,
    // 回来即恢复,绝不自动摘除(否则盘回来用户的项目就找不回了)。
    const externalRoot = makeTempDir("nomi-runtime-external-missing-");
    const folderProject = createProject({ rootPath: externalRoot, name: "Folder Detached", payload: { scenes: [] } });

    fs.rmSync(externalRoot, { recursive: true, force: true });

    const summary = listProjects().find((item) => item.id === folderProject.id);
    expect(summary).toMatchObject({ id: folderProject.id, source: "folder", missing: true });
  });

  it("listProjects does not avalanche-prune native projects when the default root itself is gone", () => {
    // 防雪崩:默认根整体不可访问(被移走/同步中)时,native 项目都会 missing,
    // 但此时不能清——可能只是根临时不在,清了等于把整库误删。
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const a = createProject({ name: "Native A", payload: { scenes: [] } });
    const b = createProject({ name: "Native B", payload: { scenes: [] } });

    // 整个默认根消失(模拟根目录被移走/同步未就绪)。
    fs.rmSync(defaultRoot, { recursive: true, force: true });

    const projects = listProjects();
    expect(projects.find((item) => item.id === a.id)).toMatchObject({ missing: true });
    expect(projects.find((item) => item.id === b.id)).toMatchObject({ missing: true });
  });
});
