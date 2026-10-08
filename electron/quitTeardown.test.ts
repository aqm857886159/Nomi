import { beforeEach, describe, expect, it, vi } from "vitest";
import { installQuitTeardown, registerQuitDrain, resetQuitRequest, resetQuitTeardownForTests } from "./quitTeardown";
import { openProjectAgentLane } from "../src/workbench/project/projectAgentLaneOpen";

type Listener = (event: { preventDefault: () => void }) => void;
const quitCancellationMatrix = ["agent command", "capability core", "project opening"] as const;

function fakeApp() {
  const listeners = new Map<string, Listener>();
  const app = {
    on: vi.fn((event: "before-quit" | "will-quit", listener: Listener) => {
      listeners.set(event, listener);
      return app;
    }),
    quit: vi.fn(),
    exit: vi.fn(),
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

describe("quit teardown lifecycle", () => {
  beforeEach(() => resetQuitTeardownForTests());
  it("keeps teardown reversible at before-quit and performs it after windows are closed", async () => {
    const { app, emit } = fakeApp();
    let handlerAlive = true;
    const disposeLane = vi.fn(async () => {
      handlerAlive = false;
    });
    const deps = {
      disposeBackgroundLifecycle: vi.fn(),
      stopDesktopCapabilityCore: vi.fn(),
      disposeDesktopLaneIpc: disposeLane,
      abortAllActiveExports: vi.fn(() => 2),
    };
    installQuitTeardown(app, deps);
    expect(app.on).toHaveBeenCalledWith("will-quit", expect.any(Function));

    const beforePrevented = emit("before-quit");
    expect(beforePrevented).not.toHaveBeenCalled();
    expect(handlerAlive).toBe(true);
    expect(deps.stopDesktopCapabilityCore).not.toHaveBeenCalled();

    const willPrevented = emit("will-quit");
    expect(willPrevented).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(handlerAlive).toBe(false));
    expect(deps.disposeBackgroundLifecycle).toHaveBeenCalledOnce();
    expect(deps.stopDesktopCapabilityCore).toHaveBeenCalledOnce();
    expect(deps.abortAllActiveExports).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
  });

  it.each(quitCancellationMatrix)("leaves the live %s usable when close confirmation rejects quit", async (surface) => {
    const { app, emit } = fakeApp();
    let laneAvailable = true;
    let capabilityCoreAlive = true;
    let projectOpen = false;
    const runAgentCommand = vi.fn(() => laneAvailable ? { ok: true, value: "agent-command-accepted" } : { ok: false, code: "agent_lane_disposed" });
    const readCapabilityCore = vi.fn(() => capabilityCoreAlive ? { ok: true, value: "capability-core-alive" } : { ok: false });
    const openProject = vi.fn(() => { projectOpen = capabilityCoreAlive; return projectOpen; });
    installQuitTeardown(app, {
      disposeBackgroundLifecycle: vi.fn(),
      stopDesktopCapabilityCore: vi.fn(() => { capabilityCoreAlive = false; }),
      disposeDesktopLaneIpc: vi.fn(async () => { laneAvailable = false; }),
      abortAllActiveExports: vi.fn(() => 0),
    });
    const beforePrevented = emit("before-quit");
    expect(beforePrevented).not.toHaveBeenCalled();
    expect(runAgentCommand()).toEqual({ ok: true, value: "agent-command-accepted" });
    expect(readCapabilityCore()).toEqual({ ok: true, value: "capability-core-alive" });
    expect(openProject()).toBe(true);
    await expect(openProjectAgentLane(
      { projectId: "project-after-cancel", immutableProjectUuid: "uuid-after-cancel", projectGeneration: 1 },
      {
        open: vi.fn(async () => ({ ok: true as const, workspaceId: "workspace-after-cancel" })),
        recoverReceipts: vi.fn(async () => undefined),
        reportFailure: vi.fn(),
      },
    )).resolves.toBe(true);
    expect(laneAvailable).toBe(true);
    expect(capabilityCoreAlive).toBe(true);
    expect(projectOpen).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(quitCancellationMatrix).toContain(surface);
  });

  it("forces process exit after the teardown budget when a dependency hangs", async () => {
    const { app, emit } = fakeApp();
    installQuitTeardown(app, {
      disposeBackgroundLifecycle: vi.fn(),
      stopDesktopCapabilityCore: vi.fn(),
      disposeDesktopLaneIpc: () => new Promise<void>(() => undefined),
      abortAllActiveExports: vi.fn(() => 0),
      timeoutMs: 5,
    });
    emit("will-quit");
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("starts the quit budget at will-quit after a five-second confirmation", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const drain = vi.fn(() => new Promise<void>(() => undefined));
      const now = vi.spyOn(Date, "now");
      now.mockReturnValue(0);
      installQuitTeardown(app, {
        disposeBackgroundLifecycle: vi.fn(),
        stopDesktopCapabilityCore: vi.fn(),
        disposeDesktopLaneIpc: drain,
        abortAllActiveExports: vi.fn(() => 0),
        timeoutMs: 20,
      });
      emit("before-quit");
      now.mockReturnValue(5000);
      emit("will-quit");
      for (let i = 0; i < 32; i += 1) await Promise.resolve();
      expect(drain).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(19);
      expect(app.exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      await vi.runAllTimersAsync();
      expect(app.exit).toHaveBeenCalledWith(0);
      expect(app.quit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs built-in drains in the original serial order and exits on a hanging step", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const order: string[] = [];
      let releaseBackground!: () => void;
      const background = vi.fn(() => new Promise<void>((resolve) => {
        order.push("background-lifecycle");
        releaseBackground = resolve;
      }));
      const capability = vi.fn(() => {
        order.push("capability-core");
        return new Promise<void>(() => undefined);
      });
      const exports = vi.fn(() => { order.push("active-exports"); return 0; });
      const lane = vi.fn(async () => { order.push("desktop-lane-ipc"); });
      installQuitTeardown(app, {
        disposeBackgroundLifecycle: background,
        stopDesktopCapabilityCore: capability,
        disposeDesktopLaneIpc: lane,
        abortAllActiveExports: exports,
        timeoutMs: 5,
      });
      emit("will-quit");
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
      expect(order).toEqual(["background-lifecycle"]);
      releaseBackground();
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
      expect(order).toEqual(["background-lifecycle", "capability-core"]);
      vi.advanceTimersByTime(5);
      await vi.runAllTimersAsync();
      expect(app.exit).toHaveBeenCalledWith(0);
      expect(order).toEqual(["background-lifecycle", "capability-core"]);
      expect(exports).not.toHaveBeenCalled();
      expect(lane).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["required completes", async (): Promise<void> => undefined, "quit"],
    ["required throws", async (): Promise<void> => { throw new Error("drain failed"); }, "quit"],
    ["required hangs", (): Promise<void> => new Promise<void>(() => undefined), "exit"],
  ] as const)("keeps the single owner bounded when %s", async (_label, drain, outcome) => {
    const { app, emit } = fakeApp();
    installQuitTeardown(app, {
      disposeBackgroundLifecycle: vi.fn(),
      stopDesktopCapabilityCore: vi.fn(),
      disposeDesktopLaneIpc: vi.fn(async () => undefined),
      abortAllActiveExports: vi.fn(() => 0),
      timeoutMs: 5,
    });
    registerQuitDrain(`matrix-${_label}`, drain, { required: true, timeoutMs: 5 });
    emit("will-quit");
    if (outcome === "exit") await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    else await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
  });

  it.each([
    ["completes-first", async (): Promise<void> => undefined, "quit", "first"],
    ["completes-double", async (): Promise<void> => undefined, "quit", "double"],
    ["completes-cancel-then-exit", async (): Promise<void> => undefined, "quit", "cancel-then-exit"],
    ["throws-first", async (): Promise<void> => { throw new Error("drain failed"); }, "quit", "first"],
    ["throws-double", async (): Promise<void> => { throw new Error("drain failed"); }, "quit", "double"],
    ["throws-cancel-then-exit", async (): Promise<void> => { throw new Error("drain failed"); }, "quit", "cancel-then-exit"],
    ["hangs-first", (): Promise<void> => new Promise<void>(() => undefined), "exit", "first"],
    ["hangs-double", (): Promise<void> => new Promise<void>(() => undefined), "exit", "double"],
    ["hangs-cancel-then-exit", (): Promise<void> => new Promise<void>(() => undefined), "exit", "cancel-then-exit"],
  ] as const)("bounds %s", async (_label, drain, expected, quitPath) => {
    const { app, emit } = fakeApp();
    installQuitTeardown(app, {
      disposeBackgroundLifecycle: vi.fn(),
      stopDesktopCapabilityCore: vi.fn(),
      disposeDesktopLaneIpc: vi.fn(async () => undefined),
      abortAllActiveExports: vi.fn(() => 0),
      timeoutMs: 5,
    });
    registerQuitDrain(`matrix-${quitPath}`, drain, { required: true, timeoutMs: 5 });
    if (quitPath === "double") {
      emit("will-quit");
      emit("will-quit");
    } else {
      if (quitPath === "cancel-then-exit") {
        emit("before-quit");
        resetQuitRequest();
      }
      emit("will-quit");
    }
    if (expected === "exit") await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    else await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
  });
});
