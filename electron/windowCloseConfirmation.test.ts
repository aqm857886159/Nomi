import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ipcListener: undefined as undefined | ((event: { sender: object }, payload: unknown) => void),
  fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { on: (_channel: string, listener: typeof mocks.ipcListener) => { mocks.ipcListener = listener; } },
}));

import { installWindowCloseConfirmation } from "./windowCloseConfirmation";
import { resetQuitTeardownForTests } from "./quitTeardown";

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

describe("window close confirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetQuitTeardownForTests();
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ["confirms", true, true],
    ["rejects", false, false],
  ] as const)("handles a renderer response that %s", (_label, confirmed, closes) => {
    const window = new FakeWindow();
    mocks.fromWebContents.mockReturnValue(window);
    installWindowCloseConfirmation(window as never);
    const firstClose = { preventDefault: vi.fn() };
    window.emit("close", firstClose);
    expect(firstClose.preventDefault).toHaveBeenCalledOnce();
    const { requestId } = window.webContents.send.mock.calls[0]![1] as { requestId: string };
    mocks.ipcListener?.({ sender: window.webContents }, { requestId, confirmed });
    expect(window.close).toHaveBeenCalledTimes(closes ? 1 : 0);
  });

  it("treats a renderer that never replies as confirmed within the owner budget", () => {
    const window = new FakeWindow();
    installWindowCloseConfirmation(window as never);
    const firstClose = { preventDefault: vi.fn() };
    window.emit("close", firstClose);
    vi.advanceTimersByTime(2999);
    expect(window.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(window.close).toHaveBeenCalledOnce();
  });
});
