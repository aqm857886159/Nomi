import { beforeEach, describe, expect, it, vi } from "vitest";
import { continueRequestedQuit, exitWithoutConfirmation, installQuitTeardown, isQuitRequested, registerQuitDrain, requestQuit, resetQuitRequest, resetQuitTeardownForTests } from "./quitTeardown";
import { openProjectAgentLane } from "../src/workbench/project/projectAgentLaneOpen";

type Listener = (event: { preventDefault: () => void }) => void;
type SessionEvent = { preventDefault?: () => void };
const quitCancellationMatrix = ["agent command", "capability core", "project opening"] as const;

function fakeApp() {
  const listeners = new Map<string, (...args: never[]) => void>();
  const app = {
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, listener);
      return app;
    }),
    whenReady: vi.fn((): Promise<unknown> => Promise.resolve()),
    quit: vi.fn(),
    exit: vi.fn(),
  };
  return {
    app,
    emit: (event: "before-quit" | "will-quit") => {
      const preventDefault = vi.fn();
      (listeners.get(event) as Listener | undefined)?.({ preventDefault });
      return preventDefault;
    },
    createWindow: (window: unknown) => {
      (listeners.get("browser-window-created") as ((event: unknown, window: unknown) => void) | undefined)?.({}, window);
    },
  };
}

function fakeSessionSource() {
  const listeners = new Map<string, (event?: SessionEvent) => void>();
  const source = {
    on: vi.fn((event: string, listener: (event?: SessionEvent) => void) => {
      listeners.set(event, listener);
      return source;
    }),
  };
  return {
    source,
    emit: (event: string, payload: SessionEvent = {}) => {
      listeners.get(event)?.(payload);
    },
  };
}

function recordingDeps(calls: string[], overrides: Partial<Parameters<typeof installQuitTeardown>[1]> = {}) {
  return {
    disposeBackgroundLifecycle: vi.fn(() => { calls.push("background-lifecycle"); }),
    stopDesktopCapabilityCore: vi.fn(() => { calls.push("capability-core"); }),
    abortAllActiveExports: vi.fn(() => { calls.push("active-exports"); return 1; }),
    disposeDesktopLaneIpc: vi.fn(async () => { calls.push("desktop-lane-ipc"); }),
    ...overrides,
  };
}

