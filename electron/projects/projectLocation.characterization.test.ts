/**
 * 「项目在哪」特征测试（D-project-location 第 1 段，2026-10-29）。
 *
 * 钉的是**现状**，包括 0.24.0 一位 Windows 用户报的三件坏事：
 *   1. 项目位置设在安装目录里，升级删了安装目录：第一次打开库里全是「文件夹暂不可用」，关掉再开全没了；
 *   2. 在资源管理器里给项目文件夹改名：项目从库里消失，再用「选文件夹」打开改名后的文件夹，提示文件夹不存在；
 *   3. 画布上一张图「加载失败」、素材面板里那张图却在（这里只钉媒体解析里属于「项目在哪」的那几条事实）。
 * 标了「坏行为」的用例，收敛单（docs/plan/2026-10-29-project-location-owner.direction-check.md）会把它翻过来：
 * 到时候改断言，别删用例——它们就是收敛单的验收清单。
 *
 * 全部走真实生产函数（设置入口 pickProjectLocation、新建 createProject、选文件夹 openWorkspaceFolder、
 * 列表 listProjects、读 readProject、媒体 parseLocalAssetUrl…），只把 electron 换成指向临时目录的桩。
 * 「重启」= resetLegacyDiscoveryGuard（进程内一次性发现 guard 复位，等价于新进程）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let electronBase = "";

vi.mock("electron", () => ({
  app: {
    // 安装目录 = exe 所在目录（Windows 上就是用户自己选的 F:\Nomi_new 这一层）。
    getPath: (name: string) => (name === "exe" ? path.join(electronBase, "F_drive", "Nomi_new", "Nomi.exe") : path.join(electronBase, `electron-${name}`)),
    getAppPath: () => process.cwd(),
    getName: () => "Nomi",
    getVersion: () => "0.24.0",
    isPackaged: true,
    on: () => undefined,
  },
  ipcMain: { handle: () => undefined, on: () => undefined },
  dialog: {},
  shell: {},
  protocol: {},
  BrowserWindow: class {
    static getAllWindows() {
      return [];
    }
  },
}));

import { app } from "electron";
import { createProject, diagnoseProject, listProjects, projectDirById, readProject, saveProject } from "./repository";
import { checkProjectLocation, pickProjectLocation, revealProjectLocation } from "../settings/projectLocationIpc";
import { getSettingsRoot } from "../settings/settingsRoot";
import { listProjectAssets } from "../assets/projectAssetStore";
import { localAssetUrl } from "../assets/assetPaths";
import { parseLocalAssetUrl } from "../protocol/localProtocol";
import { assessWorkspaceFolderSafety, openWorkspaceFolder } from "../workspace/workspaceIpc";
import { resetLegacyDiscoveryGuard } from "../workspace/legacyProjectMigration";
import { findRecentWorkspace, listRecentWorkspaces } from "../workspace/workspaceRegistry";
import { releaseWorkspaceManifestLock, tryAcquireWorkspaceManifestLock } from "../workspace/workspaceManifestLock";
import { workspaceProjectFile } from "../workspace/workspacePaths";

type Card = { id: string; missing?: boolean; source?: string; rootPath?: string };
type Created = { id: string; lastKnownRootPath: string };

/** 新建项目（默认根下自动建文件夹）。声明类型是 ProjectRecord（没有 lastKnownRootPath），运行时拿到的是 workspace 记录（有）——两份记录形状本身也是收敛单要收的。 */
function createAtDefault(name: string): Created {
  return createProject({ name }) as unknown as Created;
}

let base = "";

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-location-"));
  electronBase = base;
  const settingsRoot = path.join(base, "userData");
  fs.mkdirSync(settingsRoot, { recursive: true });
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
  resetLegacyDiscoveryGuard();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetLegacyDiscoveryGuard();
  fs.rmSync(base, { recursive: true, force: true });
});

