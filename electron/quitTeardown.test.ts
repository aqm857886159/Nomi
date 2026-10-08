import { describe, expect, it, vi } from "vitest";
import { installQuitTeardown } from "./quitTeardown";
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
});
