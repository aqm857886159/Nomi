// 系统通知 IPC（从 main.ts 拆出，那边 775/800 行只剩余量给两行注册；后续通知通道加这里，别回填 main.ts）。
// 用途：批量生成跑完时，若 Nomi 窗口不在前台 → 发一条原生通知，点它回到 Nomi。
// 方案：docs/plan/2026-08-02-task-center-queue.md
//
// 为什么走主进程而不是渲染层的 HTML5 Notification：只有主进程这边点击回调能真正把窗口
// show()+focus() 拉回前台（渲染层的 window.focus() 在 macOS 上不可靠）。
import { BrowserWindow, Notification, ipcMain } from "electron";
import { logCrash } from "./crashLog";
import { assertTrustedSender } from "./ipcSenderGuard";

type NotifyPayload = {
  title?: unknown;
  body?: unknown;
  /** true = 不要 OS 提示音（用户在应用内关了「声音」时传 true）。 */
  silent?: unknown;
};

function focusMainWindow(): void {
  // 通知可能在窗口最小化时被点：先 restore 再 show+focus，否则 macOS 上只是抢焦点、窗口仍收着。
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 异步通道（ipcMain.handle）而非 registerSyncIpc：发通知没必要阻塞渲染层。
export function registerNotificationIpc(): void {
  ipcMain.handle("nomi:notifications:show", (event, payload: unknown) => {
    // 原生通知可被伪装成系统提示做钓鱼，且点击会把窗口拉到前台。
    assertTrustedSender(event);
    const input = (payload || {}) as NotifyPayload;
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, reason: "empty-title" };
    // Linux 部分环境 / 未授权时不支持：老实回 false，调用端据此降级到自制提示音，别假装发了。
    if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
    const notification = new Notification({
      title,
      body: String(input.body || ""),
      silent: input.silent === true,
    });
    notification.on("click", focusMainWindow);
    // macOS 自 Electron 42 起走 UNNotification：系统可能在 show() 之后**异步**拒发
    // （用户在系统设置里关了通知、未获授权…），而 isSupported() 仍返回 true。
    // 不接这个事件的话，失败是**全无声的**：这里照样 return ok:true、界面无异常、日志无记录，
    // 上面那句「别假装发了」的承诺就成了空话。落盘留证，让「哪天发不出去」是看得见的。
    notification.on("failed", (_event, error) => {
      logCrash("notification:failed", error);
    });
    notification.show();
    // 仍返回 ok:true —— show() 是异步的，此刻还不知道成败；ok 表示「已交给系统」。
    // 真实成败以上面的 failed 落盘为准（2026-08-24 实测：Electron 43 + ad-hoc 签名下正常弹出）。
    return { ok: true };
  });
}
