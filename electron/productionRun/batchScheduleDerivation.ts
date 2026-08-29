import type {
  BudgetLedgerSummary,
  ProductionGate,
  ProductionGenerationPlan,
  ProductionGenerationShot,
  ProductionJob,
  ProductionRunStatus,
} from "./productionRunTypes";
import type { ShotPrice } from "./shotPricing";
import { productionGenerationJobId } from "./productionGenerationAuthorization";

/**
 * P4 S4 — the pure batch derivation. This is the heart of "调度器无自有持久状态" (plan §1).
 *
 * ## Why there is no second source of truth
 *
 * The scheduler owns NO mutable state. Every tick recomputes "the next dispatch set" purely from the
 * durable Run — `plan.shots` (anchors + video shots, partitioned by role) + `jobs[]` + the budget
 * `ledger` summary + the anchor checkpoint gate. A crash-restart re-runs THIS SAME function over the
 * reloaded Run and gets THE SAME answer, because:
 *
 *   - "has this unit been dispatched?" = does `jobs[]` contain a job for `(shotId, currentAttempt)`?
 *     The jobId is derived by the shared ProductionRun authorization identity helper,
 *     so the durable job list IS the ledger of what was submitted. We never keep a private set.
 *   - "how much have we spent?" = the budget summary (reserved + actual + unsettled). The ledger is an
 *     append-only replay — itself a single source of truth. Halt is judged against `authorized`.
 *   - "did the anchor pass?" = the anchor checkpoint gate's status, written into the Run (never the
 *     renderer store). Waiting → shots blocked; approved (or auto-released) → shots released.
 *
 * This mirrors the already-shipped `latestGenerationAttempt` pattern (derive attempt from jobs[], never
 * self-count), so the two layers agree by construction and recovery cannot double-submit or over-spend.
 *
 * Pure: no IO, no clock read (the caller passes `now`), no provider call. The scheduler orchestrator
 * turns this plan into side effects (reserve + submit inside the Run lock); this function only decides.
 */

/**
 * A unit (anchor or shot) cleared for dispatch this tick: which shotId, which attempt (derived from
 * its lineage / attemptCount), and its sealed contract hash (for the jobId the orchestrator will submit).
 */
export type DispatchTask = {
  shotId: string;
  attempt: number;
  contractHash: string;
};

/**
 * The anchor checkpoint decision for this tick (plan §3.2). The orchestrator acts on it:
 *   - `not_required` — no anchor-role shots; skip the checkpoint entirely.
 *   - `pending_anchors` — anchors still generating; nothing to open yet.
 *   - `should_open` — all anchors ready, no gate yet → open a `scope:'anchor_checkpoint'` gate.
 *   - `waiting` — gate open, user has not decided → shots stay blocked.
 *   - `approved` — user approved the look → release shots.
 *   - `rejected` — user rejected → re-attempt ONLY the anchor (shots stay blocked).
 *   - `auto_release` — the configured timeout elapsed → release shots (orchestrator records approval).
 */
export type CheckpointStatus =
  | "not_required"
  | "pending_anchors"
  | "should_open"
  | "waiting"
  | "approved"
  | "rejected"
  | "auto_release";

export type CheckpointState = {
  status: CheckpointStatus;
  /** The anchor job ids that are ready (for the orchestrator to reference when opening the gate). */
  readyAnchorJobIds: string[];
};

/**
 * The structured halt signal (plan §3.3): the batch cannot afford every remaining shot under the
 * plan-level authorized ceiling. `haltedAtShotId` is the first shot (checkbox order) that would breach;
 * counts let `nomi_get_run` show "已完成 N / 剩余 M" without the scheduler holding any state.
 */
export type BudgetHalt = {
  haltedAtShotId: string;
  /** Included video shots already finished (ready/adopted). */
  completedCount: number;
  /** Included video shots cleared for dispatch this tick (fit under the cap). */
  dispatchableCount: number;
  /** Included video shots that did not fit (from the halt point onward, minus already-finished/in-flight). */
  remainingCount: number;
  authorized: number;
  currency: string;
};

