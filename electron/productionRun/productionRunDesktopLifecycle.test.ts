// 回归钉：再次启动 app 时「必须能看见窗口」。
// issue #62：second-instance 曾只 focus 已存在的窗口，零窗口时什么都不做 —— 而新进程因拿不到
// 单实例锁已经自杀，结果用户怎么点图标都打不开，只能杀进程。这条不变量不许再退化。
import { beforeEach, describe, expect, it, vi } from "vitest";

const appHandlers = new Map<string, (...args: unknown[]) => unknown>();
const quit = vi.fn();
let windows: FakeWindow[] = [];

type FakeWindow = {
  isDestroyed: () => boolean;
  isVisible: () => boolean;
  isMinimized: () => boolean;
  restore: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  on: () => void;
  webContents: { send: ReturnType<typeof vi.fn> };
};

vi.mock("electron", () => ({
  app: {
    on: (event: string, handler: (...args: unknown[]) => unknown) => appHandlers.set(event, handler),
    quit: () => quit(),
    isReady: () => true,
    getPath: () => "/tmp/nomi-lifecycle-test",
    dock: { show: vi.fn() },
    focus: vi.fn(),
  },
  // 叫回不再「从所有窗口里挑一个」：这张表只用来证明辅助窗不会被挑中。
  BrowserWindow: { getAllWindows: () => windows },
}));
vi.mock("../logging/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock("../quitTeardown", () => ({ isQuitRequested: () => false, requestQuit: vi.fn(), exitWithoutConfirmation: vi.fn(), setRelaunchAfterExit: vi.fn() }));
vi.mock("./artifactProjection", () => ({ loadOrCreateArtifactPreviewSecret: () => "secret" }));
vi.mock("./productionRunRepository", () => ({ createProductionRunRepository: () => ({}) }));

import { adoptMainWindow, installMainWindowOwner, openMainWindow, resetMainWindowOwnerForTests } from "../mainWindowPresence";
import { installProductionRunDesktopLifecycle } from "./productionRunDesktopLifecycle";

function fakeWindow(state: { minimized?: boolean; visible?: boolean } = {}): FakeWindow {
  let minimized = state.minimized ?? false;
  let visible = state.visible ?? true;
  return {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    restore: vi.fn(() => { minimized = false; }),
    show: vi.fn(() => { visible = true; }),
    focus: vi.fn(),
    on: () => undefined,
    webContents: { send: vi.fn() },
  };
}

/** 装上主窗主人；build 建出的就是主窗（辅助窗不经主人，只在 getAllWindows 里）。 */
function installOwner(main: () => FakeWindow = () => fakeWindow()) {
  const built: FakeWindow[] = [];
  const lifecycle: { flush?: () => void } = {};
  const build = vi.fn(async () => {
    const win = main();
    adoptMainWindow(win as never);
    built.push(win);
    windows.push(win);
    return win as never;
  });
  installMainWindowOwner({ build, onWindowReady: () => lifecycle.flush?.(), isBusy: () => false, isBackgroundLaunch: false, allowRelaunch: true, platform: "darwin" });
  return { build, built, lifecycle };
}

function install(owner = installOwner()) {
  const installed = installProductionRunDesktopLifecycle({
    isMcpStdio: false,
    allowE2eMultiInstance: false,
    hasSingleInstanceLock: true,
  });
  owner.lifecycle.flush = installed.flushPendingProductionDeepLink;
  const handler = appHandlers.get("second-instance");
  if (!handler) throw new Error("second-instance handler was not registered");
  return { ...owner, secondInstance: (commandLine: string[] = []) => handler(null, commandLine) };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("production run desktop lifecycle · 单实例再次启动", () => {
  beforeEach(() => {
    appHandlers.clear();
    quit.mockClear();
    windows = [];
    resetMainWindowOwnerForTests();
  });

  it("零窗口时建回主窗口并显示（否则 app 永远打不开）", async () => {
    const { build, built, secondInstance } = install();
    secondInstance();
    await settle();
    expect(build).toHaveBeenCalledTimes(1);
    expect(built[0]!.show).toHaveBeenCalled();
  });

  it("已有窗口时恢复并聚焦它，不另建窗口", async () => {
    const owner = installOwner(() => fakeWindow({ minimized: true }));
    await openMainWindow();
    const { build, built, secondInstance } = install(owner);
    secondInstance();
    expect(built[0]!.restore).toHaveBeenCalled();
    expect(built[0]!.show).toHaveBeenCalled();
    expect(built[0]!.focus).toHaveBeenCalled();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("拿不到单实例锁的那个进程仍然直接退出（让位给老实例）", () => {
    const log = vi.fn();
    installProductionRunDesktopLifecycle({
      isMcpStdio: false,
      allowE2eMultiInstance: false,
      hasSingleInstanceLock: false,
      log,
    });
    expect(quit).toHaveBeenCalledTimes(1);
    expect(appHandlers.has("second-instance")).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("another Nomi instance is already using this profile"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("NOMI_ELECTRON_USER_DATA_DIR"));
  });

  it("第一扇窗是辅助窗时，second-instance 亮的是主窗，不是辅助窗（更新后点开没反应）", async () => {
    const helper = fakeWindow({ visible: false });
    windows = [helper];
    const owner = installOwner(() => fakeWindow({ visible: false }));
    await openMainWindow();
    const { built, secondInstance } = install(owner);
    secondInstance();
    expect(helper.show).not.toHaveBeenCalled();
    expect(built[0]!.show).toHaveBeenCalled();
  });

  it("主窗藏着时带深链再次启动：亮出主窗，深链只投递一次（★9 第 11 条）", async () => {
    const owner = installOwner(() => fakeWindow({ visible: false }));
    await openMainWindow();
    const { built, secondInstance } = install(owner);
    secondInstance(["--flag", "nomi://project/p1"]);
    await settle();
    expect(built[0]!.isVisible()).toBe(true);
    expect(built[0]!.webContents.send.mock.calls).toEqual([["nomi:production-deep-link", { projectId: "p1" }]]);
  });

  it("零窗口时带深链再次启动：建好主窗后投递，只投递一次", async () => {
    const { built, secondInstance } = install();
    secondInstance(["nomi://project/p1"]);
    await settle();
    await settle();
    expect(built).toHaveLength(1);
    expect(built[0]!.webContents.send.mock.calls).toEqual([["nomi:production-deep-link", { projectId: "p1" }]]);
  });
});
