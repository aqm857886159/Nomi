import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ click: undefined as undefined | (() => void | Promise<unknown>), main: null as ReturnType<typeof win> | null, windows: [] as ReturnType<typeof win>[] }));
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => h.windows } }));
vi.mock("../appWindowRegistry", () => ({ getMainWindow: () => h.main }));
vi.mock("../logging/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("../desktopNotification", () => ({ showDesktopNotification: (notice: { onClick: () => void }) => { h.click = notice.onClick; } }));
vi.mock("./productionNotifications", () => ({ createNoticeDedupe: () => () => true, decideProductionNotice: () => ({ key: "k", target: { projectId: "p", runId: "r" } }) }));
import { createMainWindowGuard } from "../mainWindowPresence";
import { createProductionNotificationsListener } from "./productionNotificationsDesktop";
function win() { return { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } }; }
describe("制作通知召回及深链", () => {
  it("点击投递遇到失效的 renderer 也不抛出异步异常", async () => {
    h.main = win(); h.main.webContents.send.mockImplementationOnce(() => { throw new Error("renderer gone"); });
    h.windows = [h.main]; createMainWindowGuard({ createWindow: vi.fn(), onWindowReady: vi.fn() });
    createProductionNotificationsListener()([], {} as never);
    await expect(h.click!()).resolves.toBeUndefined();
  });
  it.each([false, true])("辅助窗排首，主窗存在=%s", async (exists) => {
    const aux = win(); h.main = exists ? win() : null; h.windows = [aux, ...(h.main ? [h.main] : [])];
    createMainWindowGuard({ createWindow: async () => { h.main = win(); }, onWindowReady: vi.fn() });
    createProductionNotificationsListener()([], {} as never); await h.click!();
    expect(h.main?.show).toHaveBeenCalled(); expect(h.main?.focus).toHaveBeenCalled();
    expect(h.main?.webContents.send).toHaveBeenCalledWith("nomi:production-deep-link", { projectId: "p", runId: "r" });
    expect(aux.show).not.toHaveBeenCalled(); expect(aux.webContents.send).not.toHaveBeenCalled();
  });
});
