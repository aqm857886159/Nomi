import { pollWithBackoff } from "../shared/retryPolicy";
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
  /** Injectable clock; the horizon counts wall time (poll round-trips included), not just sleeps. */
  now?: () => number;
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
  let polls = 0;
  let lastPoll: GenerationSubmissionPollResult | undefined;
  const aborted = (): SingleShotGenerationObservation => ({ nextAction: "observe", polls, lastPoll, aborted: true });

  const read = async (): Promise<SingleShotGenerationObservation> => {
    if (!isObserverCurrent(deps)) return aborted();
    lastPoll = await deps.submission.poll(deps.input);
    polls += 1;
    // A provider query cannot always be cancelled, so re-check the lifecycle
    // boundary before interpreting its response or touching the durable store.
    if (!isObserverCurrent(deps)) return aborted();
    if (lastPoll.nextAction === "materialize") {
      if (!isObserverCurrent(deps)) return aborted();
      const materialized = await deps.submission.materialize(deps.input);
      if (!isObserverCurrent(deps)) return aborted();
      await deps.onMaterialized?.(materialized);
      if (!isObserverCurrent(deps)) return aborted();
      return { nextAction: "completed", polls, lastPoll, materialized };
    }
    if (lastPoll.nextAction === "attention") return { nextAction: "attention", polls, lastPoll };
    return { nextAction: "observe", polls, lastPoll };
  };

  try {
    return await pollWithBackoff(
      read,
      (value) => value.nextAction === "observe" && !value.aborted,
      { initialDelayMs, maxDelayMs, horizonMs: pollHorizonMs, signal: deps.signal, sleep: deps.sleep, now: deps.now },
    );
  } catch (error) {
    if (deps.signal?.aborted && Object.is(error, deps.signal.reason)) return aborted();
    throw error;
  }
}
