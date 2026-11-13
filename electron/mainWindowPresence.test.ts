// 主窗口唯一主人（electron/mainWindowPresence.ts）的状态机与门岗。
// 方向检查：docs/engineering/direction-checks/2026-11-09-app-reopen-owner.md（★9 第 2、3、5、6、7、9、10、12、13 条）。
//
// 量具先修（方向检查 §4）：假窗口有 creating / open（可见、藏、最小化）/ closing / destroyed 全部状态，
// 外加 App 的 quitting；对已销毁的窗口调 show 直接抛错（真 Electron 在这里 SIGSEGV）。
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appFocus: vi.fn(),
  quitRequested: false,
  backgroundUnshown: false,
  requestQuit: vi.fn(),
  exitWithoutConfirmation: vi.fn(),
  setRelaunchAfterExit: vi.fn(),
}));

vi.mock("electron", () => ({ app: { focus: mocks.appFocus } }));
vi.mock("./logging/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock("./backgroundIdleExit", () => ({ isBackgroundWindowUnshown: () => mocks.backgroundUnshown }));
vi.mock("./quitTeardown", () => ({
  isQuitRequested: () => mocks.quitRequested,
  requestQuit: mocks.requestQuit,
  exitWithoutConfirmation: mocks.exitWithoutConfirmation,
  setRelaunchAfterExit: mocks.setRelaunchAfterExit,
}));

import { getMainWindow } from "./appWindowRegistry";
import {
  adoptMainWindow,
  beginMainWindowClose,
  borrowMainWindow,
  cancelMainWindowClose,
  installMainWindowOwner,
  mainWindowPhase,
  markMainWindowQuitting,
  noteCloseConfirmationInstalled,
  openMainWindow,
  rebuildMainWindow,
  resetMainWindowOwnerForTests,
  revealMainWindow,
  sendToMainWindow,
  settleConfirmedClose,
  type RevealEntry,
} from "./mainWindowPresence";
import * as ownerModule from "./mainWindowPresence";

let nextId = 1;
class FakeWindow extends EventEmitter {
  readonly webContents = { id: nextId++, send: vi.fn(), setBackgroundThrottling: vi.fn() };
  visible = true;
  minimized = false;
  destroyed = false;
  isDestroyed = (): boolean => this.destroyed;
  isVisible = (): boolean => this.visible && !this.destroyed;
  isMinimized = (): boolean => this.minimized;
  restore = vi.fn(() => { this.assertAlive("restore"); this.minimized = false; });
  show = vi.fn(() => { this.assertAlive("show"); this.visible = true; });
  focus = vi.fn(() => this.assertAlive("focus"));
  hide = vi.fn(() => { this.assertAlive("hide"); this.visible = false; });
  /** 真 close：先发 close（可被拦），没拦就进「正在关」，closed 由 finishClosing 异步补发（Electron 也是异步）。 */
  close = vi.fn(() => {
    let prevented = false;
    this.emit("close", { preventDefault: () => { prevented = true; } });
    if (!prevented) this.closingPending = true;
  });
  destroy = vi.fn(() => this.finishClosing());
  closingPending = false;
  finishClosing(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closingPending = false;
    this.emit("closed");
  }
  private assertAlive(method: string): void {
    if (this.destroyed) throw new Error(`${method}() on a destroyed window (Electron: SIGSEGV)`);
  }
}

type Built = { windows: FakeWindow[]; build: ReturnType<typeof vi.fn>; release: () => void; onWindowReady: ReturnType<typeof vi.fn> };

function install(options: { busy?: () => boolean; platform?: NodeJS.Platform; background?: boolean; allowRelaunch?: boolean; deferred?: boolean; confirmation?: boolean } = {}): Built {
  const windows: FakeWindow[] = [];
  let release: () => void = () => {};
  const build = vi.fn(async () => {
    const win = new FakeWindow();
    win.visible = !options.background;
    adoptMainWindow(win as never);
    if (options.confirmation !== false) noteCloseConfirmationInstalled(win as never);
    windows.push(win);
    if (options.deferred) await new Promise<void>((resolve) => { release = resolve; });
    return win as never;
  });
  const onWindowReady = vi.fn();
  installMainWindowOwner({
    build,
    onWindowReady,
    isBusy: options.busy ?? (() => false),
    isBackgroundLaunch: options.background ?? false,
    allowRelaunch: options.allowRelaunch ?? true,
    platform: options.platform ?? "darwin",
    workPollMs: 50,
  });
  return { windows, build, release: () => release(), onWindowReady };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const shown = (win: FakeWindow): number => win.show.mock.calls.length;

// 叫回主窗的 8 个入口：7 个走 revealMainWindow，维护重建走 rebuildMainWindow。
const ENTRY_FILES: ReadonlyArray<readonly [RevealEntry | "rebuild", string]> = [
  ["activate", "electron/main.ts"],
  ["second-instance", "electron/productionRun/productionRunDesktopLifecycle.ts"],
  ["deep-link", "electron/productionRun/productionRunDesktopLifecycle.ts"],
  ["canvas-notification", "electron/notificationIpc.ts"],
  ["production-notification", "electron/productionRun/productionNotificationsDesktop.ts"],
  ["screenshot", "electron/screenshot/screenshotHotkey.ts"],
  ["mcp-credentials", "electron/capabilityCore/appIntegration.ts"],
  ["rebuild", "electron/main.ts"],
];
const REVEAL_ENTRIES = ENTRY_FILES.map(([entry]) => entry).filter((entry): entry is RevealEntry => entry !== "rebuild");

beforeEach(() => {
  resetMainWindowOwnerForTests();
  mocks.quitRequested = false;
  mocks.backgroundUnshown = false;
  vi.clearAllMocks();
});
afterEach(() => {
  resetMainWindowOwnerForTests();
  vi.useRealTimers();
});

describe("8 个叫回入口都只发意图（接线）", () => {
  it.each(ENTRY_FILES)("%s → %s 走主人，不自己挑窗口", (entry, file) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    if (entry === "rebuild") expect(source).toMatch(/rebuildMainWindow\(/);
    else expect(source).toMatch(new RegExp(`revealMainWindow\\(\\s*["']${entry}["']\\s*\\)`));
    expect(source).not.toMatch(/getAllWindows\(\)/);
  });

  it("主人不交出窗口对象：叫回入口没有返回值，模块也不导出 showWindow / ensureMainWindow", () => {
    install();
    expect(revealMainWindow("activate")).toBeUndefined();
    const owner = ownerModule;
    expect(Object.keys(owner)).not.toEqual(expect.arrayContaining(["showWindow"]));
    expect("ensureMainWindow" in owner).toBe(false);
    expect("createMainWindowGuard" in owner).toBe(false);
  });

  it("「有活在跑」只有一份：关窗决策、后台空闲退出、更新安装都问同一个 isProductionWorkBusy", () => {
    const main = fs.readFileSync(path.join(process.cwd(), "electron/main.ts"), "utf8");
    expect(main).toMatch(/isBusy:\s*isProductionWorkBusy\b/);
    expect(main).toMatch(/hasInFlightWork:\s*isProductionWorkBusy\b/);
    expect(main).not.toMatch(/hasInFlightProductionWork/);
    const updater = fs.readFileSync(path.join(process.cwd(), "electron/update/autoUpdater.ts"), "utf8");
    expect(updater).toMatch(/export const isProductionWorkBusy = \(\): boolean => busyGate\.isBusyAtQuit\(\)/);
  });

  it("更新安装在调安装之前先进退出中（installGate 的 markStarted 第一步，★9 第 9 条接线）", () => {
    const updater = fs.readFileSync(path.join(process.cwd(), "electron/update/autoUpdater.ts"), "utf8");
    expect(updater).toMatch(/markStarted:\s*\(\)\s*=>\s*\{\s*markMainWindowQuitting\("update-install"\);\s*installOnQuit\.markInstallStarted\(\);/);
  });
});

describe("4 态叫回矩阵：每个入口 × absent / creating / open（可见、藏、最小化）/ closing / quitting", () => {
  it.each(REVEAL_ENTRIES)("absent：%s 建一个主窗并显示（零窗口不死局，issue #62）", async (entry) => {
    const owner = install();
    revealMainWindow(entry);
    await settle();
    expect(owner.build).toHaveBeenCalledOnce();
    expect(shown(owner.windows[0]!)).toBe(1);
    expect(owner.onWindowReady).toHaveBeenCalledOnce();
  });

  it.each(REVEAL_ENTRIES)("creating：%s 等建好再显示，不建第二扇", async (entry) => {
    const owner = install({ deferred: true });
    void openMainWindow();
    expect(mainWindowPhase()).toBe("creating");
    revealMainWindow(entry);
    revealMainWindow("activate");
    await vi.waitFor(() => expect(owner.windows).toHaveLength(1));
    expect(owner.build).toHaveBeenCalledOnce();
    expect(shown(owner.windows[0]!)).toBe(0);
    owner.release();
    await settle();
    expect(owner.build).toHaveBeenCalledOnce();
    expect(shown(owner.windows[0]!)).toBeGreaterThan(0);
  });

  it.each(REVEAL_ENTRIES.flatMap((entry) => (["visible", "hidden", "minimized"] as const).map((state) => [entry, state] as const)))(
    "open-%s-%s：还原、显示、聚焦同一扇窗，不新建",
    async (entry, state) => {
      const owner = install();
      await openMainWindow();
      const win = owner.windows[0]!;
      if (state === "hidden") win.visible = false;
      if (state === "minimized") win.minimized = true;
      revealMainWindow(entry);
      expect(owner.build).toHaveBeenCalledOnce();
      expect(win.restore).toHaveBeenCalledTimes(state === "minimized" ? 1 : 0);
      expect(shown(win)).toBe(1);
      expect(win.focus).toHaveBeenCalledOnce();
      expect(win.isVisible() && !win.isMinimized()).toBe(true);
      expect(mocks.appFocus).toHaveBeenCalledTimes(entry === "mcp-credentials" ? 1 : 0);
    },
  );

  it.each(REVEAL_ENTRIES)("closing（没装关窗确认的窗口正在关）：%s 不碰正在关的窗，关完才建新窗", async (entry) => {
    const owner = install({ confirmation: false });
    await openMainWindow();
    const old = owner.windows[0]!;
    old.close();
    expect(mainWindowPhase()).toBe("closing");
    revealMainWindow(entry);
    revealMainWindow(entry);
    expect(shown(old)).toBe(0);
    expect(old.focus).not.toHaveBeenCalled();
    expect(owner.build).toHaveBeenCalledOnce();
    old.finishClosing();
    await settle();
    expect(owner.build).toHaveBeenCalledTimes(2);
    expect(shown(owner.windows[1]!)).toBe(1);
  });

  it.each(REVEAL_ENTRIES)("quitting（空闲关窗已放行）：%s 连点 5 次不碰旧窗、不建窗，只登记一次退完重开", async (entry) => {
    const owner = install();
    await openMainWindow();
    const old = owner.windows[0]!;
    expect(beginMainWindowClose(old as never)).toBe("ask");
    old.show.mockClear();
    old.focus.mockClear();
    settleConfirmedClose(old as never);
    expect(mainWindowPhase()).toBe("quitting");
    expect(mocks.requestQuit).toHaveBeenCalledOnce();
    for (let index = 0; index < 5; index += 1) revealMainWindow(entry);
    await settle();
    old.close();
    for (let index = 0; index < 5; index += 1) revealMainWindow(entry);
    old.finishClosing();
    for (let index = 0; index < 5; index += 1) revealMainWindow(entry);
    await settle();
    expect(shown(old)).toBe(0);
    expect(old.focus).not.toHaveBeenCalled();
    expect(owner.build).toHaveBeenCalledOnce();
    expect(mocks.setRelaunchAfterExit.mock.calls).toEqual([[true]]);
  });

  it("quitting：后台冷启、E2E 的实例被叫回不重开（由启动器 / 走查管进程）", async () => {
    for (const options of [{ background: true }, { allowRelaunch: false }]) {
      resetMainWindowOwnerForTests();
      vi.clearAllMocks();
      const owner = install(options);
      await openMainWindow();
      const win = owner.windows[0]!;
      win.visible = true;
      settleConfirmedClose(win as never);
      revealMainWindow("second-instance");
      expect(mocks.setRelaunchAfterExit).not.toHaveBeenCalled();
      expect(owner.build).toHaveBeenCalledOnce();
    }
  });
});

describe("关窗只有两种结果：空闲就退；macOS 有活就藏", () => {
  it.each([
    ["darwin", false, false, "quit"],
    ["darwin", true, false, "hide"],
    ["darwin", true, true, "quit"], // ⌘Q 时用户要的是退出，有活也照退（确认框已经提醒过）
    ["win32", false, false, "quit"],
    ["win32", true, false, "quit"], // Windows 第一刀不变：关窗即退（托盘是第二刀）
  ] as const)("%s · 忙=%s · ⌘Q=%s → %s", async (platform, busy, quitAsked, outcome) => {
    const owner = install({ platform, busy: () => busy });
    await openMainWindow();
    const win = owner.windows[0]!;
    mocks.quitRequested = quitAsked;
    expect(beginMainWindowClose(win as never)).toBe("ask");
    settleConfirmedClose(win as never);
    if (outcome === "hide") {
      expect(win.hide).toHaveBeenCalledOnce();
      expect(win.destroyed).toBe(false);
      expect(win.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
      expect(mocks.requestQuit).not.toHaveBeenCalled();
      expect(mainWindowPhase()).toBe("open");
    } else {
      expect(win.hide).not.toHaveBeenCalled();
      expect(mocks.requestQuit).toHaveBeenCalledOnce();
      expect(win.close).not.toHaveBeenCalled(); // 不再「关一次窗再强制关一次」：窗口只由退出流程关
      expect(mainWindowPhase()).toBe("quitting");
    }
  });

  it("原生兜底框点「强制退出」：有活也退", async () => {
    const owner = install({ busy: () => true });
    await openMainWindow();
    settleConfirmedClose(owner.windows[0]! as never, { force: true });
    expect(mocks.requestQuit).toHaveBeenCalledOnce();
    expect(owner.windows[0]!.hide).not.toHaveBeenCalled();
  });

  it("忙时藏起：叫回还是同一扇窗、恢复节流；再藏起后活干完自己退出（无人值守退出，存盘排空项照跑）", async () => {
    let busy = true;
    const owner = install({ busy: () => busy });
    await openMainWindow();
    const win = owner.windows[0]!;
    settleConfirmedClose(win as never);
    expect(win.isVisible()).toBe(false);
    revealMainWindow("activate");
    expect(owner.build).toHaveBeenCalledOnce();
    expect(win.isVisible()).toBe(true);
    expect(win.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    settleConfirmedClose(win as never);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(mocks.exitWithoutConfirmation).not.toHaveBeenCalled();
    busy = false;
    await vi.waitFor(() => expect(mocks.exitWithoutConfirmation).toHaveBeenCalledWith("hidden-work-finished"));
    expect(mainWindowPhase()).toBe("quitting");
    expect(mocks.exitWithoutConfirmation).toHaveBeenCalledOnce();
  });
});

describe("看不见的窗口不发问（方向检查 §8.3 症状二）", () => {
  it.each(["minimized", "hidden"] as const)("主窗%s 时来退出：先亮出来再让渲染层问", async (state) => {
    const owner = install();
    await openMainWindow();
    const win = owner.windows[0]!;
    if (state === "minimized") win.minimized = true;
    else win.visible = false;
    mocks.quitRequested = true;
    expect(beginMainWindowClose(win as never)).toBe("ask");
    expect(win.isVisible() && !win.isMinimized()).toBe(true);
  });

  it("后台冷启、用户从没见过、又空闲：不问，直接存盘退出", async () => {
    mocks.backgroundUnshown = true;
    const owner = install({ background: true });
    await openMainWindow();
    const win = owner.windows[0]!;
    expect(beginMainWindowClose(win as never)).toBe("handled");
    expect(shown(win)).toBe(0);
    expect(mocks.exitWithoutConfirmation).toHaveBeenCalledWith("background-unshown-idle");
    expect(beginMainWindowClose(win as never)).toBe("proceed");
  });

  it("后台冷启、没见过但有活：亮出来再问（不替用户断活）", async () => {
    mocks.backgroundUnshown = true;
    const owner = install({ background: true, busy: () => true });
    await openMainWindow();
    expect(beginMainWindowClose(owner.windows[0]! as never)).toBe("ask");
    expect(mocks.exitWithoutConfirmation).not.toHaveBeenCalled();
  });
});

describe("「退出中」从放行关窗那一刻才算", () => {
  it("⌘Q 弹确认后点「取消」：没进 quitting，之后叫回照常显示同一扇窗（★9 第 13 条）", async () => {
    const owner = install();
    await openMainWindow();
    const win = owner.windows[0]!;
    mocks.quitRequested = true;
    expect(beginMainWindowClose(win as never)).toBe("ask");
    expect(mainWindowPhase()).toBe("open");
    revealMainWindow("activate"); // 确认框还在时叫回：照常亮主窗
    mocks.quitRequested = false;
    cancelMainWindowClose();
    win.visible = false;
    revealMainWindow("canvas-notification");
    expect(win.isVisible()).toBe(true);
    expect(owner.build).toHaveBeenCalledOnce();
    expect(mocks.requestQuit).not.toHaveBeenCalled();
  });

  it("更新安装：调安装前进 quitting；安装器先关窗、后发 before-quit，期间二次启动不建窗、不重开（★9 第 9 条）", async () => {
    const owner = install();
    await openMainWindow();
    const win = owner.windows[0]!;
    markMainWindowQuitting("update-install");
    // 安装器关窗：关窗确认照样问（确认框是存盘点）；用户确认后放行这次关窗，交给安装器继续。
    expect(beginMainWindowClose(win as never)).toBe("ask");
    settleConfirmedClose(win as never);
    expect(win.close).toHaveBeenCalledOnce();
    expect(mocks.requestQuit).not.toHaveBeenCalled();
    expect(beginMainWindowClose(win as never)).toBe("proceed");
    win.finishClosing();
    revealMainWindow("second-instance");
    revealMainWindow("activate");
    await settle();
    expect(owner.build).toHaveBeenCalledOnce();
    expect(mocks.setRelaunchAfterExit).not.toHaveBeenCalledWith(true);
  });

  it("先被叫回登记了重开、随后开始更新安装：撤回重开（安装器自己会重开）", async () => {
    const owner = install();
    await openMainWindow();
    settleConfirmedClose(owner.windows[0]! as never);
    revealMainWindow("activate");
    expect(mocks.setRelaunchAfterExit).toHaveBeenLastCalledWith(true);
    markMainWindowQuitting("update-install");
    expect(mocks.setRelaunchAfterExit).toHaveBeenLastCalledWith(false);
  });
});

describe("发消息与借用都只在主窗开着时", () => {
  it("sendToMainWindow / borrowMainWindow 在 absent、quitting 时拒绝，借用回调不许异步", async () => {
    const owner = install();
    expect(sendToMainWindow("nomi:x", 1)).toBe(false);
    expect(borrowMainWindow(() => 1)).toBeNull();
    await openMainWindow();
    const win = owner.windows[0]!;
    expect(sendToMainWindow("nomi:x", 1)).toBe(true);
    expect(win.webContents.send).toHaveBeenCalledWith("nomi:x", 1);
    expect(borrowMainWindow((borrowed) => borrowed === (win as never))).toBe(true);
    expect(() => borrowMainWindow(async () => 1)).toThrow(/synchronous/);
    settleConfirmedClose(win as never);
    expect(sendToMainWindow("nomi:x", 2)).toBe(false);
    expect(borrowMainWindow(() => 1)).toBeNull();
  });

  it("登记表跟着主人走：closed 后清掉，旧窗的 closed 不误清新窗", async () => {
    const owner = install({ confirmation: false });
    await openMainWindow();
    const first = owner.windows[0]!;
    expect(getMainWindow()).toBe(first);
    first.close();
    first.finishClosing();
    expect(getMainWindow()).toBeNull();
  });
});

describe("维护重建（第 8 个入口）在主人里完成，期间是 creating", () => {
  it("重建：销毁旧窗、建新窗并聚焦；期间叫回等新窗，不碰旧窗", async () => {
    const owner = install();
    await openMainWindow();
    const old = owner.windows[0]!;
    let finishBuild: () => void = () => {};
    const next = new FakeWindow();
    rebuildMainWindow(old as never, {
      reason: "test",
      prepare: async () => undefined,
      build: async () => {
        adoptMainWindow(next as never);
        await new Promise<void>((resolve) => { finishBuild = resolve; });
        return next as never;
      },
    });
    expect(mainWindowPhase()).toBe("creating");
    revealMainWindow("deep-link");
    await settle();
    expect(old.destroyed).toBe(true);
    finishBuild();
    await vi.waitFor(() => expect(next.focus).toHaveBeenCalled());
    expect(shown(next)).toBe(1);
    expect(owner.build).toHaveBeenCalledOnce();
    expect(old.show).not.toHaveBeenCalled();
  });

  it("后台冷启的实例重建不把没人看的窗口亮出来（★9 第 10 条）", async () => {
    const owner = install({ background: true });
    await openMainWindow();
    const next = new FakeWindow();
    next.visible = false;
    rebuildMainWindow(owner.windows[0]! as never, { reason: "test", prepare: async () => undefined, build: async () => { adoptMainWindow(next as never); return next as never; } });
    await vi.waitFor(() => expect(mainWindowPhase()).toBe("open"));
    expect(next.focus).not.toHaveBeenCalled();
    expect(next.show).not.toHaveBeenCalled();
  });

  it("重建失败不停在零窗口：从 absent 再建一次", async () => {
    const owner = install();
    await openMainWindow();
    rebuildMainWindow(owner.windows[0]! as never, { reason: "test", prepare: async () => undefined, build: async () => { throw new Error("boom"); } });
    await vi.waitFor(() => expect(owner.build).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(mainWindowPhase()).toBe("open"));
  });

  it("退出中不重建", async () => {
    const owner = install();
    await openMainWindow();
    settleConfirmedClose(owner.windows[0]! as never);
    const build = vi.fn();
    rebuildMainWindow(owner.windows[0]! as never, { reason: "test", prepare: async () => undefined, build });
    await settle();
    expect(build).not.toHaveBeenCalled();
  });
});

describe("门岗：主进程里只有主人和登记过的子窗文件能 show / focus / restore 窗口（★9 第 6 条）", () => {
  const RULE = "main-window-presence/no-restricted-syntax";
  const lint = async (source: string, filePath: string): Promise<string[]> => {
    const [result] = await new ESLint({ cwd: process.cwd() }).lintText(source, { filePath });
    return (result?.messages ?? []).filter((message) => message.ruleId === RULE).map((message) => message.message);
  };

  it.each([
    "win.show();",
    "win.focus();",
    "win.restore();",
    "win.showInactive();",
    "win.moveTop();",
    'win["show"]();',
    "const show = win.show.bind(win); show();",
    'import { app } from "electron"; app.focus({ steal: true });',
  ])("红：入口文件里写 %s", async (source) => {
    expect(await lint(source, "electron/notificationIpc.ts")).not.toHaveLength(0);
  });

  it.each([
    ["app.dock.show();", "electron/backgroundLaunch.ts"],
    ['win.webContents.send("nomi:x", 1);', "electron/notificationIpc.ts"],
    ["win.show(); win.focus(); app.focus({ steal: true });", "electron/mainWindowPresence.ts"],
    ["win.show();", "electron/notificationIpc.test.ts"],
  ])("绿：%s @ %s", async (source, filePath) => {
    expect(await lint(source, filePath)).toEqual([]);
  });
}, 60_000);
