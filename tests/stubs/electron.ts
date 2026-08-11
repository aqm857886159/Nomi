// Vitest 专用的 Electron 运行时桩（stub）。
//
// 单测跑在 `environment: "node"`，而真·electron 模块在被 import 时会执行
// `node_modules/electron/index.js`：若平台二进制不可解析（如 CI 全新环境里
// path.txt 缺失），它会**在 import 那一刻**抛
// "Electron failed to install correctly"。源码（如 runtimePaths.ts）在模块顶层
// `import { app } from "electron"`，于是任何传递依赖到它的单测都会在加载期崩。
//
// 这里把 electron 整个 alias 成 import 无副作用的桩：单测本就不该、也无法使用真 electron
// 运行时；真正需要 electron 行为的测试各自注入自己的假实现。桩只需"存在且不抛"。
// （唯一的副作用是惰性的：首次调用 getPath 才建/清临时根，见下方 runtimeRoot。）
// 真实 app 构建走 vite.config.ts，不受此 alias 影响。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 路径类 API 必须返回**真实的绝对路径**（根因：曾经返回 ""）。
 *
 * 真 electron 的 getPath() 永远给绝对路径，返回 "" 是一个现实中不存在的值。而
 * `getSettingsRoot()` 之下挂着十几个存储模块（catalog / proxy / 项目位置 / prompt 库 /
 * 下载偏好 …），它们一律 `path.join(getSettingsRoot(), 文件名)`——base 为 "" 时 join 出
 * 的是相对路径，于是全部落到 `process.cwd()`＝**仓库根目录**：单测会在仓库里生成
 * model-catalog.json 之类的脏文件（未被 .gitignore 收，`git add -A` 就混进提交），
 * 且跑测试会读到上一轮的残留。逐个测试 mock 掉 store 只是堵症状——桩说了实话，
 * 这一整类问题才不会再从别的入口冒出来。
 *
 * 每个测试进程一份独立的临时根（按 pid 定名，vitest 默认 forks pool ⇒ 同一时刻不会有两个
 * worker 撞同一个 pid），首次用到时先清掉残留 —— 于是每个测试进程都从空目录开始，跨次运行
 * 也不会读到上一轮的状态。**不用 mkdtemp + exit 钩子做清理**：vitest 结束时是强制终止 worker
 * 进程的，'exit' 不保证触发，那样只会一边堆临时目录一边假装清理过（实测验证过：跑完目录还在）。
 * 也不做「跑完统一扫掉 nomi-vitest-*」：这台机器常有多个 worktree 并行跑测试，共用同一个
 * os.tmpdir()，一把扫会删掉别人正在用的目录。取舍是明说的 —— 空目录留给系统临时区按期回收，
 * 换来「不会误删并行任务」+「内容永远在使用前被清空，任何一次测试都读不到残留」。
 *
 * 缓存挂 globalThis 而不是模块作用域：vitest 默认 isolate，同一进程里每个测试文件都会重新
 * 求值本模块，`vi.resetModules()` 亦然；模块级变量会让"清理"按文件数反复触发，把测试跑到
 * 一半的状态清掉。globalThis 不随模块注册表重置，故「一进程只清一次」成立。
 * 真正需要隔离/断言具体路径的测试，照旧用 NOMI_SETTINGS_DIR 或自己 mock electron。
 */
const globalScope = globalThis as { __nomiElectronStubRoot?: string };

function runtimeRoot(): string {
  const existing = globalScope.__nomiElectronStubRoot;
  if (existing) return existing;
  const root = path.join(os.tmpdir(), `nomi-vitest-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  globalScope.__nomiElectronStubRoot = root;
  return root;
}

const noop = (): undefined => undefined;

export const app = {
  // 按 name 分子目录，与真 electron「userData / documents / downloads / logs 各是不同目录」一致；
  // 目录不预建——写入方（writeJsonFileAtomic / ensureDir）本就会 mkdir，读取方容忍缺失。
  getPath: (name = "userData"): string => path.join(runtimeRoot(), name),
  // 真 electron 在 dev 下返回仓库根；getSkillsRoots 早已把 "" 经 path.resolve 折成 cwd，
  // 故这里写实等价于原行为，只是不再依赖"相对路径碰巧解析对"。
  getAppPath: (): string => process.cwd(),
  getName: (): string => "Nomi",
  getVersion: (): string => "0.0.0-test",
  on: noop,
  whenReady: (): Promise<void> => Promise.resolve(),
  quit: noop,
};

export const ipcMain = { handle: noop, on: noop, removeHandler: noop };

export const ipcRenderer = {
  invoke: (): Promise<unknown> => Promise.resolve(undefined),
  on: noop,
  send: noop,
};

export const contextBridge = { exposeInMainWorld: noop };

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
}

export const dialog = {
  showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: (): Promise<{ canceled: boolean; filePath?: string }> =>
    Promise.resolve({ canceled: true }),
};

export const shell = {
  openExternal: (): Promise<void> => Promise.resolve(),
  openPath: (): Promise<string> => Promise.resolve(""),
};

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, "utf-8"),
  decryptString: (b: Buffer): string => b.toString("utf-8"),
};

export const net = { request: noop };

export const session = { defaultSession: undefined };

export const protocol = { handle: noop, registerSchemesAsPrivileged: noop };

export const webContents = { getAllWebContents: (): unknown[] => [] };

export default {
  app,
  ipcMain,
  ipcRenderer,
  contextBridge,
  BrowserWindow,
  dialog,
  shell,
  safeStorage,
  net,
  session,
  protocol,
  webContents,
};
