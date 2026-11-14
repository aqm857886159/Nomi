import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { beginMainWindowClose, cancelMainWindowClose, noteCloseConfirmationInstalled, revealMainWindow, settleConfirmedClose } from "./mainWindowPresence";
import { resetQuitRequest } from "./quitTeardown";

export const CLOSE_ACK_DEADLINE_MS = 1500;
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

// 关窗的结果（退 / 藏）只由主窗主人决定；这里只负责「问用户」这一步。取消 = 撤销还没放行的退出。
function cancelClose(): void {
  resetQuitRequest();
  cancelMainWindowClose();
}

function showNativeCloseDialog(mainWindow: BrowserWindow): void {
  const existing = pendingCloseDialogs.get(mainWindow);
  if (existing) {
    revealMainWindow("close-confirmation");
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
    if (result.response === 0) settleConfirmedClose(mainWindow, { force: true });
    else cancelClose();
  }).catch(() => {
    pendingCloseDialogs.delete(mainWindow);
    cancelClose();
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
      cancelClose();
      return;
    }
    settleConfirmedClose(mainWindow);
  });
}

export function installWindowCloseConfirmation(mainWindow: BrowserWindow): void {
  registerCloseResponseIpc();
  noteCloseConfirmationInstalled(mainWindow);
  mainWindow.on("close", (event) => {
    // 主人先判：已放行 → 关；后台冷启没人见过又空闲 → 主人直接存盘退出；其余先把窗口亮出来再问（看不见的窗口不发问）。
    const start = beginMainWindowClose(mainWindow);
    if (start === "proceed") return;
    event.preventDefault();
    if (start === "handled") return;
    if (pendingCloseRequests.has(mainWindow) || pendingCloseDialogs.has(mainWindow)) return;
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
  mainWindow.on("closed", () => clearPendingClose(mainWindow));
}
