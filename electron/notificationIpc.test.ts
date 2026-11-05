import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ handler: undefined as undefined | ((event: object, payload: unknown) => unknown), click: undefined as undefined | (() => void | Promise<unknown>), main: null as ReturnType<typeof win> | null, windows: [] as ReturnType<typeof win>[] }));
vi.mock("electron", () => ({ ipcMain: { handle: (_: string, fn: (event: object, payload: unknown) => unknown) => { h.handler = fn; } }, BrowserWindow: { getAllWindows: () => h.windows } }));
vi.mock("./appWindowRegistry", () => ({ getMainWindow: () => h.main }));
vi.mock("./ipcSenderGuard", () => ({ assertTrustedSender: vi.fn() }));
vi.mock("./desktopNotification", () => ({ showDesktopNotification: (notice: { onClick: () => void }) => { h.click = notice.onClick; return { ok: true }; } }));
vi.mock("./logging/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
import { createMainWindowGuard } from "./mainWindowPresence";
import { registerNotificationIpc } from "./notificationIpc";
function win() { return { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }; }
describe("通知点击主窗身份", () => {
  beforeEach(() => { h.main = null; h.windows = []; registerNotificationIpc(); });
  it.each([false, true])("辅助窗排首，主窗存在=%s", async (exists) => {
    const aux = win(); h.windows = [aux]; if (exists) { h.main = win(); h.windows.push(h.main); }
    const createWindow = vi.fn(async () => { h.main = win(); h.windows.push(h.main); });
    createMainWindowGuard({ createWindow, onWindowReady: vi.fn() });
    h.handler!({}, { title: "done" }); await h.click!();
    expect(h.main?.show).toHaveBeenCalled(); expect(h.main?.focus).toHaveBeenCalled(); expect(aux.show).not.toHaveBeenCalled();
  });
});
