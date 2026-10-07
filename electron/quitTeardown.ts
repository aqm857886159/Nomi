export type QuitLifecycleEvent = { preventDefault: () => void };

export interface QuitLifecycleApp {
  on(event: "before-quit" | "will-quit", listener: (event: QuitLifecycleEvent) => void): unknown;
  quit(): void;
}

export interface QuitTeardownDependencies {
  markQuitRequested(): void;
  disposeBackgroundLifecycle(): void;
  stopDesktopCapabilityCore(): void;
  disposeDesktopLaneIpc(): Promise<void>;
  abortAllActiveExports(): number;
  onError?(stage: string, error: unknown): void;
}

/**
 * `before-quit` is only a marker. Every operation below is deliberately delayed until
 * `will-quit`, after Electron has closed all windows, so a cancellable window close cannot
 * leave a live process with its IPC and capability owners already dismantled.
 */
export function installQuitTeardown(app: QuitLifecycleApp, dependencies: QuitTeardownDependencies): void {
  let cleanupFinished = false;
  let cleanup: Promise<void> | undefined;

  app.on("before-quit", () => {
    dependencies.markQuitRequested();
  });

  app.on("will-quit", (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanup) return;
    cleanup = (async () => {
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
      cleanupFinished = true;
      app.quit();
    })();
    void cleanup;
  });
}
