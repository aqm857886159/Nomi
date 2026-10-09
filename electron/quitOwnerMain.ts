import { BrowserWindow, ipcMain } from "electron";
import { installQuitTeardown, type QuitLifecycleApp, type QuitTeardownDependencies } from "./quitTeardown";
import { quitTeardownLogSinks } from "./quitTeardownLog";
import { installShutdownProjectFlush, SHUTDOWN_FLUSH_RESPONSE_CHANNEL } from "./shutdownProjectFlush";
import { assertTrustedFireAndForget, assertTrustedUiSender } from "./ipcSenderGuard";

/**
 * main.ts's one call into the quit lifecycle: installs the owner with the production log sinks and
 * registers the drains that need live Electron windows (OS shutdown: every open window silently saves
 * its project, the write itself stays the renderer's existing save path).
 */
export function installMainQuitOwner(app: QuitLifecycleApp, dependencies: Omit<QuitTeardownDependencies, "onError" | "onReceipt">): void {
  installQuitTeardown(app, { ...dependencies, ...quitTeardownLogSinks });
  installShutdownProjectFlush({
    windows: () => BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed() && !window.webContents.isCrashed()).map((window) => window.webContents),
    onResponse: (listener) => { ipcMain.on(SHUTDOWN_FLUSH_RESPONSE_CHANNEL, (event, payload: unknown) => { if (!assertTrustedFireAndForget(event, SHUTDOWN_FLUSH_RESPONSE_CHANNEL, assertTrustedUiSender)) return; listener(payload); }); },
    onError: quitTeardownLogSinks.onError!,
  });
}
