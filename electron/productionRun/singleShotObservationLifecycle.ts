/**
 * Owns the in-process lifetime of single-shot observers.
 *
 * ProductionRun remains the durable authority; this module only prevents an
 * old capability-core instance from continuing to query a provider or project
 * a result after shutdown/restart.  `stop()` advances an epoch and aborts every
 * active worker.  A worker must still check the supplied guard before any
 * side-effect (the observer does this at each provider/renderer boundary).
 */

export type SingleShotObservationWorkerContext = {
  signal: AbortSignal;
  epoch: number;
  isCurrent: () => boolean;
};

export type SingleShotObservationWorker = (
  context: SingleShotObservationWorkerContext,
) => void | Promise<void>;

type ActiveObservation = {
  epoch: number;
  controller: AbortController;
};

export function createSingleShotObservationLifecycle() {
  let epoch = 0;
  const active = new Map<string, ActiveObservation>();

  const isCurrent = (candidateEpoch: number): boolean => candidateEpoch === epoch;

  const run = async (key: string, worker: SingleShotObservationWorker): Promise<boolean> => {
    const existing = active.get(key);
    if (existing) return false;
    const controller = new AbortController();
    const workerEpoch = epoch;
    const state: ActiveObservation = { epoch: workerEpoch, controller };
    active.set(key, state);
    try {
      await worker({
        signal: controller.signal,
        epoch: workerEpoch,
        isCurrent: () => !controller.signal.aborted && isCurrent(workerEpoch),
      });
      return true;
    } finally {
      // A stopped worker may finish after a fresh worker for the same key has
      // started.  Never let the stale finally block remove that fresh entry.
      if (active.get(key) === state) active.delete(key);
    }
  };

  const stop = (): void => {
    epoch += 1;
    for (const observation of active.values()) observation.controller.abort();
    active.clear();
  };

  return {
    run,
    stop,
    isCurrent,
    currentEpoch: () => epoch,
    activeKeys: () => [...active.keys()],
  };
}

export type SingleShotObservationLifecycle = ReturnType<typeof createSingleShotObservationLifecycle>;
