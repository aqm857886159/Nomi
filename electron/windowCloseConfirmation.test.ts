import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ipcListener: undefined as undefined | ((event: { sender: object }, payload: unknown) => void),
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { focus: vi.fn() },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { on: (_channel: string, listener: typeof mocks.ipcListener) => { mocks.ipcListener = listener; } },
  dialog: { showMessageBox: mocks.showMessageBox },
}));
vi.mock("./logging/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import { installWindowCloseConfirmation } from "./windowCloseConfirmation";
import { installQuitTeardown, isQuitRequested, resetQuitTeardownForTests } from "./quitTeardown";
import { adoptMainWindow, installMainWindowOwner, mainWindowPhase, markMainWindowQuitting, openMainWindow, resetMainWindowOwnerForTests, revealMainWindow } from "./mainWindowPresence";

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn();
  readonly setBackgroundThrottling = vi.fn();
}

class FakeWindow extends EventEmitter {
  readonly webContents = new FakeWebContents();
  visible = true;
  minimized = false;
  destroyed = false;
  readonly focus = vi.fn();
  readonly show = vi.fn(() => { this.visible = true; });
  readonly restore = vi.fn(() => { this.minimized = false; });
  readonly hide = vi.fn(() => { this.visible = false; });
  readonly close = vi.fn(() => {
    const event = { preventDefault: vi.fn() };
    this.emit("close", event);
    if (event.preventDefault.mock.calls.length === 0) {
      this.destroyed = true;
      this.emit("closed");
    }
  });
  isDestroyed = (): boolean => this.destroyed;
  isVisible = (): boolean => this.visible && !this.destroyed;
  isMinimized = (): boolean => this.minimized;
}

/**
 * Electron app stand-in: app.quit() emits before-quit, closes every open window (a prevented close
 * cancels the quit), then emits will-quit once no window is open. Like Electron's Browser::Quit, a call
 * made while a quit is still in flight is ignored until the next macrotask.
 */
function installQuitOwner(windows: FakeWindow[]) {
  const listeners = new Map<string, (event: { preventDefault: () => void }) => void>();
  let quitting = false;
  const app = {
    on: vi.fn((event: string, listener: (...args: never[]) => void) => { listeners.set(event, listener as (event: { preventDefault: () => void }) => void); return app; }),
    whenReady: vi.fn(() => Promise.resolve()),
    exit: vi.fn(),
    quit: vi.fn(() => {
      if (quitting) return;
      quitting = true;
      listeners.get("before-quit")?.({ preventDefault: vi.fn() });
      for (const window of windows.filter((candidate) => !candidate.destroyed)) window.close();
      if (windows.every((candidate) => candidate.destroyed)) listeners.get("will-quit")?.({ preventDefault: vi.fn() });
      setTimeout(() => { quitting = false; }, 0);
    }),
  };
  installQuitTeardown(app, {
    disposeBackgroundLifecycle: vi.fn(),
    stopDesktopCapabilityCore: vi.fn(),
    abortAllActiveExports: vi.fn(() => 0),
    disposeDesktopLaneIpc: vi.fn(async () => undefined),
  });
  return app;
}

/** 生产接线：主窗主人建窗 → 装关窗确认；关窗的结果（退 / 藏）由主人决定。 */
async function setup(options: { busy?: boolean; platform?: NodeJS.Platform; minimized?: boolean; visible?: boolean } = {}) {
  const window = new FakeWindow();
  window.minimized = options.minimized ?? false;
  window.visible = options.visible ?? true;
  mocks.fromWebContents.mockReturnValue(window);
  const app = installQuitOwner([window]);
  installMainWindowOwner({
    build: async () => {
      adoptMainWindow(window as never);
      installWindowCloseConfirmation(window as never);
      return window as never;
    },
    onWindowReady: () => undefined,
    isBusy: () => options.busy ?? false,
    isBackgroundLaunch: false,
    allowRelaunch: false,
    platform: options.platform ?? "darwin",
  });
  await openMainWindow();
  return { window, app };
}

