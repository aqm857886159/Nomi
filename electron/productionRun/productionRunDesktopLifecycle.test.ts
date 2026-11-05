import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), quit: vi.fn(), main: null as ReturnType<typeof win> | null, windows: [] as ReturnType<typeof win>[], ready: true }));
vi.mock("electron", () => ({ app: { on: (event: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(event, fn), quit: h.quit, isReady: () => h.ready }, BrowserWindow: { getAllWindows: () => h.windows } }));
vi.mock("../appWindowRegistry", () => ({ getMainWindow: () => h.main }));
vi.mock("../logging/logger", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }));
vi.mock("./artifactProjection", () => ({ loadOrCreateArtifactPreviewSecret: vi.fn() }));
vi.mock("./productionRunRepository", () => ({ createProductionRunRepository: () => ({}) }));
vi.mock("./productionDeepLink", () => ({ resolveProductionDeepLink: () => ({ projectId: "p", nodeId: "n" }) }));
import { logError } from "../logging/logger";
import { createMainWindowGuard } from "../mainWindowPresence";
import { installProductionRunDesktopLifecycle } from "./productionRunDesktopLifecycle";
function win() { return { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } }; }
function setup() {
  const createWindow = vi.fn(async () => { h.main = win(); h.windows.push(h.main); });
  const ensureMainWindow = createMainWindowGuard({ createWindow, onWindowReady: () => lifecycle.flushPendingProductionDeepLink() });
  const lifecycle = installProductionRunDesktopLifecycle({ isMcpStdio: false, allowE2eMultiInstance: false, hasSingleInstanceLock: true, ensureMainWindow });
  return { createWindow, ensureMainWindow, ...lifecycle };
}
async function settle() { await vi.waitFor(() => expect(h.main?.focus).toHaveBeenCalled()); }
describe("desktop lifecycle · registry 与深链", () => {
  beforeEach(() => { h.handlers.clear(); vi.clearAllMocks(); h.main = null; h.windows = []; h.ready = true; });
  it.each(["zero", "aux-only", "aux-first"])("second-instance %s 总是叫回真正主窗", async (kind) => {
    const aux = win(); if (kind !== "zero") h.windows.push(aux);
    if (kind === "aux-first") { h.main = win(); h.windows.push(h.main); }
    const f = setup(); h.handlers.get("second-instance")!({}, []); await settle();
    expect(h.main?.show).toHaveBeenCalled(); expect(aux.show).not.toHaveBeenCalled(); expect(f.createWindow).toHaveBeenCalledTimes(kind === "aux-first" ? 0 : 1);
  });
  it("深链在新主窗就绪后投递，辅助窗不能收", async () => {
    const aux = win(); h.windows = [aux]; setup();
    h.handlers.get("open-url")!({ preventDefault: vi.fn() }, "nomi://project/p/node/n"); await settle();
    await vi.waitFor(() => expect(h.main?.webContents.send).toHaveBeenCalledWith("nomi:production-deep-link", { projectId: "p", nodeId: "n" }));
    expect(aux.webContents.send).not.toHaveBeenCalled();
  });
  it("建窗失败仍保留原深链，下次召回就绪后只投递一次", async () => {
    const f = setup(); f.createWindow.mockRejectedValueOnce(new Error("load failed"));
    h.handlers.get("open-url")!({ preventDefault: vi.fn() }, "nomi://project/p/node/n");
    await vi.waitFor(() => expect(logError).toHaveBeenCalled());
    await f.ensureMainWindow("activate");
    await vi.waitFor(() => expect(h.main?.webContents.send).toHaveBeenCalledExactlyOnceWith("nomi:production-deep-link", { projectId: "p", nodeId: "n" }));
  });
  it("ready 前暂存深链，初始建窗完成后再投递", async () => {
    h.ready = false; const f = setup(); h.handlers.get("open-url")!({ preventDefault: vi.fn() }, "nomi://project/p/node/n");
    expect(f.createWindow).not.toHaveBeenCalled(); h.ready = true; h.main = win(); f.flushPendingProductionDeepLink(); await settle();
    expect(h.main?.webContents.send).toHaveBeenCalledWith("nomi:production-deep-link", { projectId: "p", nodeId: "n" });
  });
  it("无单实例锁仍退出", () => {
    const log = vi.fn(); installProductionRunDesktopLifecycle({ isMcpStdio: false, allowE2eMultiInstance: false, hasSingleInstanceLock: false, ensureMainWindow: vi.fn(), log });
    expect(h.quit).toHaveBeenCalledOnce(); expect(h.handlers.has("second-instance")).toBe(false); expect(log).toHaveBeenCalled();
  });
});
