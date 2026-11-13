// 主窗口的唯一主人：建、显示、藏、关、退出中、叫回，都只在这里做。
// 方向检查：docs/engineering/direction-checks/2026-11-09-app-reopen-owner.md
//
// 为什么要有一个主人：以前 8 个入口（Dock、再次双击、深链、两种通知、截图、MCP 凭据页、维护重建）各自
// 「找一个窗口对象再调 show」，窗口在「正在关 / 退出中」时照样被拿去 show，崩溃或没反应；关窗又可能把渲染层
// 销毁、进程留着，渲染层里的活跟着停。现在：
//   · 入口只发意图 revealMainWindow(入口名)，拿不到窗口对象（门岗：eslint.config.mjs 的 main-window-presence）；
//   · 状态只有 absent / creating / open（可见、藏、最小化）/ quitting，另有 E2E 下没装关窗确认时的 closing；
//   · 关窗只有两种结果：空闲就退；macOS 上有活就藏起来，活干完自己退；
//   · 看不见的窗口不发问：先亮出来再问。只有后台冷启、用户从没见过、又空闲的实例直接存盘退出；
//   · 「退出中」从主人放行主窗关闭那一刻、或更新安装开始前算起，此后不碰窗口；被叫回就在进程退完后重开一次。
import { app, type BrowserWindow } from "electron";

import { getMainWindow, setMainWindow } from "./appWindowRegistry";
import { isBackgroundWindowUnshown } from "./backgroundIdleExit";
import { logError, logInfo, logWarn } from "./logging/logger";
import { exitWithoutConfirmation, isQuitRequested, requestQuit, setRelaunchAfterExit } from "./quitTeardown";

/** 叫回主窗的 8 个入口（维护重建走 rebuildMainWindow）；关窗确认自己也会要求亮窗。 */
export type RevealEntry =
  | "activate"
  | "second-instance"
  | "deep-link"
  | "canvas-notification"
  | "production-notification"
  | "screenshot"
  | "mcp-credentials"
  | "close-confirmation";

export type MainWindowPhase = "absent" | "creating" | "open" | "closing" | "quitting";
export type CloseStart = "proceed" | "ask" | "handled";

export interface MainWindowOwnerDependencies {
  /** 建主窗并载入渲染层；建好的窗口必须在 await 之前经 adoptMainWindow 交给主人。 */
  build(): Promise<BrowserWindow>;
  /** 窗口就绪后要补做的事（如冲刷积压的深链）。 */
  onWindowReady(): void;
  /** 「有活在跑」的唯一真相（autoUpdater 的 busyGate：主进程 + 渲染层上报）。 */
  isBusy(): boolean;
  /** MCP 后台冷启的实例：维护重建不显示窗口，退出途中不重开。 */
  isBackgroundLaunch: boolean;
  /** E2E 关掉：走查要控制进程，退出途中不重开。 */
  allowRelaunch: boolean;
  platform: NodeJS.Platform;
  /** 藏着干活时多久查一次忙闲（测试缩短）。 */
  workPollMs?: number;
}

let deps: MainWindowOwnerDependencies | null = null;
let current: BrowserWindow | null = null;
let creating: Promise<void> | null = null;
let quittingReason: string | null = null;
let closeReleased = false;
let closing = false;
let revealAfterClose: RevealEntry | null = null;
let relaunchRequested = false;
let hiddenForWork = false;
let workPoll: ReturnType<typeof setInterval> | null = null;
const confirmedWindows = new WeakSet<BrowserWindow>();

export function installMainWindowOwner(next: MainWindowOwnerDependencies): void {
  deps = next;
}

export function mainWindowPhase(): MainWindowPhase {
  if (quittingReason) return "quitting";
  if (creating) return "creating";
  if (current && !current.isDestroyed()) return closing ? "closing" : "open";
  return "absent";
}

function stopWorkPoll(): void {
  if (workPoll) clearInterval(workPoll);
  workPoll = null;
}

function markQuitting(reason: string): void {
  if (!quittingReason) quittingReason = reason;
  stopWorkPoll();
  logInfo("window", "main-window-quitting", { reason: quittingReason });
}

/** 唯一会 restore / show / focus 主窗的地方。 */
function showOwned(win: BrowserWindow, entry: RevealEntry): void {
  // macOS 上只 focus 不够：它让窗口成为 key window，但不把 Nomi 变成最前面的应用（MCP 凭据页从别的 App 叫过来）。
  if (entry === "mcp-credentials" && deps?.platform === "darwin") app.focus({ steal: true });
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (hiddenForWork) {
    hiddenForWork = false;
    stopWorkPoll();
    win.webContents.setBackgroundThrottling(true);
  }
}

