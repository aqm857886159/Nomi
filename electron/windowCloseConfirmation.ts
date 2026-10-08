import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { quitTeardownTimeoutMs, resetQuitRequest } from "./quitTeardown";

const windowsAllowedToClose = new WeakSet<BrowserWindow>();
const pendingCloseRequests = new WeakMap<BrowserWindow, string>();
const pendingCloseTimers = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>();
let closeResponseIpcRegistered = false;

function clearPendingClose(mainWindow: BrowserWindow): void {
  pendingCloseRequests.delete(mainWindow);
  const timer = pendingCloseTimers.get(mainWindow);
  if (timer) clearTimeout(timer);
  pendingCloseTimers.delete(mainWindow);
}

function parseCloseResponse(payload: unknown): { requestId: string; confirmed: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const requestId = String((payload as { requestId?: unknown }).requestId || "").trim();
  if (!requestId) return null;
  return { requestId, confirmed: (payload as { confirmed?: unknown }).confirmed === true };
}

function registerCloseResponseIpc(): void {
  if (closeResponseIpcRegistered) return;
  closeResponseIpcRegistered = true;
  ipcMain.on("nomi:window:close-response", (event, payload: unknown) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    const response = parseCloseResponse(payload);
    if (!mainWindow || !response) return;
    if (pendingCloseRequests.get(mainWindow) !== response.requestId) return;
    clearPendingClose(mainWindow);
    if (!response.confirmed || mainWindow.isDestroyed()) {
      resetQuitRequest();
      return;
    }
    windowsAllowedToClose.add(mainWindow);
    mainWindow.close();
  });
}

export function installWindowCloseConfirmation(mainWindow: BrowserWindow): void {
  registerCloseResponseIpc();
  mainWindow.on("close", (event) => {
    if (windowsAllowedToClose.has(mainWindow)) {
      windowsAllowedToClose.delete(mainWindow);
      return;
    }
    if (pendingCloseRequests.has(mainWindow)) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const requestId = randomUUID();
    pendingCloseRequests.set(mainWindow, requestId);
    const timer = setTimeout(() => {
      if (pendingCloseRequests.get(mainWindow) !== requestId) return;
      clearPendingClose(mainWindow);
      if (mainWindow.isDestroyed()) return;
      windowsAllowedToClose.add(mainWindow);
      mainWindow.close();
    }, quitTeardownTimeoutMs());
    timer.unref?.();
    pendingCloseTimers.set(mainWindow, timer);
    mainWindow.focus();
    mainWindow.webContents.send("nomi:window:close-request", { requestId });
  });
  mainWindow.on("closed", () => {
    clearPendingClose(mainWindow);
  });
}
