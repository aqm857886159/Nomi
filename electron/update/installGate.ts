// 全仓唯一调用 electron-updater 安装的地方（`quitAndInstall` / `install`），结构测试钉死这一点
// （electron/update/installGate.structure.test.ts）。
//
// 为什么只留一个入口：三轮评审问题是同一类——「判忙」和「真正调用安装」不在同一时刻（TOCTOU）：
// 渲染层判忙、主进程装；abort 导出之后才判忙；await 核缓存之后才装。修在这里：
//   · 异步准备（加载更新器、核对缓存包）全部放在入口**前面**做完；
//   · 进入 installIfIdleNow 之后**没有任何 await**：同步判忙、同步调用库。
// 立即安装（IPC）、退出排空、续装重试三条路都走它，各自只决定「准备什么」和「用哪种安装方式」。
export type UpdaterInstaller = {
  quitAndInstall: () => void;
  install?: (isSilent: boolean, isForceRunAfter: boolean) => boolean;
  /** electron-updater 在 install() 抛错路径上不复位的内部旗；失败时复位，之后的重试才不会被库自己忽略。 */
  quitAndInstallCalled?: boolean;
};

/** restart = 用户点「重启以更新」（非静默，装完重开）；quit = 退出时静默安装（装完不重开）。 */
export type InstallMode = "restart" | "quit";
export type InstallOutcome = "started" | "busy" | "failed";

export type InstallGateDeps = {
  getUpdater: () => UpdaterInstaller | null;
  /** 同步判断「现在能不能装」：true = 有活在跑，不许打断。senderId 只有用户点击那条路才有。 */
  isBusy: (mode: InstallMode, senderId?: number) => boolean;
  /** 紧挨着调用库之前（同一个同步块里）登记「安装已开始」，避免退出排空项重复装。 */
  markStarted: () => void;
  /** 起不来时撤回 markStarted。 */
  markFailed: () => void;
  onAttempt?: (mode: InstallMode, outcome: InstallOutcome) => void;
};

export function createInstallGate(deps: InstallGateDeps): { installIfIdleNow: (mode: InstallMode, senderId?: number) => InstallOutcome } {
  return {
    // 注意：这个函数不是 async、里面不许出现 await。
    installIfIdleNow(mode, senderId) {
      const updater = deps.getUpdater();
      if (!updater) return finish(deps, mode, "failed");
      let busy: boolean;
      try {
        busy = deps.isBusy(mode, senderId);
      } catch {
        busy = true; // 判不准就拦
      }
      if (busy) return finish(deps, mode, "busy");
      deps.markStarted();
      let started = false;
      try {
        if (mode === "restart") {
          updater.quitAndInstall();
          started = true;
        } else {
          started = updater.install?.(true, false) ?? false;
        }
      } catch {
        started = false;
      } finally {
        if (!started) {
          updater.quitAndInstallCalled = false;
          deps.markFailed();
        }
      }
      return finish(deps, mode, started ? "started" : "failed");
    },
  };
}

function finish(deps: InstallGateDeps, mode: InstallMode, outcome: InstallOutcome): InstallOutcome {
  deps.onAttempt?.(mode, outcome);
  return outcome;
}
