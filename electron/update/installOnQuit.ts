// 「点了下载更新 = 同意更新，下次退出 Nomi 时自动装好」。
//
// 安装挂在退出唯一 owner（electron/quitTeardown.ts）的排空项上，不另写退出路径、不订阅 quit 事件。
// 排空项在用户点下载那一刻才登记：owner 按登记顺序串行排空，晚登记 = 排在启动期那批排空项之后，
// 装包程序（NSIS）启动时 Nomi 已把项目、导出、Agent 都收尾完，不会被安装程序强杀在半路。
// 只在正常退出（will-quit）走到这里：系统关机 / 登出这类只跑关键排空项的无人值守退出不会触发安装。
import type { QuitDrainOptions } from "../quitTeardown";
import type { InstallOutcome } from "./installGate";

export const INSTALL_ON_QUIT_DRAIN = "update-install-on-quit";
export const INSTALL_ON_QUIT_TIMEOUT_MS = 1500;

export type InstallOnQuitDeps = {
  registerDrain: (name: string, drain: () => void | Promise<void>, options?: QuitDrainOptions) => () => void;
  /**
   * 退出时安装：走唯一安装入口 installGate.installIfIdleNow("quit")——同步判忙、同步调用库。
   * busy = 有活没干完，不装、状态保留，等下次退出；failed = 装包程序没起来。
   */
  install: () => InstallOutcome;
};

export type InstallOnQuit = {
  /** 用户同意更新（点了下载）：登记排空项。重复点只登记一次。 */
  consent(): void;
  /** 下载完成：之后的正常退出会装。 */
  markDownloaded(): void;
  /** 下载失败 / 取消：撤销同意，退出时什么都不做。 */
  revoke(): void;
  /** 用户已经点了「重启以更新」（由 quitAndInstall 自己装）：退出排空项不再重复装。 */
  markInstallStarted(): void;
  /** 起装包程序失败：撤销上一条，退出时还可以再试一次。 */
  markInstallFailed(): void;
  /** 已经下好、还没装上（安装失败后仍然是 true，重试 / 下次退出才有东西可装）。 */
  isDownloaded(): boolean;
  isArmed(): boolean;
};

export function createInstallOnQuit(deps: InstallOnQuitDeps): InstallOnQuit {
  let unregister: (() => void) | null = null;
  let downloaded = false;
  let installStarted = false;

  const drain = (): void => {
    if (!downloaded || installStarted) return;
    // 「已开始」的登记 / 撤回都在安装入口的同步块里做（失败原子撤回，保留「已下载」，之后点一次重试、下次退出才都装得上）。
    if (deps.install() === "failed") throw new Error("update installer did not start");
  };

  return {
    consent() {
      if (unregister) return;
      unregister = deps.registerDrain(INSTALL_ON_QUIT_DRAIN, drain, { required: true, timeoutMs: INSTALL_ON_QUIT_TIMEOUT_MS });
    },
    markDownloaded() {
      downloaded = true;
    },
    revoke() {
      unregister?.();
      unregister = null;
      downloaded = false;
    },
    markInstallStarted() {
      installStarted = true;
    },
    markInstallFailed() {
      installStarted = false;
    },
    isDownloaded() {
      return downloaded;
    },
    isArmed() {
      return Boolean(unregister) && downloaded && !installStarted;
    },
  };
}
