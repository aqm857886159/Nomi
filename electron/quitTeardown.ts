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

export type QuitReceiptEvent = "quit-step" | "quit-exit";
export type QuitDrainOptions = {
  required?: boolean;
  timeoutMs?: number;
  /**
   * Also runs when the OS ends the session (Windows session-end, Linux shutdown), where nobody can confirm
   * anything and the whole budget is `CRITICAL_EXIT_TIMEOUT_MS`. It runs beside the built-in critical
   * chain, so it neither delays nor is delayed by the Agent lane close.
   */
  critical?: boolean;
};

type QuitDrain = {
  name: string;
  drain: () => void | Promise<void>;
  required: boolean;
  timeoutMs?: number;
  critical: boolean;
};

export interface QuitTeardownDependencies {
  disposeBackgroundLifecycle(): void;
  stopDesktopCapabilityCore(): void;
  disposeDesktopLaneIpc(): Promise<void>;
  abortAllActiveExports(): number;
  onError?(stage: string, error: unknown): void;
  /** Receipts: one `quit-step` per built-in / registered drain, one `quit-exit` when the owner ends the process. */
  onReceipt?(event: QuitReceiptEvent, fields: Record<string, string | number>): void;
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
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
// Set once an unattended exit (session end, lost launcher) arrives: drains that have not started
// yet and are not critical are skipped so the shortened deadline is spent on exports and the lane.
let criticalOnly = false;
const BUILTIN_FAST_DRAIN_TIMEOUT_CAP_MS = 250;
const BUILTIN_FAST_DRAIN_COUNT = 3;
// Nobody can answer a confirmation when the OS session ends or the dev launcher died:
// only abort exports (orphan ffmpeg) and close the Agent lane (transcript / trace), then exit.
export const CRITICAL_EXIT_TIMEOUT_MS = 500;

export function registerQuitDrain(name: string, drain: () => void | Promise<void>, options: QuitDrainOptions = {}): () => void {
  if (!name.trim()) throw new Error("quit drain name is required");
  const entry = { name, drain, required: options.required ?? true, timeoutMs: options.timeoutMs, critical: options.critical ?? false } satisfies QuitDrain;
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
  if (deadlineTimer) clearTimeout(deadlineTimer);
  deadlineTimer = undefined;
  criticalOnly = false;
}

function report(onError: ((stage: string, error: unknown) => void) | undefined, stage: string, error: unknown): void {
  onError?.(stage, error);
}

type DrainOutcome = "done" | "timeout" | "failed";
type Receipt = QuitTeardownDependencies["onReceipt"];

async function runDrain(entry: QuitDrain, totalTimeoutMs: number, onError: QuitTeardownDependencies["onError"], onReceipt: Receipt): Promise<boolean> {
  const timeoutMs = Math.max(0, Math.min(entry.timeoutMs ?? totalTimeoutMs, totalTimeoutMs));
  const startedAt = Date.now();
  let outcome: DrainOutcome = "done";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  try {
    const result = await Promise.race([Promise.resolve().then(entry.drain).then(() => "done" as const), timeout]);
    if (result === "timeout") {
      outcome = "timeout";
      report(onError, `${entry.name}-timeout`, { timeoutMs, required: entry.required });
    }
  } catch (error) {
    outcome = "failed";
    report(onError, `${entry.name}-failed`, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
  onReceipt?.("quit-step", { step: entry.name, outcome, ms: Date.now() - startedAt });
  return outcome === "timeout";
}

/** Runs every entry in order; a timed-out step is logged and the next step still runs. */
async function runSerially(
  entries: readonly QuitDrain[],
  critical: ReadonlySet<QuitDrain>,
  onError: QuitTeardownDependencies["onError"],
  onReceipt: Receipt,
): Promise<boolean> {
  let anyTimedOut = false;
  for (const entry of entries) {
    if (teardownFinished) break;
    if (criticalOnly && !critical.has(entry)) {
      onReceipt?.("quit-step", { step: entry.name, outcome: "skipped", ms: 0 });
      continue;
    }
    const timedOut = await runDrain(entry, quitTeardownTimeoutMs(), onError, onReceipt);
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
  const backgroundLifecycle: QuitDrain = { name: "background-lifecycle", drain: dependencies.disposeBackgroundLifecycle, required: true, timeoutMs: fastTimeoutMs, critical: false };
  const capabilityCore: QuitDrain = { name: "capability-core", drain: dependencies.stopDesktopCapabilityCore, required: true, timeoutMs: fastTimeoutMs, critical: false };
  const activeExports: QuitDrain = {
    name: "active-exports",
    drain: () => {
      const aborted = dependencies.abortAllActiveExports();
      if (aborted > 0) report(dependencies.onError, "exports-aborted", { count: aborted });
    },
    required: true,
    timeoutMs: fastTimeoutMs,
    critical: false,
  };
  // workspace.close records the pending Agent turn under .nomi/agent-sessions before
  // trace/harness close, so it takes whatever budget remains.
  const desktopLane: QuitDrain = { name: "desktop-lane-ipc", drain: dependencies.disposeDesktopLaneIpc, required: true, critical: false };
  const builtInDrains = [backgroundLifecycle, capabilityCore, activeExports, desktopLane];
  const criticalDrains = [activeExports, desktopLane];

  const critical = new Set(criticalDrains);
  const onReceipt = dependencies.onReceipt;
  let teardownStartedAt = 0;

  // The one place the GUI process ends. Always app.exit, never a second app.quit(): when the drains
  // settle in the microtask checkpoint of the will-quit dispatch that prevented the quit, Electron is
  // still "quitting" and silently ignores app.quit(), so the process stayed alive (V-1125).
  // app.exit still emits `quit`; before-quit / will-quit already ran and windows are already closed.
  const finish = (reason: string, code: number): void => {
    if (teardownFinished) return;
    teardownFinished = true;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    deadlineTimer = undefined;
    onReceipt?.("quit-exit", { reason, code, ms: Date.now() - teardownStartedAt });
    app.exit(code);
  };

  // One owner deadline. It is re-armed (never extended) when an unattended exit shortens it, so a
  // drain that is already running cannot hold the process past the shorter deadline.
  const armDeadline = (at: number, onDeadline: () => void): void => {
    if (quitDeadlineAt !== undefined && quitDeadlineAt <= at && deadlineTimer) return;
    quitDeadlineAt = at;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(onDeadline, Math.max(0, at - Date.now()));
  };

  app.on("before-quit", () => {
    quitRequested = true;
  });

  app.on("will-quit", (event) => {
    if (teardownFinished) return;
    event.preventDefault();
    if (teardownStarted) return;
    teardownStarted = true;
    quitRequested = true;
    teardownStartedAt = Date.now();
    armDeadline(teardownStartedAt + ownerTimeoutMs, () => {
      report(dependencies.onError, "quit-timeout", { timeoutMs: ownerTimeoutMs });
      finish("deadline", requestedExitCode ?? 0);
    });
    const registered = [...registeredDrains.values()];
    for (const entry of registered) if (entry.critical) critical.add(entry);
    // Optional drains are best effort: they run beside the serial chain and never delay the exit.
    for (const entry of registered.filter((drain) => !drain.required)) {
      void runDrain(entry, quitTeardownTimeoutMs(), dependencies.onError, onReceipt);
    }
    void runSerially([...builtInDrains, ...registered.filter((drain) => drain.required)], critical, dependencies.onError, onReceipt)
      .then((timedOut) => {
        if (teardownFinished) return; // the deadline already ended the process
        if (timedOut) report(dependencies.onError, "quit-timeout", { timeoutMs: ownerTimeoutMs });
        finish(timedOut ? "step-timeout" : "completed", requestedExitCode ?? 0);
      });
  });

  exitWithCriticalDrains = (reason) => {
    if (teardownFinished) return;
    const budgetMs = Math.min(ownerTimeoutMs, CRITICAL_EXIT_TIMEOUT_MS);
    criticalOnly = true;
    const onDeadline = (): void => {
      report(dependencies.onError, "critical-exit-timeout", { reason, timeoutMs: budgetMs });
      finish(`${reason}-deadline`, 0);
    };
    // A will-quit teardown already running keeps going, but only through the critical drains and
    // on the shortened deadline (the timer is re-armed, not just the remaining-budget variable).
    armDeadline(Date.now() + budgetMs, onDeadline);
    if (teardownStarted) return;
    teardownStarted = true;
    quitRequested = true;
    teardownStartedAt = Date.now();
    const registeredCritical = [...registeredDrains.values()].filter((entry) => entry.critical);
    const beside = registeredCritical.map((entry) => runDrain(entry, quitTeardownTimeoutMs(), dependencies.onError, onReceipt));
    void Promise.all([runSerially(criticalDrains, critical, dependencies.onError, onReceipt), ...beside]).then((outcomes) => {
      const timedOut = outcomes.some(Boolean);
      if (teardownFinished) return;
      if (timedOut) report(dependencies.onError, "critical-exit-timeout", { reason, timeoutMs: budgetMs });
      finish(reason, 0);
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
      // Electron 43 types this listener as `() => void`, but its docs (same d.ts entry) say
      // `e.preventDefault()` delays shutdown, and lib/browser/api/power-monitor.ts takes a logind
      // shutdown-delay lock (setListeningForShutdown) only so that preventDefault can work. The
      // native emitter passes the event as the first argument. Real Linux shutdown: unverified.
      session.powerMonitor().on("shutdown", (event) => {
        if (!teardownFinished) event?.preventDefault?.();
        exitWithoutConfirmation("shutdown");
      });
    });
  }
}
