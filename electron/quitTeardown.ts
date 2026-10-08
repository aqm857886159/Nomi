export type QuitLifecycleEvent = { preventDefault: () => void };
/** Electron passes an Event to session-end listeners; the typings for powerMonitor `shutdown` omit it. */
export type SystemSessionEndEvent = { preventDefault?: () => void };
export interface SystemSessionEndSource {
  on(event: string, listener: (event?: SystemSessionEndEvent) => void): unknown;
}

export interface QuitLifecycleApp {
  on(event: "before-quit" | "will-quit", listener: (event: QuitLifecycleEvent) => void): unknown;
  on(event: "browser-window-created", listener: (event: unknown, window: SystemSessionEndSource) => void): unknown;
  whenReady(): Promise<unknown>;
  quit(): void;
  exit(code?: number): void;
}

export type QuitDrainOptions = { required?: boolean; timeoutMs?: number };

type QuitDrain = {
  name: string;
  drain: () => void | Promise<void>;
  required: boolean;
  timeoutMs?: number;
};

export interface QuitTeardownDependencies {
  disposeBackgroundLifecycle(): void;
  stopDesktopCapabilityCore(): void;
  disposeDesktopLaneIpc(): Promise<void>;
  abortAllActiveExports(): number;
  onError?(stage: string, error: unknown): void;
  timeoutMs?: number;
  /**
   * Operating-system session end that bypasses before-quit / will-quit.
   * Electron 43 typings (electron.d.ts, App `before-quit`): "On Windows, this event will not be
   * emitted if the app is closed due to a shutdown/restart of the system or a user logout."
   * Windows delivers BrowserWindow `query-session-end` / `session-end`; Linux delivers
   * powerMonitor `shutdown`. macOS logout/shutdown goes through the normal quit lifecycle.
   */
  systemSession?: { platform: NodeJS.Platform; powerMonitor: () => SystemSessionEndSource };
}

const registeredDrains = new Map<string, QuitDrain>();
let quitRequested = false;
let teardownInstalled = false;
let teardownFinished = false;
let teardownStarted = false;
let ownerTimeoutMs = 3000;
let quitDeadlineAt: number | undefined;
let ownerApp: QuitLifecycleApp | undefined;
let requestedExitCode: number | undefined;
let exitWithCriticalDrains: ((reason: string) => void) | undefined;
const BUILTIN_FAST_DRAIN_TIMEOUT_CAP_MS = 250;
const BUILTIN_FAST_DRAIN_COUNT = 3;
// Nobody can answer a confirmation when the OS session ends or the dev launcher died:
// only abort exports (orphan ffmpeg) and close the Agent lane (transcript / trace), then exit.
export const CRITICAL_EXIT_TIMEOUT_MS = 500;

export function registerQuitDrain(name: string, drain: () => void | Promise<void>, options: QuitDrainOptions = {}): () => void {
  if (!name.trim()) throw new Error("quit drain name is required");
  const entry = { name, drain, required: options.required ?? true, timeoutMs: options.timeoutMs } satisfies QuitDrain;
  registeredDrains.set(name, entry);
  return () => { if (registeredDrains.get(name) === entry) registeredDrains.delete(name); };
}

export function isQuitRequested(): boolean {
  return quitRequested;
}

function requireOwner(): QuitLifecycleApp {
  if (!ownerApp) throw new Error("quit owner is not installed");
  return ownerApp;
}

/** Normal quit: Electron closes windows (close confirmation applies), then the owner drains. */
export function requestQuit(options: { exitCode?: number } = {}): void {
  const app = requireOwner();
  if (options.exitCode !== undefined) requestedExitCode = options.exitCode;
  app.quit();
}

/**
 * A prevented window `close` cancels Electron's in-flight quit. After the user confirmed the
 * close of a window that a quit was waiting on, resume that quit so the owner drains and exits.
 */
export function continueRequestedQuit(): void {
  if (ownerApp && quitRequested && !teardownStarted) ownerApp.quit();
}

/** Exit without asking anyone: bounded critical drains, then app.exit(0). */
export function exitWithoutConfirmation(reason: string): void {
  if (!exitWithCriticalDrains) throw new Error("quit owner is not installed");
  exitWithCriticalDrains(reason);
}

/** A cancellable close confirmation may undo a before-quit request. */
export function resetQuitRequest(): void {
  if (!teardownStarted) {
    quitRequested = false;
    requestedExitCode = undefined;
  }
}

export function quitTeardownTimeoutMs(): number {
  return quitDeadlineAt === undefined ? ownerTimeoutMs : Math.max(0, quitDeadlineAt - Date.now());
}

/** Vitest isolation hook; the production owner is installed exactly once. */
export function resetQuitTeardownForTests(): void {
  registeredDrains.clear();
  quitRequested = false;
  teardownInstalled = false;
  teardownFinished = false;
  teardownStarted = false;
  ownerApp = undefined;
  requestedExitCode = undefined;
  exitWithCriticalDrains = undefined;
  ownerTimeoutMs = 3000;
  quitDeadlineAt = undefined;
}

function report(onError: ((stage: string, error: unknown) => void) | undefined, stage: string, error: unknown): void {
  onError?.(stage, error);
}