/** 「设置 → 新项目默认位置」里选一个目录（真实入口，原生对话框的结果注入进去）。 */
async function chooseDefaultLocation(root: string): Promise<void> {
  const picked = await pickProjectLocation({ showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) });
  expect(picked).toMatchObject({ ok: true, location: { path: path.resolve(root), source: "custom" } });
}

const restart = (): void => resetLegacyDiscoveryGuard();

async function cardsOf(ids: readonly string[]): Promise<Card[]> {
  return ((await listProjects()) as Card[]).filter((card) => ids.includes(card.id));
}

function registeredIds(ids: readonly string[]): string[] {
  return listRecentWorkspaces(getSettingsRoot()).map((entry) => entry.id).filter((id) => ids.includes(id));
}

function installDir(): string {
  return path.dirname(app.getPath("exe"));
}

describe("问题 1：默认位置在安装目录里，升级删了安装目录", () => {
  async function upgradedUser(): Promise<{ ids: string[]; root: string }> {
    const root = path.join(installDir(), "xiangmu");
    await chooseDefaultLocation(root);
    const ids = Array.from({ length: 5 }, (_, index) => createProject({ name: `项目${index + 1}` }).id);
    expect(await cardsOf(ids)).toHaveLength(5);
    fs.rmSync(installDir(), { recursive: true, force: true }); // 安装器那一半（另一条线修），这里只要结果
    restart();
    return { ids, root };
  }

  it("升级后第一次打开：5 张卡都在、都标 missing（「文件夹暂不可用」）；没人碰默认根时，重启多少次都还在（现状，保留）", async () => {
    const { ids, root } = await upgradedUser();
    const first = await cardsOf(ids);
    expect(first).toHaveLength(5);
    expect(first.every((card) => card.missing === true && card.source === "native")).toBe(true);
    restart();
    expect(await cardsOf(ids)).toHaveLength(5);
    expect(fs.existsSync(root)).toBe(false);
  });

  // 坏行为 1：列表读面按「native + missing + 默认根在」推断「用户真删了」，把登记摘掉；而默认根会被下面任何一扇门重新建出来。
  // 收敛单会把它翻过来：读路径不摘登记（卡片一直显示「找不到」，直到用户自己移除或重新打开那个文件夹），读路径也不建默认根。
  it.each<[string, (ids: string[]) => unknown]>([
    ["新建项目 createProject", () => createProject({ name: "升级后新建" })],
    ["素材库「所有项目」逐个列素材 listProjectAssets", (ids) => listProjectAssets({ projectId: ids[0] })],
    ["按 id 找项目目录 projectDirById（nomi-local 媒体 / 导出 / 暂存回收）", (ids) => projectDirById(ids[0])],
    ["读项目 readProject（MCP 读、单个同步检查、列文件）", (ids) => readProject(ids[0])],
    ["设置「检查目录」checkProjectLocation", () => checkProjectLocation()],
    ["设置「打开目录」revealProjectLocation", () => revealProjectLocation({ openPath: async () => "" })],
  ])("坏行为 1：%s 把默认根建回来以后，下一次列表把 5 张灰卡从登记里永久摘掉（收敛单会把它翻过来）", async (_door, touch) => {
    const { ids, root } = await upgradedUser();
    expect(await cardsOf(ids)).toHaveLength(5);

    await touch(ids);
    expect(fs.existsSync(root)).toBe(true);

    expect(await cardsOf(ids)).toHaveLength(0); // 同一会话里刷新一次库就没了
    restart();
    expect(await cardsOf(ids)).toHaveLength(0); // 关掉再开：也没了
    expect(registeredIds(ids)).toEqual([]); // 登记被物理删除，文件夹恢复到原处之外的地方都找不回
  });
});

