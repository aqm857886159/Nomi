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
  if (!teardownStarted) quitRequested = false;
}

export function quitTeardownTimeoutMs(): number {
  return ownerTimeoutMs;
}

/** Vitest isolation hook; the production owner is installed exactly once. */
export function resetQuitTeardownForTests(): void {
  registeredDrains.clear();
  quitRequested = false;
  teardownInstalled = false;
  teardownFinished = false;
  teardownStarted = false;
  ownerTimeoutMs = 3000;
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

  app.on("before-quit", () => { quitRequested = true; });

  registerQuitDrain("background-lifecycle", dependencies.disposeBackgroundLifecycle, { required: true });
  registerQuitDrain("capability-core", dependencies.stopDesktopCapabilityCore, { required: true });
  registerQuitDrain("active-exports", () => {
    const aborted = dependencies.abortAllActiveExports();
    if (aborted > 0) report(dependencies.onError, "exports-aborted", { count: aborted });
  }, { required: true });
  registerQuitDrain("desktop-lane-ipc", dependencies.disposeDesktopLaneIpc, { required: true });

  app.on("will-quit", (event) => {
    if (teardownFinished) return;
    event.preventDefault();
    if (teardownStarted) return;
    teardownStarted = true;
    const required = [...registeredDrains.values()].filter((entry) => entry.required);
    const optional = [...registeredDrains.values()].filter((entry) => !entry.required);
    for (const entry of optional) void runDrain(entry, ownerTimeoutMs, dependencies.onError);
    const requiredWork = Promise.all(required.map((entry) => runDrain(entry, ownerTimeoutMs, dependencies.onError)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const totalTimeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ownerTimeoutMs); });
    void Promise.race([requiredWork.then((timedOut) => timedOut.some(Boolean) ? "required-timeout" as const : "done" as const), totalTimeout]).then((result) => {
      if (timer) clearTimeout(timer);
      teardownFinished = true;
      if (result === "timeout" || result === "required-timeout") {
        report(dependencies.onError, "quit-timeout", { timeoutMs: ownerTimeoutMs });
        app.exit?.(0);
        return;
      }
      app.quit();
    });
  });
}