function requestIdAt(window: FakeWindow, index = 0): string {
  return (window.webContents.send.mock.calls[index]![1] as { requestId: string }).requestId;
}

function answer(window: FakeWindow, requestId: string, decision: "ack" | boolean): void {
  mocks.ipcListener?.({ sender: window.webContents }, decision === "ack" ? { requestId, ack: true } : { requestId, confirmed: decision });
}

describe("window close confirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetQuitTeardownForTests();
    resetMainWindowOwnerForTests();
    mocks.showMessageBox.mockReset().mockResolvedValue({ response: 1 });
  });
  afterEach(() => {
    resetMainWindowOwnerForTests();
    vi.useRealTimers();
  });

  it("keeps the window open while an ACKed renderer waits ten seconds, then an idle confirmed close quits", async () => {
    const { window, app } = await setup();
    const firstClose = { preventDefault: vi.fn() };
    window.emit("close", firstClose);
    expect(firstClose.preventDefault).toHaveBeenCalledOnce();
    const requestId = requestIdAt(window);
    answer(window, requestId, "ack");
    vi.advanceTimersByTime(10_000);
    expect(window.destroyed).toBe(false);
    answer(window, requestId, true);
    // 空闲关窗真退出（拍板 A）：窗口只由退出流程关一次，不再「关一次窗再强制关一次」。
    expect(app.quit).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(true);
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
  });

  it("keeps the window open when an ACKed renderer cancels, then allows a later close", async () => {
    const { window, app } = await setup();
    window.emit("close", { preventDefault: vi.fn() });
    const first = requestIdAt(window, 0);
    answer(window, first, "ack");
    answer(window, first, false);
    expect(window.destroyed).toBe(false);
    expect(isQuitRequested()).toBe(false);
    expect(mainWindowPhase()).toBe("open");
    window.emit("close", { preventDefault: vi.fn() });
    const second = requestIdAt(window, 1);
    answer(window, second, "ack");
    answer(window, second, true);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(true);
  });

  it("「重启以更新」的关窗确认里点取消：不再算退出中，之后叫回照常亮出同一扇窗（★9 第 13 条）", async () => {
    const { window } = await setup();
    markMainWindowQuitting("update-install");
    expect(mainWindowPhase()).toBe("quitting");
    window.emit("close", { preventDefault: vi.fn() });
    const requestId = requestIdAt(window);
    answer(window, requestId, "ack");
    answer(window, requestId, false);
    expect(window.destroyed).toBe(false);
    expect(mainWindowPhase()).toBe("open");
    window.visible = false;
    window.show.mockClear();
    revealMainWindow("activate");
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.visible).toBe(true);
  });

  it("macOS: a confirmed close while work is running hides the window instead of quitting (拍板 B)", async () => {
    const { window, app } = await setup({ busy: true });
    window.emit("close", { preventDefault: vi.fn() });
    const requestId = requestIdAt(window);
    answer(window, requestId, "ack");
    answer(window, requestId, true);
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(false);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("Windows: a confirmed close quits even while work is running (first cut keeps today's behavior)", async () => {
    const { window, app } = await setup({ busy: true, platform: "win32" });
    window.emit("close", { preventDefault: vi.fn() });
    const requestId = requestIdAt(window);
    answer(window, requestId, "ack");
    answer(window, requestId, true);
    expect(window.hide).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(true);
  });

  it.each([
    ["minimized", { minimized: true }],
    ["hidden", { visible: false }],
  ] as const)("brings a %s window back before asking: an invisible window never asks (§8.3)", async (_label, state) => {
    const { window, app } = await setup(state);
    app.quit();
    expect(window.isVisible() && !window.isMinimized()).toBe(true);
    expect(window.webContents.send).toHaveBeenCalledWith("nomi:window:close-request", expect.anything());
    const showOrder = window.show.mock.invocationCallOrder[0]!;
    expect(showOrder).toBeLessThan(window.webContents.send.mock.invocationCallOrder[0]!);
  });

  it("uses a native dialog after 1500ms without ACK, where cancel stays open and force quit closes", async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });
    const { window } = await setup({ busy: true });
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(false);
    expect(isQuitRequested()).toBe(false);
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    // 强制退出：有活也退，不藏。
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.destroyed).toBe(true);
  });

  it("asks natively with Force Quit / Cancel, Cancel as default and escape", async () => {
    const { window } = await setup();
    window.emit("close", { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      buttons: ["Force Quit", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    }));
  });

  it("brings the window forward instead of stacking a second native dialog (R-review-1125 #4)", async () => {
    let resolveDialog!: (value: { response: number }) => void;
    mocks.showMessageBox.mockReturnValueOnce(new Promise<{ response: number }>((resolve) => { resolveDialog = resolve; }));
    const { window } = await setup();
    window.emit("close", { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.showMessageBox).toHaveBeenCalledOnce(); // dialog is open now, the close request is gone
    window.focus.mockClear();
    const again = { preventDefault: vi.fn() };
    window.emit("close", again);
    await vi.advanceTimersByTimeAsync(3000);
    expect(again.preventDefault).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalled();
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledOnce();
    resolveDialog({ response: 1 });
    await vi.runAllTimersAsync();
    expect(window.destroyed).toBe(false);
  });

  it.each([
    ["the renderer crashes", (window: FakeWindow) => window.webContents.emit("render-process-gone", {}, { reason: "crashed" })],
    ["the renderer hangs", (window: FakeWindow) => window.emit("unresponsive")],
  ])("asks natively when %s after ACK instead of refusing every close forever", async (_label, loseRenderer) => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });
    const { window } = await setup();
    window.emit("close", { preventDefault: vi.fn() });
    answer(window, requestIdAt(window), "ack");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
    loseRenderer(window);
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
    expect(window.destroyed).toBe(true);
  });

  it("ignores a lost renderer when no close is pending", async () => {
    const { window } = await setup();
    window.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    window.emit("unresponsive");
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });

  it("does not open a second native dialog when quit is clicked twice while the first is open", async () => {
    let resolveDialog!: (value: { response: number }) => void;
    mocks.showMessageBox.mockReturnValueOnce(new Promise<{ response: number }>((resolve) => { resolveDialog = resolve; }));
    const { window } = await setup();
    window.emit("close", { preventDefault: vi.fn() });
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
    resolveDialog({ response: 1 });
    await vi.runAllTimersAsync();
    expect(window.destroyed).toBe(false);
  });

  it("keeps the window open at the ACK deadline, guarding against force-close mutation", async () => {
    const { window } = await setup();
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1499);
    expect(window.destroyed).toBe(false);
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(window.destroyed).toBe(false);
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
  });

  it("finishes a requested quit (⌘Q) after the user confirms the close that interrupted it, even while busy", async () => {
    const { window, app } = await setup({ busy: true });
    app.quit();
    expect(window.destroyed).toBe(false);
    const requestId = requestIdAt(window);
    answer(window, requestId, "ack");
    vi.advanceTimersByTime(10_000);
    expect(app.quit).toHaveBeenCalledOnce();
    answer(window, requestId, true);
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.destroyed).toBe(true);
    // 1 = user quit (cancelled by the prevented close), 2 = resumed by the main-window owner; then the
    // quit owner drains and ends the process itself with app.exit (never a third app.quit inside will-quit).
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(app.quit).toHaveBeenCalledTimes(2);
    expect(app.exit).toHaveBeenCalledOnce();
  });

  it("finishes a requested quit after native force quit", async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });
    const { window, app } = await setup();
    app.quit();
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(window.destroyed).toBe(true);
    expect(app.quit).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
  });
});
