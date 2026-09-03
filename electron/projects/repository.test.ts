import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import {
  createProject,
  legacyProjectDirById,
  listProjects,
  normalizeProjectRecord,
  resetEmptyDraftGcGuard,
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
    process.env.NOMI_PROJECTS_DIR = root;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NOMI_PROJECTS_DIR;
    else process.env.NOMI_PROJECTS_DIR = prevEnv;
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

// 启动 GC 挂在 listProjects 首次调用：回收上个进程遗留的空白草稿，但只跑一次——
// 本会话之后新建的草稿绝不被误删（once-guard）。
describe("listProjects 启动一次 GC（空白草稿回收）", () => {
  let projectsRoot = "";
  let settingsRoot = "";
  let prevProjects: string | undefined;
  let prevSettings: string | undefined;
  beforeEach(() => {
    prevProjects = process.env.NOMI_PROJECTS_DIR;
    prevSettings = process.env.NOMI_SETTINGS_DIR;
    projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gc-proj-"));
    settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gc-settings-"));
    process.env.NOMI_PROJECTS_DIR = projectsRoot;
    process.env.NOMI_SETTINGS_DIR = settingsRoot;
    resetEmptyDraftGcGuard();
  });
  afterEach(() => {
    if (prevProjects === undefined) delete process.env.NOMI_PROJECTS_DIR;
    else process.env.NOMI_PROJECTS_DIR = prevProjects;
    if (prevSettings === undefined) delete process.env.NOMI_SETTINGS_DIR;
    else process.env.NOMI_SETTINGS_DIR = prevSettings;
    fs.rmSync(projectsRoot, { recursive: true, force: true });
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  });

  it("首次列举回收草稿，二次列举不再回收本会话新建的草稿", () => {
    const stale = createProject({ name: "上个进程的空白", draft: true });
    expect(listProjects().some((p) => p.id === stale.id)).toBe(false); // 首次 = 回收

    const fresh = createProject({ name: "本会话新建空白", draft: true });
    expect(listProjects().some((p) => p.id === fresh.id)).toBe(true); // 二次 = guard 已消费，保留
  });

  it("非草稿项目不被回收", () => {
    const keep = createProject({ name: "正常项目" });
    expect(listProjects().some((p) => p.id === keep.id)).toBe(true);
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

  // 类根因（与 2026-09-03-startup-library-discovery-rescan 同一 class）：
  // 「启动时对全库做一遍工作」的成本正比于库大小，而不是正比于真正要处理的项目数。
  // 这里的具体形态是：GC 自己列了一遍全库（372 次 manifest 快照读），listProjects
  // 紧接着又列一遍，第一遍的结果用完即弃。实测占冷启动列举总耗时的 55-63%。
  //
  // 判据取「一次 listProjects 里，某个项目的 manifest 被快照读了几次」——列举的真实
  // 单位成本就是它，而它是跨模块调用（workspaceRepository → workspaceManifest），spy 拦得到。
  // 不用耗时断言：并行 suite 下必然 flake（R18），且「列两遍」才是因、慢一倍只是果。
  //
  // 不用 spyOn(listWorkspaceProjects)：GC 与 listWorkspaceProjects 同住
  // workspaceRepository.ts，GC 调的是模块内的局部绑定，spy 换掉导出属性根本观测不到，
  // 断言会恒真通过——这正是 docs/fixes/2026-09-03-vacuous-fs-read-spy-probe 那一类假绿。
  // 本条已做变异验证：把 GC 改回自己 listWorkspaceProjects(deps)，它从 1 变 2 而红。
  //
  // 只对「GC 不动的项目」计数：被回收的草稿另有 resolveWorkspaceProjectDir 等
  // 每候选各自的读（实测 3 次），那是 GC 的固有单项成本、正比于草稿数而非库大小，
  // 不属于本次要消除的「全库重复列举」。混进来会让断言测的不是它自称在测的东西。
  it("首次列举（含 GC）非回收项目的 manifest 只被读一次，不为 GC 再列一遍全库", async () => {
    createProject({ name: "上个进程的空白", draft: true });
    const keep = createProject({ name: "正常项目" });
    resetEmptyDraftGcGuard();

    const workspaceManifest = await import("../workspace/workspaceManifest");
    const spy = vi.spyOn(workspaceManifest, "readWorkspaceManifestSnapshot");
    try {
      listProjects();

      const keepEntry = findRecentWorkspace(settingsRoot, keep.id) as { rootPath: string } | null;
      expect(keepEntry).toBeTruthy();
      const keepDir = path.resolve((keepEntry as { rootPath: string }).rootPath);
      const keepReads = spy.mock.calls.filter(([rootPath]) => path.resolve(String(rootPath)) === keepDir).length;

      // 反恒真守卫：spy 确实观测到了这个目录的读（否则下面的 <=1 是空真）。
      expect(keepReads).toBeGreaterThan(0);
      // 核心不变量：修复前 GC 与 listProjects 各列一遍全库 → 这里是 2。
      expect(keepReads).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  // 上一条只证「少列了一遍」，不证「列的那遍仍然对」。GC 会删项目，被删的必须从
  // 复用的那份快照里摘掉——否则省下的一次列举会以「幽灵卡片」的形式还回去。
  it("被 GC 回收的草稿不出现在同一次列举的返回里（复用快照不留幽灵）", () => {
    const stale = createProject({ name: "上个进程的空白", draft: true });
    const keep = createProject({ name: "正常项目" });
    resetEmptyDraftGcGuard();

    const listed = listProjects();
    expect(listed.some((p) => p.id === stale.id)).toBe(false);
    expect(listed.some((p) => p.id === keep.id)).toBe(true);
  });
});
