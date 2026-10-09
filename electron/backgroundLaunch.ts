import { app, BrowserWindow } from "electron";

import { createBackgroundIdleExit, setBackgroundIdleExitOwner, type BackgroundIdleExit } from "./backgroundIdleExit";
import { hasInFlightTasks } from "./tasks/taskCache";
import { listProjects } from "./projects/repository";
import { getProductionRunService } from "./productionRun/productionRunRuntime";

export const isBackgroundLaunch = process.env.NOMI_LAUNCH_BACKGROUND === "1";

let idleExit: BackgroundIdleExit | undefined;
/** 后台冷启的主窗口有没有被用户叫出来过（一次 show 就算——从此它是用户在看的窗口）。 */
let shownToUser = false;
/** 主窗口代次：建一个新窗口、或窗口被叫出来，都加一。派发前落地的项目租约据它判断「还是不是那一个没人看的窗口」。 */
let windowEpoch = 0;

export function backgroundWindowOptions(): { show: boolean; backgroundThrottling: boolean } {
  return { show: !isBackgroundLaunch, backgroundThrottling: !isBackgroundLaunch };
}

export function installBackgroundWindowBehavior(mainWindow: BrowserWindow): void {
  if (!isBackgroundLaunch) return;
  windowEpoch += 1;
  mainWindow.on("show", () => {
    shownToUser = true;
    windowEpoch += 1;
    idleExit?.markWindowShown();
    mainWindow.webContents.setBackgroundThrottling(true);
    if (process.platform === "darwin") app.dock?.show?.();
  });
  if (process.platform === "darwin") app.dock?.hide();
}

export function installBackgroundLifecycle(deps: {
  hasInFlightWork: () => boolean;
  quit: () => void;
}): void {
  if (!isBackgroundLaunch) return;
  idleExit = createBackgroundIdleExit(deps);
  setBackgroundIdleExitOwner(idleExit);
}

export function hasInFlightProductionWork(): boolean {
  try {
    const service = getProductionRunService();
    return hasInFlightTasks() || listProjects().some((project) => service.repository.list(project.id).some((run) =>
      ["ready", "running", "exporting", "pausing"].includes(String(run.status)),
    ));
  } catch {
    // Unknown durable state must keep the process alive rather than risk
    // terminating a provider job that the owner has not finished observing.
    return true;
  }
}

/**
 * 主窗口此刻是隐藏的、而且用户从没把它叫出来过（外部 MCP 冷启的后台实例）。只有这时主进程可以替 Agent 在那个窗口里
 * 打开项目再落画布（landingProjectAccess）：没有人在看它。用户见过的窗口一律不替他换项目。
 */
export function mainWindowHiddenFromUser(window: Pick<BrowserWindow, "isDestroyed" | "isVisible"> | null): boolean {
  return isBackgroundLaunch && !shownToUser && Boolean(window) && !window!.isDestroyed() && !window!.isVisible();
}

/** 主窗口代次（见 windowEpoch）。 */
export function backgroundWindowEpoch(): number {
  return windowEpoch;
}

export function touchBackgroundActivity(): void {
  idleExit?.touch();
}

export function disposeBackgroundLifecycle(): void {
  setBackgroundIdleExitOwner(null);
  idleExit?.dispose();
  idleExit = undefined;
}
