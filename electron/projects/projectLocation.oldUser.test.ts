/**
 * 老用户升级路径（设计卡 docs/plan/2026-10-29-project-location-owner.md ★1c；upgrade-path 证据）。
 *
 * 数据是旧版本用它自己的真函数落的（tests/fixtures/old-user-data/projects/<版本>-library，生成脚本
 * generators/zzProjectLibraryGen.ts.txt，做法见该目录的 README），不是手写的形状。一个老用户的项目库：
 *   · 「Docs Project」：建在当时的默认位置「文稿/Nomi Projects」里（native）；
 *   · 「External Project」：打开过的别处文件夹（folder）；
 *   · 「App Data Project」：把「新项目默认位置」设到应用数据目录下面之后建的（native）——旧版本没有任何拦截，
 *     本分支的位置判定会拒绝把新项目放在那里。最终设置就停在这里：新项目默认位置 = 应用数据目录下面。
 * 同一套断言跑两份：0.24.0 落的（清单带 immutableProjectUuid / projectGeneration）和 0.20.0 落的（没有这两个字段）。
 *
 * 五条，每条都从刚拷出来的真数据开始（只把 electron 的目录接口换成指向临时目录的桩）：
 *   1. 什么都不做：三个项目都在、读得出、存得了——包括在应用数据目录里的那个（位置判定只管新选的位置，不管已有的项目）；
 *   2. 文件夹找不到了（默认位置整个删了、外部文件夹改名）：卡片一直留着，重启几次登记不减、默认位置不被建回；
 *      打开改名后的文件夹接回同一个项目；不要的卡能自己移除，重启不回来（2b）；
 *   3. 默认位置设在应用数据目录里：设置值原样不动；新建项目被拒，界面那句指到设置；换成正常文件夹后新建成功；
 *   4. 把老项目挪出应用目录：挪走再打开 = 接回同一个项目；复制一份再打开（原件还在）= 拒绝、两边一个字节不变；
 *      原件挪走 / 改名后再打开副本 = 接上；
 *   5. 退回上一个版本：经过各种写之后，登记里每一条的键集合都和那个版本自己落的一样（旧版本照读不误）。
 *
 * 任何一条不成立，尤其第 1 条（老项目打不开或存不了），是锁死老用户：停下上报，不在这里改方向。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInstance, type TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ base: "" }));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => {
      const base = electronState.base;
      if (name === "exe") return path.join(base, "Install", "Nomi.exe");
      if (name === "userData") return path.join(base, "userData");
      if (name === "logs") return path.join(base, "userData", "logs");
      if (name === "temp") return path.join(base, "Temp");
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

import { resources } from "../../src/i18n/resources";
import { projectDeleteChoice } from "../../src/workbench/library/projectDeleteChoice";
import { projectOperationFailureText } from "../../src/workbench/project/projectOperationFailureText";
import { listProjectAssets } from "../assets/projectAssetStore";
import { getProjectLocationState } from "../runtimePaths";
import { checkProjectLocation, pickProjectLocation, revealProjectLocation } from "../settings/projectLocationIpc";
import { getSettingsRoot } from "../settings/settingsRoot";
import { projectLocationRejection, workspaceFolderCopy } from "../shared/contracts/projectLocation";
import { resetLegacyDiscoveryGuard } from "../workspace/legacyProjectMigration";
import { findAppOwnedLocation } from "../workspace/workspaceLocationPolicy";
import { openWorkspaceFolder } from "../workspace/workspaceIpc";
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

const FIXTURES = fileURLToPath(new URL("../../tests/fixtures/old-user-data/projects", import.meta.url));
const RELEASES = ["v0.24.0-library", "v0.20.0-library"] as const;

type FixtureProject = { key: "docs" | "external" | "appData"; id: string; name: string; marker: string; folder: string };
type Fixture = { projects: FixtureProject[]; defaultLocation: string };

let base = "";
const home = (): string => path.join(base, "home");
const userData = (): string => path.join(base, "userData");
const registryFile = (): string => path.join(userData(), "recent-workspaces.json");
const locationFile = (): string => path.join(userData(), "project-location.json");

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-old-user-library-")));
  electronState.base = base;
  vi.stubEnv("NOMI_SETTINGS_DIR", ""); // 设置根 = userData，和打包后的真实情形一样
  vi.stubEnv("NOMI_PROJECTS_DIR", "");
  (process as { resourcesPath?: string }).resourcesPath = path.join(base, "Install", "resources");
  resetLegacyDiscoveryGuard();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (process as { resourcesPath?: string }).resourcesPath;
  resetLegacyDiscoveryGuard();
  fs.rmSync(base, { recursive: true, force: true });
});

/** 把旧版本落的目录拷进临时盘：文本文件里的占位符换回这次的根（按 JSON 转义，Windows 的反斜杠也安全）。清单是生成脚本的说明，不是用户的盘。 */
function installFixture(release: string): Fixture {
  const source = path.join(FIXTURES, release);
  const described = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8")) as {
    placeholder: string;
    defaultLocation: string;
    projects: Record<string, { id: string; name: string; marker: string; folder: string }>;
  };
  const replacement = JSON.stringify(base).slice(1, -1);
  const copy = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const next = path.join(from, entry.name);
      if (entry.isDirectory()) copy(next, path.join(to, entry.name));
      else if (entry.name !== "manifest.json") fs.writeFileSync(path.join(to, entry.name), fs.readFileSync(next, "utf8").split(described.placeholder).join(replacement));
    }
  };
  copy(source, base);
  return {
    defaultLocation: path.join(base, ...described.defaultLocation.split("/")),
    projects: Object.entries(described.projects).map(([key, project]) => ({
      key: key as FixtureProject["key"],
      id: project.id,
      name: project.name,
      marker: project.marker,
      folder: path.join(base, ...project.folder.split("/")),
    })),
  };
}

