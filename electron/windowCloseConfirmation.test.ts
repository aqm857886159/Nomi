import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ipcListener: undefined as undefined | ((event: { sender: object }, payload: unknown) => void),
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { on: (_channel: string, listener: typeof mocks.ipcListener) => { mocks.ipcListener = listener; } },
  dialog: { showMessageBox: mocks.showMessageBox },
}));

import { installWindowCloseConfirmation } from "./windowCloseConfirmation";
import { installQuitTeardown, isQuitRequested, resetQuitTeardownForTests } from "./quitTeardown";

class FakeWindow extends EventEmitter {
  readonly webContents = { send: vi.fn() };
  readonly focus = vi.fn();
  readonly close = vi.fn(() => {
    const event = { preventDefault: vi.fn() };
    this.emit("close", event);
    if (event.preventDefault.mock.calls.length === 0) this.emit("closed");
  });
  destroyed = false;
  isDestroyed = () => this.destroyed;
}

/** Electron app stand-in: app.quit() emits before-quit, then will-quit once no window is open. */
function installOwner(openWindows: () => number) {
  const listeners = new Map<string, (event: { preventDefault: () => void }) => void>();
  const app = {
    on: vi.fn((event: string, listener: (...args: never[]) => void) => { listeners.set(event, listener as (event: { preventDefault: () => void }) => void); return app; }),
    whenReady: vi.fn(() => Promise.resolve()),
    exit: vi.fn(),
    quit: vi.fn(() => {
      listeners.get("before-quit")?.({ preventDefault: vi.fn() });
      if (openWindows() === 0) listeners.get("will-quit")?.({ preventDefault: vi.fn() });
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

describe("window close confirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetQuitTeardownForTests();
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the window open while an ACKed renderer waits ten seconds before confirming", () => {
    const window = new FakeWindow();
    mocks.fromWebContents.mockReturnValue(window);
    installWindowCloseConfirmation(window as never);
    const firstClose = { preventDefault: vi.fn() };
    window.emit("close", firstClose);
    expect(firstClose.preventDefault).toHaveBeenCalledOnce();
    const { requestId } = window.webContents.send.mock.calls[0]![1] as { requestId: string };
    mocks.ipcListener?.({ sender: window.webContents }, { requestId, ack: true });
    vi.advanceTimersByTime(10_000);
    expect(window.close).not.toHaveBeenCalled();
    mocks.ipcListener?.({ sender: window.webContents }, { requestId, confirmed: true });
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("keeps the window open when an ACKed renderer cancels, then allows a later quit", () => {
    const window = new FakeWindow();
    mocks.fromWebContents.mockReturnValue(window);
    installWindowCloseConfirmation(window as never);
    const firstClose = { preventDefault: vi.fn() };
    window.emit("close", firstClose);
    const firstRequest = window.webContents.send.mock.calls[0]![1] as { requestId: string };
    mocks.ipcListener?.({ sender: window.webContents }, { requestId: firstRequest.requestId, ack: true });
    mocks.ipcListener?.({ sender: window.webContents }, { requestId: firstRequest.requestId, confirmed: false });
    expect(window.close).not.toHaveBeenCalled();
    expect(isQuitRequested()).toBe(false);
    window.emit("close", { preventDefault: vi.fn() });
    const secondRequest = window.webContents.send.mock.calls[1]![1] as { requestId: string };
    mocks.ipcListener?.({ sender: window.webContents }, { requestId: secondRequest.requestId, ack: true });
    mocks.ipcListener?.({ sender: window.webContents }, { requestId: secondRequest.requestId, confirmed: true });
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("uses a native dialog after 1500ms without ACK, where cancel stays open and force quit closes", async () => {
    const window = new FakeWindow();
    mocks.fromWebContents.mockReturnValue(window);
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });
    installWindowCloseConfirmation(window as never);
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
    expect(window.close).not.toHaveBeenCalled();
    expect(isQuitRequested()).toBe(false);
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("does not open a second native dialog when quit is clicked twice while the first is open", async () => {
    const window = new FakeWindow();
    mocks.fromWebContents.mockReturnValue(window);
    let resolveDialog!: (value: { response: number }) => void;
    mocks.showMessageBox.mockReturnValueOnce(new Promise<{ response: number }>((resolve) => { resolveDialog = resolve; }));
    installWindowCloseConfirmation(window as never);
    window.emit("close", { preventDefault: vi.fn() });
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
    resolveDialog({ response: 1 });
    await vi.runAllTimersAsync();
    expect(window.close).not.toHaveBeenCalled();
  });

  it("keeps the window open at the ACK deadline, guarding against force-close mutation", () => {
    const window = new FakeWindow();
    mocks.fromWebContents.mockReturnValue(window);
    installWindowCloseConfirmation(window as never);
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1499);
    expect(window.close).not.toHaveBeenCalled();
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(window.close).not.toHaveBeenCalled();
    expect(mocks.showMessageBox).toHaveBeenCalledOnce();
  });

  it("finishes a requested quit after the user confirms the close that interrupted it", async () => {
    const window = new FakeWindow();
    let open = 1;
    window.on("closed", () => { open = 0; });
    mocks.fromWebContents.mockReturnValue(window);
    const app = installOwner(() => open);
    installWindowCloseConfirmation(window as never);
    app.quit();
    window.emit("close", { preventDefault: vi.fn() });
    const { requestId } = window.webContents.send.mock.calls[0]![1] as { requestId: string };
    mocks.ipcListener?.({ sender: window.webContents }, { requestId, ack: true });
    vi.advanceTimersByTime(10_000);
    expect(app.quit).toHaveBeenCalledOnce();
    mocks.ipcListener?.({ sender: window.webContents }, { requestId, confirmed: true });
    expect(window.close).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    // 1 = user quit (cancelled by the prevented close), 2 = resumed after closed, 3 = owner after drains.
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(3));
    expect(app.exit).not.toHaveBeenCalled();
  });

  it("finishes a requested quit after native force quit, but not after a plain window close", async () => {
    const quitting = new FakeWindow();
    let open = 1;
    quitting.on("closed", () => { open = 0; });
    mocks.fromWebContents.mockReturnValue(quitting);
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });
    const app = installOwner(() => open);
    installWindowCloseConfirmation(quitting as never);
    app.quit();
    quitting.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(1500);
    await vi.runAllTimersAsync();
    expect(quitting.close).toHaveBeenCalledOnce();
    expect(app.quit.mock.calls.length).toBeGreaterThanOrEqual(2);

    resetQuitTeardownForTests();
    const plain = new FakeWindow();
    mocks.fromWebContents.mockReturnValue(plain);
    const plainApp = installOwner(() => 1);
    installWindowCloseConfirmation(plain as never);
    plain.emit("close", { preventDefault: vi.fn() });
    const { requestId } = plain.webContents.send.mock.calls[0]![1] as { requestId: string };
    mocks.ipcListener?.({ sender: plain.webContents }, { requestId, ack: true });
    mocks.ipcListener?.({ sender: plain.webContents }, { requestId, confirmed: true });
    await vi.runAllTimersAsync();
    expect(plain.close).toHaveBeenCalledOnce();
    expect(plainApp.quit).not.toHaveBeenCalled();
  });
});
