// Real path: OS session-end -> quitTeardown owner -> renderer flush request -> the real renderer
// persistence queue -> the real main project store on disk. Only Electron's event source and the
// IPC wire are faked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() } }));
const bridge = vi.hoisted(() => ({ current: null as null | { window: { onProjectFlushRequest: (cb: () => Promise<void>) => () => void } } }));
vi.mock("../src/desktop/bridge", async (importOriginal) => ({ ...(await importOriginal<object>()), getDesktopBridge: () => bridge.current }));

import { installQuitTeardown, resetQuitTeardownForTests } from "./quitTeardown";
import { createProject, readProject, saveProject } from "./projects/repository";
import { installShutdownProjectFlush, SHUTDOWN_FLUSH_REQUEST_CHANNEL, SHUTDOWN_FLUSH_RESPONSE_CHANNEL } from "./shutdownProjectFlush";
import { subscribeWorkbenchProjectPersistence } from "../src/workbench/project/workbenchProjectSession";
import { bindShutdownProjectFlush } from "../src/workbench/project/useProjectWindowLifecycle";
import { useWorkbenchStore } from "../src/workbench/workbenchStore";

type SessionListener = (event?: { preventDefault?: () => void }) => void;

function harness(options: { renderer: "answers" | "silent" }) {
  const appListeners = new Map<string, (...args: never[]) => void>();
  const app = {
    on: vi.fn((event: string, listener: (...args: never[]) => void) => { appListeners.set(event, listener); return app; }),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
    exit: vi.fn(),
  };
  const sessionListeners = new Map<string, SessionListener>();
  const osWindow = { on: vi.fn((event: string, listener: SessionListener) => { sessionListeners.set(event, listener); return osWindow; }) };
  const responseListeners: Array<(payload: unknown) => void> = [];
  let rendererHandler: (() => Promise<void>) | undefined;
  bridge.current = { window: { onProjectFlushRequest: (cb) => { rendererHandler = cb; return () => { rendererHandler = undefined; }; } } };
  // The preload wiring: run the renderer handler, answer on the response channel.
  const webContents = {
    send: vi.fn((channel: string, payload: { requestId: string }) => {
      expect(channel).toBe(SHUTDOWN_FLUSH_REQUEST_CHANNEL);
      if (options.renderer === "silent") return;
      void (async () => {
        let ok = true;
        try { await rendererHandler?.(); } catch { ok = false; }
        responseListeners.forEach((listener) => listener({ requestId: payload.requestId, ok }));
        expect(SHUTDOWN_FLUSH_RESPONSE_CHANNEL).toBeTruthy();
      })();
    }),
  };
  const errors: string[] = [];
  const onError = (stage: string) => { errors.push(stage); };
  installQuitTeardown(app, {
    disposeBackgroundLifecycle: vi.fn(),
    stopDesktopCapabilityCore: vi.fn(),
    disposeDesktopLaneIpc: vi.fn(async () => undefined),
    abortAllActiveExports: vi.fn(() => 0),
    onError,
    systemSession: { platform: "win32", powerMonitor: vi.fn() },
  });
  installShutdownProjectFlush({ windows: () => [webContents], onResponse: (listener) => { responseListeners.push(listener); }, onError });
  (appListeners.get("browser-window-created") as unknown as (event: unknown, window: unknown) => void)({}, osWindow);
  return { app, errors, webContents, sessionEnd: () => sessionListeners.get("session-end")?.() };
}

describe("OS session end silently saves the project", () => {
  let projectsRoot = "";
  let settingsRoot = "";
  let prev: Array<string | undefined> = [];
  let projectId = "";
  let saveSpy: ReturnType<typeof vi.fn>;
  let dispose: () => Promise<void>;

  beforeEach(() => {
    Object.assign(globalThis, { window: { addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    resetQuitTeardownForTests();
    prev = [process.env.NOMI_PROJECTS_DIR, process.env.NOMI_SETTINGS_DIR];
    projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-shutdown-proj-"));
    settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-shutdown-set-"));
    process.env.NOMI_PROJECTS_DIR = projectsRoot;
    process.env.NOMI_SETTINGS_DIR = settingsRoot;
    projectId = createProject({ name: "shutdown-save" }).id;
    saveSpy = vi.fn(async (id: string, payload: unknown) => saveProject(id, { ...readProject(id)!, payload }) as never);
    dispose = subscribeWorkbenchProjectPersistence({
      projectId, isHydrating: () => false, canPersist: () => true,
      saveProject: saveSpy as never, onSaved: vi.fn(),
    });
  });
  afterEach(async () => {
    await dispose().catch(() => undefined);
    bridge.current = null;
    if (prev[0] === undefined) delete process.env.NOMI_PROJECTS_DIR; else process.env.NOMI_PROJECTS_DIR = prev[0];
    if (prev[1] === undefined) delete process.env.NOMI_SETTINGS_DIR; else process.env.NOMI_SETTINGS_DIR = prev[1];
    fs.rmSync(projectsRoot, { recursive: true, force: true });
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  });

  const savedCategoryNames = (): string[] => ((readProject(projectId)?.payload as { categories?: Array<{ name: string }> } | undefined)?.categories ?? []).map((c) => c.name);

  it("writes the unsaved edit into the project file before the process exits", async () => {
    const run = harness({ renderer: "answers" });
    bindShutdownProjectFlush();
    useWorkbenchStore.getState().addCategory("关机前的新分组"); // debounced: not on disk yet
    expect(savedCategoryNames()).not.toContain("关机前的新分组");

    run.sessionEnd();
    await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
    expect(savedCategoryNames()).toContain("关机前的新分组");
    expect(run.errors).toEqual([]);
  });

  it("lets the shutdown go within the budget and logs it when the renderer never answers", async () => {
    const run = harness({ renderer: "silent" });
    useWorkbenchStore.getState().addCategory("没人回执的分组");
    const startedAt = Date.now();
    run.sessionEnd();
    await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0), { timeout: 1500 });
    expect(Date.now() - startedAt).toBeLessThan(800);
    expect(run.errors).toContain("renderer-project-flush-timeout");
  });

  it("does not touch the disk when nothing changed since the last save", async () => {
    const run = harness({ renderer: "answers" });
    bindShutdownProjectFlush();
    run.sessionEnd();
    await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
    expect(run.webContents.send).toHaveBeenCalledOnce();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("reports a failed save (read-only or full disk) and still lets the shutdown go", async () => {
    saveSpy.mockRejectedValueOnce(new Error("ENOSPC"));
    const run = harness({ renderer: "answers" });
    bindShutdownProjectFlush();
    useWorkbenchStore.getState().addCategory("磁盘满的分组");
    run.sessionEnd();
    await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
    expect(run.errors).toContain("renderer-project-flush-failed");
  });
});
