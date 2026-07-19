import type { BrowserWindow } from "electron";
import { installWindowCloseConfirmation } from "./windowCloseConfirmation";
import { installAppPageZoomGuard } from "./windowInput";
import { installWindowZoomShortcuts } from "./windowZoomShortcuts";

/** 主窗口输入/关闭行为集中安装，避免 main.ts 继续膨胀。 */
export function installMainWindowInteractions(window: BrowserWindow): void {
  installAppPageZoomGuard(window.webContents);
  installWindowZoomShortcuts(window.webContents);
  // 自动化里无人处理关闭确认框；E2E 窗口必须能正常退出，避免残留进程。
  if (process.env.NOMI_E2E !== "1") installWindowCloseConfirmation(window);
}
