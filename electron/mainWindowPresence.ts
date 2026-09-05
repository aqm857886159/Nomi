// 「进程活着 ⇒ 一定有窗口可点」的守卫（issue #62 根因收口）。
//
// 零窗口但进程还活着是个死局：老实例攥着单实例锁，用户再次启动时新进程拿不到锁会直接退出，
// 老实例又既不建窗也不退出 —— 用户看到的是「双击图标毫无反应，只能去任务管理器杀进程」。
// 进入零窗口态的路不止一条（macOS 关窗后按设计不退出、窗口重建半途失败……），所以不在每条路上
// 各补一次症状，而是让所有路都汇到这里自愈：谁发现「该有窗口却没有」，就调它。
import { BrowserWindow } from "electron";
import { logError } from "./logging/logger";

export function createMainWindowGuard(args: {
  createWindow: () => Promise<unknown>;
  /** 窗口就绪后要补做的事（如冲刷积压的 deep link）。 */
  onWindowReady: () => void;
}): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return function ensureMainWindow(): Promise<void> {
    if (BrowserWindow.getAllWindows().length > 0) return Promise.resolve();
    // 并发去重：activate 与 second-instance 可能几乎同时到达，别建出两个窗口。
    if (inFlight) return inFlight;
    inFlight = args
      .createWindow()
      .then(() => args.onWindowReady())
      .catch((error) => {
        logError("window", "ensure-main-window-failed", error);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
