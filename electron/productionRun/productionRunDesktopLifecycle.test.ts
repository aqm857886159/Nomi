// 回归钉：再次启动 app 时「必须能看见窗口」。
// issue #62：second-instance 曾只 focus 已存在的窗口，零窗口时什么都不做 —— 而新进程因拿不到
// 单实例锁已经自杀，结果用户怎么点图标都打不开，只能杀进程。这条不变量不许再退化。
import { beforeEach, describe, expect, it, vi } from "vitest";

const appHandlers = new Map<string, (...args: unknown[]) => unknown>();
const quit = vi.fn();
let windows: FakeWindow[] = [];

type FakeWindow = {
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
};

vi.mock("electron", () => ({
  app: {
    on: (event: string, handler: (...args: unknown[]) => unknown) => appHandlers.set(event, handler),
    quit: () => quit(),
    isReady: () => true,
    getPath: () => "/tmp/nomi-lifecycle-test",
  },
  BrowserWindow: { getAllWindows: () => windows },
}));
vi.mock("../mainWindowRegistry", () => ({ getMainWindow: () => null }));
vi.mock("./artifactProjection", () => ({ loadOrCreateArtifactPreviewSecret: () => "secret" }));
vi.mock("./productionRunRepository", () => ({ createProductionRunRepository: () => ({}) }));

import { installProductionRunDesktopLifecycle } from "./productionRunDesktopLifecycle";

function fakeWindow(minimized = false): FakeWindow {
  return { isMinimized: () => minimized, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
}

function install(ensureMainWindow = vi.fn()) {
  installProductionRunDesktopLifecycle({
    isMcpStdio: false,
    allowE2eMultiInstance: false,
    hasSingleInstanceLock: true,
    ensureMainWindow,
  });
  const handler = appHandlers.get("second-instance");
  if (!handler) throw new Error("second-instance handler was not registered");
  return { ensureMainWindow, secondInstance: () => handler(null, [] as unknown as string[]) };
}

describe("production run desktop lifecycle · 单实例再次启动", () => {
  beforeEach(() => {
    appHandlers.clear();
    quit.mockClear();
    windows = [];
  });

  it("零窗口时建回主窗口（否则 app 永远打不开）", () => {
    const { ensureMainWindow, secondInstance } = install();
    secondInstance();
    expect(ensureMainWindow).toHaveBeenCalledTimes(1);
  });

  it("已有窗口时恢复并聚焦它，不另建窗口", () => {
    const existing = fakeWindow(true);
    windows = [existing];
    const { ensureMainWindow, secondInstance } = install();
    secondInstance();
    expect(existing.restore).toHaveBeenCalled();
    expect(existing.show).toHaveBeenCalled();
    expect(existing.focus).toHaveBeenCalled();
    expect(ensureMainWindow).not.toHaveBeenCalled();
  });

  it("拿不到单实例锁的那个进程仍然直接退出（让位给老实例）", () => {
    const log = vi.fn();
    installProductionRunDesktopLifecycle({
      isMcpStdio: false,
      allowE2eMultiInstance: false,
      hasSingleInstanceLock: false,
      ensureMainWindow: vi.fn(),
      log,
    });
    expect(quit).toHaveBeenCalledTimes(1);
    expect(appHandlers.has("second-instance")).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("another Nomi instance is already using this profile"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("NOMI_ELECTRON_USER_DATA_DIR"));
  });
});
