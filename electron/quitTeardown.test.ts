import { describe, expect, it, vi } from "vitest";
import { installQuitTeardown } from "./quitTeardown";

type Listener = (event: { preventDefault: () => void }) => void;

function fakeApp() {
  const listeners = new Map<string, Listener>();
  const app = {
    on: vi.fn((event: "before-quit" | "will-quit", listener: Listener) => {
      listeners.set(event, listener);
      return app;
    }),
    quit: vi.fn(),
  };
  return {
    app,
    emit: (event: "before-quit" | "will-quit") => {
      const preventDefault = vi.fn();
      listeners.get(event)?.({ preventDefault });
      return preventDefault;
    },
  };
}

const quitLifecycleMatrix = ["before-quit", "will-quit"] as const;

describe("quit teardown lifecycle", () => {
  it("keeps teardown reversible at before-quit and performs it after windows are closed", async () => {
    const { app, emit } = fakeApp();
    let handlerAlive = true;
    const disposeLane = vi.fn(async () => {
      handlerAlive = false;
    });
    const deps = {
      markQuitRequested: vi.fn(),
      disposeBackgroundLifecycle: vi.fn(),
      stopDesktopCapabilityCore: vi.fn(),
      disposeDesktopLaneIpc: disposeLane,
      abortAllActiveExports: vi.fn(() => 2),
    };
    installQuitTeardown(app, deps);
    for (const event of quitLifecycleMatrix) {
      expect(app.on).toHaveBeenCalledWith(event, expect.any(Function));
    }

    const beforePrevented = emit("before-quit");
    expect(beforePrevented).not.toHaveBeenCalled();
    expect(deps.markQuitRequested).toHaveBeenCalledOnce();
    expect(handlerAlive).toBe(true);
    expect(deps.stopDesktopCapabilityCore).not.toHaveBeenCalled();

    const willPrevented = emit("will-quit");
    expect(willPrevented).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(handlerAlive).toBe(false));
    expect(deps.disposeBackgroundLifecycle).toHaveBeenCalledOnce();
    expect(deps.stopDesktopCapabilityCore).toHaveBeenCalledOnce();
    expect(deps.abortAllActiveExports).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