describe("问题 2：在资源管理器里给项目文件夹改名", () => {
  async function defaultLocation(): Promise<string> {
    const root = path.join(base, "Documents", "Nomi Projects");
    await chooseDefaultLocation(root);
    await listProjects(); // 启动后第一次列举（吃掉进程内一次性发现）
    return root;
  }

  async function openFolder(rootPath: string, initialize = false): Promise<{ id: string; lastKnownRootPath?: string }> {
    return (await openWorkspaceFolder(
      { rootPath, initialize },
      { createProject, selectedRootPaths: new Set([path.resolve(rootPath)]), confirmInitialize: () => true, homedir: base },
    )) as { id: string; lastKnownRootPath?: string };
  }

  it("坏行为 2a：默认根里的项目改名后，同一会话下一次列表就把它从库里摘掉（收敛单会把它翻过来：留在库里标「找不到」）", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    fs.renameSync(project.lastKnownRootPath, `${project.lastKnownRootPath}-改名`);

    expect(await cardsOf([project.id])).toEqual([]);
    expect(findRecentWorkspace(getSettingsRoot(), project.id)).toBeNull();
  });

  it("坏行为 2b：选文件夹打开改名后的文件夹，登记的是清单里创建时的旧路径、不是用户刚选的目录（收敛单会把它翻过来：登记 = 用户这次打开的目录）", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    const oldRoot = project.lastKnownRootPath;
    const renamed = `${oldRoot}-改名`;
    fs.renameSync(oldRoot, renamed);
    await listProjects();

    const opened = await openFolder(renamed);
    expect(opened.id).toBe(project.id);
    expect(opened.lastKnownRootPath).toBe(oldRoot);
    expect(findRecentWorkspace(getSettingsRoot(), project.id)).toMatchObject({ rootPath: oldRoot, missing: true, source: "folder" });
    // 渲染层随后打开它：读不到 → 诊断 missing-folder →「项目文件夹不存在或磁盘未连接」。
    expect(diagnoseProject(project.id)).toMatchObject({ status: "missing-folder", rootPath: oldRoot });
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: true, rootPath: oldRoot })]);
  });

  it("坏行为 2c：登记失效后 readProject 按 id 扫默认根找到改名的目录，却读根上的 project.json，造出一份别的 id、没有内容的「Untitled Project」（收敛单会把它翻过来：删掉按 id 扫默认根）", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    fs.renameSync(project.lastKnownRootPath, `${project.lastKnownRootPath}-改名`);
    await listProjects();
    await openFolder(`${project.lastKnownRootPath}-改名`);

    const read = readProject(project.id) as { id: string; name: string; payload?: unknown; lastKnownRootPath?: string } | null;
    expect(read).not.toBeNull();
    expect(read?.id).not.toBe(project.id);
    expect(read).toMatchObject({ name: "Untitled Project" });
    expect(read?.payload).toBeUndefined();
    expect(read?.lastKnownRootPath).toBeUndefined();
  });

  it("坏行为 2d：外部文件夹（选文件夹建的项目）改名后重新打开，登记仍是旧路径，重启也回不来（收敛单会把它翻过来）", async () => {
    await defaultLocation();
    const externalRoot = path.join(base, "D_drive", "作品", "我的短片");
    const project = await openFolder(externalRoot, true);
    fs.renameSync(externalRoot, `${externalRoot}-改名`);
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: true, source: "folder" })]);

    await openFolder(`${externalRoot}-改名`);
    expect(readProject(project.id)).toBeNull();
    expect(diagnoseProject(project.id)).toMatchObject({ status: "missing-folder", rootPath: externalRoot });
    restart();
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: true, rootPath: externalRoot })]);
  });

  it("坏行为 2e：项目开着时在默认根里被改名，库刷新一次后，自动保存经「按 id 扫默认根」写进根上的旧格式 project.json；.nomi 清单不动，重启后读到的是改名前的内容（收敛单会把它翻过来）", async () => {
    await defaultLocation();
    const project = createAtDefault("开着改名");
    const renamed = `${project.lastKnownRootPath}-改名`;
    fs.renameSync(project.lastKnownRootPath, renamed);
    await listProjects(); // 库刷新：摘登记（坏行为 2a）

    // 渲染层的自动保存不带 expectedBinding（projectPersistenceService → saveLocalProject(id, payload)）。
    await saveProject(project.id, { payload: { marker: "改名后自动保存的内容" } });
    expect(JSON.parse(fs.readFileSync(path.join(renamed, "project.json"), "utf8"))).toMatchObject({ payload: { marker: "改名后自动保存的内容" } });
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(renamed), "utf8")).payload?.marker).toBeUndefined();

    restart();
    await listProjects(); // 发现流程按新路径登记回来，读的是 .nomi 清单
    expect((readProject(project.id) as { payload?: { marker?: string } } | null)?.payload?.marker).toBeUndefined();
  });

  it("坏行为 2f：复制一份项目文件夹、用选文件夹打开副本：登记仍指着原文件夹，之后的保存全写进原文件夹（收敛单会把它翻过来，并要定「同一个 id 两个文件夹」怎么办）", async () => {
    await defaultLocation();
    const original = createAtDefault("原片");
    const copy = path.join(base, "E_drive", "原片-副本");
    fs.cpSync(original.lastKnownRootPath, copy, { recursive: true });

    const opened = await openFolder(copy);
    expect(opened.id).toBe(original.id);
    expect(findRecentWorkspace(getSettingsRoot(), original.id)).toMatchObject({ rootPath: original.lastKnownRootPath, missing: false });

    await saveProject(original.id, { payload: { marker: "在副本里做的修改" } });
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(original.lastKnownRootPath), "utf8"))).toMatchObject({ payload: { marker: "在副本里做的修改" } });
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(copy), "utf8")).payload?.marker).toBeUndefined();
  });

  it("坏行为 2g：在默认根里复制一份项目文件夹（「xxx - 副本」），之后只是重启：每次启动发现流程按 id 把登记改绑到没登记的那个文件夹，原件和副本来回换，上一次启动后的修改下一次就看不到（收敛单会把它翻过来：启动对账不改绑一个还绑在活文件夹上的 id）", async () => {
    await defaultLocation();
    const original = createAtDefault("原片");
    const copy = `${original.lastKnownRootPath} - 副本`;
    await saveProject(original.id, { payload: { marker: "复制前" } });
    fs.cpSync(original.lastKnownRootPath, copy, { recursive: true });
    const boundTo = (): string | undefined => findRecentWorkspace(getSettingsRoot(), original.id)?.rootPath;
    const shown = (): string | undefined => (readProject(original.id) as { payload?: { marker?: string } } | null)?.payload?.marker;

    restart();
    expect(await cardsOf([original.id])).toHaveLength(1);
    expect(boundTo()).toBe(copy);
    await saveProject(original.id, { payload: { marker: "第 1 次启动后的修改" } });
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(copy), "utf8"))).toMatchObject({ payload: { marker: "第 1 次启动后的修改" } });

    restart();
    await listProjects();
    expect(boundTo()).toBe(original.lastKnownRootPath);
    expect(shown()).toBe("复制前"); // 第 1 次启动后的修改在副本里，这次打开的是原件

    restart();
    await listProjects();
    expect(boundTo()).toBe(copy);
    expect(shown()).toBe("第 1 次启动后的修改");
  });

  it("现状：默认根里改名、不重新打开，下次启动的发现流程按新路径把它登记回来（native）；收敛单要决定这条发现还留不留", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    const renamed = `${project.lastKnownRootPath}-改名`;
    fs.renameSync(project.lastKnownRootPath, renamed);
    expect(await cardsOf([project.id])).toEqual([]);

    restart();
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: false, source: "native", rootPath: renamed })]);
  });
});