/** 目录里每个文件的内容（相对路径 → base64），比字节不比时间；目录不在就是空。 */
function filesOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(root)) return out;
  for (const rel of (fs.readdirSync(root, { recursive: true }) as string[]).sort()) {
    const full = path.join(root, rel);
    if (fs.statSync(full).isFile()) out[rel.split(path.sep).join("/")] = fs.readFileSync(full).toString("base64");
  }
  return out;
}

const rawRegistry = (): Array<Record<string, unknown>> => JSON.parse(fs.readFileSync(registryFile(), "utf8")) as Array<Record<string, unknown>>;
/** 登记里「谁在哪」（按 id 排序，路径经 resolve 去掉分隔符差异）。 */
const registered = (): Array<{ id: string; rootPath: string }> =>
  rawRegistry()
    .map((entry) => ({ id: String(entry.id), rootPath: path.resolve(String(entry.rootPath)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
const sortedIds = (items: Array<{ id: string }>): string[] => items.map((item) => item.id).sort();

async function startApp(): Promise<Awaited<ReturnType<typeof listProjects>>> {
  resetLegacyDiscoveryGuard(); // 重启 = 进程内一次性的启动对账重新来一遍
  return listProjects();
}

async function openFolder(rootPath: string): Promise<{ id: string; name: string; lastKnownRootPath: string }> {
  return (await openWorkspaceFolder(
    { rootPath, initialize: false },
    { createProject, selectedRootPaths: new Set([path.resolve(rootPath)]), confirmInitialize: () => true, homedir: home() },
  )) as { id: string; name: string; lastKnownRootPath: string };
}

function expectBoundTo(id: string, folder: string): void {
  const entry = findRecentWorkspace(getSettingsRoot(), id);
  expect(entry?.missing).toBe(false);
  expect(path.resolve(String(entry?.rootPath))).toBe(path.resolve(folder));
  expect(listRecentWorkspaces(getSettingsRoot()).filter((item) => item.id === id)).toHaveLength(1);
}

async function realT(language: "zh-CN" | "en"): Promise<TFunction> {
  const i18n = createInstance();
  await i18n.init({ lng: language, resources, interpolation: { escapeValue: false } });
  return i18n.t.bind(i18n) as TFunction;
}

describe.each(RELEASES)("老用户的项目库（%s 落的）", (release) => {
  let old: Fixture;
  const project = (key: FixtureProject["key"]): FixtureProject => {
    const found = old.projects.find((item) => item.key === key);
    if (!found) throw new Error(`fixture ${release} has no ${key} project`);
    return found;
  };

  beforeEach(() => {
    old = installFixture(release);
  });

  it("1 什么都不做：三个项目都在、读得出、存得了；在应用数据目录里的那个也从库里打开和保存，不被位置判定拦住", async () => {
    // 前提：这个老用户的项目真的躺在本分支会拒绝的位置里（否则这条什么都没证明）。
    expect(findAppOwnedLocation(project("appData").folder)).toMatchObject({ kind: "app-data" });
    const untouched = filesOf(base);
    expect(Object.keys(untouched)).toContain("userData/recent-workspaces.json"); // 快照里真有东西，下面"一个字节不变"才不是空比空
    expect(Object.keys(untouched).filter((file) => file.endsWith(".nomi/project.json"))).toHaveLength(old.projects.length);

    const cards = await startApp();
    expect(sortedIds(cards)).toEqual(sortedIds(old.projects));
    for (const card of cards) expect(card, card.name).toMatchObject({ missing: false });
    for (const item of old.projects) {
      expect(readProject(item.id), item.name).toMatchObject({ id: item.id, name: item.name, payload: { marker: item.marker } });
      expect(path.resolve(String(projectDirById(item.id)))).toBe(path.resolve(item.folder));
      expect(diagnoseProject(item.id), item.name).toMatchObject({ status: "ok" });
    }
    // 升级本身什么都不做：列举 + 逐个读，设置、登记、三个项目文件夹一个字节都不变。
    expect(filesOf(base)).toEqual(untouched);

    // 渲染层「保存」走的 saveProject：版本加一、新内容落进项目自己的文件夹、读回来是新内容。
    for (const item of old.projects) {
      const before = readProject(item.id);
      const saved = await saveProject(item.id, { name: item.name, payload: { marker: item.marker, editedAfterUpgrade: true } });
      expect(saved.revision, item.name).toBe((before?.revision ?? 0) + 1);
      const onDisk = JSON.parse(fs.readFileSync(path.join(item.folder, ".nomi", "project.json"), "utf8")) as { id: string; payload: unknown };
      expect(onDisk, item.name).toMatchObject({ id: item.id, payload: { marker: item.marker, editedAfterUpgrade: true } });
      expect(readProject(item.id)?.payload).toEqual({ marker: item.marker, editedAfterUpgrade: true });
    }
    expect(registered().map((entry) => entry.rootPath)).toEqual(old.projects.slice().sort((a, b) => a.id.localeCompare(b.id)).map((item) => path.resolve(item.folder)));

    // 重启后还是这三张：没有不见的，也没有多出来的。
    const restarted = await startApp();
    expect(sortedIds(restarted)).toEqual(sortedIds(old.projects));
    for (const card of restarted) expect(card, card.name).toMatchObject({ missing: false });
  });

  it("2 文件夹找不到了（两个默认位置整个删了、外部文件夹改名）：卡片一直留着，重启几次登记不减、默认位置不被建回；打开改名后的文件夹接回同一个项目", async () => {
    await startApp();
    const before = registered();
    const external = project("external");
    const documentsRoot = path.dirname(project("docs").folder); // 老的默认位置（文稿/Nomi Projects）
    const appRoot = old.defaultLocation; // 现在的默认位置（应用数据目录下面）
    fs.rmSync(documentsRoot, { recursive: true });
    fs.rmSync(appRoot, { recursive: true });
    const renamed = `${external.folder}-renamed`;
    fs.renameSync(external.folder, renamed);

    for (let round = 0; round < 3; round += 1) {
      const cards = await startApp();
      expect(sortedIds(cards), `第 ${round + 1} 次启动`).toEqual(sortedIds(old.projects));
      for (const card of cards) expect(card, card.name).toMatchObject({ missing: true });
      // 读面全读一遍：找不到就是找不到，不建、不改、不摘。
      for (const item of old.projects) {
        expect(readProject(item.id)).toBeNull();
        projectDirById(item.id);
        diagnoseProject(item.id);
        await listProjectAssets({ projectId: item.id });
      }
      await revealProjectLocation({ openPath: async () => "" });
      expect(registered(), `第 ${round + 1} 次启动`).toEqual(before);
      expect(fs.existsSync(documentsRoot)).toBe(false);
      expect(fs.existsSync(appRoot)).toBe(false);
    }

    // 用户在「打开已有文件夹」里选改名后的那个：接回同一个项目，登记换到新路径；另外两张还是找不到。
    const opened = await openFolder(renamed);
    expect(opened.id).toBe(external.id);
    expectBoundTo(external.id, renamed);
    expect(readProject(external.id)).toMatchObject({ id: external.id, payload: { marker: external.marker } });
    expect(registered().filter((entry) => entry.id !== external.id)).toEqual(before.filter((entry) => entry.id !== external.id));

    const cards = await startApp(); // 重启后仍接着
    expectBoundTo(external.id, renamed);
    expect(cards.filter((card) => card.missing).map((card) => card.id).sort()).toEqual(sortedIds(old.projects.filter((item) => item.key !== "external")));
    expect(fs.existsSync(documentsRoot)).toBe(false);
    expect(fs.existsSync(appRoot)).toBe(false);
  });

  it("2b 文件夹找不到的卡不要了：确认框只说移除，摘掉这几张，重启不回来；还在的卡不动，默认位置不被建回", async () => {
    await startApp();
    const documentsRoot = path.dirname(project("docs").folder);
    const appRoot = old.defaultLocation;
    fs.rmSync(documentsRoot, { recursive: true });
    fs.rmSync(appRoot, { recursive: true });
    const external = project("external");
    const kept = registered().filter((entry) => entry.id === external.id);

    const cards = await startApp();
    for (const key of ["docs", "appData"] as const) {
      const card = cards.find((item) => item.id === project(key).id);
      expect(card, key).toMatchObject({ missing: true });
      const choice = projectDeleteChoice(card as NonNullable<typeof card>);
      expect(choice.intent, key).toBe("unbind");
      await expect(deleteProject(project(key).id, choice.intent), key).resolves.toEqual({ id: project(key).id, deleted: false });
    }

    for (let round = 0; round < 2; round += 1) {
      const after = await startApp();
      expect(sortedIds(after), `第 ${round + 1} 次启动`).toEqual([external.id]);
      expect(registered(), `第 ${round + 1} 次启动`).toEqual(kept);
      expect(fs.existsSync(documentsRoot)).toBe(false);
      expect(fs.existsSync(appRoot)).toBe(false);
    }
    expect(readProject(external.id)).toMatchObject({ id: external.id, payload: { marker: external.marker } });
  });

  it("3 默认位置设在应用数据目录里：设置值原样不动；新建项目被拒，界面那句指到设置；换成正常文件夹后新建成功", async () => {
    await startApp();
    const settingBytes = fs.readFileSync(locationFile(), "utf8");
    const state = getProjectLocationState();
    expect(state.source).toBe("custom");
    expect(path.resolve(state.path)).toBe(path.resolve(old.defaultLocation));

    // 新建项目：被拒，哪样东西都没建、没改。
    const before = filesOf(base);
    let failure: unknown;
    try {
      rendererCreate({ name: "升级后新建的项目" });
    } catch (error) {
      failure = error;
    }
    expect(projectLocationRejection(failure)).toBe("app-data");
    expect(filesOf(base)).toEqual(before);
    // 界面那句：真词典（中 / 英）里「新项目默认位置在应用数据目录里」那条，不是泛泛的「新建失败」。
    for (const language of ["zh-CN", "en"] as const) {
      const t = await realT(language);
      const text = projectOperationFailureText("create", failure, t);
      expect(text).toBe(t("studio.newProjectLocationInsideApp", { place: t("studio.appOwnedPlaceAppData") }));
      expect(text).not.toBe(t("studio.newProjectFailed"));
    }
    // 设置页「检查目录」只报、不改；设置值还是用户当年设的那个。
    expect(checkProjectLocation()).toEqual({ ok: false, error: "inside-app" });
    expect(fs.readFileSync(locationFile(), "utf8")).toBe(settingBytes);

    // 用户到设置里换成自己的文件夹：之后新建照建，落在新位置；老项目一个不少、位置不变。
    const normal = path.join(home(), "Projects");
    expect(await pickProjectLocation({ showOpenDialog: async () => ({ canceled: false, filePaths: [normal] }) })).toMatchObject({ ok: true });
    expect(path.resolve(getProjectLocationState().path)).toBe(path.resolve(normal));
    const created = rendererCreate({ name: "升级后新建的项目" });
    expect(path.dirname(path.resolve(created.lastKnownRootPath))).toBe(path.resolve(normal));
    expect(fs.existsSync(path.join(created.lastKnownRootPath, ".nomi", "project.json"))).toBe(true);
    const cards = await startApp();
    expect(sortedIds(cards)).toEqual([...sortedIds(old.projects), created.id].sort());
    for (const item of old.projects) {
      expectBoundTo(item.id, item.folder);
      expect(readProject(item.id)).toMatchObject({ payload: { marker: item.marker } });
    }
  });

  describe("4 把老项目挪出应用目录", () => {
    const target = (): string => path.join(home(), "Projects");
    const movedFolder = (): string => path.join(target(), path.basename(project("appData").folder));

    it("4a 挪走后在新位置打开：接回同一个项目，登记换到新位置，能存；重启后仍接着", async () => {
      const item = project("appData");
      await startApp();
      fs.mkdirSync(target(), { recursive: true });
      fs.renameSync(item.folder, movedFolder());
      expect(findAppOwnedLocation(movedFolder())).toBeNull();
      expect((await startApp()).find((card) => card.id === item.id)).toMatchObject({ missing: true });

      const opened = await openFolder(movedFolder());
      expect(opened.id).toBe(item.id);
      expectBoundTo(item.id, movedFolder());
      expect(readProject(item.id)).toMatchObject({ id: item.id, payload: { marker: item.marker } });
      await saveProject(item.id, { name: item.name, payload: { marker: item.marker, editedAfterMove: true } });
      expect(JSON.parse(fs.readFileSync(path.join(movedFolder(), ".nomi", "project.json"), "utf8"))).toMatchObject({ payload: { editedAfterMove: true } });

      await startApp();
      expectBoundTo(item.id, movedFolder());
    });

    it("4b 复制一份再打开（原件还在）：拒绝，登记不变，两边一个字节都不变", async () => {
      const item = project("appData");
      await startApp();
      const copyFolder = movedFolder();
      fs.mkdirSync(target(), { recursive: true });
      fs.cpSync(item.folder, copyFolder, { recursive: true });
      const registry = fs.readFileSync(registryFile(), "utf8");
      const originalFiles = filesOf(item.folder);
      const copyFiles = filesOf(copyFolder);

      const rejected = await openFolder(copyFolder).then(
        () => null,
        (error: unknown) => error,
      );
      const copy = workspaceFolderCopy(rejected);
      expect(copy?.projectName).toBe(item.name);
      expect(path.resolve(String(copy?.originalRootPath))).toBe(path.resolve(item.folder));
      expect(fs.readFileSync(registryFile(), "utf8")).toBe(registry);
      expect(filesOf(item.folder)).toEqual(originalFiles);
      expect(filesOf(copyFolder)).toEqual(copyFiles);
      expectBoundTo(item.id, item.folder);
    });

    it("4c 复制一份后原件被挪走（改名）再打开副本：接上，登记指向副本", async () => {
      const item = project("appData");
      await startApp();
      const copyFolder = movedFolder();
      fs.mkdirSync(target(), { recursive: true });
      fs.cpSync(item.folder, copyFolder, { recursive: true });
      fs.renameSync(item.folder, `${item.folder}-原件`);

      const opened = await openFolder(copyFolder);
      expect(opened.id).toBe(item.id);
      expectBoundTo(item.id, copyFolder);
      expect(readProject(item.id)).toMatchObject({ id: item.id, payload: { marker: item.marker } });
    });
  });

  it("5 退回上一个版本：经过各种写之后，登记里每一条的键集合都和那个版本自己落的一样", async () => {
    // 那个版本落的是什么样，就以什么样为准（从真数据读出来，不手写）：每种来源一个键集合。
    const wrote = new Map<string, string[]>();
    for (const entry of rawRegistry()) {
      const keys = Object.keys(entry).sort();
      const known = wrote.get(String(entry.source));
      if (known) expect(keys, `${release} 自己落的同类条目键集合不一致`).toEqual(known);
      wrote.set(String(entry.source), keys);
    }
    expect([...wrote.keys()].sort()).toEqual(["folder", "native"]);
    const expectKeySetsUnchanged = (step: string): void => {
      for (const entry of rawRegistry()) expect(Object.keys(entry).sort(), `${step}：${String(entry.id)}`).toEqual(wrote.get(String(entry.source)));
      expect(Object.keys(JSON.parse(fs.readFileSync(locationFile(), "utf8")) as object), `${step}：设置文件`).toEqual(["projectsRoot"]);
    };

    await startApp();
    expectKeySetsUnchanged("启动列举");
    for (const item of old.projects) await saveProject(item.id, { name: item.name, payload: { marker: item.marker, step: "save" } });
    expectKeySetsUnchanged("逐个保存");

    const external = project("external");
    const renamed = `${external.folder}-renamed`;
    fs.renameSync(external.folder, renamed);
    await openFolder(renamed);
    expectKeySetsUnchanged("改名后重开");

    const appData = project("appData");
    const moved = path.join(home(), "Projects", path.basename(appData.folder));
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(appData.folder, moved);
    await openFolder(moved);
    expectKeySetsUnchanged("挪出应用目录后重开");

    await pickProjectLocation({ showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(home(), "NewProjects")] }) });
    const created = rendererCreate({ name: "升级后新建的项目" });
    expectKeySetsUnchanged("换默认位置后新建");
    expect(findRecentWorkspace(getSettingsRoot(), created.id)).toMatchObject({ source: "native" });

    await deleteProject(project("docs").id, "unbind");
    expectKeySetsUnchanged("从项目库移除一个");
    await startApp();
    expectKeySetsUnchanged("重启");
  });
});