// 「建好」先把 creating 清掉、再通知就绪：就绪回调里冲刷的深链要看到 open，才能当场投递，不会又被记回待办丢掉。
function startCreating(build: () => Promise<unknown>): Promise<void> {
  if (creating) return creating;
  creating = Promise.resolve()
    .then(build)
    .then(
      () => { creating = null; deps?.onWindowReady(); },
      (error: unknown) => { creating = null; throw error; },
    );
  return creating;
}

function revealSettled(entry: RevealEntry): void {
  const phase = mainWindowPhase();
  if (phase === "open" && current) showOwned(current, entry);
  else if (phase === "quitting") requestRelaunchFor(entry);
  else if (phase === "creating") void creating!.then(() => revealSettled(entry), (error: unknown) => logError("window", "reveal-create-failed", error, { entry }));
  else logWarn("window", "reveal-not-settled", { entry, phase });
}

function requestRelaunchFor(entry: RevealEntry): void {
  if (!deps || relaunchRequested) return;
  if (quittingReason === "update-install" || deps.isBackgroundLaunch || !deps.allowRelaunch || entry === "close-confirmation") {
    logInfo("window", "reveal-while-quitting-ignored", { entry, reason: quittingReason ?? "" });
    return;
  }
  relaunchRequested = true;
  setRelaunchAfterExit(true);
  logInfo("window", "reveal-while-quitting-relaunch", { entry, reason: quittingReason ?? "" });
}

/** 唯一的叫回入口：只发意图，不交出窗口对象。 */
export function revealMainWindow(entry: RevealEntry): void {
  if (!deps) {
    logWarn("window", "reveal-without-owner", { entry });
    return;
  }
  const owner = deps;
  switch (mainWindowPhase()) {
    case "open":
      showOwned(current!, entry);
      return;
    case "creating":
      void creating!.then(() => revealSettled(entry), (error: unknown) => logError("window", "reveal-create-failed", error, { entry }));
      return;
    case "absent":
      void startCreating(() => owner.build()).then(() => revealSettled(entry), (error: unknown) => logError("window", "reveal-create-failed", error, { entry }));
      return;
    case "closing":
      revealAfterClose = entry;
      return;
    case "quitting":
      requestRelaunchFor(entry);
  }
}

/** 启动时建首窗；失败抛给调用方（main.ts 启动失败就退出）。 */
export function openMainWindow(): Promise<void> {
  if (!deps) return Promise.reject(new Error("main window owner is not installed"));
  const owner = deps;
  return startCreating(() => owner.build());
}

/** 给主窗的渲染层发消息；主窗不在、在建或退出中就返回 false，由调用方决定要不要排队。 */
export function sendToMainWindow(channel: string, payload: unknown): boolean {
  if (mainWindowPhase() !== "open" || !current) return false;
  current.webContents.send(channel, payload);
  return true;
}

/** 同步借用主窗（如截图签发项目租约）。回调里不许 await：借到的窗口只在这一刻有效。 */
export function borrowMainWindow<T>(lend: (win: BrowserWindow) => T): T | null {
  if (mainWindowPhase() !== "open" || !current) return null;
  const result = lend(current);
  if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("borrowMainWindow callback must be synchronous");
  return result;
}

/** main.ts 建好窗口后立刻交给主人（在载入渲染层的 await 之前）。 */
export function adoptMainWindow(win: BrowserWindow): void {
  current = win;
  closing = false;
  setMainWindow(win);
  win.on("close", () => {
    // 没装关窗确认（E2E）：这次关就真的关了。装了的由 beginMainWindowClose 决定。
    if (!confirmedWindows.has(win) && current === win && !quittingReason) closing = true;
  });
  win.on("closed", () => {
    if (getMainWindow() === win) setMainWindow(null);
    if (current !== win) return;
    current = null;
    closing = false;
    hiddenForWork = false;
    stopWorkPoll();
    const pending = revealAfterClose;
    revealAfterClose = null;
    if (pending && !quittingReason) revealMainWindow(pending);
  });
}

/** windowCloseConfirmation 装上时登记：这扇窗的关由确认流程经主人决定。 */
export function noteCloseConfirmationInstalled(win: BrowserWindow): void {
  confirmedWindows.add(win);
}