async function runDrain(entry: QuitDrain, totalTimeoutMs: number, onError: ((stage: string, error: unknown) => void) | undefined): Promise<boolean> {
  const timeoutMs = Math.max(0, Math.min(entry.timeoutMs ?? totalTimeoutMs, totalTimeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  try {
    const result = await Promise.race([Promise.resolve().then(entry.drain).then(() => "done" as const), timeout]);
    if (result === "timeout") {
      report(onError, `${entry.name}-timeout`, { timeoutMs, required: entry.required });
      return true;
    }
  } catch (error) {
    report(onError, `${entry.name}-failed`, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return false;
}

/** Runs every entry in order; a timed-out step is logged and the next step still runs. */
async function runSerially(entries: readonly QuitDrain[], onError: QuitTeardownDependencies["onError"]): Promise<boolean> {
  let anyTimedOut = false;
  for (const entry of entries) {
    const timedOut = await runDrain(entry, quitTeardownTimeoutMs(), onError);
    anyTimedOut ||= timedOut;
  }
  return anyTimedOut;
}

/** The only owner allowed to subscribe to Electron's quit lifecycle and to end the GUI process. */
export function installQuitTeardown(app: QuitLifecycleApp, dependencies: QuitTeardownDependencies): void {
  if (teardownInstalled) return;
  teardownInstalled = true;
  ownerApp = app;
  ownerTimeoutMs = dependencies.timeoutMs ?? 3000;
  // The first three drains are synchronous bookkeeping and get a small cap. The lane
  // close is different: laneHost.close records the pending Agent turn before closing
  // its trace and harness, so it receives every millisecond left in the owner budget.
  // Scale the cap only for tiny test/embedded budgets so the three caps never exceed it.
  const fastTimeoutMs = Math.min(
    BUILTIN_FAST_DRAIN_TIMEOUT_CAP_MS,
    Math.max(1, Math.floor(ownerTimeoutMs / (BUILTIN_FAST_DRAIN_COUNT + 1))),
  );
  const backgroundLifecycle: QuitDrain = { name: "background-lifecycle", drain: dependencies.disposeBackgroundLifecycle, required: true, timeoutMs: fastTimeoutMs };
  const capabilityCore: QuitDrain = { name: "capability-core", drain: dependencies.stopDesktopCapabilityCore, required: true, timeoutMs: fastTimeoutMs };
  const activeExports: QuitDrain = {
    name: "active-exports",
    drain: () => {
      const aborted = dependencies.abortAllActiveExports();
      if (aborted > 0) report(dependencies.onError, "exports-aborted", { count: aborted });
    },
    required: true,
    timeoutMs: fastTimeoutMs,
  };
  // workspace.close records the pending Agent turn under .nomi/agent-sessions before
  // trace/harness close, so it takes whatever budget remains.
  const desktopLane: QuitDrain = { name: "desktop-lane-ipc", drain: dependencies.disposeDesktopLaneIpc, required: true };
  const builtInDrains = [backgroundLifecycle, capabilityCore, activeExports, desktopLane];
  const criticalDrains = [activeExports, desktopLane];

  app.on("before-quit", () => {
    quitRequested = true;
  });

  app.on("will-quit", (event) => {
    if (teardownFinished) return;
    event.preventDefault();
    if (teardownStarted) return;
    teardownStarted = true;
    quitRequested = true;
    quitDeadlineAt = Date.now() + ownerTimeoutMs;
    const required = [...registeredDrains.values()].filter((entry) => entry.required);
    const optional = [...registeredDrains.values()].filter((entry) => !entry.required);
    const runInOrder = async (): Promise<boolean> => {
      const timedOut = await runSerially([...builtInDrains, ...required], dependencies.onError);
      for (const entry of optional) void runDrain(entry, quitTeardownTimeoutMs(), dependencies.onError);
      return !timedOut;
    };
    void runInOrder().then((completed) => {
      teardownFinished = true;
      if (!completed) {
        report(dependencies.onError, "quit-timeout", { timeoutMs: ownerTimeoutMs });
        app.exit(requestedExitCode ?? 0);
        return;
      }
      if (requestedExitCode !== undefined) app.exit(requestedExitCode);
      else app.quit();
    });
  });

  exitWithCriticalDrains = (reason) => {
    if (teardownFinished) return;
    const budgetMs = Math.min(ownerTimeoutMs, CRITICAL_EXIT_TIMEOUT_MS);
    quitDeadlineAt = Math.min(quitDeadlineAt ?? Number.POSITIVE_INFINITY, Date.now() + budgetMs);
    // A will-quit teardown already running keeps going on the shortened deadline.
    if (teardownStarted) return;
    teardownStarted = true;
    quitRequested = true;
    void runSerially(criticalDrains, dependencies.onError).then((timedOut) => {
      teardownFinished = true;
      if (timedOut) report(dependencies.onError, "critical-exit-timeout", { reason, timeoutMs: budgetMs });
      app.exit(0);
    });
  };

  const session = dependencies.systemSession;
  if (session?.platform === "win32") {
    app.on("browser-window-created", (_event, window) => {
      // preventDefault keeps Windows waiting (it shows its "app is preventing shutdown" screen)
      // until the critical drains finish and the process exits.
      window.on("query-session-end", (event) => {
        if (!teardownFinished) event?.preventDefault?.();
        exitWithoutConfirmation("query-session-end");
      });
      window.on("session-end", () => { exitWithoutConfirmation("session-end"); });
    });
  } else if (session?.platform === "linux") {
    void app.whenReady().then(() => {
      session.powerMonitor().on("shutdown", (event) => {
        if (!teardownFinished) event?.preventDefault?.();
        exitWithoutConfirmation("shutdown");
      });
    });
  }
}
