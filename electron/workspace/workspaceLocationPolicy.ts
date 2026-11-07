/**
 * 项目能不能放在这里：每个入口都调这一个判定（「项目在哪」收敛单不变量 ④，用户 2026-10-29 批准）。
 *
 * 为什么：0.24.0 有用户把「新项目默认位置」设在安装目录下面，升级时安装器清空安装目录，项目跟着没了。
 * Nomi 自己的目录——安装目录（含 resources）、应用数据（userData 与设置根）、系统临时目录——都会被升级、卸载
 * 或系统清理整个删掉，项目不能放进去。入口：设置里选「新项目默认位置」（选时拒，检查时报）、「打开已有文件夹」
 * （选择时和打开时都判）、新建项目、外部 Agent 建项目（两者都经 electron/projects/repository.ts 的 createProject）。
 *
 * 不判的：环境变量 NOMI_PROJECTS_DIR 托管的默认位置。它不经任何产品入口选出，设置页对它只读（managed-by-environment），
 * 拒绝了用户也没处改；走查 / e2e 的隔离项目库都靠它。启动对账扫到的文件夹也不判——那是盘上已有的东西，不是入口。
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getSettingsRoot } from "../settings/settingsRoot";
import { projectLocationRejectedError, type AppOwnedLocationKind } from "../shared/contracts/projectLocation";

type PathApi = Pick<typeof path, "resolve" | "relative" | "isAbsolute" | "dirname" | "basename" | "join" | "sep">;
/** 符号链接要按真实位置比较（macOS 的 /var → /private/var、指进应用目录的链接）；win32 推导测试传 null，只做字面比较。 */
type LocationFs = { exists: (target: string) => boolean; realpath: (target: string) => string } | null;

export type AppOwnedRoot = { kind: AppOwnedLocationKind; root: string };

const nodeFs: LocationFs = { exists: (target) => fs.existsSync(target), realpath: (target) => fs.realpathSync(target) };

/**
 * candidate 是 root 本身或在它里面。用 Node 的 path.relative：path.win32.relative 自己不分大小写（盘符、目录名都是），
 * 末尾分隔符经 resolve 去掉；不另写 startsWith(root + sep)。
 */
export function isPathInside(root: string, candidate: string, pathApi: PathApi = path): boolean {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  if (relative === "") return true;
  if (pathApi.isAbsolute(relative)) return false; // win32 不同盘符
  return relative !== ".." && !relative.startsWith(`..${pathApi.sep}`);
}

/** 最近一个存在的祖先取 realpath，再接上还不存在的那一截（选的位置可能还没建出来）。 */
function canonicalPath(target: string, pathApi: PathApi, locationFs: LocationFs): string {
  const resolved = pathApi.resolve(target);
  if (!locationFs) return resolved;
  const missing: string[] = [];
  let current = resolved;
  for (;;) {
    if (locationFs.exists(current)) {
      try {
        return pathApi.join(locationFs.realpath(current), ...missing);
      } catch {
        return resolved;
      }
    }
    const parent = pathApi.dirname(current);
    if (parent === current) return resolved;
    missing.unshift(pathApi.basename(current));
    current = parent;
  }
}

/** 安装目录：mac 是 exe 所在的（最外层）.app 包；Windows / Linux 是 exe 所在目录（Windows 上用户自己选的那一层）。 */
export function installRootFromExe(exePath: string, pathApi: PathApi = path): string {
  const resolved = pathApi.resolve(exePath);
  const segments = resolved.split(pathApi.sep);
  const bundleIndex = segments.findIndex((segment, index) => index < segments.length - 1 && segment.toLowerCase().endsWith(".app"));
  return bundleIndex > 0 ? segments.slice(0, bundleIndex + 1).join(pathApi.sep) : pathApi.dirname(resolved);
}

/**
 * Nomi 自己的目录，全部取自 Electron 自己的路径接口。安装目录只对打包的应用成立：开发运行时 exe 是 node_modules 里的
 * Electron，没有安装器会清它。
 */
export function appOwnedLocationRoots(): AppOwnedRoot[] {
  const roots: AppOwnedRoot[] = [];
  const add = (kind: AppOwnedLocationKind, value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text && path.isAbsolute(text)) roots.push({ kind, root: text });
  };
  if (app.isPackaged) {
    add("install", installRootFromExe(app.getPath("exe")));
    add("install", process.resourcesPath);
  }
  add("app-data", app.getPath("userData"));
  add("app-data", getSettingsRoot());
  add("temp", app.getPath("temp"));
  return roots;
}

/**
 * 唯一的判定：candidate 落在哪个应用目录里（root 本身也算），不在任何一个里返回 null。
 * 字面路径与真实路径都比：经符号链接指进应用目录的也拦，应用目录自己经符号链接（macOS 临时目录）也认得出。
 */
export function findAppOwnedLocation(
  candidate: string,
  roots: readonly AppOwnedRoot[] = appOwnedLocationRoots(),
  options: { path?: PathApi; fs?: LocationFs } = {},
): AppOwnedRoot | null {
  const pathApi = options.path ?? path;
  const locationFs = options.fs === undefined ? nodeFs : options.fs;
  const candidates = [pathApi.resolve(candidate), canonicalPath(candidate, pathApi, locationFs)];
  for (const owned of roots) {
    const ownedForms = [pathApi.resolve(owned.root), canonicalPath(owned.root, pathApi, locationFs)];
    if (candidates.some((form) => ownedForms.some((root) => isPathInside(root, form, pathApi)))) return owned;
  }
  return null;
}

/** 入口用：落在应用目录里就抛 ProjectLocationRejectedError[类别]（渲染层按类别说清为什么、去哪改）。 */
export function assertUserOwnedLocation(candidate: string): void {
  const owned = findAppOwnedLocation(candidate);
  if (owned) throw projectLocationRejectedError(owned.kind, path.resolve(candidate));
}
