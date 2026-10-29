import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 系统回收站用一个临时目录假扮：shell.trashItem 把路径挪进去（真回收站也是「挪走、能还原」）。
const trash = vi.hoisted(() => ({
  dir: "",
  failWith: null as Error | null,
  leaveInPlace: false,
  calls: [] as string[],
}));
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
  shell: {
    trashItem: async (target: string) => {
      trash.calls.push(target);
      if (trash.failWith) throw trash.failWith;
      if (trash.leaveInPlace) return; // 系统报成功、原路径却还在
      fs.renameSync(target, path.join(trash.dir, `${path.basename(target)}-${trash.calls.length}`));
    },
  },
}));

import { createProject, deleteProject, listProjects } from "./repository";
import { resetLegacyDiscoveryGuard } from "../workspace/legacyProjectMigration";
import { findRecentWorkspace } from "../workspace/workspaceRegistry";
import { WorkspaceManifestLockBusyError, acquireWorkspaceManifestLock, releaseWorkspaceManifestLock } from "../workspace/workspaceManifestLock";
import { isProjectTrashFailedError, projectTrashFailureReason } from "../shared/projectDeleteIntent";
import { classifyTrashFailure } from "./projectTrash";

// ⑭（用户 2026-10-22 拍板）：确认「删除文件」后项目文件夹进系统回收站、可以恢复；进不了回收站就报清楚原因、
// 什么都不删，绝不静默退回永久删除。方向检查 docs/engineering/direction-checks/2026-10-23-project-delete-to-trash.md。
describe("删项目进系统回收站", () => {
  let projectsRoot = "";
  let settingsRoot = "";
  beforeEach(() => {
    projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-trash-proj-"));
    settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-trash-settings-"));
    trash.dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-trash-bin-"));
    trash.failWith = null;
    trash.leaveInPlace = false;
    trash.calls = [];
    vi.stubEnv("NOMI_PROJECTS_DIR", projectsRoot);
    vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of [projectsRoot, settingsRoot, trash.dir]) fs.rmSync(dir, { recursive: true, force: true });
  });

  function nativeProjectWithAsset(name: string) {
    const project = createProject({ name });
    const root = (findRecentWorkspace(settingsRoot, project.id) as { rootPath: string }).rootPath;
    fs.mkdirSync(path.join(root, "assets", "imported"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets", "imported", "user.png"), "user asset");
    return { project, root };
  }

  it("确认「删除文件」：整个项目文件夹进回收站（素材都在里面、能还原），然后才从项目库移除", async () => {
    const { project, root } = nativeProjectWithAsset("进回收站");
    await expect(deleteProject(project.id, "delete-files")).resolves.toEqual({ id: project.id, deleted: true });
    expect(trash.calls).toEqual([path.resolve(root)]);
    expect(fs.existsSync(root)).toBe(false);
    const binned = fs.readdirSync(trash.dir);
    expect(binned).toHaveLength(1);
    expect(fs.readFileSync(path.join(trash.dir, binned[0], "assets", "imported", "user.png"), "utf8")).toBe("user asset");
    expect(findRecentWorkspace(settingsRoot, project.id)).toBeFalsy();
  });

  it("从回收站还原后，下次启动（启动发现重新扫默认根）它回到项目库", async () => {
    const { project, root } = nativeProjectWithAsset("还原回来");
    await deleteProject(project.id, "delete-files");
    const [binned] = fs.readdirSync(trash.dir);
    fs.renameSync(path.join(trash.dir, binned), root); // 用户在系统回收站点「还原」
    resetLegacyDiscoveryGuard(); // 模拟下次启动
    expect((await listProjects()).some((item) => item.id === project.id)).toBe(true);
  });

  it.each([
    ["没有权限", Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }), "permission"],
    ["这个位置没有回收站（Windows 回收站放弃操作）", new Error("Operation was aborted"), "no-trash"],
    ["文件被别的程序占用", Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" }), "in-use"],
    ["别的原因", new Error("something unexpected"), "unknown"],
  ] as const)("进不了回收站（%s）：明确报错、什么都不删、项目还在库里", async (_label, failure, reason) => {
    const { project, root } = nativeProjectWithAsset("进不了回收站");
    trash.failWith = failure;
    const error = await deleteProject(project.id, "delete-files").then(() => null, (caught: unknown) => caught);
    expect(isProjectTrashFailedError(error)).toBe(true);
    expect(projectTrashFailureReason(error)).toBe(reason);
    expect(fs.existsSync(path.join(root, "assets", "imported", "user.png"))).toBe(true);
    expect(findRecentWorkspace(settingsRoot, project.id)).toBeTruthy();
  });

  it("删除时别的写者正锁着这个项目：照常报「正被别处占用」，不进回收站、不删", async () => {
    const { project, root } = nativeProjectWithAsset("正被别处占用");
    const lease = await acquireWorkspaceManifestLock(root);
    try {
      await expect(deleteProject(project.id, "delete-files")).rejects.toThrow(WorkspaceManifestLockBusyError);
      expect(trash.calls).toEqual([]);
      expect(fs.existsSync(path.join(root, "assets", "imported", "user.png"))).toBe(true);
      expect(findRecentWorkspace(settingsRoot, project.id)).toBeTruthy();
    } finally {
      releaseWorkspaceManifestLock(lease);
    }
  });

  // 删除前「取清单锁」那一下只用来探「别处占用」。取锁时写不进 .nomi（只读卷 EROFS、没权限 EACCES / EPERM）不是占用：
  // 若原样往外抛，会绕过回收站那一步的分类，界面把真原因说成「可能有别的程序正占用它的文件夹」（V-library-trash 建议 1，
  // 真只读卷实测）。这里照真只读卷上的样子让建锁候选目录那一步失败，核「只有别处占用才拦，其余交给回收站报真原因」。
  describe("删除前取清单锁写不进 .nomi（只读卷 / 没权限写）", () => {
    let mkdirSpy: { mockRestore: () => void } | null = null;
    function failLockCandidateMkdir(code: string) {
      const realMkdir = fs.mkdirSync;
      mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
        if (String(target).includes("manifest-transaction.candidate-")) {
          throw Object.assign(new Error(`${code}: operation failed, mkdir '${String(target)}'`), { code });
        }
        return (realMkdir as (...args: unknown[]) => unknown)(target, ...rest);
      }) as never);
    }
    afterEach(() => {
      mkdirSpy?.mockRestore();
      mkdirSpy = null;
    });

    it.each(["EROFS", "EACCES", "EPERM"])("%s：不报成「别处占用」，交给回收站那一步报真原因；文件和登记原样", async (code) => {
      const { project, root } = nativeProjectWithAsset("只读卷上的项目");
      trash.failWith = new Error("“只读卷上的项目” couldn’t be moved to the trash because the volume “V” doesn’t have one.");
      failLockCandidateMkdir(code);
      const error = await deleteProject(project.id, "delete-files").then(() => null, (caught: unknown) => caught);
      expect(trash.calls).toEqual([path.resolve(root)]); // 回收站那一步真的被走到了
      expect(error).not.toBeInstanceOf(WorkspaceManifestLockBusyError);
      expect(projectTrashFailureReason(error)).toBe("no-trash"); // 报的是回收站给的真原因，不是原始的 EROFS / EACCES
      expect(fs.existsSync(path.join(root, "assets", "imported", "user.png"))).toBe(true);
      expect(findRecentWorkspace(settingsRoot, project.id)).toBeTruthy();
    });

    it("取锁写不进 .nomi、但回收站进得去：照常进回收站（取锁只拦「别处占用」，不拦别的错）", async () => {
      const { project, root } = nativeProjectWithAsset("取锁失败但能进回收站");
      failLockCandidateMkdir("EROFS");
      await expect(deleteProject(project.id, "delete-files")).resolves.toEqual({ id: project.id, deleted: true });
      expect(trash.calls).toEqual([path.resolve(root)]);
      expect(fs.existsSync(root)).toBe(false);
      expect(findRecentWorkspace(settingsRoot, project.id)).toBeFalsy();
    });
  });

  it("回收站报成功、原路径却还在：当失败处理，不从项目库移除", async () => {
    const { project, root } = nativeProjectWithAsset("报成功但还在");
    trash.leaveInPlace = true;
    const error = await deleteProject(project.id, "delete-files").then(() => null, (caught: unknown) => caught);
    expect(isProjectTrashFailedError(error)).toBe(true);
    expect(fs.existsSync(root)).toBe(true);
    expect(findRecentWorkspace(settingsRoot, project.id)).toBeTruthy();
  });

  it("老格式项目（根目录 project.json、未登记）确认「删除文件」：同样进回收站，不是永久删除", async () => {
    const legacyRoot = path.join(projectsRoot, "Legacy Project");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "project.json"), JSON.stringify({ id: "legacy-trash-id", name: "Legacy", version: 1, payload: {} }));
    await expect(deleteProject("legacy-trash-id", "delete-files")).resolves.toEqual({ id: "legacy-trash-id", deleted: true });
    expect(trash.calls).toEqual([path.resolve(legacyRoot)]);
    expect(fs.existsSync(legacyRoot)).toBe(false);
  });

  it("老格式项目进不了回收站：明确报错，文件夹原样", async () => {
    const legacyRoot = path.join(projectsRoot, "Legacy Locked");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "project.json"), JSON.stringify({ id: "legacy-locked-id", name: "Legacy", version: 1, payload: {} }));
    trash.failWith = new Error("Operation was aborted");
    const error = await deleteProject("legacy-locked-id", "delete-files").then(() => null, (caught: unknown) => caught);
    expect(projectTrashFailureReason(error)).toBe("no-trash");
    expect(fs.existsSync(path.join(legacyRoot, "project.json"))).toBe(true);
  });

  it("确认「只移除」：不进回收站、不删，只从项目库移除", async () => {
    const { project, root } = nativeProjectWithAsset("只移除");
    await expect(deleteProject(project.id, "unbind")).resolves.toEqual({ id: project.id, deleted: false });
    expect(trash.calls).toEqual([]);
    expect(fs.existsSync(path.join(root, "assets", "imported", "user.png"))).toBe(true);
    expect(findRecentWorkspace(settingsRoot, project.id)).toBeFalsy();
  });

  it("外部文件夹确认「删除文件」：仍然只解绑，不进回收站、不碰用户的文件", async () => {
    // 用户自己的文件夹在 Nomi 的设置目录之外（设置目录里面的位置入口会拒绝，见 workspaceLocationPolicy）。
    const externalParent = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-trash-external-"));
    try {
      const externalRoot = path.join(externalParent, "用户自己的文件夹");
      const project = createProject({ name: "外部", rootPath: externalRoot });
      await expect(deleteProject(project.id, "delete-files")).resolves.toEqual({ id: project.id, deleted: false });
      expect(trash.calls).toEqual([]);
      expect(fs.existsSync(externalRoot)).toBe(true);
    } finally {
      fs.rmSync(externalParent, { recursive: true, force: true });
    }
  });
});

