// Vitest 专用的 Electron 运行时桩（stub）。
//
// 单测跑在 `environment: "node"`，而真·electron 模块在被 import 时会执行
// `node_modules/electron/index.js`：若平台二进制不可解析（如 CI 全新环境里
// path.txt 缺失），它会**在 import 那一刻**抛
// "Electron failed to install correctly"。源码（如 runtimePaths.ts）在模块顶层
// `import { app } from "electron"`，于是任何传递依赖到它的单测都会在加载期崩。
//
// 这里把 electron 整个 alias 成无副作用的桩：单测本就不该、也无法使用真 electron
// 运行时；真正需要 electron 行为的测试各自注入自己的假实现。桩只需"存在且不抛"。
// 真实 app 构建走 vite.config.ts，不受此 alias 影响。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const noop = (): undefined => undefined;

// getPath() 必须给**绝对**目录 —— 真 Electron 永远如此（main.ts 启动时还会
// app.setPath("userData", …) 再注入一次）。桩从前返回 ""，于是遍布代码的
// `path.join(getSettingsRoot(), 文件名)` 全退化成相对路径，落进 process.cwd()
// = 仓库根目录：跑一次 `pnpm run test` 就在仓库里拉出一个未跟踪的
// model-catalog.json（真发生过，由 providerAdapter/onboardingRoundtrip 触发）。
// 不忠实的替身 = 生产代码里发现不了的一整类 bug，故这里按进程给一份真临时
// userData 根：每个 vitest worker 各一份、互不串味，进程退出即清。
// 需要检查落盘内容的测试仍各自 vi.mock("electron") 指向自己的临时目录。
const TEST_APP_DATA_ROOT = path.join(os.tmpdir(), "nomi-vitest-userdata", String(process.pid));

process.on("exit", () => {
  try {
    fs.rmSync(TEST_APP_DATA_ROOT, { recursive: true, force: true });
  } catch {
    // 尽力而为：临时目录留下无害，绝不能因清理失败影响测试结果
  }
});

export const app = {
  // 真 Electron 的各 name（userData / temp / documents / downloads…）是不同目录，
  // 这里同样分开，免得「项目默认目录」之类的东西被塞进 userData 里。
  getPath: (name?: string): string => path.join(TEST_APP_DATA_ROOT, name || "userData"),
  // 开发态下 getAppPath() 就是仓库根（既有各测试的自备 mock 也都这么写）。
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