describe("问题 3 里属于「项目在哪」的媒体解析事实（画布图卡与素材面板走同一个 nomi-local 解析）", () => {
  const rel = "assets/generated/2026-10-29/shot.png";

  async function currentProject(): Promise<{ id: string; lastKnownRootPath: string }> {
    await chooseDefaultLocation(path.join(base, "Documents", "Nomi Projects"));
    await listProjects();
    const project = createAtDefault("当前项目");
    fs.mkdirSync(path.join(project.lastKnownRootPath, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(project.lastKnownRootPath, rel), "png");
    return project;
  }

  it("节点 URL 带的是别的项目的 id、那个项目的位置找不到：解析失败（协议回 404）；同一份文件按当前项目 id 照常解析（问题 3 的候选之一）", async () => {
    const project = await currentProject();
    expect(parseLocalAssetUrl(localAssetUrl("workspace-foreign-project", rel))).toBeNull();
    const target = parseLocalAssetUrl(localAssetUrl(project.id, rel));
    expect(target?.projectId).toBe(project.id);
    expect(fs.realpathSync(String(target?.filePath))).toBe(fs.realpathSync(path.join(project.lastKnownRootPath, rel)));
  });

  it("清单走不了无锁快照时，每一次媒体解析都要取清单锁；别的写者正拿着锁 → 解析失败（问题 3 的候选之一，收敛单会把它翻过来：问「在哪」不重读清单）", async () => {
    const project = await currentProject();
    const manifestFile = workspaceProjectFile(project.lastKnownRootPath);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
    // 非媒体 data: 串不会被落盘瘦身，它让快照读永远退回加锁读。
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, payload: { note: "data:application/octet-stream;base64,AAAA" } }));
    const url = localAssetUrl(project.id, rel);
    const lease = tryAcquireWorkspaceManifestLock(project.lastKnownRootPath);
    try {
      expect(parseLocalAssetUrl(url)).toBeNull();
    } finally {
      releaseWorkspaceManifestLock(lease);
    }
    expect(parseLocalAssetUrl(url)).not.toBeNull();
  });

  it("当前项目在默认根里被改名：媒体解析靠按 id 扫默认根仍能出图，同一时刻 readProject 却给出别的 id 的空记录（两条读路径答案不一致）", async () => {
    const project = await currentProject();
    const renamed = `${project.lastKnownRootPath}-改名`;
    fs.renameSync(project.lastKnownRootPath, renamed);
    await listProjects(); // 库刷新：摘登记（坏行为 1 / 2a 同一条）

    const target = parseLocalAssetUrl(localAssetUrl(project.id, rel));
    expect(fs.realpathSync(String(target?.filePath))).toBe(fs.realpathSync(path.join(renamed, rel)));
    expect((readProject(project.id) as { id?: string } | null)?.id).not.toBe(project.id);
  });
});

describe("问题 1 的上游：每个入口都不拒绝应用自己的目录", () => {
  it("坏行为 4a：新项目默认位置接受安装目录里面的路径，新建项目就落进安装目录（收敛单会把它翻过来）", async () => {
    const insideInstall = path.join(installDir(), "xiangmu");
    await chooseDefaultLocation(insideInstall);
    const project = createAtDefault("放进安装目录");
    expect(project.lastKnownRootPath.startsWith(`${insideInstall}${path.sep}`)).toBe(true);
  });

  it("坏行为 4b：新项目默认位置接受用户数据目录（userData）里面的路径（收敛单会把它翻过来）", async () => {
    await chooseDefaultLocation(path.join(getSettingsRoot(), "projects"));
  });

  it("坏行为 4c：选文件夹的安全检查不认安装目录和用户数据目录（收敛单会把它翻过来）", () => {
    expect(assessWorkspaceFolderSafety(path.join(installDir(), "xiangmu", "某项目"), { homedir: base })).toMatchObject({ ok: true });
    expect(assessWorkspaceFolderSafety(path.join(getSettingsRoot(), "某项目"), { homedir: base })).toMatchObject({ ok: true });
  });
});
