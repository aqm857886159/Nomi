import { BrowserWindow } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

import { appWindowRecordOf, originOfUrl, type AppWindowRole } from "./appWindowRegistry";

type IpcEvent = Pick<IpcMainEvent | IpcMainInvokeEvent, "sender" | "senderFrame">;

export class UntrustedIpcSenderError extends Error {
  constructor() {
    super("IPC 请求来源不是 Nomi 自有窗口");
    this.name = "UntrustedIpcSenderError";
  }
}

/**
 * 全部 IPC 信任判定的唯一实现。「这个发送方是谁」只问登记表（electron/appWindowRegistry.ts），
 * 不再从 URL 长相之类的偶然属性现场推导——那正是素材盒浮层/菜单窗/dev 模式三次误伤的来源。
 *
 * 除了角色，还要过三道结构闸（都是不依赖 URL 内容的硬性事实）：
 *  1. 发送方必须是这个窗口**自己的** webContents。应用内浏览器的远端网页是 WebContentsView
 *     且不挂 preload（electron/browser/core/browserViews.ts），本来就没有 ipcRenderer；这条把
 *     「结构上不可能」变成「显式拒绝」，不靠别处的实现细节维持。
 *  2. 必须是顶层主帧：页面内的 iframe 子帧不算，远端内容被 iframe 进来也拿不到权限。
 *  3. origin 必须等于登记的入口 origin（登记时为 null 则以窗口自己当前 URL 为准）——
 *     窗口一旦被导航去别的 origin，权限立刻消失。
 */
function assertSenderRole(event: IpcEvent, allowedRoles: readonly AppWindowRole[]): void {
  const sender = event.sender;
  const senderFrame = event.senderFrame;
  const senderWindow = sender ? BrowserWindow.fromWebContents(sender) : null;
  const record = appWindowRecordOf(senderWindow);

  if (!record || !allowedRoles.includes(record.role)) throw new UntrustedIpcSenderError();

  const contents = record.window.webContents;
  const mainFrame = contents.isDestroyed() ? null : contents.mainFrame;
  const expectedOrigin = record.expectedOrigin ?? originOfUrl(contents.isDestroyed() ? null : contents.getURL());
  const senderOrigin = originOfUrl(senderFrame?.url);

  if (
    contents.isDestroyed() ||
    sender !== contents ||
    !senderFrame ||
    !mainFrame ||
    senderFrame.routingId !== mainFrame.routingId ||
    !senderOrigin ||
    !expectedOrigin ||
    senderOrigin !== expectedOrigin
  ) {
    throw new UntrustedIpcSenderError();
  }
}

/**
 * 最高信任面：只有工作台主窗口。
 *
 * 给「动用户授权 / 花额度 / 碰账号与供应商凭据」的通道用——这些能力只有主窗口的界面暴露，
 * 辅助窗口拿不到也不该拿到（最小权限；将来某个辅助窗口哪天真的载入了不那么可信的东西，
 * 它顶多够到 UI 面那一档）。
 */
export function assertTrustedSender(event: IpcEvent): void {
  assertSenderRole(event, ["main"]);
}

/**
 * Nomi 自有 UI 面：主窗口 + 我们自己建、挂了 Nomi preload 的辅助窗（素材盒浮层、浏览器 chrome 菜单）。
 *
 * 给两类通道用：应用内浏览器自己的控制通道（`browser:*`），以及素材盒这种**界面就长在辅助窗里**
 * 的功能所需的少数几条数据通道（素材列表/导入、以及它右键删除要走的回收站通道）。
 * 远端网页够不到这一档：它是无 preload 的 WebContentsView，既不隶属任何登记窗口，也没有 ipcRenderer。
 */
export function assertTrustedUiSender(event: IpcEvent): void {
  assertSenderRole(event, ["main", "app-surface"]);
}
