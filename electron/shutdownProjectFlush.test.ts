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

import { installQuitTeardown, requestQuit, resetQuitTeardownForTests } from "./quitTeardown";
import { createProject, readProject, saveProject } from "./projects/repository";
import { installShutdownProjectFlush, SHUTDOWN_FLUSH_REQUEST_CHANNEL, SHUTDOWN_FLUSH_RESPONSE_CHANNEL } from "./shutdownProjectFlush";
import { subscribeWorkbenchProjectPersistence } from "../src/workbench/project/workbenchProjectSession";
import { bindShutdownProjectFlush } from "../src/workbench/project/useProjectWindowLifecycle";
import { useWorkbenchStore } from "../src/workbench/workbenchStore";

type SessionListener = (event?: { preventDefault?: () => void }) => void;

function harness(options: { renderer?: "answers" | "silent"; windows?: Array<"answers" | "silent">; platform?: NodeJS.Platform }) {
  const kinds = options.windows ?? [options.renderer ?? "answers"];
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
  const windows = kinds.map((kind) => ({
    send: vi.fn((channel: string, payload: { requestId: string }) => {
      expect(channel).toBe(SHUTDOWN_FLUSH_REQUEST_CHANNEL);
      if (kind === "silent") return;
      void (async () => {
        let ok = true;
        try { await rendererHandler?.(); } catch { ok = false; }
        responseListeners.forEach((listener) => listener({ requestId: payload.requestId, ok }));
        expect(SHUTDOWN_FLUSH_RESPONSE_CHANNEL).toBeTruthy();
      })();
    }),
  }));
  const webContents = windows[0]!;
  const errors: string[] = [];
  const onError = (stage: string) => { errors.push(stage); };
  installQuitTeardown(app, {
    disposeBackgroundLifecycle: vi.fn(),
    stopDesktopCapabilityCore: vi.fn(),
    disposeDesktopLaneIpc: vi.fn(async () => undefined),
    abortAllActiveExports: vi.fn(() => 0),
    onError,
    systemSession: { platform: options.platform ?? "win32", powerMonitor: () => ({ on: vi.fn() }) },
  });
  installShutdownProjectFlush({ windows: () => windows, onResponse: (listener) => { responseListeners.push(listener); }, onError });
  (appListeners.get("browser-window-created") as unknown as ((event: unknown, window: unknown) => void) | undefined)?.({}, osWindow);
  const emitApp = (event: "before-quit" | "will-quit") => (appListeners.get(event) as unknown as (e: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
  return { app, errors, webContents, windows, emitApp, sessionEnd: () => sessionListeners.get("session-end")?.() };
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

  it("waits for the save already in flight, then writes the newest edit once, losing nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    saveSpy.mockImplementationOnce(async (id: string, payload: unknown) => {
      await gate;
      return saveProject(id, { ...readProject(id)!, payload }) as never;
    });
    const run = harness({ renderer: "answers" });
    bindShutdownProjectFlush();
    useWorkbenchStore.getState().addCategory("在途那次的分组");
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1), { timeout: 2000 }); // debounce fired, write blocked
    useWorkbenchStore.getState().addCategory("存盘途中新改的分组");

    run.sessionEnd();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(run.app.exit).not.toHaveBeenCalled(); // receipt waits for the in-flight write
    release();
    await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
    expect(savedCategoryNames()).toEqual(expect.arrayContaining(["在途那次的分组", "存盘途中新改的分组"]));
    expect(saveSpy).toHaveBeenCalledTimes(2); // the in-flight one + exactly one catch-up write
    expect(run.errors).toEqual([]);
  });

  it("saves every window's project when two windows both answer, writing each once", async () => {
    const secondId = createProject({ name: "shutdown-save-2" }).id;
    const secondSave = vi.fn(async (id: string, payload: unknown) => saveProject(id, { ...readProject(id)!, payload }) as never);
    const disposeSecond = subscribeWorkbenchProjectPersistence({
      projectId: secondId, isHydrating: () => false, canPersist: () => true, saveProject: secondSave as never, onSaved: vi.fn(),
    });
    try {
      const run = harness({ windows: ["answers", "answers"] });
      bindShutdownProjectFlush();
      useWorkbenchStore.getState().addCategory("两个窗口的新分组");
      run.sessionEnd();
      await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
      const names = (id: string) => ((readProject(id)?.payload as { categories?: Array<{ name: string }> } | undefined)?.categories ?? []).map((c) => c.name);
      expect(names(projectId)).toContain("两个窗口的新分组");
      expect(names(secondId)).toContain("两个窗口的新分组");
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(secondSave).toHaveBeenCalledTimes(1);
      expect(run.windows.every((w) => w.send.mock.calls.length === 1)).toBe(true);
      expect(run.errors).toEqual([]);
    } finally {
      await disposeSecond().catch(() => undefined);
    }
  });

  it("one silent window does not hold back the other window's save, and the whole thing stays in budget", async () => {
    const run = harness({ windows: ["silent", "answers"] });
    bindShutdownProjectFlush();
    useWorkbenchStore.getState().addCategory("另一个窗口没回执的分组");
    const startedAt = Date.now();
    run.sessionEnd();
    await vi.waitFor(() => expect(savedCategoryNames()).toContain("另一个窗口没回执的分组"), { timeout: 300 });
    await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0), { timeout: 1500 });
    expect(Date.now() - startedAt).toBeLessThan(800);
    expect(run.errors).toContain("renderer-project-flush-timeout");
  });

  it("a flush held up by an in-flight write still catches an edit made after the flush began", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    saveSpy.mockImplementationOnce(async (id: string, payload: unknown) => {
      await gate;
      return saveProject(id, { ...readProject(id)!, payload }) as never;
    });
    const run = harness({ renderer: "answers" });
    bindShutdownProjectFlush();
    useWorkbenchStore.getState().addCategory("首笔卡住的分组");
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1), { timeout: 2000 });

    run.sessionEnd(); // flush starts and waits on the blocked first write
    await vi.waitFor(() => expect(run.webContents.send).toHaveBeenCalledTimes(1));
    useWorkbenchStore.getState().addCategory("flush 开始后才产生的分组"); // re-arms saveScheduled
    expect(run.app.exit).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
    expect(savedCategoryNames()).toEqual(expect.arrayContaining(["首笔卡住的分组", "flush 开始后才产生的分组"]));
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });

  describe("normal quits never ask the renderer to flush", () => {
    it.each(["win32", "darwin", "linux"] as const)("plain will-quit on %s", async (platform) => {
      const run = harness({ renderer: "answers", platform });
      bindShutdownProjectFlush();
      useWorkbenchStore.getState().addCategory("普通退出前的分组");
      run.emitApp("before-quit");
      run.emitApp("will-quit");
      await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
      expect(run.windows.every((w) => w.send.mock.calls.length === 0)).toBe(true);
    });

    it("app.quit() requested by the app, then the close confirmation, then will-quit", async () => {
      const run = harness({ renderer: "answers", platform: "darwin" });
      bindShutdownProjectFlush();
      requestQuit(); // what a confirmed close resumes with
      expect(run.app.quit).toHaveBeenCalled();
      run.emitApp("before-quit");
      run.emitApp("will-quit");
      await vi.waitFor(() => expect(run.app.exit).toHaveBeenCalledWith(0));
      expect(run.windows.every((w) => w.send.mock.calls.length === 0)).toBe(true);
    });
  });
});
