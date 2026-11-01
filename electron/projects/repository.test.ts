import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  // 和真 Electron 一样每个 name 一个目录（都在系统临时目录下）：全指向同一个目录时 userData 就把用户的项目文件夹都罩住了，入口会拒绝。
  app: {
    getPath: (name: string) => {
      const dir = path.join(os.tmpdir(), `electron-${name}`);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    getAppPath: () => process.cwd(),
  },
}));

import {
  createProject,
  legacyProjectDirById,
  listProjects,
  normalizeProjectRecord,
  sanitizeName,
} from "./repository";
import { findRecentWorkspace } from "../workspace/workspaceRegistry";

describe("sanitizeName", () => {
  it("replaces filesystem-unsafe characters with underscore", () => {
    expect(sanitizeName('a/b:c*d?e"f')).toBe("a_b_c_d_e_f");
    expect(sanitizeName("a\\b|c<d>e")).toBe("a_b_c_d_e");
  });
  it("collapses whitespace and trims", () => {
    expect(sanitizeName("  hello   world  ")).toBe("hello world");
  });
  it("falls back when empty/blank", () => {
    expect(sanitizeName("")).toBe("Untitled");
    expect(sanitizeName("   ")).toBe("Untitled");
    expect(sanitizeName("", "Project")).toBe("Project");
  });
  it("caps length at 90 chars", () => {
    expect(sanitizeName("x".repeat(200)).length).toBe(90);
  });
});

describe("normalizeProjectRecord", () => {
  it("throws on non-object input", () => {
    expect(() => normalizeProjectRecord(null)).toThrow();
    expect(() => normalizeProjectRecord([])).toThrow();
    expect(() => normalizeProjectRecord("x")).toThrow();
  });
  it("fills defaults and sanitizes the name", () => {
    const rec = normalizeProjectRecord({ name: "My/Film" });
    expect(rec.id).toMatch(/^project-/);
    expect(rec.name).toBe("My_Film");
    expect(rec.revision).toBe(0);
    expect(rec.version).toBe(1);
    expect(typeof rec.createdAt).toBe("number");
    expect(typeof rec.updatedAt).toBe("number");
    expect(typeof rec.savedAt).toBe("number");
  });
  it("preserves a provided id and numeric timestamps", () => {
    const rec = normalizeProjectRecord({ id: " p1 ", name: "n", createdAt: 100, updatedAt: 200, revision: 5, version: 3 });
    expect(rec.id).toBe("p1");
    expect(rec.createdAt).toBe(100);
    expect(rec.updatedAt).toBe(200);
    expect(rec.revision).toBe(5);
    expect(rec.version).toBe(3);
  });
});

// 修「文件夹改名后 nomi-local 图全部 404 消失」：legacyProjectDirById 按内容（manifest id）
// 找回项目目录，必须同时认根 project.json（legacy）和 .nomi/project.json（workspace 清单）。
describe("legacyProjectDirById（folder rename 自愈）", () => {
  let root = "";
  let prevEnv: string | undefined;
  beforeEach(() => {
    prevEnv = process.env.NOMI_PROJECTS_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-projroot-"));
    vi.stubEnv("NOMI_PROJECTS_DIR", root);
  });
  afterEach(() => {
    if (prevEnv === undefined) vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
    else vi.stubEnv("NOMI_PROJECTS_DIR", prevEnv);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("按根 project.json 找到 legacy 项目目录", () => {
    const dir = path.join(root, "any-renamed-folder");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id: "id-legacy", name: "L", version: 1 }));
    expect(legacyProjectDirById("id-legacy")).toBe(dir);
  });

  it("按 .nomi/project.json 找到被改名的 workspace 项目（核心修复）", () => {
    const dir = path.join(root, "renamed-after-move");
    fs.mkdirSync(path.join(dir, ".nomi"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".nomi", "project.json"), JSON.stringify({ id: "id-nomi", name: "W", version: 1 }));
    expect(legacyProjectDirById("id-nomi")).toBe(dir);
  });

  it("找不到匹配 id 时返回 null", () => {
    expect(legacyProjectDirById("nope")).toBeNull();
  });
});

// 列表只读（2026-10-22，V-plibrary N1）：listProjects 不删任何项目。空白草稿回收曾挂在首次列举上，
// 列举是异步的，期间排队等锁的保存会被它删掉。读面也不做展示上的取舍（V-plibrary2 r3，用户拍板 B）：
// 刚新建、还没保存的空白项目照常在列表里——MCP、全部项目素材、走查都靠它找刚建的项目。
describe("listProjects 只读：所有登记过的项目都在、不删", () => {
  let projectsRoot = "";
  let settingsRoot = "";
  beforeEach(() => {
    projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gc-proj-"));
    settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gc-settings-"));
    vi.stubEnv("NOMI_PROJECTS_DIR", projectsRoot);
    vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(projectsRoot, { recursive: true, force: true });
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  });

  it("刚新建、零编辑的空白草稿就在列表里（带 rootPath）；列多少次都不删", async () => {
    const draft = createProject({ name: "刚建的空白", draft: true });
    const root = (findRecentWorkspace(settingsRoot, draft.id) as { rootPath: string }).rootPath;
    for (let round = 0; round < 2; round += 1) {
      expect((await listProjects()).find((p) => p.id === draft.id)).toMatchObject({ rootPath: root, draft: true, revision: 0 });
      expect(fs.existsSync(root)).toBe(true);
    }
  });

  it("非草稿项目照常显示", async () => {
    const keep = createProject({ name: "正常项目" });
    expect((await listProjects()).some((p) => p.id === keep.id)).toBe(true);
  });

  it("在创建入口冻结默认项目与打开文件夹的来源", () => {
    const native = createProject({ name: "默认位置项目" });
    const externalRoot = path.join(projectsRoot, "用户显式打开的文件夹");
    const external = createProject({ name: "外部文件夹", rootPath: externalRoot });

    expect(findRecentWorkspace(settingsRoot, native.id)).toMatchObject({
      source: "native",
      nativeRootPath: path.resolve(projectsRoot),
    });
    expect(findRecentWorkspace(settingsRoot, external.id)).toMatchObject({ source: "folder" });
  });

  // 「启动时对全库做一遍工作」的成本正比于库大小（2026-09-03-startup-library-discovery-rescan 同一 class）：
  // 一次 listProjects 里，每个项目的 manifest 只被快照读一次。判据取跨模块 spy 观测到的读次数，不用耗时断言（R18）。
  it("一次列举里每个项目的 manifest 只被快照读一次", async () => {
    createProject({ name: "上个进程的空白", draft: true });
    const keep = createProject({ name: "正常项目" });

    const workspaceManifest = await import("../workspace/workspaceManifest");
    const spy = vi.spyOn(workspaceManifest, "readWorkspaceManifestSnapshotAsync");
    try {
      await listProjects();
      const keepDir = path.resolve((findRecentWorkspace(settingsRoot, keep.id) as { rootPath: string }).rootPath);
      const keepReads = spy.mock.calls.filter(([rootPath]) => path.resolve(String(rootPath)) === keepDir).length;
      expect(keepReads).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
