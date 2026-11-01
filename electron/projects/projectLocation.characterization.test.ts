/**
 * 「项目在哪」特征测试（D-project-location 第 1 段钉现状，2026-10-29；I-project-location 第一刀翻转）。
 *
 * 0.24.0 一位 Windows 用户报的三件坏事：
 *   1. 项目位置设在安装目录里，升级删了安装目录：第一次打开库里全是「文件夹暂不可用」，关掉再开全没了；
 *   2. 在资源管理器里给项目文件夹改名：项目从库里消失，再用「选文件夹」打开改名后的文件夹，提示文件夹不存在；
 *   3. 画布上一张图「加载失败」、素材面板里那张图却在（这里只钉媒体解析里属于「项目在哪」的那几条事实）。
 * 第 1 段标「坏行为」的用例由收敛单（docs/plan/2026-10-29-project-location-owner.md）翻过来：改断言、不删用例。
 * 标「已翻（第一刀）」的是 0.24.1 这一刀的验收；标「现状（第二刀翻）」的属删除清单第 4 / 5 条与 3C，0.24.2 再翻。
 * 「入口 × 路径形状 × 状态」的完整矩阵在 projectLocation.matrix.test.ts。
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
import { readProjectLocationSettings, writeProjectsRoot } from "../settings/projectLocationSettings";
import { getSettingsRoot } from "../settings/settingsRoot";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { createWorkspaceProject } from "../workspace/workspaceRepository";
import { projectLocationRejection, workspaceFolderCopy } from "../shared/contracts/projectLocation";
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

/** 目录树快照（相对路径 → 内容）：「两个文件夹都不写」「读调用不建不写」用它比。 */
function treeSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(root)) return out;
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out[`${path.relative(root, full)}/`] = "";
        visit(full);
      } else out[path.relative(root, full)] = fs.readFileSync(full, "utf8");
    }
  };
  visit(root);
  return out;
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe("问题 1：默认位置在安装目录里，升级删了安装目录", () => {
  // 0.24.0 允许把默认位置设进安装目录、在那里建项目；第一刀起入口拒绝（见「问题 1 的上游」），这里照 0.24.0 留下的盘面直接摆出来：
  // 设置文件里写着安装目录下的位置，5 个项目由当时的建项目流程（createWorkspaceProject，native 来源）建在那里。
  async function upgradedUser(): Promise<{ ids: string[]; root: string }> {
    const root = path.join(installDir(), "xiangmu");
    writeProjectsRoot(root);
    const ids = Array.from({ length: 5 }, (_, index) =>
      createWorkspaceProject(
        { rootPath: path.join(root, `项目${index + 1}-0240`), record: { name: `项目${index + 1}` }, origin: { source: "native", nativeRootPath: root } },
        getWorkspaceRepositoryDeps(),
      ).id,
    );
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

  // 坏行为 1（已翻，第一刀）：以前列表按「native + missing + 默认根在」推断「用户真删了」就摘登记，而下面任何一扇门都会先把默认根建回来。
  // 现在：读路径不建默认根（新建项目在应用目录里直接被拒），列表也不摘登记——5 张卡一直标「找不到」，登记一条不少。
  it.each<[string, (ids: string[]) => unknown, unknown]>([
    ["新建项目 createProject（被拒：默认位置在安装目录里）", () => createProject({ name: "升级后新建" }), "install"],
    ["素材库「所有项目」逐个列素材 listProjectAssets", (ids) => listProjectAssets({ projectId: ids[0] }), { items: [], cursor: null }],
    ["按 id 找项目目录 projectDirById（nomi-local 媒体 / 导出 / 暂存回收）", (ids) => projectDirById(ids[0]), null],
    ["读项目 readProject（MCP 读、单个同步检查、列文件）", (ids) => readProject(ids[0]), null],
    ["设置「检查目录」checkProjectLocation（只报：在 Nomi 自己的目录里）", () => checkProjectLocation(), { ok: false, error: "inside-app" }],
    ["设置「打开目录」revealProjectLocation（只报：不存在）", () => revealProjectLocation({ openPath: async () => "" }), { ok: false, error: "missing" }],
  ])("已翻（第一刀）：升级后碰 %s，默认根不被建回来；5 张卡都在、标 missing，重启后还在，登记一条不少", async (_door, touch, expected) => {
    const { ids, root } = await upgradedUser();
    expect(await cardsOf(ids)).toHaveLength(5);

    let outcome: unknown;
    try {
      outcome = await touch(ids);
    } catch (error) {
      outcome = projectLocationRejection(error) ?? error;
    }
    expect(outcome).toEqual(expected);
    expect(fs.existsSync(root)).toBe(false);

    const sameSession = await cardsOf(ids);
    expect(sameSession).toHaveLength(5);
    expect(sameSession.every((card) => card.missing === true)).toBe(true);
    restart();
    expect(await cardsOf(ids)).toHaveLength(5);
    expect(registeredIds(ids).sort()).toEqual([...ids].sort());
  });

  it("已翻（第一刀）：默认根不管被谁建回来（用户自己新建了同名文件夹），列表照样不摘：文件夹不在 ≠ 用户删了", async () => {
    const { ids, root } = await upgradedUser();
    fs.mkdirSync(root, { recursive: true });
    expect(await cardsOf(ids)).toEqual(ids.map(() => expect.objectContaining({ missing: true })));
    restart();
    expect(await cardsOf(ids)).toHaveLength(5);
    expect(registeredIds(ids)).toHaveLength(5);
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

  it("已翻（第一刀，坏行为 2a）：默认根里的项目改名后，同一会话刷新库：卡还在、标「找不到」，登记不动", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    fs.renameSync(project.lastKnownRootPath, `${project.lastKnownRootPath}-改名`);

    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: true, rootPath: project.lastKnownRootPath })]);
    expect(findRecentWorkspace(getSettingsRoot(), project.id)).toMatchObject({ rootPath: project.lastKnownRootPath, missing: true });
  });

  it("已翻（第一刀，坏行为 2b）：选文件夹打开改名后的文件夹，登记 = 用户这次打开的目录，接上原项目（同一个 id），诊断 ok", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    const oldRoot = project.lastKnownRootPath;
    const renamed = `${oldRoot}-改名`;
    fs.renameSync(oldRoot, renamed);
    await listProjects();

    const opened = await openFolder(renamed);
    expect(opened.id).toBe(project.id);
    expect(opened.lastKnownRootPath).toBe(renamed);
    expect(findRecentWorkspace(getSettingsRoot(), project.id)).toMatchObject({ rootPath: renamed, missing: false });
    expect(diagnoseProject(project.id)).toMatchObject({ status: "ok", rootPath: renamed });
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: false, rootPath: renamed })]);
    expect(fs.existsSync(oldRoot)).toBe(false);
  });

  it("已翻（第一刀，坏行为 2c）：重开改名后的文件夹之后，readProject 读出的就是原项目（同一个 id、原名、登记路径）", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    fs.renameSync(project.lastKnownRootPath, `${project.lastKnownRootPath}-改名`);
    await listProjects();
    await openFolder(`${project.lastKnownRootPath}-改名`);

    const read = readProject(project.id) as { id: string; name: string; lastKnownRootPath?: string } | null;
    expect(read).toMatchObject({ id: project.id, name: "我的短片", lastKnownRootPath: `${project.lastKnownRootPath}-改名` });
  });

  it("现状（第二刀翻，删除清单第 5 条）：改名后还没重开时，readProject 经按 id 扫默认根读根上的 project.json，现造一份别的 id 的空记录（不写盘）", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    const renamed = `${project.lastKnownRootPath}-改名`;
    fs.renameSync(project.lastKnownRootPath, renamed);
    const before = treeSnapshot(renamed);

    const read = readProject(project.id) as { id: string; name: string } | null;
    expect(read?.id).not.toBe(project.id);
    expect(read).toMatchObject({ name: "Untitled Project" });
    expect(treeSnapshot(renamed)).toEqual(before);
  });

  it("已翻（第一刀，坏行为 2d）：外部文件夹改名后，重启仍是「找不到」卡；重开改名后的目录就接上，重启后也接着", async () => {
    await defaultLocation();
    const externalRoot = path.join(base, "D_drive", "作品", "我的短片");
    const project = await openFolder(externalRoot, true);
    fs.renameSync(externalRoot, `${externalRoot}-改名`);
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: true, source: "folder" })]);
    restart();
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: true, rootPath: externalRoot })]);

    await openFolder(`${externalRoot}-改名`);
    expect(readProject(project.id)).toMatchObject({ id: project.id });
    expect(diagnoseProject(project.id)).toMatchObject({ status: "ok", rootPath: `${externalRoot}-改名` });
    restart();
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: false, rootPath: `${externalRoot}-改名` })]);
  });

  it("已翻（第一刀，坏行为 2e）：项目开着时在默认根里被改名，库刷新后自动保存照实报「找不到项目」，不写根上的旧格式 project.json、不把旧文件夹建回来；重启后按新路径接回，内容是改名前存下的", async () => {
    await defaultLocation();
    const project = createAtDefault("开着改名");
    await saveProject(project.id, { payload: { marker: "改名前存下的内容" } });
    const renamed = `${project.lastKnownRootPath}-改名`;
    fs.renameSync(project.lastKnownRootPath, renamed);
    await listProjects(); // 库刷新：不摘登记，卡标「找不到」
    const before = treeSnapshot(renamed);

    // 渲染层的自动保存不带 expectedBinding（projectPersistenceService → saveLocalProject(id, payload)）。
    await expect(saveProject(project.id, { payload: { marker: "改名后自动保存的内容" } })).rejects.toThrow(/not found/i);
    expect(fs.existsSync(path.join(renamed, "project.json"))).toBe(false);
    expect(treeSnapshot(renamed)).toEqual(before);
    expect(fs.existsSync(project.lastKnownRootPath)).toBe(false);

    restart();
    await listProjects(); // 启动对账按新路径接回（原登记的文件夹已经不在了）
    expect(findRecentWorkspace(getSettingsRoot(), project.id)).toMatchObject({ rootPath: renamed, missing: false });
    expect((readProject(project.id) as { payload?: { marker?: string } } | null)?.payload?.marker).toBe("改名前存下的内容");
  });

  it("已翻（第一刀，坏行为 2f）：复制一份项目文件夹、用选文件夹打开副本：拒绝（说原文件夹在哪），不改绑，两个文件夹都不写", async () => {
    await defaultLocation();
    const original = createAtDefault("原片");
    const copy = path.join(base, "E_drive", "原片-副本");
    fs.cpSync(original.lastKnownRootPath, copy, { recursive: true });
    const originalBefore = treeSnapshot(original.lastKnownRootPath);
    const copyBefore = treeSnapshot(copy);

    let rejected: unknown = null;
    try {
      await openFolder(copy);
    } catch (error) {
      rejected = error;
    }
    expect(workspaceFolderCopy(rejected)).toEqual({ projectName: "原片", originalRootPath: original.lastKnownRootPath });
    expect(findRecentWorkspace(getSettingsRoot(), original.id)).toMatchObject({ rootPath: original.lastKnownRootPath, missing: false });
    expect(treeSnapshot(original.lastKnownRootPath)).toEqual(originalBefore);
    expect(treeSnapshot(copy)).toEqual(copyBefore);
    // 之后的保存照旧只写原文件夹。
    await saveProject(original.id, { payload: { marker: "拒绝之后的修改" } });
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(copy), "utf8")).payload?.marker).toBeUndefined();
  });

  it("已翻（第一刀，坏行为 2g）：在默认根里复制一份项目文件夹（「xxx - 副本」），之后连续重启：登记始终指原件，副本不登记也不被写，每次启动后的修改下一次都看得到；原件被挪走后再启动才接到副本", async () => {
    await defaultLocation();
    const original = createAtDefault("原片");
    const copy = `${original.lastKnownRootPath} - 副本`;
    await saveProject(original.id, { payload: { marker: "复制前" } });
    fs.cpSync(original.lastKnownRootPath, copy, { recursive: true });
    const copyBefore = treeSnapshot(copy);
    const boundTo = (): string | undefined => findRecentWorkspace(getSettingsRoot(), original.id)?.rootPath;
    const shown = (): string | undefined => (readProject(original.id) as { payload?: { marker?: string } } | null)?.payload?.marker;

    for (const round of [1, 2, 3]) {
      restart();
      expect(await cardsOf([original.id])).toHaveLength(1);
      expect(boundTo()).toBe(original.lastKnownRootPath);
      expect(shown()).toBe(round === 1 ? "复制前" : `第 ${round - 1} 次启动后的修改`);
      await saveProject(original.id, { payload: { marker: `第 ${round} 次启动后的修改` } });
    }
    expect(treeSnapshot(copy)).toEqual(copyBefore);
    expect(listRecentWorkspaces(getSettingsRoot()).filter((entry) => entry.id === original.id)).toHaveLength(1);

    fs.renameSync(original.lastKnownRootPath, path.join(base, "挪走的原件"));
    restart();
    await listProjects();
    expect(boundTo()).toBe(copy);
    expect(shown()).toBe("复制前");
  });

  it("保留（收敛单第 3 条）：默认根里改名、不重新打开，同一会话是「找不到」卡；下次启动对账按新路径接回（原登记的文件夹已不在，native）", async () => {
    await defaultLocation();
    const project = createAtDefault("我的短片");
    const renamed = `${project.lastKnownRootPath}-改名`;
    fs.renameSync(project.lastKnownRootPath, renamed);
    expect(await cardsOf([project.id])).toEqual([expect.objectContaining({ missing: true })]);

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

  it("现状（第二刀翻，3C）：清单走不了无锁快照时，每一次媒体解析都要取清单锁；别的写者正拿着锁 → 解析失败（问题 3 的候选之一；第二刀问「在哪」不重读清单）", async () => {
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

  it("现状（第二刀翻，删除清单第 4 / 5 条）：当前项目在默认根里被改名、还没重开：媒体解析靠按 id 扫默认根仍能出图，同一时刻 readProject 却给出别的 id 的空记录（两条读路径答案不一致）", async () => {
    const project = await currentProject();
    const renamed = `${project.lastKnownRootPath}-改名`;
    fs.renameSync(project.lastKnownRootPath, renamed);
    await listProjects(); // 库刷新：登记还在、标 missing

    const target = parseLocalAssetUrl(localAssetUrl(project.id, rel));
    expect(fs.realpathSync(String(target?.filePath))).toBe(fs.realpathSync(path.join(renamed, rel)));
    expect((readProject(project.id) as { id?: string } | null)?.id).not.toBe(project.id);
  });
});

describe("问题 1 的上游：每个入口都拒绝应用自己的目录", () => {
  it("已翻（第一刀，坏行为 4a）：新项目默认位置不接受安装目录里面的路径，原设置不变；0.24.0 已经设在那里的老用户点新建被拒，什么都不建", async () => {
    const insideInstall = path.join(installDir(), "xiangmu");
    const picked = await pickProjectLocation({ showOpenDialog: async () => ({ canceled: false, filePaths: [insideInstall] }) });
    expect(picked).toEqual({ ok: false, error: "inside-app" });
    expect(readProjectLocationSettings().projectsRoot).toBeNull();
    expect(fs.existsSync(insideInstall)).toBe(false);

    writeProjectsRoot(insideInstall); // 0.24.0 允许这样设
    expect(projectLocationRejection(caught(() => createAtDefault("放进安装目录")))).toBe("install");
    expect(fs.existsSync(insideInstall)).toBe(false);
  });

  it("已翻（第一刀，坏行为 4b）：新项目默认位置不接受用户数据目录（userData / 设置根）里面的路径", async () => {
    for (const root of [path.join(getSettingsRoot(), "projects"), path.join(app.getPath("userData"), "projects")]) {
      const picked = await pickProjectLocation({ showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) });
      expect(picked).toEqual({ ok: false, error: "inside-app" });
    }
    expect(readProjectLocationSettings().projectsRoot).toBeNull();
  });

  it("已翻（第一刀，坏行为 4c）：选文件夹的安全检查拒绝安装目录和用户数据目录，原因带类别", () => {
    expect(assessWorkspaceFolderSafety(path.join(installDir(), "xiangmu", "某项目"), { homedir: base })).toMatchObject({ ok: false, reason: expect.stringContaining("ProjectLocationRejectedError[install]") });
    expect(assessWorkspaceFolderSafety(path.join(getSettingsRoot(), "某项目"), { homedir: base })).toMatchObject({ ok: false, reason: expect.stringContaining("ProjectLocationRejectedError[app-data]") });
  });
});
