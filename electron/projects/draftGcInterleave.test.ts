import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import { createProject, listProjects, saveProject } from "./repository";
import { findRecentWorkspace } from "../workspace/workspaceRegistry";
import { acquireWorkspaceManifestLock, releaseWorkspaceManifestLock } from "../workspace/workspaceManifestLock";

// 列举与同进程写入交错：列举是异步的，等它读完，同进程的保存 / 改名 / 创建可能已经插进来过，
// 也可能有保存正排队等锁。空草稿回收曾挂在首次列举上，这些交错都能删掉用户的草稿（V-plibrary F1、N1，丢数据）。
// 2026-10-22 起列举只读、不删任何项目；这里钉住每种交错下项目都还在。
describe("列举与同进程写入交错：列举不删项目", () => {
  let projectsRoot = "";
  let settingsRoot = "";
  beforeEach(() => {
    projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gcx-proj-"));
    settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gcx-settings-"));
    vi.stubEnv("NOMI_PROJECTS_DIR", projectsRoot);
    vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(projectsRoot, { recursive: true, force: true });
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  });

  /** 让草稿的快照读完、另一个项目的快照读卡住：中间就是「同进程别的写入能插进来」的窗口。 */
  async function listingWithWindow(draftId: string, siblingId: string, whileOpen: () => Promise<void>) {
    const draftRoot = (findRecentWorkspace(settingsRoot, draftId) as { rootPath: string }).rootPath;
    const siblingRoot = (findRecentWorkspace(settingsRoot, siblingId) as { rootPath: string }).rootPath;
    let draftRead!: () => void;
    const draftReadDone = new Promise<void>((resolve) => { draftRead = resolve; });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    // 窗口开在文件系统这一层（真外部边界）：草稿的清单读完就放行「窗口里的写入」，同伴的清单读卡到窗口收尾。
    const originalReadFile = fs.promises.readFile.bind(fs.promises);
    vi.spyOn(fs.promises, "readFile").mockImplementation((async (...args: Parameters<typeof fs.promises.readFile>) => {
      const file = String(args[0]);
      const value = await originalReadFile(...args);
      if (file.startsWith(`${draftRoot}${path.sep}`) && file.endsWith("project.json")) draftRead();
      if (file.startsWith(`${siblingRoot}${path.sep}`) && file.endsWith("project.json")) await released;
      return value;
    }) as typeof fs.promises.readFile);
    const listing = listProjects(); // promise-held：先让列举卡在半路，窗口里做别的，最后再 await
    await draftReadDone;
    await whileOpen();
    release();
    return { rows: await listing, draftRoot };
  }

  it("草稿在列举途中保存成功：目录、注册项都还在，卡片也在", async () => {
    const draft = createProject({ name: "列举途中保存", draft: true });
    const sibling = createProject({ name: "慢的同伴" });
    const { rows, draftRoot } = await listingWithWindow(draft.id, sibling.id, async () => {
      await saveProject(draft.id, { ...draft, payload: { text: "用户已经确认保存的内容" } });
    });
    expect(fs.existsSync(draftRoot)).toBe(true);
    expect(findRecentWorkspace(settingsRoot, draft.id)).toBeTruthy();
    expect(rows.some((row) => row.id === draft.id)).toBe(true);
  });

  it("草稿在列举途中被改名（保存带新名字）：不被回收", async () => {
    const draft = createProject({ name: "列举途中改名", draft: true });
    const sibling = createProject({ name: "慢的同伴" });
    const { draftRoot } = await listingWithWindow(draft.id, sibling.id, async () => {
      await saveProject(draft.id, { ...draft, name: "改过的名字" });
    });
    expect(fs.existsSync(draftRoot)).toBe(true);
    expect(findRecentWorkspace(settingsRoot, draft.id)).toBeTruthy();
  });

  // V-plibrary 用例 C（N1，丢数据）：保存已经发出、正在等别的写者放锁（10ms 一次重试），
  // 别的写者刚放锁、保存的重试计时器还没到，列举就收尾了。此刻锁是空的、清单还是 draft rev 0，
  // 只看「此刻清单」的回收授权会把它删掉——用户这次保存随后失败，取锁时还会重建一个没清单、没登记的孤儿目录。
  it("保存正在排队等锁时列举收尾：不删；保存成功落盘，之后的列表里有它", async () => {
    const draft = createProject({ name: "排队等锁的保存", draft: true });
    const sibling = createProject({ name: "慢的同伴" });
    let saving: Promise<{ ok: true; revision: number | undefined } | { ok: false; error: string }> | null = null;
    let lease: Awaited<ReturnType<typeof acquireWorkspaceManifestLock>> | null = null;
    const { rows, draftRoot } = await listingWithWindow(draft.id, sibling.id, async () => {
      const root = (findRecentWorkspace(settingsRoot, draft.id) as { rootPath: string }).rootPath;
      lease = await acquireWorkspaceManifestLock(root); // 另一写者占着清单锁
      saving = saveProject(draft.id, { ...draft, payload: { text: "用户刚敲进去的字" } }).then(
        (record) => ({ ok: true as const, revision: record.revision }),
        (error: unknown) => ({ ok: false as const, error: String((error as Error)?.message ?? error) }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30)); // 保存进入重试
      releaseWorkspaceManifestLock(lease); // 放锁后立刻放行列举
    });
    expect(lease).not.toBeNull();
    const folderAfterGc = fs.existsSync(draftRoot);
    const result = await saving!;
    expect(folderAfterGc).toBe(true);
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(findRecentWorkspace(settingsRoot, draft.id)).toBeTruthy();
    // 列表不做展示上的取舍：这一次的列表里就有它（读面返回所有登记过的项目）。
    expect(rows.some((row) => row.id === draft.id)).toBe(true);
    expect((await listProjects()).some((row) => row.id === draft.id)).toBe(true);
  });

  it("上个进程遗留的空草稿与列举途中新建的草稿：都不删，之后的列表里两个都在", async () => {
    const stale = createProject({ name: "上个进程遗留", draft: true });
    const sibling = createProject({ name: "慢的同伴" });
    let fresh = "";
    const { rows, draftRoot } = await listingWithWindow(stale.id, sibling.id, async () => {
      fresh = createProject({ name: "列举途中新建", draft: true }).id;
    });
    expect(rows.some((row) => row.id === stale.id)).toBe(true);
    expect(fs.existsSync(draftRoot)).toBe(true);
    const next = await listProjects();
    expect(next.some((row) => row.id === stale.id)).toBe(true);
    expect(next.some((row) => row.id === fresh)).toBe(true);
  });
});
