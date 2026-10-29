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
  // 系统回收站用临时目录假扮（删项目进回收站，⑭；专门的用例在 projectDeleteToTrash.test.ts）。
  shell: {
    trashItem: async (target: string) => {
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-list-trash-"));
      fs.renameSync(target, path.join(bin, path.basename(target)));
    },
  },
}));

import { createProject, deleteProject, listProjects, saveProject } from "./repository";
import { findRecentWorkspace } from "../workspace/workspaceRegistry";
import { workspaceProjectBackupFile, workspaceProjectFile } from "../workspace/workspacePaths";
import { resetLegacyDiscoveryGuard } from "../workspace/legacyProjectMigration";
import * as manifest from "../workspace/workspaceManifest";
import { WORKSPACE_LIST_IO_CONCURRENCY } from "../workspace/workspaceRepository";
import { WorkspaceManifestLockBusyError, acquireWorkspaceManifestLock, releaseWorkspaceManifestLock } from "../workspace/workspaceManifestLock";

// 项目列表摘要读面的特征测试（P-library，2026-10-21）：钉住「列表读面返回什么」，
// 不钉它是同步还是异步——一律 `await listProjects()`，同步实现与异步实现都得过。
// 摘要 = 不带 payload 的项目记录 + 现场派生的封面；坏项目走注册表兜底而不是从列表里消失。
describe("项目列表摘要读面", () => {
  let projectsRoot = "";
  let settingsRoot = "";
  beforeEach(() => {
    projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-list-proj-"));
    settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-list-settings-"));
    vi.stubEnv("NOMI_PROJECTS_DIR", projectsRoot);
    vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(projectsRoot, { recursive: true, force: true });
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  });

  it("返回摘要：不带 payload，带 rootPath / source / missing，按更新时间倒序", async () => {
    const older = createProject({ name: "较旧" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = createProject({ name: "较新" });

    const listed = await listProjects();
    expect(listed.map((project) => project.id)).toEqual([newer.id, older.id]);
    for (const project of listed) {
      expect(project).not.toHaveProperty("payload");
      expect(project).toMatchObject({ missing: false, source: "native" });
      expect(typeof project.rootPath).toBe("string");
    }
  });

  it("封面现场从画布节点结果派生，不是持久化字段", async () => {
    const project = createProject({ name: "带封面" });
    await saveProject(project.id, {
      ...(project as Record<string, unknown>),
      payload: {
        generationCanvas: {
          nodes: [{ id: "n1", kind: "image", result: { type: "image", url: "https://example.test/a.png" } }],
          edges: [],
        },
      },
    });
    const listed = await listProjects();
    const found = listed.find((item) => item.id === project.id);
    expect(found?.thumbnailUrls?.[0]).toBe("https://example.test/a.png");
  });

  it("项目文件夹被删（missing）：卡片照出，标 missing，不拖垮别的项目", async () => {
    const healthy = createProject({ name: "健康" });
    const gone = createProject({ name: "被外部删掉", rootPath: path.join(projectsRoot, "ext-folder-project") });
    const goneEntry = findRecentWorkspace(settingsRoot, gone.id) as { rootPath: string };
    fs.rmSync(goneEntry.rootPath, { recursive: true, force: true });

    const listed = await listProjects();
    expect(listed.find((item) => item.id === healthy.id)).toMatchObject({ missing: false });
    expect(listed.find((item) => item.id === gone.id)).toMatchObject({ missing: true });
  });

  it("清单损坏的项目：卡片照出（用注册表里的名字），其余项目不受影响", async () => {
    const healthy = createProject({ name: "健康" });
    const broken = createProject({ name: "清单坏了" });
    const brokenEntry = findRecentWorkspace(settingsRoot, broken.id) as { rootPath: string };
    fs.writeFileSync(workspaceProjectFile(brokenEntry.rootPath), "{ not json");

    const listed = await listProjects();
    expect(listed.find((item) => item.id === healthy.id)?.name).toBe("健康");
    expect(listed.find((item) => item.id === broken.id)).toMatchObject({ name: "清单坏了", missing: false });
  });

  // N2（V-plibrary）：一个项目的 .nomi 被挪到根外再用 junction 接回。快照读拒绝越界返回 null，
  // 回落的加锁读又抛边界错——此前这一个错让整次 listProjects 抛出，邻居项目一张都拿不到。
  it("一个项目的数据越界：整页不抛，邻居照出；这张卡标「越界、不可打开」，不读根外内容", async () => {
    const neighbour = createProject({ name: "无辜的邻居" });
    const inside = path.join(projectsRoot, "registered");
    const project = createProject({ name: "登记时的名字", rootPath: inside });
    const source = path.join(inside, ".nomi");
    const destination = path.join(settingsRoot, "outside-metadata");
    fs.renameSync(source, destination);
    const outsideFile = path.join(destination, "project.json");
    const value = JSON.parse(fs.readFileSync(outsideFile, "utf8"));
    value.name = "根外的内容";
    fs.writeFileSync(outsideFile, JSON.stringify(value));
    fs.symlinkSync(destination, source, "junction");
    try {
      const listed = await listProjects();
      expect(listed.find((item) => item.id === neighbour.id)?.name).toBe("无辜的邻居");
      expect(listed.find((item) => item.id === project.id)).toMatchObject({
        name: "登记时的名字",
        missing: false,
        unreadableReason: "outside-workspace",
      });
    } finally {
      fs.unlinkSync(source); // 先摘 junction，别顺着它删目标
    }
  });

  // 删除严格照用户在确认框里确认的意图执行（V-plibrary2 条件，丢数据）：确认框按列表那一刻的卡片说话，
  // 主进程在删除那一刻执行，两刻之间状态可能变了——主进程不许自己重新判断「该删多少」。
  describe("删除照用户确认的意图执行", () => {
    function nativeWithOutsideNomi(name: string) {
      const project = createProject({ name });
      const inside = (findRecentWorkspace(settingsRoot, project.id) as { rootPath: string }).rootPath;
      expect(findRecentWorkspace(settingsRoot, project.id)).toMatchObject({ source: "native" }); // 正常删会整目录 rmSync
      fs.mkdirSync(path.join(inside, "assets", "imported"), { recursive: true });
      fs.writeFileSync(path.join(inside, "assets", "imported", "user.png"), "user asset");
      const source = path.join(inside, ".nomi");
      const destination = path.join(settingsRoot, `outside-${project.id}`);
      fs.renameSync(source, destination);
      fs.symlinkSync(destination, source, "junction");
      const restore = () => { fs.unlinkSync(source); fs.renameSync(destination, source); };
      return { project, inside, source, destination, restore };
    }

    it("列表时是灰卡（确认「只移除」），删除前 .nomi 被挪回原处：只解绑，目录与素材一个不动", async () => {
      const { project, inside, restore } = nativeWithOutsideNomi("灰卡确认后又修好了");
      const card = (await listProjects()).find((item) => item.id === project.id);
      expect(card).toMatchObject({ unreadableReason: "outside-workspace" });
      restore(); // 界面还没刷新，用户点了「从项目库移除」
      await expect(deleteProject(project.id, "unbind")).resolves.toEqual({ id: project.id, deleted: false });
      expect(fs.existsSync(path.join(inside, "assets", "imported", "user.png"))).toBe(true);
      expect(fs.existsSync(workspaceProjectFile(inside))).toBe(true);
      expect(findRecentWorkspace(settingsRoot, project.id)).toBeFalsy();
    });

    it("灰卡确认「只移除」：只解绑，盘上文件（含根外那份）一个不动", async () => {
      const { project, inside, source, destination } = nativeWithOutsideNomi("要移除的越界项目");
      try {
        await expect(deleteProject(project.id, "unbind")).resolves.toEqual({ id: project.id, deleted: false });
        expect(findRecentWorkspace(settingsRoot, project.id)).toBeFalsy();
        expect(fs.existsSync(path.join(inside, "assets", "imported", "user.png"))).toBe(true);
        expect(fs.existsSync(path.join(destination, "project.json"))).toBe(true);
      } finally {
        fs.unlinkSync(source);
      }
    });

    // V-plibrary2 r2 条件：移除灰卡只摘登记，目录还在默认根里；下次启动的发现扫到它、读它抛错，
    // 此前整次 listProjects 跟着 reject，所有项目都打不开。发现的每一项也只坏它自己。
    for (const kind of ["outside-workspace", "unreadable"] as const) {
      it(`移除 ${kind} 灰卡后下次启动：整页照常出、邻居都在，被移除的那个不回来`, async () => {
        const neighbour = createProject({ name: "无辜的邻居" });
        const project = createProject({ name: `要移除的 ${kind}` });
        const root = (findRecentWorkspace(settingsRoot, project.id) as { rootPath: string }).rootPath;
        let cleanup = () => {};
        if (kind === "outside-workspace") {
          const source = path.join(root, ".nomi");
          const destination = path.join(settingsRoot, `outside-next-launch-${project.id}`);
          fs.renameSync(source, destination);
          fs.symlinkSync(destination, source, "junction");
          cleanup = () => fs.unlinkSync(source);
        } else {
          for (const file of [workspaceProjectFile(root), workspaceProjectBackupFile(root)]) {
            if (!fs.existsSync(file)) continue;
            const raw = JSON.parse(fs.readFileSync(file, "utf8"));
            delete raw.projectGeneration; // 身份半缺：快照读拒、加锁读抛身份错
            fs.writeFileSync(file, JSON.stringify(raw));
          }
        }
        try {
          expect((await listProjects()).find((item) => item.id === project.id)).toMatchObject({ unreadableReason: kind });
          await expect(deleteProject(project.id, "unbind")).resolves.toEqual({ id: project.id, deleted: false });
          resetLegacyDiscoveryGuard(); // 模拟下次启动：发现会重新扫默认根
          const next = await listProjects();
          expect(next.some((item) => item.id === neighbour.id)).toBe(true);
          expect(next.some((item) => item.id === project.id)).toBe(false);
          expect(fs.existsSync(root)).toBe(true);
        } finally {
          cleanup();
        }
      });
    }

    it("确认的是「删除文件」，此刻却读不出来：拒绝（状态变了），什么都不删、登记还在", async () => {
      const { project, inside, source } = nativeWithOutsideNomi("确认删除后变坏了");
      try {
        await expect(deleteProject(project.id, "delete-files")).rejects.toThrow(/ProjectDeleteStateChangedError:/);
        expect(fs.existsSync(path.join(inside, "assets", "imported", "user.png"))).toBe(true);
        expect(findRecentWorkspace(settingsRoot, project.id)).toBeTruthy();
      } finally {
        fs.unlinkSync(source);
      }
    });

    it("确认「删除文件」时清单正被别的写者锁着：照常报忙，不解绑、不删盘", async () => {
      const busy = createProject({ name: "删除时正在被写" });
      const root = (findRecentWorkspace(settingsRoot, busy.id) as { rootPath: string }).rootPath;
      const raw = JSON.parse(fs.readFileSync(workspaceProjectFile(root), "utf8"));
      raw.payload = { note: "data:image/png;base64,AAAA" }; // 逼它走加锁读
      fs.writeFileSync(workspaceProjectFile(root), JSON.stringify(raw));
      const lease = await acquireWorkspaceManifestLock(root);
      try {
        await expect(deleteProject(busy.id, "delete-files")).rejects.toThrow(WorkspaceManifestLockBusyError);
        expect(findRecentWorkspace(settingsRoot, busy.id)).toBeTruthy();
        expect(fs.existsSync(root)).toBe(true);
      } finally {
        releaseWorkspaceManifestLock(lease);
      }
    });

    it("没带意图 / 意图不认识：拒绝，什么都不动", async () => {
      const project = createProject({ name: "没带意图" });
      const root = (findRecentWorkspace(settingsRoot, project.id) as { rootPath: string }).rootPath;
      await expect(deleteProject(project.id, undefined)).rejects.toThrow(/intent is required/);
      await expect(deleteProject(project.id, "delete")).rejects.toThrow(/intent is required/);
      expect(fs.existsSync(root)).toBe(true);
      expect(findRecentWorkspace(settingsRoot, project.id)).toBeTruthy();
    });

    it("读得出来的 native 项目确认「删除文件」：整个文件夹进回收站（原路径不在了）", async () => {
      const project = createProject({ name: "正常删除" });
      const root = (findRecentWorkspace(settingsRoot, project.id) as { rootPath: string }).rootPath;
      await expect(deleteProject(project.id, "delete-files")).resolves.toEqual({ id: project.id, deleted: true });
      expect(fs.existsSync(root)).toBe(false);
    });
  });

  it("一个项目的清单正被别的写者加锁写：整页不抛，这张卡退回登记卡（不标坏，下次刷新就好）", async () => {
    const neighbour = createProject({ name: "无辜的邻居" });
    const busy = createProject({ name: "正在被写" });
    const busyRoot = (findRecentWorkspace(settingsRoot, busy.id) as { rootPath: string }).rootPath;
    // 内嵌 data URL 让快照读让位给加锁读；锁被另一写者占着 → 加锁读抛 busy。
    const raw = JSON.parse(fs.readFileSync(workspaceProjectFile(busyRoot), "utf8"));
    raw.payload = { note: "data:image/png;base64,AAAA" };
    fs.writeFileSync(workspaceProjectFile(busyRoot), JSON.stringify(raw));
    const lease = await acquireWorkspaceManifestLock(busyRoot);
    try {
      const listed = await listProjects();
      expect(listed.find((item) => item.id === neighbour.id)?.name).toBe("无辜的邻居");
      const card = listed.find((item) => item.id === busy.id);
      expect(card).toMatchObject({ name: "正在被写", missing: false });
      expect(card).not.toHaveProperty("unreadableReason");
    } finally {
      releaseWorkspaceManifestLock(lease);
    }
  });

  it("读清单的盘读并发不超过上限：41 个项目也只同时在飞 WORKSPACE_LIST_IO_CONCURRENCY 个", async () => {
    for (let index = 0; index < 41; index += 1) createProject({ name: `项目 ${index}` });
    const original = manifest.readWorkspaceManifestSnapshotAsync;
    let inFlight = 0;
    let peak = 0;
    const spy = vi.spyOn(manifest, "readWorkspaceManifestSnapshotAsync").mockImplementation(async (rootPath: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await original(rootPath);
      } finally {
        inFlight -= 1;
      }
    });
    try {
      const listed = await listProjects();
      expect(listed).toHaveLength(41);
      expect(spy).toHaveBeenCalledTimes(41);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(WORKSPACE_LIST_IO_CONCURRENCY);
    } finally {
      spy.mockRestore();
    }
  });

  it("列举期间主进程事件循环不被占住：定时器照常触发", async () => {
    for (let index = 0; index < 20; index += 1) createProject({ name: `项目 ${index}` });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    try {
      await listProjects();
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });
});
