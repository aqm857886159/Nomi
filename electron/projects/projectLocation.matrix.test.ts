/**
 * 「项目在哪」入口 × 路径形状 × 状态矩阵（docs/plan/2026-10-29-project-location-owner.md ★9 ①–⑦，第一刀）。
 *
 * 一、入口拒绝 Nomi 自己的目录（不变量 ④）：会把项目放到某个位置的六个入口——设置「新项目默认位置」选位置、
 *    设置「检查目录」、「打开已有文件夹」的选择与打开、渲染层「新建项目」（同步 IPC nomi:projects:create）、
 *    外部 Agent 建项目（createNamedProject）——× Nomi 自己的五个目录 × 五种路径形状：全拒，被拒时整棵临时盘
 *    （含设置与登记）一个字节都不变。反例：用户自己的五种位置六个入口全放行；环境变量托管的位置不判。
 * 二、状态（不变量 ①②③⑤）：改名、挪盘、默认根整个挪走又被建回、两个文件夹都在的副本、原件扔了的副本、
 *    经符号链接 / 末尾分隔符打开同一个文件夹 ×「打开已有文件夹」「不重开、连续重启」「读面不写」；
 *    另有外置盘拔掉又插回、从项目库移除、找不到的卡片能移除、默认位置被删后新建照建。
 *
 * path.win32 的盘符 / 大小写 / 正反斜杠在 electron/workspace/workspaceLocationPolicy.test.ts（纯推导）；
 * 这里全部走真实生产函数和真实文件系统，只把 electron 换成指向临时目录的桩（打包形态：isPackaged = true）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ base: "" }));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => {
      const base = electronState.base;
      if (name === "exe") return path.join(base, "F_drive", "Nomi_new", "Nomi.exe");
      if (name === "userData") return path.join(base, "AppData", "Roaming", "Nomi");
      if (name === "logs") return path.join(base, "AppData", "Roaming", "Nomi", "logs"); // Windows 上日志就在 userData 里
      if (name === "temp") return path.join(base, "AppData", "Local", "Temp");
      if (name === "documents") return path.join(base, "home", "Documents");
      return path.join(base, `electron-${name}`);
    },
    getAppPath: () => process.cwd(),
    getName: () => "Nomi",
    getVersion: () => "0.24.1",
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

import { projectDeleteChoice } from "../../src/workbench/library/projectDeleteChoice";
import { createNamedProject } from "../capabilityCore/core";
import { listProjectAssets } from "../assets/projectAssetStore";
import { localAssetUrl } from "../assets/assetPaths";
import { parseLocalAssetUrl } from "../protocol/localProtocol";
import { checkProjectLocation, pickProjectLocation, revealProjectLocation } from "../settings/projectLocationIpc";
import { writeProjectsRoot } from "../settings/projectLocationSettings";
import { getSettingsRoot } from "../settings/settingsRoot";
import { projectLocationRejection, workspaceFolderCopy, type AppOwnedLocationKind } from "../shared/contracts/projectLocation";
import { resetLegacyDiscoveryGuard } from "../workspace/legacyProjectMigration";
import { openWorkspaceFolder, selectWorkspaceFolder } from "../workspace/workspaceIpc";
import { findRecentWorkspace, listRecentWorkspaces } from "../workspace/workspaceRegistry";
import { registerProjectsIpc } from "./projectsIpc";
import { createProject, deleteProject, diagnoseProject, listProjects, projectDirById, readProject, recoverProject, saveProject } from "./repository";

// 渲染层「新建项目」走的同一个同步 IPC 处理函数（main.ts 用同一组 repository 函数注册它）。
const syncHandlers = new Map<string, (record: unknown) => unknown>();
registerProjectsIpc({
  registerSyncIpc: (channel, handler) => syncHandlers.set(channel, handler as unknown as (record: unknown) => unknown),
  listProjects,
  createProject,
  readProject,
  saveProject,
  deleteProject,
  diagnoseProject,
  recoverProject,
});
function rendererCreate(record: unknown): { id: string; name: string; lastKnownRootPath: string } {
  const handler = syncHandlers.get("nomi:projects:create");
  if (!handler) throw new Error("nomi:projects:create was not registered");
  return handler(record) as { id: string; name: string; lastKnownRootPath: string };
}

let base = "";
const home = (): string => path.join(base, "home");
const defaultRoot = (): string => path.join(home(), "Documents", "Nomi Projects");
const restart = (): void => resetLegacyDiscoveryGuard();

type AppPlace = { label: string; dir: () => string; kind: AppOwnedLocationKind };
const APP_PLACES: AppPlace[] = [
  { label: "安装目录（exe 所在的 F:\\Nomi_new 这一层）", dir: () => path.join(base, "F_drive", "Nomi_new"), kind: "install" },
  { label: "单独给出的 resources（process.resourcesPath）", dir: () => path.join(base, "Mount", "Nomi", "resources"), kind: "install" },
  { label: "userData", dir: () => path.join(base, "AppData", "Roaming", "Nomi"), kind: "app-data" },
  { label: "设置根（NOMI_SETTINGS_DIR）", dir: () => path.join(home(), ".nomi"), kind: "app-data" },
  { label: "系统临时目录（getPath temp）", dir: () => path.join(base, "AppData", "Local", "Temp"), kind: "temp" },
];

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-location-matrix-")));
  electronState.base = base;
  vi.stubEnv("NOMI_SETTINGS_DIR", path.join(home(), ".nomi"));
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
  (process as { resourcesPath?: string }).resourcesPath = path.join(base, "Mount", "Nomi", "resources");
  for (const place of APP_PLACES) fs.mkdirSync(place.dir(), { recursive: true });
  fs.mkdirSync(path.join(home(), "Desktop"), { recursive: true });
  resetLegacyDiscoveryGuard();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (process as { resourcesPath?: string }).resourcesPath;
  resetLegacyDiscoveryGuard();
  fs.rmSync(base, { recursive: true, force: true });
});

/** 目录树快照（相对路径 → 内容 / 链接目标），skip 里的目录不进快照。比字节，不比时间。 */
function treeSnapshot(root: string, skip: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (skip.some((skipped) => full === skipped || full.startsWith(`${skipped}${path.sep}`))) continue;
      const rel = path.relative(root, full);
      if (entry.isSymbolicLink()) out[rel] = `-> ${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) {
        out[`${rel}${path.sep}`] = "";
        visit(full);
      } else out[rel] = fs.readFileSync(full).toString("base64");
    }
  };
  visit(root);
  return out;
}

/** 用户的磁盘：临时盘里除 Nomi 自己目录（日志、设置、登记都在那几处）以外的全部。 */
const userDisk = (): Record<string, string> => treeSnapshot(base, APP_PLACES.map((place) => place.dir()));
const registryBytes = (): string => {
  try {
    return fs.readFileSync(path.join(getSettingsRoot(), "recent-workspaces.json"), "utf8");
  } catch {
    return "";
  }
};
const realpath = (target: string | undefined): string => fs.realpathSync(String(target));
const entriesFor = (id: string) => listRecentWorkspaces(getSettingsRoot()).filter((entry) => entry.id === id);

type EntranceResult = "accepted" | "rejected" | `rejected:${AppOwnedLocationKind}`;

function rejectionOf(error: unknown): EntranceResult {
  const kind = projectLocationRejection(error);
  if (kind) return `rejected:${kind}`;
  throw error;
}

async function openFolder(rootPath: string, initialize = false, name?: string): Promise<{ id: string; name: string; lastKnownRootPath: string }> {
  return (await openWorkspaceFolder(
    name ? { rootPath, initialize, name } : { rootPath, initialize },
    { createProject, selectedRootPaths: new Set([path.resolve(rootPath)]), confirmInitialize: () => true, homedir: home() },
  )) as { id: string; name: string; lastKnownRootPath: string };
}

type Entrance = {
  label: string;
  /** 被拒时说不说得出是哪类目录：设置页只回 inside-app（一句话不分类），其余入口带类别给渲染层。 */
  carriesKind: boolean;
  /** 碰入口之前的盘面（老用户在 0.24.0 已经设好的位置）；快照在它之后取。 */
  arrange?: (candidate: string) => void;
  act: (candidate: string) => Promise<EntranceResult>;
};

const ENTRANCES: Entrance[] = [
  {
    label: "设置「新项目默认位置」选位置",
    carriesKind: false,
    act: async (candidate) => {
      const result = await pickProjectLocation({ showOpenDialog: async () => ({ canceled: false, filePaths: [candidate] }) });
      if (result.ok) return "accepted";
      if (result.error === "inside-app") return "rejected";
      throw new Error(`pickProjectLocation: ${JSON.stringify(result)}`);
    },
  },
  {
    label: "设置「检查目录」（0.24.0 已经设在这里的老用户）",
    carriesKind: false,
    arrange: (candidate) => {
      fs.mkdirSync(candidate, { recursive: true });
      writeProjectsRoot(candidate);
    },
    act: async () => {
      const result = checkProjectLocation();
      if (result.ok) return "accepted";
      if (result.error === "inside-app") return "rejected";
      throw new Error(`checkProjectLocation: ${JSON.stringify(result)}`);
    },
  },
  {
    label: "「打开已有文件夹」选择时",
    carriesKind: true,
    act: async (candidate) => {
      const selection = await selectWorkspaceFolder({ showOpenDialog: async () => ({ canceled: false, filePaths: [candidate] }) }, { homedir: home() });
      if (selection.canceled) throw new Error("selection canceled");
      return "rejected" in selection ? rejectionOf({ message: selection.reason }) : "accepted";
    },
  },
  {
    label: "「打开已有文件夹」打开时（新建工作区）",
    carriesKind: true,
    act: async (candidate) => {
      try {
        await openFolder(candidate, true);
        return "accepted";
      } catch (error) {
        return rejectionOf(error);
      }
    },
  },
  {
    label: "渲染层「新建项目」（同步 IPC nomi:projects:create，默认位置是老用户设好的）",
    carriesKind: true,
    arrange: (candidate) => {
      writeProjectsRoot(candidate);
    },
    act: async () => {
      try {
        rendererCreate({ name: "新建的项目" });
        return "accepted";
      } catch (error) {
        return rejectionOf(error);
      }
    },
  },
  {
    label: "外部 Agent 建项目（createNamedProject，默认位置是老用户设好的）",
    carriesKind: true,
    arrange: (candidate) => {
      writeProjectsRoot(candidate);
    },
    act: async () => {
      try {
        createNamedProject("外部 Agent 的项目");
        return "accepted";
      } catch (error) {
        return rejectionOf(error);
      }
    },
  },
];

type Shape = { label: string; candidate: (place: string) => string };
const SHAPES: Shape[] = [
  { label: "里面一层（中文 + 空格）", candidate: (place) => path.join(place, "我的 项目") },
  { label: "还没建出来的深层", candidate: (place) => path.join(place, "a", "b", "c") },
  { label: "目录本身", candidate: (place) => place },
  { label: "末尾分隔符", candidate: (place) => `${path.join(place, "xiangmu")}${path.sep}` },
  {
    label: "经桌面上的符号链接指进去",
    candidate: (place) => {
      const link = path.join(home(), "Desktop", `通往 ${path.basename(place)}`);
      if (!fs.existsSync(link)) fs.symlinkSync(place, link, "dir");
      return path.join(link, "projects");
    },
  },
];

describe("一、入口拒绝 Nomi 自己的目录（不变量 ④）：六个入口 × 五个目录 × 五种路径形状", () => {
  const cases = ENTRANCES.flatMap((entrance) =>
    APP_PLACES.flatMap((place) => SHAPES.map((shape) => [entrance.label, place.label, shape.label, entrance, place, shape] as const)),
  );

  it.each(cases)("%s × %s × %s → 拒绝，盘上（含设置、登记）一个字节都不变", async (_entrance, _place, _shape, entrance, place, shape) => {
    const candidate = shape.candidate(place.dir());
    entrance.arrange?.(candidate);
    const before = treeSnapshot(base);

    const result = await entrance.act(candidate);

    expect(result).toBe(entrance.carriesKind ? `rejected:${place.kind}` : "rejected");
    expect(treeSnapshot(base)).toEqual(before);
  });

  const USER_PLACES: Array<{ label: string; dir: () => string }> = [
    { label: "文稿里的默认位置", dir: () => defaultRoot() },
    { label: "外置盘（中文 + 空格）", dir: () => path.join(base, "Volumes", "外置 盘", "作品") },
    { label: "同步盘", dir: () => path.join(home(), "Dropbox", "Nomi") },
    { label: "和 userData 同前缀的兄弟目录（Nomi Projects）", dir: () => path.join(base, "AppData", "Roaming", "Nomi Projects") },
    { label: "和安装目录同前缀的兄弟目录（Nomi_new2）", dir: () => path.join(base, "F_drive", "Nomi_new2", "xiangmu") },
  ];

  it.each(ENTRANCES.flatMap((entrance) => USER_PLACES.map((place) => [entrance.label, place.label, entrance, place] as const)))(
    "反例：%s × %s → 放行",
    async (_entrance, _place, entrance, place) => {
      const candidate = place.dir();
      entrance.arrange?.(candidate);
      expect(await entrance.act(candidate)).toBe("accepted");
    },
  );

  it("环境变量托管的默认位置（走查 / e2e 的隔离库）在系统临时目录里也不判：新建照建、检查照报可用；选文件夹选进同一处照拒", async () => {
    const managed = path.join(base, "AppData", "Local", "Temp", "nomi-walk-projects");
    fs.mkdirSync(managed, { recursive: true });
    vi.stubEnv("NOMI_PROJECTS_DIR", managed);

    expect(rendererCreate({ name: "走查项目" }).lastKnownRootPath.startsWith(`${managed}${path.sep}`)).toBe(true);
    expect(createNamedProject("走查里的 Agent 项目").id).toBeTruthy();
    expect(checkProjectLocation()).toMatchObject({ ok: true });
    expect(await pickProjectLocation({ showOpenDialog: async () => ({ canceled: false, filePaths: [defaultRoot()] }) })).toEqual({
      ok: false,
      error: "managed-by-environment",
    });
    await expect(ENTRANCES[2].act(path.join(managed, "别的文件夹"))).resolves.toBe("rejected:temp");
  });

  it("默认位置文件夹被删了：新建项目照建（用户动作），默认位置跟着建出来", async () => {
    await listProjects();
    expect(fs.existsSync(defaultRoot())).toBe(false);
    const created = rendererCreate({ name: "默认位置被删后新建" });
    expect(fs.existsSync(path.join(created.lastKnownRootPath, ".nomi", "project.json"))).toBe(true);
    expect(path.dirname(created.lastKnownRootPath)).toBe(defaultRoot());
  });
});

const REL = "assets/generated/2026-10-29/shot.png";
type Project = { id: string; name: string; root: string };

async function startApp(): Promise<void> {
  restart();
  await listProjects(); // 启动后第一次列举（吃掉进程内一次性的启动对账）
}

function withMedia(root: string): void {
  fs.mkdirSync(path.join(root, path.dirname(REL)), { recursive: true });
  fs.writeFileSync(path.join(root, REL), "png");
}

function createNative(name: string): Project {
  const record = rendererCreate({ name });
  withMedia(record.lastKnownRootPath);
  return { id: record.id, name, root: record.lastKnownRootPath };
}

async function createExternal(root: string, name: string): Promise<Project> {
  const record = await openFolder(root, true, name);
  withMedia(root);
  return { id: record.id, name, root: path.resolve(root) };
}

function moveInto(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

function expectBoundTo(id: string, folder: string): void {
  const entry = findRecentWorkspace(getSettingsRoot(), id);
  expect(entry?.missing).toBe(false);
  expect(realpath(entry?.rootPath)).toBe(realpath(folder));
  expect(entriesFor(id)).toHaveLength(1);
}

type Arranged = { project: Project; pick: string; neighbours?: Project[] };
type StateCase = {
  label: string;
  arrange: () => Promise<Arranged>;
  /** 「打开已有文件夹」选 pick：接上（登记 = 所选目录）或拒绝（另一个还在的文件夹的副本）。 */
  open: "bound" | "copy";
  /** 不重开、只是重启（启动对账）之后登记指哪：原登记，还是 pick（默认根里改名的，原文件夹已不在）。 */
  afterRestart: "original" | "pick";
  /** 同一会话刷新库时，这张卡是不是「找不到」。 */
  missing: boolean;
};

const STATES: StateCase[] = [
  {
    label: "默认根里改名",
    arrange: async () => {
      const project = createNative("改名的短片");
      const pick = `${project.root}-改名`;
      fs.renameSync(project.root, pick);
      return { project, pick };
    },
    open: "bound",
    afterRestart: "pick",
    missing: true,
  },
  {
    label: "外部文件夹改名",
    arrange: async () => {
      const project = await createExternal(path.join(base, "D_drive", "作品", "外部短片"), "外部短片");
      const pick = `${project.root}-改名`;
      fs.renameSync(project.root, pick);
      return { project, pick };
    },
    open: "bound",
    afterRestart: "original",
    missing: true,
  },
  {
    label: "从默认根挪到另一块盘",
    arrange: async () => {
      const project = createNative("挪盘的短片");
      const pick = path.join(base, "E_drive", "挪过来", path.basename(project.root));
      moveInto(project.root, pick);
      return { project, pick };
    },
    open: "bound",
    afterRestart: "original",
    missing: true,
  },
  {
    label: "默认根整个挪走、又被建回（空的）",
    arrange: async () => {
      const project = createNative("整库挪走的短片");
      const neighbour = createNative("一起挪走的邻居");
      const moved = path.join(base, "E_drive", "Nomi Projects 备份");
      moveInto(defaultRoot(), moved);
      fs.mkdirSync(defaultRoot(), { recursive: true });
      return { project, pick: path.join(moved, path.basename(project.root)), neighbours: [neighbour] };
    },
    open: "bound",
    afterRestart: "original",
    missing: true,
  },
  {
    label: "复制一份到另一块盘（两个都在）",
    arrange: async () => {
      const project = createNative("被复制的短片");
      const pick = path.join(base, "E_drive", "副本", path.basename(project.root));
      fs.mkdirSync(path.dirname(pick), { recursive: true });
      fs.cpSync(project.root, pick, { recursive: true });
      return { project, pick };
    },
    open: "copy",
    afterRestart: "original",
    missing: false,
  },
  {
    label: "默认根里复制一份「xxx - 副本」（两个都在）",
    arrange: async () => {
      const project = createNative("默认根里的原片");
      const pick = `${project.root} - 副本`;
      fs.cpSync(project.root, pick, { recursive: true });
      return { project, pick };
    },
    open: "copy",
    afterRestart: "original",
    missing: false,
  },
  {
    label: "复制一份到另一块盘、原件扔进了废纸篓",
    arrange: async () => {
      const project = createNative("原件扔了的短片");
      const pick = path.join(base, "E_drive", "副本", path.basename(project.root));
      fs.mkdirSync(path.dirname(pick), { recursive: true });
      fs.cpSync(project.root, pick, { recursive: true });
      moveInto(project.root, path.join(home(), ".Trash", path.basename(project.root)));
      return { project, pick };
    },
    open: "bound",
    afterRestart: "original",
    missing: true,
  },
  {
    label: "同一个文件夹经桌面上的符号链接打开（不算副本）",
    arrange: async () => {
      const project = await createExternal(path.join(base, "D_drive", "作品", "链接的短片"), "链接的短片");
      const pick = path.join(home(), "Desktop", "短片的捷径");
      fs.symlinkSync(project.root, pick, "dir");
      return { project, pick };
    },
    open: "bound",
    afterRestart: "original",
    missing: false,
  },
  {
    label: "同一个文件夹带末尾分隔符打开（不算副本）",
    arrange: async () => {
      const project = await createExternal(path.join(base, "D_drive", "作品", "末尾分隔符"), "末尾分隔符");
      return { project, pick: `${project.root}${path.sep}` };
    },
    open: "bound",
    afterRestart: "original",
    missing: false,
  },
];

/** 读面：项目库列表、读项目、按 id 找目录、素材库、诊断、媒体解析、设置检查、设置打开位置。 */
const READS: Array<[string, (id: string) => unknown]> = [
  ["listProjects", () => listProjects()],
  ["readProject", (id) => readProject(id)],
  ["projectDirById", (id) => projectDirById(id)],
  ["listProjectAssets", (id) => listProjectAssets({ projectId: id })],
  ["diagnoseProject", (id) => diagnoseProject(id)],
  ["parseLocalAssetUrl", (id) => parseLocalAssetUrl(localAssetUrl(id, REL))],
  ["checkProjectLocation", () => checkProjectLocation()],
  ["revealProjectLocation", () => revealProjectLocation({ openPath: async () => "" })],
];

async function readEverything(id: string): Promise<void> {
  for (const [, read] of READS) await read(id);
}

describe("二、状态 × 入口（不变量 ①②③⑤）", () => {
  const cases = STATES.map((state) => [state.label, state] as const);

  it.each(cases)("%s：「打开已有文件夹」选它", async (_label, state) => {
    await startApp();
    const { project, pick, neighbours = [] } = await state.arrange();

    if (state.open === "copy") {
      const registry = registryBytes();
      const originalTree = treeSnapshot(project.root);
      const copyTree = treeSnapshot(pick);
      const rejected = await openFolder(pick).then(
        () => null,
        (error: unknown) => error,
      );
      expect(workspaceFolderCopy(rejected)).toEqual({ projectName: project.name, originalRootPath: project.root });
      expect(registryBytes()).toBe(registry);
      expect(treeSnapshot(project.root)).toEqual(originalTree);
      expect(treeSnapshot(pick)).toEqual(copyTree);
      return;
    }

    const opened = await openFolder(pick);
    expect(opened.id).toBe(project.id);
    expectBoundTo(project.id, pick);
    expect(readProject(project.id)).toMatchObject({ id: project.id, name: project.name });
    expect(diagnoseProject(project.id)).toMatchObject({ status: "ok" });
    expect(realpath(parseLocalAssetUrl(localAssetUrl(project.id, REL))?.filePath)).toBe(realpath(path.join(pick, REL)));
    for (const neighbour of neighbours) expect(entriesFor(neighbour.id)).toEqual([expect.objectContaining({ rootPath: neighbour.root })]);

    await startApp(); // 重启后仍接着
    expectBoundTo(project.id, pick);
    for (const neighbour of neighbours) expect(entriesFor(neighbour.id)).toHaveLength(1);
  });

  it.each(cases)("%s：不重开、连续重启 3 次", async (_label, state) => {
    await startApp();
    const { project, pick, neighbours = [] } = await state.arrange();

    for (let round = 0; round < 3; round += 1) {
      await startApp();
      expect((await listProjects()).filter((card) => card.id === project.id)).toHaveLength(1);
      expect(entriesFor(project.id)).toHaveLength(1);
      for (const neighbour of neighbours) expect(entriesFor(neighbour.id)).toHaveLength(1);
    }
    if (state.afterRestart === "pick") expectBoundTo(project.id, pick);
    else expect(entriesFor(project.id)).toEqual([expect.objectContaining({ rootPath: project.root, missing: !fs.existsSync(project.root) })]);
  });

  it.each(cases)("%s：同一会话刷新库照实标，读面 8 个调用不写用户磁盘、不写登记；重启的启动对账也不碰用户磁盘", async (_label, state) => {
    await startApp();
    const { project } = await state.arrange();
    const disk = userDisk();
    const registry = registryBytes();

    expect((await listProjects()).find((card) => card.id === project.id)?.missing).toBe(state.missing);
    await readEverything(project.id);
    expect(userDisk()).toEqual(disk);
    expect(registryBytes()).toBe(registry);

    restart();
    await listProjects(); // 启动对账：只可能写登记（第二刀把它挪进 app ready），不碰用户磁盘
    expect(userDisk()).toEqual(disk);
    const reconciled = registryBytes();
    await readEverything(project.id);
    expect(userDisk()).toEqual(disk);
    expect(registryBytes()).toBe(reconciled);
  });

  it("外置盘拔掉：「找不到」，重启几次都不摘、不改绑；插回去不用重开就恢复", async () => {
    await startApp();
    const drive = path.join(base, "Volumes", "外置 盘");
    const project = await createExternal(path.join(drive, "作品", "外置盘上的短片"), "外置盘上的短片");
    const unplugged = path.join(base, "Volumes", "拔下来的盘");
    fs.renameSync(drive, unplugged);

    for (let round = 0; round < 2; round += 1) {
      await startApp();
      expect((await listProjects()).find((card) => card.id === project.id)).toMatchObject({ missing: true, rootPath: project.root });
    }
    fs.renameSync(unplugged, drive);
    expect((await listProjects()).find((card) => card.id === project.id)).toMatchObject({ missing: false, rootPath: project.root });
    expect(readProject(project.id)).toMatchObject({ id: project.id });
  });

  it("从项目库移除（文件夹还在默认根里）：重启后启动对账不把它找回来", async () => {
    await startApp();
    const project = createNative("移除后别回来");
    await deleteProject(project.id, "unbind");
    for (let round = 0; round < 2; round += 1) {
      await startApp();
      expect((await listProjects()).some((card) => card.id === project.id)).toBe(false);
    }
    expect(fs.existsSync(project.root)).toBe(true);
  });
});

/**
 * 删除要跨层走一遍：真列表给卡片状态 → 真确认框判断 → 真主进程 → 重启（真启动对账）。这几层以前各测各的，拼起来的路径没人测：
 * 文件夹没了的本地卡，确认框说「移到废纸篓」，主进程什么都没摘，界面却说已移除，重启后卡片又回来。
 * 不变量：主进程回 deleted:false，登记就一定摘了；用户移除的卡，重启多少次都不回来。
 * 正常的本地卡进系统回收站在 projectDeleteToTrash.test.ts（这里 electron 是桩，没有回收站）。
 */
describe("删除：卡片状态 × 确认框 × 主进程 × 重启", () => {
  const cardOf = async (id: string) => {
    const card = (await listProjects()).find((item) => item.id === id);
    if (!card) throw new Error(`项目库里没有 ${id}`);
    return card;
  };
  const expectStaysRemoved = async (id: string): Promise<void> => {
    expect(entriesFor(id)).toHaveLength(0);
    for (let round = 0; round < 2; round += 1) {
      await startApp();
      expect((await listProjects()).some((card) => card.id === id), `第 ${round + 1} 次重启后`).toBe(false);
      expect(entriesFor(id), `第 ${round + 1} 次重启后`).toHaveLength(0);
    }
  };

  const MISSING_SHAPES: Array<{ label: string; arrange: (project: Project) => void }> = [
    { label: "文件夹被删了", arrange: (project) => fs.rmSync(project.root, { recursive: true }) },
    { label: "文件夹被挪出了默认位置", arrange: (project) => moveInto(project.root, path.join(home(), "Desktop", "挪走的短片")) },
  ];

  it.each(MISSING_SHAPES)("本地卡，$label：确认框只说移除，摘掉登记，盘上一个字节不变，重启不回来", async ({ arrange }) => {
    await startApp();
    const project = createNative("要移除的短片");
    arrange(project);
    const disk = userDisk();

    const card = await cardOf(project.id);
    expect(card.missing).toBe(true);
    const choice = projectDeleteChoice(card);
    expect(choice.intent).toBe("unbind");
    await expect(deleteProject(project.id, choice.intent)).resolves.toEqual({ id: project.id, deleted: false });

    await expectStaysRemoved(project.id);
    expect(userDisk()).toEqual(disk);
  });

  it("本地卡，文件夹在默认根里改了名：摘掉登记，内容不动，重启不被对账接回；想要回来，「打开已有文件夹」选它还能接上", async () => {
    await startApp();
    const project = createNative("改名后不要了");
    const renamed = `${project.root}-改名`;
    fs.renameSync(project.root, renamed);
    const disk = userDisk();

    const card = await cardOf(project.id);
    expect(card.missing).toBe(true);
    const choice = projectDeleteChoice(card);
    expect(choice.intent).toBe("unbind");
    await expect(deleteProject(project.id, choice.intent)).resolves.toEqual({ id: project.id, deleted: false });

    await expectStaysRemoved(project.id);
    // 盘上只多一个「别找回来」的标记，在 Nomi 自己的 .nomi 目录里；项目内容一个字节不变。
    const after = userDisk();
    const added = Object.keys(after).filter((rel) => !(rel in disk));
    expect(added.map((rel) => path.basename(rel))).toEqual(["removed-from-library"]);
    delete after[added[0]];
    expect(after).toEqual(disk);

    expect((await openFolder(renamed)).id).toBe(project.id);
    expectBoundTo(project.id, renamed);
    await startApp();
    expectBoundTo(project.id, renamed);
  });

  it("外部文件夹，盘没插：只移除；盘插回来也不回到库里", async () => {
    await startApp();
    const drive = path.join(base, "Volumes", "外置盘");
    const project = await createExternal(path.join(drive, "作品", "不要了的短片"), "不要了的短片");
    const unplugged = path.join(base, "Volumes", "拔下来的盘");
    fs.renameSync(drive, unplugged);

    const card = await cardOf(project.id);
    expect(card.missing).toBe(true);
    const choice = projectDeleteChoice(card);
    expect(choice.intent).toBe("unbind");
    await expect(deleteProject(project.id, choice.intent)).resolves.toEqual({ id: project.id, deleted: false });
    await expectStaysRemoved(project.id);

    fs.renameSync(unplugged, drive);
    await expectStaysRemoved(project.id);
    expect(fs.existsSync(path.join(project.root, REL))).toBe(true);
  });

  // 清单坏了的卡看着是张普通卡（列表用登记兜的），确认框说得出的只有删除；主进程认不出这是不是项目，不敢进回收站，只摘登记，界面如实说只移除了。
  it("本地卡，清单坏了：主进程回 false 并摘掉登记，盘上一个字节不变，重启不回来", async () => {
    await startApp();
    const project = createNative("清单坏了的短片");
    fs.writeFileSync(path.join(project.root, ".nomi", "project.json"), "不是 JSON");
    const disk = userDisk();

    const choice = projectDeleteChoice(await cardOf(project.id));
    await expect(deleteProject(project.id, choice.intent)).resolves.toEqual({ id: project.id, deleted: false });

    await expectStaysRemoved(project.id);
    expect(userDisk()).toEqual(disk);
  });

  // 库页没刷新：确认框按列表那一刻说「进回收站」，文件夹在确认之后才没的。主进程回 false 且真摘了登记，界面才能如实说「只从项目库移除了」。
  it.each([
    { label: "被删了", gone: (project: Project) => fs.rmSync(project.root, { recursive: true }) },
    { label: "被挪出了默认位置", gone: (project: Project) => moveInto(project.root, path.join(home(), "Desktop", "挪走的短片")) },
    { label: "在默认根里改了名", gone: (project: Project) => fs.renameSync(project.root, `${project.root}-改名`) },
  ])("列表之后文件夹才$label：意图还是删文件，主进程回 false 并摘掉登记，重启不回来", async ({ gone }) => {
    await startApp();
    const project = createNative("库页没刷新");
    const card = await cardOf(project.id);
    expect(card.missing).toBeFalsy();
    const choice = projectDeleteChoice(card);
    expect(choice.intent).toBe("delete-files");
    gone(project);

    await expect(deleteProject(project.id, choice.intent)).resolves.toEqual({ id: project.id, deleted: false });
    await expectStaysRemoved(project.id);
  });
});
