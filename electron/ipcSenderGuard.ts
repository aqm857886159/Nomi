import { BrowserWindow } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

import { getMainWindow } from "./mainWindowRegistry";

type IpcEvent = Pick<IpcMainEvent | IpcMainInvokeEvent, "sender" | "senderFrame">;

export class UntrustedIpcSenderError extends Error {
  constructor() {
    super("IPC 请求来源不是 Nomi 主窗口");
    this.name = "UntrustedIpcSenderError";
  }
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? "file://" : parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Trust boundary for IPC handlers that mutate authority or spend user quota.
 *
 * BrowserView/WebContentsView is intentionally allowed to load remote pages in
 * the in-app browser, so "came from a renderer" is not an identity check. The
 * only trusted sender is the currently registered Nomi main window's main
 * frame, with the same origin as that window's current renderer entry.
 */
export function assertTrustedSender(event: IpcEvent): void {
  const mainWindow = getMainWindow();
  const sender = event.sender;
  const senderFrame = event.senderFrame;
  const mainContents = mainWindow?.webContents;
  const mainFrame = mainContents?.mainFrame;
  const senderWindow = mainWindow && sender ? BrowserWindow.fromWebContents(sender) : null;
  const senderOrigin = originOf(senderFrame?.url);
  const mainOrigin = originOf(mainContents?.getURL());

  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !mainContents ||
    mainContents.isDestroyed() ||
    senderWindow !== mainWindow ||
    sender !== mainContents ||
    !senderFrame ||
    !mainFrame ||
    senderFrame.routingId !== mainFrame.routingId ||
    !senderOrigin ||
    senderOrigin !== mainOrigin
  ) {
    throw new UntrustedIpcSenderError();
  }
}

/**
 * Trust boundary for the in-app browser's own control channels (`browser:*`).
 *
 * These are legitimately driven by three distinct app-owned surfaces, so
 * `assertTrustedSender` (main window only) would break the in-app browser:
 * the main window, the asset overlay window, and the chrome menu window —
 * every one of them a BrowserWindow created by us with our preload attached.
 *
 * The remote page itself is NOT one of them: browser views are constructed as
 * `WebContentsView` with no preload (electron/browser/core/browserViews.ts),
 * so remote content has no `ipcRenderer` and is structurally unable to reach
 * any channel. This rule enforces that structurally rather than relying on it:
 * the sender must be a BrowserWindow's own top-level frame loaded from the
 * app's local renderer entry (`file://`), which no remote page can satisfy.
 */
export function assertTrustedUiSender(event: IpcEvent): void {
  const sender = event.sender;
  const senderFrame = event.senderFrame;
  const senderWindow = sender ? BrowserWindow.fromWebContents(sender) : null;

  if (
    !senderWindow ||
    senderWindow.isDestroyed() ||
    sender !== senderWindow.webContents ||
    !senderFrame ||
    senderFrame.routingId !== senderWindow.webContents.mainFrame?.routingId ||
    originOf(senderFrame.url) !== "file://"
  ) {
    throw new UntrustedIpcSenderError();
  }
}