/** Progress projection over the video shots (for stop/halt status queries). All derived from jobs[]. */
export type BatchProgress = {
  total: number;
  completed: number;
  inFlight: number;
  pending: number;
};

/**
 * P4 S4: raised when the budget genuinely runs out mid-batch and the orchestrator must halt the Run
 * (plan §3.3). Carries the structured "已完成 N / 剩余 M" so the caller never silently over-spends.
 * The ledger's `reserve` is the last hard wall (it throws "Budget authorization exceeded"); this typed
 * error is the STRUCTURED halt the derivation raises PROACTIVELY so the Run enters a queryable halt.
 */
export class BudgetExhaustedError extends Error {
  readonly code = "budget_exhausted" as const;

  constructor(readonly halt: BudgetHalt) {
    super(`budget_exhausted: authorized ${halt.authorized} ${halt.currency} covers ${halt.completedCount + halt.dispatchableCount} of ${halt.completedCount + halt.dispatchableCount + halt.remainingCount} shot(s); halted at ${halt.haltedAtShotId}`);
    this.name = "BudgetExhaustedError";
  }
}

export type BatchDerivationInput = {
  runId: string;
  runStatus: ProductionRunStatus;
  plan: ProductionGenerationPlan;
  jobs: ProductionJob[];
  budget: BudgetLedgerSummary;
  /** Resolve a shot's derived price (S2). Unknown → 0 liability toward the cap (still dispatchable). */
  perShotPrice: (shotId: string) => ShotPrice;
  /** The current anchor checkpoint gate, if one was opened. */
  anchorGate?: ProductionGate;
  now: string;
  /** Auto-release the checkpoint after this many ms of waiting. Undefined = never auto-release (default). */
  anchorAutoReleaseMs?: number;
};

export type BatchDerivationResult = {
  anchorDispatch: DispatchTask[];
  shotDispatch: DispatchTask[];
  /**
   * Units whose current-attempt job is submitted and still pollable (`provider_accepted`/`polling`
   * with a providerTaskId). The orchestrator's observe loop polls these (with real waits) until they
   * settle — THIS is what lets a re-kick (project reopen / timer) advance a slow provider's in-flight
   * jobs after a restart: `needsDispatch` is false for them, so without this list a re-derivation
   * would say "nothing to do" and the jobs would sit at `processing` forever.
   */
  observe: DispatchTask[];
  checkpoint: CheckpointState;
  progress: BatchProgress;
  halt?: BudgetHalt;
};

/** Job statuses that mean "this unit finished successfully" — never re-dispatch. */
const TERMINAL_DONE = new Set<ProductionJob["status"]>(["ready", "adopted"]);

/**
 * Post-submission, still-pollable statuses. Deliberately narrow: `needs_attention`/`submission_unknown`/
 * `reconciling`/`cancel_requested` have their own recovery flows (resume/reconcile/cancel), and
 * pre-submission statuses belong to `needsDispatch`. Requires a providerTaskId (poll needs one).
 */
const OBSERVABLE = new Set<ProductionJob["status"]>(["provider_accepted", "polling"]);

/** A shot is included in the sealed contract unless explicitly unchecked (试拍/分批). */
function isIncluded(shot: Pick<ProductionGenerationShot, "included">): boolean {
  return shot.included !== false;
}

/** The current attempt for a shot = its attemptCount (a per-shot new_attempt bumps this), min 1. */
function currentAttemptOf(shot: ProductionGenerationShot): number {
  return Number.isInteger(shot.attemptCount) && (shot.attemptCount as number) >= 1 ? (shot.attemptCount as number) : 1;
}

/** The durable job (if any) for a shot's CURRENT attempt. Pure over jobs[]. */
function jobForShot(runId: string, shot: ProductionGenerationShot, jobs: ProductionJob[]): ProductionJob | undefined {
  const hash = shot.contract?.contractHash;
  if (!hash) return undefined;
  const jobId = productionGenerationJobId(runId, hash, currentAttemptOf(shot), shot.shotId);
  return jobs.find((candidate) => candidate.jobId === jobId);
}

