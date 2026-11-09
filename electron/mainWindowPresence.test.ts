import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let windows: unknown[] = [];

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => windows } }));

import { createMainWindowGuard } from "./mainWindowPresence";

describe("主窗口在场守卫（issue #62）", () => {
  beforeEach(() => {
    windows = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("零窗口时把窗口建回来，并在就绪后冲刷积压动作", async () => {
    const createWindow = vi.fn(async () => {
      windows = [{}];
      return {};
    });
    const onWindowReady = vi.fn();
    await createMainWindowGuard({ createWindow, onWindowReady })();
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(onWindowReady).toHaveBeenCalledTimes(1);
  });

  it("已有窗口时不重复建窗", async () => {
    windows = [{}];
    const createWindow = vi.fn(async () => ({}));
    await createMainWindowGuard({ createWindow, onWindowReady: vi.fn() })();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("并发调用只建一个窗口（activate 与 second-instance 可能几乎同时到）", async () => {
    let release: (value: unknown) => void = () => {};
    const createWindow = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const ensureMainWindow = createMainWindowGuard({ createWindow, onWindowReady: vi.fn() });
    const first = ensureMainWindow();
    const second = ensureMainWindow();
    release({});
    await Promise.all([first, second]);
    expect(createWindow).toHaveBeenCalledTimes(1);
  });

  it("建窗失败不把异常抛回调用方，且下一次仍会重试（不能一次失败就永久死锁）", async () => {
    let attempt = 0;
    const createWindow = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return {};
    });
    const ensureMainWindow = createMainWindowGuard({ createWindow, onWindowReady: vi.fn() });
    await expect(ensureMainWindow()).resolves.toBeUndefined();
    await ensureMainWindow();
    expect(createWindow).toHaveBeenCalledTimes(2);
  });

  it("特征（今天）：主窗藏着或最小化时，activate 什么都不做（方向检查 §8.3 症状一）", async () => {
    const hidden = { isVisible: () => false, isMinimized: () => true, show: vi.fn(), restore: vi.fn(), focus: vi.fn() };
    windows = [hidden];
    const createWindow = vi.fn(async () => ({}));
    await createMainWindowGuard({ createWindow, onWindowReady: vi.fn() })();
    expect(createWindow).not.toHaveBeenCalled();
    expect(hidden.show).not.toHaveBeenCalled();
    expect(hidden.restore).not.toHaveBeenCalled();
  });
});
