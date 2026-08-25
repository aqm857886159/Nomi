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