function shotFinished(runId: string, shot: ProductionGenerationShot, jobs: ProductionJob[]): boolean {
  const job = jobForShot(runId, shot, jobs);
  return Boolean(job && TERMINAL_DONE.has(job.status));
}

function shotInFlight(runId: string, shot: ProductionGenerationShot, jobs: ProductionJob[]): boolean {
  const job = jobForShot(runId, shot, jobs);
  // authorization_required is still waiting for a human; authorized/intent-persisted is dispatchable.
  // Neither is provider work in flight.
  return Boolean(job
    && job.status !== "authorization_required"
    && !TERMINAL_DONE.has(job.status)
    && !DISPATCHABLE.has(job.status));
}

/**
 * Only a gate-authorized durable job can dispatch. A missing job belongs to a legacy/read-only Run; an
 * authorization_required job is still waiting for the human gate. submit_intent_persisted remains
 * dispatchable for crash recovery because the outbox intent log proves at-most-once provider submission.
 */
const DISPATCHABLE = new Set<ProductionJob["status"]>(["authorized", "submit_intent_persisted"]);
function needsDispatch(runId: string, shot: ProductionGenerationShot, jobs: ProductionJob[]): boolean {
  if (!shot.contract?.contractHash) return false;
  const job = jobForShot(runId, shot, jobs);
  return Boolean(job && DISPATCHABLE.has(job.status));
}

function priceAmount(price: ShotPrice): number {
  return price.known ? price.amount : 0;
}

function toTask(runId: string, shot: ProductionGenerationShot): DispatchTask {
  return { shotId: shot.shotId, attempt: currentAttemptOf(shot), contractHash: shot.contract!.contractHash };
}

/** Anchor-role, included shots — the identity images the batch depends on. */
function anchorsOf(plan: ProductionGenerationPlan): ProductionGenerationShot[] {
  return (plan.shots ?? []).filter((shot) => shot.role === "anchor" && isIncluded(shot));
}

/** Video-role (or unroled, backward compatible), included shots. */
function videoShotsOf(plan: ProductionGenerationPlan): ProductionGenerationShot[] {
  return (plan.shots ?? []).filter((shot) => shot.role !== "anchor" && isIncluded(shot));
}

/**
 * Resolve the anchor checkpoint decision for this tick. Pure over (anchors, jobs, gate, now, timeout).
 */
function deriveCheckpoint(input: BatchDerivationInput, anchors: ProductionGenerationShot[]): CheckpointState {
  if (anchors.length === 0) return { status: "not_required", readyAnchorJobIds: [] };
  const readyAnchorJobIds: string[] = [];
  for (const anchor of anchors) {
    const job = jobForShot(input.runId, anchor, input.jobs);
    if (!job || !TERMINAL_DONE.has(job.status)) return { status: "pending_anchors", readyAnchorJobIds };
    readyAnchorJobIds.push(job.jobId);
  }

  const gate = input.anchorGate;
  if (!gate) return { status: "should_open", readyAnchorJobIds };
  if (gate.status === "approved") return { status: "approved", readyAnchorJobIds };
  if (gate.status === "rejected") return { status: "rejected", readyAnchorJobIds };
  // waiting (or expired/revoked treated as still-blocking): check the optional auto-release timeout.
  if (gate.status === "waiting" && input.anchorAutoReleaseMs !== undefined) {
    const openedAt = Date.parse(gate.createdAt);
    const now = Date.parse(input.now);
    if (Number.isFinite(openedAt) && Number.isFinite(now) && now - openedAt >= input.anchorAutoReleaseMs) {
      return { status: "auto_release", readyAnchorJobIds };
    }
  }
  return { status: "waiting", readyAnchorJobIds };
}

/**
 * Derive the next batch to dispatch. See the module doc for why this is a pure recompute with no
 * second source of truth. The orchestrator calls this every tick and again on crash-recovery.
 */
