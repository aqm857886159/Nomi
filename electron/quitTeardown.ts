export type QuitLifecycleEvent = { preventDefault: () => void };

export interface QuitLifecycleApp {
  on(event: "before-quit" | "will-quit", listener: (event: QuitLifecycleEvent) => void): unknown;
  quit(): void;
  exit?(code?: number): void;
}

export type QuitDrainOptions = { required?: boolean; timeoutMs?: number };

type QuitDrain = {
  name: string;
  drain: () => void | Promise<void>;
  required: boolean;
  timeoutMs?: number;
  critical?: boolean;
};

export interface QuitTeardownDependencies {
  disposeBackgroundLifecycle(): void;
  stopDesktopCapabilityCore(): void;
  disposeDesktopLaneIpc(): Promise<void>;
  abortAllActiveExports(): number;
  onError?(stage: string, error: unknown): void;
  timeoutMs?: number;
}

const registeredDrains = new Map<string, QuitDrain>();
let quitRequested = false;
let teardownInstalled = false;
let teardownFinished = false;
let teardownStarted = false;
let ownerTimeoutMs = 3000;
let quitDeadlineAt: number | undefined;

export function registerQuitDrain(name: string, drain: () => void | Promise<void>, options: QuitDrainOptions = {}): () => void {
  if (!name.trim()) throw new Error("quit drain name is required");
  const entry = { name, drain, required: options.required ?? true, timeoutMs: options.timeoutMs } satisfies QuitDrain;
  registeredDrains.set(name, entry);
  return () => { if (registeredDrains.get(name) === entry) registeredDrains.delete(name); };
}

export function isQuitRequested(): boolean {
  return quitRequested;
}

/** A cancellable close confirmation may undo a before-quit request. */
export function resetQuitRequest(): void {
  if (!teardownStarted) {
    quitRequested = false;
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

/** The only owner allowed to subscribe to Electron's quit lifecycle. */
export function installQuitTeardown(app: QuitLifecycleApp, dependencies: QuitTeardownDependencies): void {
  if (teardownInstalled) return;
  teardownInstalled = true;
  ownerTimeoutMs = dependencies.timeoutMs ?? 3000;

  app.on("before-quit", () => {
    if (quitRequested) return;
    quitRequested = true;
  });

  const builtInDrains: QuitDrain[] = [
    { name: "background-lifecycle", drain: dependencies.disposeBackgroundLifecycle, required: true },
    { name: "capability-core", drain: dependencies.stopDesktopCapabilityCore, required: true },
    {
      name: "active-exports",
      drain: () => {
        const aborted = dependencies.abortAllActiveExports();
        if (aborted > 0) report(dependencies.onError, "exports-aborted", { count: aborted });
      },
      required: true,
      critical: true,
    },
    { name: "desktop-lane-ipc", drain: dependencies.disposeDesktopLaneIpc, required: true },
  ];
  const builtInStepTimeoutMs = Math.max(1, Math.floor(ownerTimeoutMs / builtInDrains.length));

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
      let anyTimedOut = false;
      for (const entry of builtInDrains) {
        const timedOut = await runDrain(
          { ...entry, timeoutMs: builtInStepTimeoutMs },
          quitTeardownTimeoutMs(),
          dependencies.onError,
        );
        anyTimedOut ||= timedOut;
      }
      for (const entry of required) {
        const timedOut = await runDrain(entry, quitTeardownTimeoutMs(), dependencies.onError);
        anyTimedOut ||= timedOut;
      }
      for (const entry of optional) void runDrain(entry, quitTeardownTimeoutMs(), dependencies.onError);
      return !anyTimedOut;
    };
    void runInOrder().then((completed) => {
      teardownFinished = true;
      if (!completed) {
        report(dependencies.onError, "quit-timeout", { timeoutMs: ownerTimeoutMs });
        app.exit?.(0);
        return;
      }
      app.quit();
    });
  });
}
