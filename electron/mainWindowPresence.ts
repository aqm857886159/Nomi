import type { BrowserWindow } from "electron";
import { getMainWindow } from "./appWindowRegistry";
import { logError, logInfo } from "./logging/logger";

type MainWindowGuard = (entry: string, reveal?: boolean, create?: () => Promise<unknown>) => Promise<BrowserWindow | null>;
let installedGuard: MainWindowGuard | undefined;

/** 显示调用者已固定的窗口，不重新选窗或更换它的项目租约。 */
export function showWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** 通知等入口复用主进程已装配的建窗主人；无 GUI 的进程不另建窗口。 */
export function ensureMainWindow(entry: string): Promise<BrowserWindow | null> {
  if (installedGuard) return installedGuard(entry);
  logInfo("window", "main-window-presence", { entry, found: false, result: "no-gui-owner" });
  return Promise.resolve(null);
}

export function createMainWindowGuard(args: {
  createWindow: () => Promise<unknown>;
  onWindowReady: () => void;
}): MainWindowGuard {
  let inFlight: Promise<void> | null = null;
  installedGuard = async (entry, reveal = true, create = args.createWindow) => {
    const found = Boolean(getMainWindow());
    try {
      // 先等正在加载的窗口：registry 登记早于 renderer ready，深链不能提前投递。
      if (!inFlight && !found) {
        inFlight = create().catch((error) => {
          // 创建者已经登记但页面未就绪：删掉这次失败的窗口，别把它当成可用主窗。
          getMainWindow()?.destroy();
          throw error;
        }).then(() => { args.onWindowReady(); }).finally(() => { inFlight = null; });
      }
      if (inFlight) await inFlight;
      const window = getMainWindow();
      if (window && reveal) showWindow(window);
      logInfo("window", "main-window-presence", { entry, found, result: window ? (reveal ? "revealed" : "retained") : "missing" });
      return window;
    } catch (error) {
      logError("window", "ensure-main-window-failed", error, { entry, found, result: "failed" });
      return null;
    }
  };
  return installedGuard;
}