// 结构守卫：删项目目录的两处（workspace 项目 / 老格式项目）只经 moveProjectFolderToTrash，不许再出现永久删除。
describe("删项目目录只有进回收站这一种做法", () => {
  it("repository.ts、workspaceRepository.ts、projectTrash.ts 里没有 rmSync / rmdirSync / unlinkSync", () => {
    for (const file of ["electron/projects/repository.ts", "electron/workspace/workspaceRepository.ts", "electron/projects/projectTrash.ts"]) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(source, file).not.toMatch(/\b(rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink)\s*\(/);
    }
  });
});

// 回收站报错原文 → 三类原因。样本是 2026-10-23 在真 macOS 上用 Electron shell.trashItem 采到的原文（不是凭记忆写的）：
// 「没有废纸篓」= 项目所在的卷是只读的 / 没有废纸篓，「没有权限」= 项目文件夹的上级目录不可写。中文、英文系统各一份。
// 其它语言认不出就归 unknown，只影响提示怎么说；进不了回收站一律什么都不删，认错不会多删一个字节。
describe("回收站报错原文 → 三类原因（真机采样）", () => {
  it.each([
    ["macOS 中文系统 · 该位置没有废纸篓", "未能将“folder1”移到废纸篓，因为宗卷“PLIBTRASHTEST”没有废纸篓。", "no-trash"],
    ["macOS 英文系统 · 该位置没有废纸篓", "“folder1” couldn’t be moved to the trash because the volume “PLIBTRASHTEST” doesn’t have one.", "no-trash"],
    ["macOS 中文系统 · 没有权限", "未能将“child”移到废纸篓，因为你没有访问该诊断报告的许可。", "permission"],
    ["macOS 英文系统 · 没有权限", "“child” couldn’t be moved to the trash because you don’t have permission to access it.", "permission"],
    ["Windows · 回收站放弃操作（Electron 自带的英文）", "Operation was aborted", "no-trash"],
    ["别的系统语言 · 认不出就是 unknown", "「folder1」をゴミ箱に入れられませんでした。", "unknown"],
  ] as const)("%s", (_label, message, reason) => {
    expect(classifyTrashFailure(new Error(message), "/Volumes/X/projects/folder1")).toBe(reason);
  });

  it("项目文件夹名是用户起的，会出现在系统原文里：名字叫 permission / locked 不能把原因带偏", () => {
    const folder = "/Volumes/X/projects/permission locked 项目";
    const noTrash = new Error("“permission locked 项目” couldn’t be moved to the trash because the volume “X” doesn’t have one.");
    expect(classifyTrashFailure(noTrash, folder)).toBe("no-trash");
    expect(classifyTrashFailure(new Error(`Failed on ${folder}`), folder)).toBe("unknown");
  });
});
