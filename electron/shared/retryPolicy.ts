import pRetry from "p-retry";

type BackoffOptions = {
  initialDelayMs: number;
  maxDelayMs?: number;
  horizonMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  unref?: boolean;
};

type RetryOptions = BackoffOptions & {
  retries: number;
  shouldRetry?: (error: unknown) => boolean;
  /** Override the wait after a failed attempt, or return null to stop. */
  delayAfterFailure?: (error: unknown, attempt: number) => number | null;
};

/** Zero-based exponential sequence for schedulers which own the timer or must reset the sequence. */
export function exponentialBackoffMs(initialDelayMs: number, step: number, capMs = Infinity): number {
  return initialDelayMs === 0 ? 0 : Math.min(capMs, initialDelayMs * 2 ** step);
}

function waitForRetry(ms: number, { signal, sleep, unref }: BackoffOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      dispose();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const wait = sleep ? Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return sleep(ms);
    }) : new Promise<void>((done) => {
      timer = setTimeout(done, ms);
      if (unref) timer.unref?.();
    });
    void wait.then(() => { dispose(); resolve(); }, (error: unknown) => { dispose(); reject(error); });
  });
}

/** Let p-retry drive attempts; only bridge waits needing a custom clock, cancellation, or clipping. */
export function retryWithBackoff<T>(
  action: (attempt: number) => T | Promise<T>,
  options: RetryOptions,
): Promise<T> {
  return runWithBackoff(action, options, false);
}

function runWithBackoff<T>(
  action: (attempt: number) => T | Promise<T>,
  options: RetryOptions,
  finalReadAtHorizon: boolean,
): Promise<T> {
  const { signal, retries, horizonMs, initialDelayMs, maxDelayMs = Infinity, shouldRetry, delayAfterFailure } = options;
  const now = options.now ?? Date.now;
  const deadline = horizonMs === undefined ? Infinity : now() + horizonMs;
  const forever = retries === Infinity;
  const customWait = forever || signal !== undefined || options.sleep !== undefined || horizonMs !== undefined || delayAfterFailure !== undefined;
  // p-retry v4 annotates its thrown Error and has its own TypeError policy. A local marker
  // keeps the caller's classification and exact thrown value, including frozen errors.
  const retryMarker = new Error("Retry requested");
  let failure: unknown;
  return pRetry(async (attempt) => {
    try {
      signal?.throwIfAborted();
      if (attempt > 1 && !finalReadAtHorizon && deadline !== Infinity && now() >= deadline) throw failure;
      const value = await action(attempt);
      signal?.throwIfAborted();
      return value;
    } catch (error) {
      if (error instanceof pRetry.AbortError && !signal?.aborted) throw error;
      failure = error;
      throw retryMarker;
    }
  }, {
    retries: forever ? 1 : retries,
    forever,
    minTimeout: customWait ? 0 : Math.min(initialDelayMs, maxDelayMs),
    maxTimeout: customWait || initialDelayMs === 0 ? 0 : maxDelayMs,
    unref: options.unref,
    onFailedAttempt: async ({ attemptNumber }) => {
      signal?.throwIfAborted();
      if ((failure as Error | null)?.name === "AbortError" ||
          attemptNumber > retries || (shouldRetry && !shouldRetry(failure))) throw failure;
      if (!customWait) return;
      const remaining = deadline === Infinity ? Infinity : deadline - now();
      if (remaining <= 0) throw failure;
      const delay = delayAfterFailure
        ? delayAfterFailure(failure, attemptNumber)
        : exponentialBackoffMs(initialDelayMs, attemptNumber - 1, maxDelayMs);
      if (delay === null) throw failure;
      await waitForRetry(Math.min(delay, remaining), options);
      // v4 owns the next attempt and adds a minimum timer tick after the injected wait.
      signal?.throwIfAborted();
      if (!finalReadAtHorizon && deadline !== Infinity && now() >= deadline) throw failure;
    },
  });
}

/** After a positive clipped wait, preserve the final read at the observation boundary. */
export async function pollWithBackoff<T>(
  read: () => T | Promise<T>,
  shouldContinue: (value: T) => boolean,
  options: BackoffOptions & { horizonMs: number },
): Promise<T> {
  const pending = new Error("Poll is pending");
  let last: T;
  try {
    return await runWithBackoff(async () => {
      last = await read();
      if (shouldContinue(last)) throw pending;
      return last;
    }, {
      ...options,
      retries: Infinity,
      shouldRetry: (error) => error === pending && options.initialDelayMs > 0,
    }, true);
  } catch (error) {
    if (error === pending) return last!;
    throw error;
  }
}
