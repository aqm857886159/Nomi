/**
 * 「项目能不能放在这里」唯一判定的矩阵（「项目在哪」收敛单不变量 ④，docs/plan/2026-10-29-project-location-owner.md ★9 ⑥）：
 * 应用目录四类 × 路径形状（posix / path.win32、盘符与目录大小写、末尾分隔符、正反斜杠、同前缀的兄弟目录、
 * 中文和空格、.app 包内、符号链接与还不存在的子目录）。入口那一侧（设置 / 选文件夹 / 新建 / 外部 Agent）在
 * electron/projects/projectLocation.matrix.test.ts。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ base: "", isPackaged: true }));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
    getPath: (name: string) =>
      name === "exe"
        ? path.join(electronState.base, "Applications", "Nomi.app", "Contents", "MacOS", "Nomi")
        : path.join(electronState.base, `electron-${name}`),
    getAppPath: () => process.cwd(),
  },
}));

import {
  appOwnedLocationRoots,
  assertUserOwnedLocation,
  findAppOwnedLocation,
  installRootFromExe,
  isPathInside,
  type AppOwnedRoot,
} from "./workspaceLocationPolicy";
import { projectLocationRejection } from "../shared/contracts/projectLocation";

const tempRoots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  electronState.isPackaged = true;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeBase(): string {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-location-policy-")));
  tempRoots.push(base);
  return base;
}

const WIN_ROOTS: AppOwnedRoot[] = [
  { kind: "install", root: "F:\\Nomi_new" },
  { kind: "install", root: "F:\\Nomi_new\\resources" },
  { kind: "app-data", root: "C:\\Users\\张三\\AppData\\Roaming\\Nomi" },
  { kind: "temp", root: "C:\\Users\\张三\\AppData\\Local\\Temp" },
];
const POSIX_ROOTS: AppOwnedRoot[] = [
  { kind: "install", root: "/Applications/Nomi.app" },
  { kind: "install", root: "/Applications/Nomi.app/Contents/Resources" },
  { kind: "app-data", root: "/Users/zhang/Library/Application Support/Nomi" },
  { kind: "temp", root: "/var/folders/ab/xyz/T" },
];

describe("findAppOwnedLocation：path.win32（不分大小写，盘符、目录都是）", () => {
  it.each<[string, string, AppOwnedRoot["kind"] | null]>([
    ["0.24.0 用户原样：安装目录下的 xiangmu", "F:\\Nomi_new\\xiangmu", "install"],
    ["盘符小写 + 目录小写", "f:\\nomi_new\\xiangmu", "install"],
    ["安装目录本身", "F:\\Nomi_new", "install"],
    ["末尾分隔符", "F:\\Nomi_new\\", "install"],
    ["正斜杠写法", "F:/Nomi_new/xiangmu/我的短片", "install"],
    ["resources 里", "F:\\NOMI_NEW\\Resources\\app", "install"],
    ["应用数据：中文用户名 + 空格", "c:\\users\\张三\\appdata\\roaming\\nomi\\项目 一", "app-data"],
    ["系统临时目录里的子目录（%TEMP%）", "C:\\Users\\张三\\AppData\\Local\\Temp\\nomi-projects", "temp"],
    ["同前缀的兄弟目录不算（Nomi_new2）", "F:\\Nomi_new2\\xiangmu", null],
    ["同前缀的兄弟目录不算（Templates）", "C:\\Users\\张三\\AppData\\Local\\Templates\\x", null],
    ["换个盘", "G:\\Nomi_new\\xiangmu", null],
    [".. 回到外面", "F:\\Nomi_new\\..\\Documents\\Nomi Projects", null],
    ["用户自己的文档", "C:\\Users\\张三\\Documents\\Nomi Projects", null],
  ])("%s → %s", (_label, candidate, expected) => {
    const hit = findAppOwnedLocation(candidate, WIN_ROOTS, { path: path.win32, fs: null });
    expect(hit?.kind ?? null).toBe(expected);
  });
});

describe("findAppOwnedLocation：posix", () => {
  it.each<[string, string, AppOwnedRoot["kind"] | null]>([
    [".app 包里", "/Applications/Nomi.app/Contents/项目", "install"],
    [".app 包本身（末尾斜杠）", "/Applications/Nomi.app/", "install"],
    ["应用数据（带空格的 Application Support）", "/Users/zhang/Library/Application Support/Nomi/projects", "app-data"],
    ["系统临时目录里的子目录（$TMPDIR）", "/var/folders/ab/xyz/T/nomi-walk", "temp"],
    ["同前缀的兄弟（Nomi.app-backup）", "/Applications/Nomi.app-backup/x", null],
    ["同前缀的兄弟（Nomi Projects）", "/Users/zhang/Library/Application Support/Nomi Projects", null],
    ["文稿里的默认位置", "/Users/zhang/Documents/Nomi Projects", null],
    ["外置盘", "/Volumes/外置 盘/作品", null],
  ])("%s → %s", (_label, candidate, expected) => {
    expect(findAppOwnedLocation(candidate, POSIX_ROOTS, { path: path.posix, fs: null })?.kind ?? null).toBe(expected);
  });
});

describe("findAppOwnedLocation：符号链接与还不存在的子目录（真文件系统）", () => {
  it("经符号链接指进应用数据目录的位置也拦，还没建出来的下一层也拦", () => {
    const base = makeBase();
    const appData = path.join(base, "real-app-data");
    fs.mkdirSync(appData);
    fs.symlinkSync(appData, path.join(base, "link-to-app-data"), "dir");
    const roots: AppOwnedRoot[] = [{ kind: "app-data", root: appData }];

    expect(findAppOwnedLocation(path.join(base, "link-to-app-data", "projects"), roots)?.kind).toBe("app-data");
    expect(findAppOwnedLocation(path.join(base, "link-to-app-data", "not", "yet", "created"), roots)?.kind).toBe("app-data");
    expect(findAppOwnedLocation(path.join(base, "elsewhere"), roots)).toBeNull();
  });

  it("应用目录自己是经链接给出的（macOS 临时目录 /var → /private/var 同形）：按真实路径给的候选也认得出", () => {
    const base = makeBase();
    const realTemp = path.join(base, "private-tmp");
    fs.mkdirSync(realTemp);
    fs.symlinkSync(realTemp, path.join(base, "tmp-link"), "dir");
    const roots: AppOwnedRoot[] = [{ kind: "temp", root: path.join(base, "tmp-link") }];

    expect(findAppOwnedLocation(path.join(realTemp, "nomi"), roots)?.kind).toBe("temp");
    expect(findAppOwnedLocation(path.join(base, "tmp-link", "nomi"), roots)?.kind).toBe("temp");
  });
});

describe("isPathInside / installRootFromExe", () => {
  it.each<[string, string, string, boolean]>([
    ["posix 本身", "/a/b", "/a/b", true],
    ["posix 子目录", "/a/b", "/a/b/c", true],
    ["posix 名字以 .. 开头的子目录", "/a/b", "/a/b/..c", true],
    ["posix 兄弟", "/a/b", "/a/bc", false],
    ["posix 父目录", "/a/b", "/a", false],
  ])("%s", (_label, root, candidate, expected) => {
    expect(isPathInside(root, candidate, path.posix)).toBe(expected);
  });

  it.each<[string, string, string]>([
    ["macOS 打包", "/Applications/Nomi.app/Contents/MacOS/Nomi", "/Applications/Nomi.app"],
    ["macOS 开发（node_modules 里的 Electron.app）", "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron", "/repo/node_modules/electron/dist/Electron.app"],
    ["Linux", "/opt/Nomi/nomi", "/opt/Nomi"],
  ])("posix：%s", (_label, exe, expected) => {
    expect(installRootFromExe(exe, path.posix)).toBe(expected);
  });

  it("Windows：exe 所在目录（用户自己选的 F:\\Nomi_new 这一层）", () => {
    expect(installRootFromExe("F:\\Nomi_new\\Nomi.exe", path.win32)).toBe("F:\\Nomi_new");
  });
});

describe("appOwnedLocationRoots / assertUserOwnedLocation（取自 Electron 自己的路径接口）", () => {
  it("打包的应用：安装目录（.app 包）、resources、userData、设置根、temp 都在", () => {
    const base = makeBase();
    electronState.base = base;
    vi.stubEnv("NOMI_SETTINGS_DIR", path.join(base, "settings"));
    const roots = appOwnedLocationRoots();
    expect(roots).toEqual(expect.arrayContaining([
      { kind: "install", root: path.join(base, "Applications", "Nomi.app") },
      { kind: "app-data", root: path.join(base, "electron-userData") },
      { kind: "app-data", root: path.join(base, "settings") },
      { kind: "temp", root: path.join(base, "electron-temp") },
    ]));
  });

  it("开发运行（没打包）：exe 是 node_modules 里的 Electron，没有安装器会清它，不算安装目录；应用数据和临时目录照拦", () => {
    const base = makeBase();
    electronState.base = base;
    electronState.isPackaged = false;
    vi.stubEnv("NOMI_SETTINGS_DIR", path.join(base, "settings"));
    expect(appOwnedLocationRoots().map((root) => root.kind)).not.toContain("install");
    expect(() => assertUserOwnedLocation(path.join(base, "electron-temp", "x"))).toThrow(/ProjectLocationRejectedError\[temp\]/);
  });

  it.each<[string, (base: string) => string, AppOwnedRoot["kind"]]>([
    ["安装目录（.app 包里）", (base) => path.join(base, "Applications", "Nomi.app", "xiangmu"), "install"],
    ["userData", (base) => path.join(base, "electron-userData", "projects"), "app-data"],
    ["设置根（NOMI_SETTINGS_DIR）", (base) => path.join(base, "settings", "projects"), "app-data"],
    ["系统临时目录（getPath temp）", (base) => path.join(base, "electron-temp", "projects"), "temp"],
  ])("拒绝 %s，错误经 IPC 只剩信息文本也认得出类别", (_label, candidate, kind) => {
    const base = makeBase();
    electronState.base = base;
    vi.stubEnv("NOMI_SETTINGS_DIR", path.join(base, "settings"));
    let thrown: unknown;
    try {
      assertUserOwnedLocation(candidate(base));
    } catch (error) {
      thrown = error;
    }
    expect(projectLocationRejection(thrown)).toBe(kind);
    expect(projectLocationRejection({ message: `Error invoking remote method 'nomi:workspace:open-folder': ${String(thrown)}` })).toBe(kind);
  });

  it("用户自己的位置（文稿、外置盘）放行", () => {
    const base = makeBase();
    electronState.base = base;
    vi.stubEnv("NOMI_SETTINGS_DIR", path.join(base, "settings"));
    expect(() => assertUserOwnedLocation(path.join(base, "Documents", "Nomi Projects"))).not.toThrow();
    expect(() => assertUserOwnedLocation(path.join(base, "Volumes", "外置 盘", "作品"))).not.toThrow();
  });
});
