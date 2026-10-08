import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";

const windowsAllowedToClose = new WeakSet<BrowserWindow>();
const pendingCloseRequests = new WeakMap<BrowserWindow, string>();
let closeResponseIpcRegistered = false;

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
    pendingCloseRequests.delete(mainWindow);
    if (!response.confirmed || mainWindow.isDestroyed()) return;
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
    mainWindow.focus();
    mainWindow.webContents.send("nomi:window:close-request", { requestId });
  });
  mainWindow.on("closed", () => {
    pendingCloseRequests.delete(mainWindow);
  });
}