export function deriveBatchPlan(input: BatchDerivationInput): BatchDerivationResult {
  const anchors = anchorsOf(input.plan);
  const videoShots = videoShotsOf(input.plan);

  // Progress projection over VIDEO shots (always available, even when stopped, for status queries).
  let completed = 0;
  let inFlight = 0;
  for (const shot of videoShots) {
    if (shotFinished(input.runId, shot, input.jobs)) completed += 1;
    else if (shotInFlight(input.runId, shot, input.jobs)) inFlight += 1;
  }
  const progress: BatchProgress = {
    total: videoShots.length,
    completed,
    inFlight,
    pending: videoShots.length - completed - inFlight,
  };

  const checkpoint = deriveCheckpoint(input, anchors);

  // In-flight units to keep polling (anchors first, then shots — plan order). Derived purely from
  // jobs[], so a crash-restart recomputes the same list and the observe loop resumes where it left off.
  const observe: DispatchTask[] = [];
  for (const shot of [...anchors, ...videoShots]) {
    const job = jobForShot(input.runId, shot, input.jobs);
    if (job && OBSERVABLE.has(job.status) && job.providerTaskId) observe.push(toTask(input.runId, shot));
  }

  // Stop semantics (plan §3.3/§4): a stopped run dispatches nothing NEW (未提交=不提交不扣费).
  // In-flight jobs still settle: they are already paid for, so `observe` keeps them pollable and the
  // orchestrator lands their results; completed jobs are preserved (both reflected in `progress`).
  const stopped = input.runStatus === "pausing" || input.runStatus === "paused" || input.runStatus === "cancelled";
  if (stopped) {
    return { anchorDispatch: [], shotDispatch: [], observe, checkpoint, progress };
  }

  // Anchors go first. Any anchor still needing a job (fresh or a rejected-checkpoint re-attempt) is
  // dispatched now; while anchors are not all ready, or the checkpoint has not released, shots wait.
  const anchorDispatch = anchors
    .filter((anchor) => needsDispatch(input.runId, anchor, input.jobs))
    .map((anchor) => toTask(input.runId, anchor));
  const checkpointReleased = checkpoint.status === "approved" || checkpoint.status === "auto_release";
  if (anchors.length > 0 && !checkpointReleased) {
    // Anchors present but checkpoint not released → dispatch anchors (if any pending), block shots.
    return { anchorDispatch, shotDispatch: [], observe, checkpoint, progress };
  }

  // Checkpoint released (approved / auto_release) or no anchors at all → consider video shots.
  // Budget halt (plan §3.3): walk included, not-yet-started shots in checkbox order, accumulating the
  // ALREADY-COMMITTED liability (reserved + actual + unsettled) + each candidate shot's price. The first
  // shot that would breach `authorized` halts the batch there (that shot and all after are not dispatched).
  const authorized = input.budget.authorized;
  const committed = input.budget.reserved + input.budget.actual + input.budget.unsettled;
  let running = committed;
  const shotDispatch: DispatchTask[] = [];
  let halt: BudgetHalt | undefined;
  let dispatchableCount = 0;
  let haltIndex = -1;

  for (let i = 0; i < videoShots.length; i += 1) {
    const shot = videoShots[i];
    if (!needsDispatch(input.runId, shot, input.jobs)) continue; // finished or in-flight → skip
    const price = priceAmount(input.perShotPrice(shot.shotId));
    if (running + price > authorized) {
      // This shot breaches the cap → halt here; do not dispatch it or any later shot.
      haltIndex = i;
      halt = {
        haltedAtShotId: shot.shotId,
        completedCount: completed,
        dispatchableCount,
        remainingCount: 0,
        authorized,
        currency: input.budget.currency,
      };
      break;
    }
    running += price;
    dispatchableCount += 1;
    shotDispatch.push(toTask(input.runId, shot));
  }

  if (halt && haltIndex >= 0) {
    let remaining = 0;
    for (let i = haltIndex; i < videoShots.length; i += 1) {
      const shot = videoShots[i];
      if (needsDispatch(input.runId, shot, input.jobs)) remaining += 1;
    }
    halt = { ...halt, dispatchableCount, remainingCount: remaining };
  }

  return { anchorDispatch, shotDispatch, observe, checkpoint, progress, ...(halt ? { halt } : {}) };
}
