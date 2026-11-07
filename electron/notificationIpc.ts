// 系统通知 IPC（从 main.ts 拆出，那边 775/800 行只剩余量给两行注册；后续通知通道加这里，别回填 main.ts）。
// 用途：批量生成跑完时，若 Nomi 窗口不在前台 → 发一条原生通知，点它回到 Nomi。
// 方案：docs/plan/2026-08-02-task-center-queue.md
//
// 为什么走主进程而不是渲染层的 HTML5 Notification：只有主进程这边点击回调能真正把窗口
// show()+focus() 拉回前台（渲染层的 window.focus() 在 macOS 上不可靠）。
import { ipcMain } from "electron";
import { ensureMainWindow } from "./mainWindowPresence";
import { showDesktopNotification } from "./desktopNotification";
import { assertTrustedSender } from "./ipcSenderGuard";

type NotifyPayload = {
  title?: unknown;
  body?: unknown;
  event?: unknown;
};

// 异步通道（ipcMain.handle）而非 registerSyncIpc：发通知没必要阻塞渲染层。
export function registerNotificationIpc(): void {
  ipcMain.handle("nomi:notifications:show", (event, payload: unknown) => {
    // 原生通知可被伪装成系统提示做钓鱼，且点击会把窗口拉到前台。
    assertTrustedSender(event);
    const input = (payload || {}) as NotifyPayload;
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, reason: "empty-title" };
    return showDesktopNotification({ title, body: String(input.body || ""),
      event: input.event === 'decision' || input.event === 'slow' ? input.event : 'completed', onClick: () => ensureMainWindow("notification") })
  });
}
