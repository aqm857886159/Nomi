export type QuitLifecycleEvent = { preventDefault: () => void };

export interface QuitLifecycleApp {
  on(event: "before-quit" | "will-quit", listener: (event: QuitLifecycleEvent) => void): unknown;
  quit(): void;
  exit?(code?: number): void;
}

export interface QuitTeardownDependencies {
  disposeBackgroundLifecycle(): void;
  stopDesktopCapabilityCore(): void;
  disposeDesktopLaneIpc(): Promise<void>;
  abortAllActiveExports(): number;
  onError?(stage: string, error: unknown): void;
  timeoutMs?: number;
}

/**
 * `before-quit` is only a marker. Every operation below is deliberately delayed until
 * `will-quit`, after Electron has closed all windows, so a cancellable window close cannot
 * leave a live process with its IPC and capability owners already dismantled.
 */
export function installQuitTeardown(app: QuitLifecycleApp, dependencies: QuitTeardownDependencies): void {
  let cleanupFinished = false;
  let cleanup: Promise<void> | undefined;
  const timeoutMs = dependencies.timeoutMs ?? 3000;

  app.on("will-quit", (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanup) return;
    const teardown = (async () => {
      try {
        dependencies.disposeBackgroundLifecycle();
      } catch (error) {
        dependencies.onError?.("background-lifecycle", error);
      }
      try {
        dependencies.stopDesktopCapabilityCore();
      } catch (error) {
        dependencies.onError?.("capability-core", error);
      }
      try {
        const aborted = dependencies.abortAllActiveExports();
        if (aborted > 0) dependencies.onError?.("exports-aborted", { count: aborted });
      } catch (error) {
        dependencies.onError?.("exports", error);
      }
      try {
        await dependencies.disposeDesktopLaneIpc();
      } catch (error) {
        dependencies.onError?.("agent-lane", error);
      }
    })();
    cleanup = teardown;
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      const result = await Promise.race([teardown.then(() => "done" as const), timeout]);
      if (timer) clearTimeout(timer);
      cleanupFinished = true;
      if (result === "timeout") {
        dependencies.onError?.("quit-timeout", { timeoutMs });
        app.exit?.(0);
      } else {
        const forceExit = setTimeout(() => {
          dependencies.onError?.("quit-timeout", { timeoutMs });
          app.exit?.(0);
        }, timeoutMs);
        forceExit.unref?.();
        app.quit();
      }
    })();
  });
}