async function flushMicrotasks(rounds = 24): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
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
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(app.quit).not.toHaveBeenCalled();
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

  it("continues to abort exports and dispose the lane after capability-core times out", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const order: string[] = [];
      const errors: string[] = [];
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
        onError: (stage) => errors.push(stage),
        timeoutMs: 40,
      });
      emit("will-quit");
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
      expect(order).toEqual(["background-lifecycle"]);
      releaseBackground();
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
      expect(order).toEqual(["background-lifecycle", "capability-core"]);
      await vi.advanceTimersByTimeAsync(10); // capability-core's own 10ms cap (40ms budget / 4)
      expect(order).toEqual(["background-lifecycle", "capability-core", "active-exports", "desktop-lane-ipc"]);
      expect(exports).toHaveBeenCalledOnce();
      expect(lane).toHaveBeenCalledOnce();
      expect(errors).toContain("capability-core-timeout");
      vi.advanceTimersByTime(30);
      await vi.runAllTimersAsync();
      expect(app.exit).toHaveBeenCalledWith(0);
      expect(errors).toContain("quit-timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out desktop-lane-ipc at its own deadline and exits within the owner budget", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const errors: string[] = [];
      const lane = vi.fn(() => new Promise<void>(() => undefined));
      installQuitTeardown(app, {
        disposeBackgroundLifecycle: vi.fn(),
        stopDesktopCapabilityCore: vi.fn(),
        disposeDesktopLaneIpc: lane,
        abortAllActiveExports: vi.fn(() => 1),
        onError: (stage) => errors.push(stage),
        timeoutMs: 40,
      });
      emit("will-quit");
      for (let i = 0; i < 32; i += 1) await Promise.resolve();
      expect(lane).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(40);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
      expect(errors).toContain("desktop-lane-ipc-timeout");
      expect(app.exit).toHaveBeenCalledWith(0);
      expect(app.quit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives desktop-lane-ipc the remaining budget when earlier drains are instant", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const errors: string[] = [];
      const lane = vi.fn(() => new Promise<void>(() => undefined));
      installQuitTeardown(app, {
        disposeBackgroundLifecycle: vi.fn(),
        stopDesktopCapabilityCore: vi.fn(),
        disposeDesktopLaneIpc: lane,
        abortAllActiveExports: vi.fn(() => 0),
        onError: (stage) => errors.push(stage),
        timeoutMs: 3000,
      });
      emit("will-quit");
      for (let i = 0; i < 32; i += 1) await Promise.resolve();
      expect(lane).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(2249);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(app.exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(751);
      await vi.runAllTimersAsync();
      expect(errors).toContain("desktop-lane-ipc-timeout");
      expect(app.exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the remaining budget for desktop-lane-ipc when capability-core hangs", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const errors: string[] = [];
      const lane = vi.fn(() => new Promise<void>(() => undefined));
      installQuitTeardown(app, {
        disposeBackgroundLifecycle: vi.fn(),
        stopDesktopCapabilityCore: vi.fn(() => new Promise<void>(() => undefined)),
        disposeDesktopLaneIpc: lane,
        abortAllActiveExports: vi.fn(() => 0),
        onError: (stage) => errors.push(stage),
        timeoutMs: 3000,
      });
      emit("will-quit");
      for (let i = 0; i < 32; i += 1) await Promise.resolve();
      expect(lane).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      for (let i = 0; i < 24; i += 1) await Promise.resolve();
      expect(errors).toContain("capability-core-timeout");
      expect(lane).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(2749);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(app.exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      await vi.runAllTimersAsync();
      expect(app.exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Windows query-session-end delays the OS, runs only exports then lane, and exits without confirmation", async () => {
    const { app, createWindow } = fakeApp();
    const window = fakeSessionSource();
    const calls: string[] = [];
    const deps = recordingDeps(calls);
    installQuitTeardown(app, { ...deps, systemSession: { platform: "win32", powerMonitor: () => { throw new Error("not on win32"); } } });
    createWindow(window.source);
    const preventDefault = vi.fn();
    window.emit("query-session-end", { preventDefault });
    window.emit("session-end");
    expect(preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(calls).toEqual(["active-exports", "desktop-lane-ipc"]);
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledOnce();
  });

  it("Windows session-end alone still aborts exports and closes the lane before exit", async () => {
    const { app, createWindow } = fakeApp();
    const window = fakeSessionSource();
    const calls: string[] = [];
    installQuitTeardown(app, { ...recordingDeps(calls), systemSession: { platform: "win32", powerMonitor: vi.fn() } });
    createWindow(window.source);
    window.emit("session-end");
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(calls).toEqual(["active-exports", "desktop-lane-ipc"]);
  });

  it("a drain registered critical runs on Windows session-end beside the lane, a plain one does not", async () => {
    const { app, createWindow } = fakeApp();
    const window = fakeSessionSource();
    const calls: string[] = [];
    registerQuitDrain("flush", async () => { calls.push("flush"); }, { critical: true });
    registerQuitDrain("plain", async () => { calls.push("plain"); });
    installQuitTeardown(app, { ...recordingDeps(calls), systemSession: { platform: "win32", powerMonitor: vi.fn() } });
    createWindow(window.source);
    window.emit("session-end");
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(calls).toContain("flush");
    expect(calls).not.toContain("plain");
    expect(calls).toContain("desktop-lane-ipc");
  });

  it("a critical drain that never settles is logged and does not hold the OS session past 500ms", async () => {
    vi.useFakeTimers();
    try {
      const { app, createWindow } = fakeApp();
      const window = fakeSessionSource();
      const errors: string[] = [];
      const calls: string[] = [];
      registerQuitDrain("flush", () => new Promise<void>(() => undefined), { critical: true, timeoutMs: 400 });
      installQuitTeardown(app, { ...recordingDeps(calls), onError: (stage) => errors.push(stage), systemSession: { platform: "win32", powerMonitor: vi.fn() } });
      createWindow(window.source);
      window.emit("session-end");
      await flushMicrotasks();
      expect(calls).toContain("desktop-lane-ipc");
      expect(app.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(errors).toContain("flush-timeout");
      expect(app.exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps system session end at 500ms and still runs the lane when exports throw", async () => {
    vi.useFakeTimers();
    try {
      const { app, createWindow } = fakeApp();
      const window = fakeSessionSource();
      const errors: string[] = [];
      const lane = vi.fn(() => new Promise<void>(() => undefined));
      installQuitTeardown(app, {
        disposeBackgroundLifecycle: vi.fn(),
        stopDesktopCapabilityCore: vi.fn(),
        abortAllActiveExports: vi.fn((): number => { throw new Error("ffmpeg kill failed"); }),
        disposeDesktopLaneIpc: lane,
        onError: (stage) => errors.push(stage),
        timeoutMs: 3000,
        systemSession: { platform: "win32", powerMonitor: vi.fn() },
      });
      createWindow(window.source);
      window.emit("query-session-end", { preventDefault: vi.fn() });
      await flushMicrotasks();
      expect(errors).toContain("active-exports-failed");
      expect(lane).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(499);
      await flushMicrotasks();
      expect(app.exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      await flushMicrotasks();
      expect(errors).toEqual(expect.arrayContaining(["desktop-lane-ipc-timeout", "critical-exit-timeout"]));
      expect(app.exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Linux subscribes powerMonitor shutdown only after ready and drains before exit", async () => {
    const { app } = fakeApp();
    let ready!: () => void;
    app.whenReady.mockReturnValue(new Promise<void>((resolve) => { ready = resolve; }));
    const monitor = fakeSessionSource();
    const powerMonitor = vi.fn(() => monitor.source);
    const calls: string[] = [];
    installQuitTeardown(app, { ...recordingDeps(calls), systemSession: { platform: "linux", powerMonitor } });
    expect(app.on).not.toHaveBeenCalledWith("browser-window-created", expect.any(Function));
    await flushMicrotasks();
    expect(powerMonitor).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(monitor.source.on).toHaveBeenCalledWith("shutdown", expect.any(Function)));
    const preventDefault = vi.fn();
    monitor.emit("shutdown", { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(calls).toEqual(["active-exports", "desktop-lane-ipc"]);
  });

  it("macOS keeps logout on the normal quit lifecycle and subscribes no session source", () => {
    const { app } = fakeApp();
    const powerMonitor = vi.fn();
    installQuitTeardown(app, { ...recordingDeps([]), systemSession: { platform: "darwin", powerMonitor } });
    expect(app.on.mock.calls.map(([event]) => event)).toEqual(["before-quit", "will-quit"]);
    expect(app.whenReady).not.toHaveBeenCalled();
    expect(powerMonitor).not.toHaveBeenCalled();
  });

  it("session end during a running will-quit teardown skips non-critical drains and shortens the deadline", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const calls: string[] = [];
      let releaseBackground!: () => void;
      const deps = recordingDeps(calls, {
        disposeBackgroundLifecycle: vi.fn(() => new Promise<void>((resolve) => { calls.push("background-lifecycle"); releaseBackground = resolve; })) as unknown as () => void,
        disposeDesktopLaneIpc: vi.fn(() => { calls.push("desktop-lane-ipc"); return new Promise<void>(() => undefined); }),
      });
      installQuitTeardown(app, { ...deps, timeoutMs: 3000 });
      emit("will-quit");
      await flushMicrotasks();
      exitWithoutConfirmation("session-end");
      releaseBackground();
      await flushMicrotasks();
      expect(calls).toEqual(["background-lifecycle", "active-exports", "desktop-lane-ipc"]);
      vi.advanceTimersByTime(500);
      await flushMicrotasks();
      expect(app.exit).toHaveBeenCalledWith(0);
      expect(app.exit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("session end while the lane is already draining still exits at 500ms (R-review-1125 #1)", async () => {
    vi.useFakeTimers();
    try {
      const { app, emit } = fakeApp();
      const calls: string[] = [];
      const errors: string[] = [];
      const deps = recordingDeps(calls, {
        disposeDesktopLaneIpc: vi.fn(() => { calls.push("desktop-lane-ipc"); return new Promise<void>(() => undefined); }),
      });
      installQuitTeardown(app, { ...deps, timeoutMs: 3000, onError: (stage) => errors.push(stage) });
      emit("will-quit");
      await flushMicrotasks();
      expect(calls).toEqual(["background-lifecycle", "capability-core", "active-exports", "desktop-lane-ipc"]);
      await vi.advanceTimersByTimeAsync(1000); // the lane already holds its long timer
      exitWithoutConfirmation("session-end");
      await vi.advanceTimersByTimeAsync(499);
      expect(app.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(app.exit).toHaveBeenCalledWith(0);
      expect(app.exit).toHaveBeenCalledOnce();
      expect(errors).toContain("critical-exit-timeout");
      expect(calls).toEqual(["background-lifecycle", "capability-core", "active-exports", "desktop-lane-ipc"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a completed teardown with app.exit, never a second app.quit inside will-quit (V-1125)", async () => {
    // Real Electron: when the drains settle in the microtask checkpoint of the will-quit dispatch
    // the owner prevented, Electron is still quitting and ignores app.quit(); the process stayed
    // alive with no windows. Synchronous drains settle exactly there.
    const { app, emit } = fakeApp();
    const receipts: string[] = [];
    installQuitTeardown(app, {
      ...recordingDeps([]),
      onReceipt: (event, fields) => receipts.push(`${event}:${String(fields.step ?? fields.reason)}:${String(fields.outcome ?? fields.code)}`),
    });
    emit("before-quit");
    emit("will-quit");
    await flushMicrotasks();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.quit).not.toHaveBeenCalled();
    expect(receipts).toEqual([
      "quit-step:background-lifecycle:done",
      "quit-step:capability-core:done",
      "quit-step:active-exports:done",
      "quit-step:desktop-lane-ipc:done",
      "quit-exit:completed:0",
    ]);
    // A will-quit that Electron emits again after the owner's exit is not prevented.
    expect(emit("will-quit")).not.toHaveBeenCalled();
  });

  it("an updater-style quit (windows closed before before-quit) still drains and exits once", async () => {
    // electron-updater quitAndInstall / Squirrel close windows first, then app.quit():
    // before-quit arrives with no window left, then will-quit; the owner path is the same.
    const { app, emit } = fakeApp();
    const calls: string[] = [];
    installQuitTeardown(app, recordingDeps(calls));
    emit("before-quit");
    expect(emit("will-quit")).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(calls).toEqual(["background-lifecycle", "capability-core", "active-exports", "desktop-lane-ipc"]);
    expect(app.exit).toHaveBeenCalledOnce();
  });

  it("unattended exits and quit requests require the installed owner", () => {
    expect(() => exitWithoutConfirmation("parent-process-exited")).toThrow("quit owner is not installed");
    expect(() => requestQuit()).toThrow("quit owner is not installed");
  });

  it("requestQuit with an exit code drains through will-quit and exits with that code", async () => {
    const { app, emit } = fakeApp();
    const calls: string[] = [];
    installQuitTeardown(app, recordingDeps(calls));
    app.quit.mockImplementationOnce(() => { emit("before-quit"); emit("will-quit"); });
    requestQuit({ exitCode: 1 });
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(1));
    expect(calls).toEqual(["background-lifecycle", "capability-core", "active-exports", "desktop-lane-ipc"]);
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("resumes a quit that a confirmed window close interrupted, and only then", () => {
    const { app, emit } = fakeApp();
    installQuitTeardown(app, recordingDeps([]));
    continueRequestedQuit();
    expect(app.quit).not.toHaveBeenCalled();
    emit("before-quit");
    resetQuitRequest();
    continueRequestedQuit();
    expect(app.quit).not.toHaveBeenCalled();
    emit("before-quit");
    expect(isQuitRequested()).toBe(true);
    continueRequestedQuit();
    expect(app.quit).toHaveBeenCalledOnce();
    emit("will-quit");
    continueRequestedQuit();
    expect(app.quit).toHaveBeenCalledOnce();
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
    // Every outcome ends through app.exit(0); app.quit() would be ignored inside will-quit.
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
    expect(outcome === "exit" || outcome === "quit").toBe(true);
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
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
    expect(expected === "exit" || expected === "quit").toBe(true);
  });
});
