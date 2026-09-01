import type {
  GenerationSubmissionMaterializeResult,
  GenerationSubmissionPollResult,
  GenerationSubmissionStartInput,
  ProductionGenerationSubmission,
} from "./productionGenerationSubmission";

/**
 * The single-shot submission seam intentionally stops at `nextAction: observe`
 * after the provider accepts a task.  This observer owns only the follow-up
 * read path: query the existing provider task, materialize exactly one output
 * when it settles, and notify the domain owner to project the durable result.
 * It never calls `start`, so observing/restarting can never create a second
 * provider job or charge.
 */
export type SingleShotGenerationObserverInput = {
  submission: Pick<ProductionGenerationSubmission, "poll" | "materialize">;
  input: GenerationSubmissionStartInput;
  onMaterialized?: (result: GenerationSubmissionMaterializeResult) => void | Promise<void>;
  /** Capability-core lifecycle signal. Aborting stops future polls and side effects. */
  signal?: AbortSignal;
  /** Optional epoch guard for callers that replace the capability-core instance. */
  isCurrent?: () => boolean;
  /** Injectable in tests; production uses the same horizon as the batch path. */
  pollHorizonMs?: number;
  /** Vendor-safe initial delay between queries (minimum 3s in production). */
  initialDelayMs?: number;
  /** Maximum delay between queries. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type SingleShotGenerationObservation = {
  nextAction: "completed" | "attention" | "observe";
  polls: number;
  lastPoll?: GenerationSubmissionPollResult;
  materialized?: GenerationSubmissionMaterializeResult;
  /** True when the observer was stopped by its owner rather than by provider state. */
  aborted?: boolean;
};

function defaultPollHorizonMs(): number {
  const value = Number(process.env.NOMI_POLL_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 300_000;
}

function isObserverCurrent(deps: SingleShotGenerationObserverInput): boolean {
  return !deps.signal?.aborted && (deps.isCurrent ? deps.isCurrent() : true);
}

/**
 * Wait for a backoff delay without making shutdown wait for the timer.  The
 * injected `sleep` remains the only clock in tests and production; the abort
 * promise merely races it and removes its listener on either outcome.
 */
async function sleepUnlessAborted(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (signal?.aborted) return false;
  if (!signal) {
    await sleep(ms);
    return true;
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<false>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms).then(() => true as const), aborted]);
    return !signal.aborted;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Observe one already-submitted single-shot task until it settles or the
 * bounded horizon expires.  A pending return is honest: the durable Run still
 * owns the provider task and a later resume/re-kick can call this function
 * again.  No submission is attempted from this path.
 */
export async function observeSingleShotGeneration(
  deps: SingleShotGenerationObserverInput,
): Promise<SingleShotGenerationObservation> {
  const pollHorizonMs = deps.pollHorizonMs ?? defaultPollHorizonMs();
  const initialDelayMs = Math.max(0, deps.initialDelayMs ?? 3_000);
  const maxDelayMs = Math.max(initialDelayMs, deps.maxDelayMs ?? 15_000);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let elapsedMs = 0;
  let delayMs = initialDelayMs;
  let polls = 0;
  let lastPoll: GenerationSubmissionPollResult | undefined;

  while (true) {
    if (!isObserverCurrent(deps)) return { nextAction: "observe", polls, lastPoll, aborted: true };
    lastPoll = await deps.submission.poll(deps.input);
    polls += 1;
    // A provider query cannot always be cancelled, so re-check the lifecycle
    // boundary before interpreting its response or touching the durable store.
    if (!isObserverCurrent(deps)) return { nextAction: "observe", polls, lastPoll, aborted: true };
    if (lastPoll.nextAction === "materialize") {
      if (!isObserverCurrent(deps)) return { nextAction: "observe", polls, lastPoll, aborted: true };
      const materialized = await deps.submission.materialize(deps.input);
      if (!isObserverCurrent(deps)) return { nextAction: "observe", polls, lastPoll, aborted: true };
      await deps.onMaterialized?.(materialized);
      if (!isObserverCurrent(deps)) return { nextAction: "observe", polls, lastPoll, aborted: true };
      return { nextAction: "completed", polls, lastPoll, materialized };
    }
    if (lastPoll.nextAction === "attention") return { nextAction: "attention", polls, lastPoll };
    if (elapsedMs >= pollHorizonMs) return { nextAction: "observe", polls, lastPoll };

    const waitMs = Math.min(delayMs, pollHorizonMs - elapsedMs);
    if (waitMs <= 0) return { nextAction: "observe", polls, lastPoll };
    if (!(await sleepUnlessAborted(sleep, waitMs, deps.signal))) {
      return { nextAction: "observe", polls, lastPoll, aborted: true };
    }
    elapsedMs += waitMs;
    delayMs = Math.min(maxDelayMs, Math.max(initialDelayMs, delayMs * 2 || initialDelayMs));
  }
}
