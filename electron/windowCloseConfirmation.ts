import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { continueRequestedQuit, resetQuitRequest } from "./quitTeardown";

export const CLOSE_ACK_DEADLINE_MS = 1500;
const windowsAllowedToClose = new WeakSet<BrowserWindow>();
const pendingCloseRequests = new WeakMap<BrowserWindow, { requestId: string; acked: boolean }>();
const pendingCloseTimers = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>();
const pendingCloseDialogs = new WeakMap<BrowserWindow, Promise<void>>();
let closeResponseIpcRegistered = false;

function clearPendingClose(mainWindow: BrowserWindow): void {
  pendingCloseRequests.delete(mainWindow);
  const timer = pendingCloseTimers.get(mainWindow);
  if (timer) clearTimeout(timer);
  pendingCloseTimers.delete(mainWindow);
}

function parseCloseResponse(payload: unknown): { requestId: string; kind: "ack" | "decision"; confirmed?: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const requestId = String((payload as { requestId?: unknown }).requestId || "").trim();
  if (!requestId) return null;
  if ((payload as { ack?: unknown }).ack === true) return { requestId, kind: "ack" };
  return { requestId, kind: "decision", confirmed: (payload as { confirmed?: unknown }).confirmed === true };
}

function forceClose(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return;
  windowsAllowedToClose.add(mainWindow);
  mainWindow.close();
}

function showNativeCloseDialog(mainWindow: BrowserWindow): void {
  const existing = pendingCloseDialogs.get(mainWindow);
  if (existing) {
    mainWindow.focus();
    return;
  }
  // 只传 options：带父窗口会跨线程持有属主，Windows 第三方输入法下整个 app 闪退（electron/nativeDialogParent.invariant.test.ts）。
  const dialogPromise = dialog.showMessageBox({
    type: "warning",
    buttons: ["Force Quit", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Nomi",
    message: "Nomi did not respond.",
    detail: "Force quitting may lose unsaved content.",
  }).then((result) => {
    pendingCloseDialogs.delete(mainWindow);
    if (result.response === 0) forceClose(mainWindow);
    else resetQuitRequest();
  }).catch(() => {
    pendingCloseDialogs.delete(mainWindow);
    resetQuitRequest();
  });
  pendingCloseDialogs.set(mainWindow, dialogPromise);
}

function registerCloseResponseIpc(): void {
  if (closeResponseIpcRegistered) return;
  closeResponseIpcRegistered = true;
  ipcMain.on("nomi:window:close-response", (event, payload: unknown) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    const response = parseCloseResponse(payload);
    if (!mainWindow || !response) return;
    const pending = pendingCloseRequests.get(mainWindow);
    if (!pending || pending.requestId !== response.requestId) return;
    if (response.kind === "ack") {
      pending.acked = true;
      const timer = pendingCloseTimers.get(mainWindow);
      if (timer) clearTimeout(timer);
      pendingCloseTimers.delete(mainWindow);
      return;
    }
    clearPendingClose(mainWindow);
    if (!response.confirmed || mainWindow.isDestroyed()) {
      resetQuitRequest();
      return;
    }
    forceClose(mainWindow);
  });
}

export function installWindowCloseConfirmation(mainWindow: BrowserWindow): void {
  registerCloseResponseIpc();
  mainWindow.on("close", (event) => {
    if (windowsAllowedToClose.has(mainWindow)) {
      windowsAllowedToClose.delete(mainWindow);
      return;
    }
    if (pendingCloseRequests.has(mainWindow) || pendingCloseDialogs.has(mainWindow)) {
      event.preventDefault();
      mainWindow.focus();
      return;
    }
    event.preventDefault();
    const requestId = randomUUID();
    pendingCloseRequests.set(mainWindow, { requestId, acked: false });
    const timer = setTimeout(() => {
      const pending = pendingCloseRequests.get(mainWindow);
      if (!pending || pending.requestId !== requestId || pending.acked) return;
      clearPendingClose(mainWindow);
      showNativeCloseDialog(mainWindow);
    }, CLOSE_ACK_DEADLINE_MS);
    timer.unref?.();
    pendingCloseTimers.set(mainWindow, timer);
    mainWindow.focus();
    mainWindow.webContents.send("nomi:window:close-request", { requestId });
  });
  // A renderer that ACKed and then crashed or hung can never deliver the user's decision: the window
  // would refuse every later close and quit forever. Treat it like a missing ACK: ask natively.
  const rendererLost = (): void => {
    if (!pendingCloseRequests.has(mainWindow)) return;
    clearPendingClose(mainWindow);
    showNativeCloseDialog(mainWindow);
  };
  mainWindow.webContents.on("render-process-gone", rendererLost);
  mainWindow.on("unresponsive", rendererLost);
  mainWindow.on("closed", () => {
    clearPendingClose(mainWindow);
    // Preventing the window "close" event cancels Electron's in-flight quit (⌘Q / Dock / app.quit). Once the user
    // confirmed and the window is gone, resume the quit they asked for; after the window list
    // settles so Electron does not re-close a closing window. No-op when no quit was requested.
    setImmediate(continueRequestedQuit);
  });
}
