// 开发态的窗口诊断挂钩。
//
// 从 main.ts 搬出来（它是白名单巨壳，只能越搬越小 —— R9/R12）。这一族天然属于日志层：
// 它挂的每一条最后都落在 `logDevDetail` 上，而 `logDevDetail` **只喷 stderr、不落盘**——
// 因为这几条要么带本机路径（userData 目录、dev server 地址、preload 路径），
// 要么是渲染层的自由文本（console 转发，可能夹带用户输入或提示词）。
// 打包版里整条是空操作，所以生产行为与从前逐字一致。
import type { BrowserWindow } from "electron";
import { logDevDetail } from "./logger";

export function registerDevDiagnostics(
  mainWindow: BrowserWindow,
  rendererUrl: string,
  context: { isDev: boolean; userDataDir: string },
): void {
  if (!context.isDev) return;

  logDevDetail("window", `loading renderer: ${rendererUrl}`);
  if (context.userDataDir) logDevDetail("main", `userData dir: ${context.userDataDir}`);

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logDevDetail("window", `renderer load failed (${errorCode}): ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    logDevDetail("window", "renderer did finish load");
  });
  mainWindow.webContents.on("dom-ready", () => {
    logDevDetail("window", "renderer dom ready");
  });
  // render-process-gone 不在这里挂：已由 installProcessGoneHandlers 装在 app 上（落盘 + 日志），
  // 覆盖所有窗口而不只是主窗，且生产环境也留证。
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    logDevDetail("window", `preload failed: ${preloadPath} :: ${error instanceof Error ? error.message : String(error)}`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logDevDetail("window", `renderer:${level} ${message} (${sourceId}:${line})`);
  });
}
