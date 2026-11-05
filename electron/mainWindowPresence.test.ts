import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

let main: ReturnType<typeof fakeWindow> | null = null;
let windows: ReturnType<typeof fakeWindow>[] = [];
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => windows } }));
vi.mock("./appWindowRegistry", () => ({ getMainWindow: () => main && !main.isDestroyed() ? main : null }));
vi.mock("./logging/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
import { createMainWindowGuard } from "./mainWindowPresence";

function fakeWindow() {
  let destroyed = false;
  return { isDestroyed: () => destroyed, destroy: vi.fn(() => { destroyed = true; }), isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
}
function fixture() {
  const createWindow = vi.fn(async () => { main = fakeWindow(); windows.push(main); return main; });
  const onWindowReady = vi.fn();
  return { createWindow, onWindowReady, ensure: createMainWindowGuard({ createWindow, onWindowReady }) };
}
function withoutGuiOwner() {
  vi.resetModules();
  return import("./mainWindowPresence");
}
describe("registry 主窗口召回", () => {
  beforeEach(() => { main = null; windows = []; });
  it("无GUI主人时通知不另建窗口", async () => {
    const module = await withoutGuiOwner();
    await expect(module.ensureMainWindow("notification")).resolves.toBeNull();
  });
  it.each(["activate", "second-instance", "deep-link", "notification"])("%s 恢复隐藏 / 最小化主窗而非排首辅助窗", async (entry) => {
    const aux = fakeWindow(); main = fakeWindow(); windows = [aux, main];
    const f = fixture(); await f.ensure(entry);
    expect(main.restore).toHaveBeenCalledOnce(); expect(main.show).toHaveBeenCalledOnce(); expect(main.focus).toHaveBeenCalledOnce();
    expect(aux.show).not.toHaveBeenCalled(); expect(f.createWindow).not.toHaveBeenCalled();
  });
  it.each([false, true])("仅辅助窗或零窗都创建真正主窗（辅助=%s）", async (aux) => {
    if (aux) windows = [fakeWindow()];
    const f = fixture(); await f.ensure("second-instance");
    expect(f.createWindow).toHaveBeenCalledOnce(); expect(f.onWindowReady).toHaveBeenCalledOnce(); expect(main?.show).toHaveBeenCalledOnce();
  });
  it("并发期间即使 registry 已登记也等创建就绪再显示和投递", async () => {
    let release!: () => void;
    const createWindow = vi.fn(() => { main = fakeWindow(); return new Promise<BrowserWindow>((resolve) => { release = () => resolve(main as unknown as BrowserWindow); }); });
    const onWindowReady = vi.fn(); const ensure = createMainWindowGuard({ createWindow, onWindowReady });
    const first = ensure("activate"); const second = ensure("deep-link");
    expect(main?.show).not.toHaveBeenCalled(); expect(onWindowReady).not.toHaveBeenCalled();
    release(); await Promise.all([first, second]); expect(createWindow).toHaveBeenCalledOnce(); expect(onWindowReady).toHaveBeenCalledOnce(); expect(main?.focus).toHaveBeenCalled();
  });
  it("维护补建不显示，期间用户召回仍能显示", async () => {
    const f = fixture(); await f.ensure("maintenance", false); expect(main?.show).not.toHaveBeenCalled();
    await f.ensure("activate"); expect(main?.show).toHaveBeenCalledOnce();
  });
  it("维护的缓存清理与建窗期间，用户召回复用同一次创建", async () => {
    let release!: () => void;
    const f = fixture();
    const maintenance = vi.fn(() => new Promise<void>((resolve) => { release = () => { main = fakeWindow(); resolve(); }; }));
    const first = f.ensure("maintenance", false, maintenance);
    const user = f.ensure("activate");
    expect(f.createWindow).not.toHaveBeenCalled(); release(); await Promise.all([first, user]);
    expect(maintenance).toHaveBeenCalledOnce(); expect(main?.show).toHaveBeenCalledOnce();
  });
  it("创建已登记但加载失败时清理未就绪窗口，后续能重试", async () => {
    const f = fixture(); const failed = fakeWindow();
    f.createWindow.mockImplementationOnce(async () => { main = failed; throw new Error("load failed"); });
    await expect(f.ensure("activate")).resolves.toBeNull();
    expect(failed.destroy).toHaveBeenCalledOnce();
    await f.ensure("activate"); expect(f.createWindow).toHaveBeenCalledTimes(2);
    expect(main?.show).toHaveBeenCalledOnce();
  });
  it("创建失败返回空，下次仍重试", async () => {
    const f = fixture(); f.createWindow.mockRejectedValueOnce(new Error("boom"));
    await expect(f.ensure("activate")).resolves.toBeNull(); await f.ensure("activate"); expect(f.createWindow).toHaveBeenCalledTimes(2);
  });
});