/** 主窗收到 close：proceed = 放行；ask = 拦下并让渲染层问；handled = 拦下，主人已经接手（无人值守退出）。 */
export function beginMainWindowClose(win: BrowserWindow): CloseStart {
  if (win !== current || !deps) return "proceed";
  if (quittingReason && closeReleased) return "proceed";
  const visible = win.isVisible() && !win.isMinimized();
  if (!visible && isBackgroundWindowUnshown() && !deps.isBusy()) {
    // 后台冷启、用户从没见过、又空闲：没人能回答确认框，直接存盘退出。
    markQuitting("background-unshown-idle");
    closeReleased = true;
    exitWithoutConfirmation("background-unshown-idle");
    return "handled";
  }
  // 看不见的窗口不发问：先亮出来，确认框才有人看得见（藏着、最小化、后台叫出过再藏起都一样）。
  showOwned(win, "close-confirmation");
  return "ask";
}

/** 用户在确认框里点了「关闭」（force = 原生兜底框点了强制退出）：空闲或非 macOS 就退；macOS 有活就藏。 */
export function settleConfirmedClose(win: BrowserWindow, options: { force?: boolean } = {}): void {
  if (win !== current || win.isDestroyed() || !deps) return;
  const owner = deps;
  const quitAsked = isQuitRequested();
  if (!quitAsked && !options.force && !quittingReason && owner.platform === "darwin" && owner.isBusy()) {
    hiddenForWork = true;
    win.webContents.setBackgroundThrottling(false);
    win.hide();
    logInfo("window", "main-window-hidden-for-work");
    stopWorkPoll();
    workPoll = setInterval(() => {
      if (!hiddenForWork || current !== win) return stopWorkPoll();
      if (owner.isBusy()) return;
      markQuitting("hidden-work-finished");
      closeReleased = true;
      exitWithoutConfirmation("hidden-work-finished");
    }, owner.workPollMs ?? 2000);
    workPoll.unref?.();
    return;
  }
  markQuitting(options.force ? "force-quit" : quitAsked ? "quit-confirmed" : "close-confirmed");
  closeReleased = true;
  // 更新安装（macOS）先关窗、后发 before-quit：放行安装器发起的那次关窗，由它接着装。其余一律走退出主人。
  if (quittingReason === "update-install" && !quitAsked) win.close();
  else requestQuit();
}

/** 用户在确认框里点了「取消」：还没放行的退出撤销，主窗照常可叫回。 */
export function cancelMainWindowClose(): void {
  if (quittingReason && !closeReleased) {
    logInfo("window", "main-window-quit-cancelled", { reason: quittingReason });
    quittingReason = null;
  }
}

/** installGate 调安装之前：进入退出中（此后叫回不建窗、不重开；关窗仍等用户确认，确认框是存盘点）。 */
export function markMainWindowQuitting(reason: "update-install"): void {
  quittingReason = reason;
  stopWorkPoll();
  if (relaunchRequested) {
    relaunchRequested = false;
    setRelaunchAfterExit(false);
  }
  logInfo("window", "main-window-quitting", { reason });
}

/** 渲染层维护重建（回到项目库、硬刷新）：销毁旧窗、建新窗都在主人里，期间状态是 creating。 */
export function rebuildMainWindow(old: BrowserWindow | null, plan: { reason: string; prepare(): Promise<unknown>; build(): Promise<BrowserWindow> }): void {
  if (!deps || quittingReason || creating) return;
  const owner = deps;
  creating = Promise.resolve()
    .then(async () => {
      if (old && !old.isDestroyed()) old.destroy();
      await plan.prepare();
      const next = await plan.build();
      // 后台冷启的实例也会重建渲染层：维护路径绝不把没人看的窗口亮出来。
      if (!owner.isBackgroundLaunch && current === next) next.focus();
      return true;
    })
    .catch((error: unknown) => {
      logError("window", "recreate-window-failed", error, { reason: plan.reason });
      return false;
    })
    .then((built) => {
      creating = null;
      if (built) owner.onWindowReady();
      // 重建失败会停在零窗口：从 absent 再建一次。
      else if (mainWindowPhase() === "absent") void startCreating(() => owner.build()).catch((error: unknown) => logError("window", "ensure-main-window-failed", error));
    });
}

/** Vitest isolation hook. */
export function resetMainWindowOwnerForTests(): void {
  stopWorkPoll();
  deps = null;
  current = null;
  creating = null;
  quittingReason = null;
  closeReleased = false;
  closing = false;
  revealAfterClose = null;
  relaunchRequested = false;
  hiddenForWork = false;
}
