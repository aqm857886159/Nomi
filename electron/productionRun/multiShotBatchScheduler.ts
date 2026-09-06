import { deriveBatchPlan, BudgetExhaustedError, type BatchDerivationResult, type BudgetHalt, type CheckpointState, type DispatchTask } from "./batchScheduleDerivation";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";
import type { ProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationSubmission } from "./productionGenerationSubmission";
import type { ShotPrice } from "./shotPricing";
import { anchorCheckpointGateId, buildAnchorCheckpointGate } from "./anchorCheckpoint";
import { logWarn } from "../logging/logger";

/**
 * P4 S4 — the durable batch scheduler orchestrator (plan §3.3). It has NO persistent state of its own:
 * every tick it reads the durable Run, calls the pure `deriveBatchPlan`, and turns the answer into side
 * effects (reserve + submit inside the Run lock via the submission facade; open/decide the anchor
 * checkpoint gate; halt the Run on budget exhaustion). A crash-restart re-runs the SAME loop over the
 * reloaded Run and converges — because "what was submitted" lives in `jobs[]`, "what was spent" lives in
 * the ledger, and "did the anchor pass" lives in the gate. See batchScheduleDerivation.ts for why.
 *
 * ## Single writer, bounded polling, no CAS churn
 *
 * This is the ONE writer for its Run. Each shot's `reserve + submit` happens inside the submission
 * facade's Run lock (`productionGenerationSubmission.start` → `runLock.withLock`), so two shots can never
 * double-reserve. Concurrency lives only in "waiting for the provider" (poll), never across submits.
 * The loop is bounded by `maxTicks` (a safety valve; a healthy batch converges in a few PROGRESS ticks).
 *
 * ## Slow providers: the observe loop (2026-08-25, APIMart 真付费验收抓到的三洞修复)
 *
 * A real video provider takes MINUTES. Dispatch therefore only submits + polls once (instant mocks
 * settle in the same tick); everything still in flight lands in the derivation's `observe` list and is
 * polled in rounds with REAL waits between them — backoff from 3s (厂商「查询间隔 ≥3-5s」契约, see
 * docs/plan/2026-07-31-seedance-api-contract-reconciliation.md §三) doubling to a 15s cap. Waiting is
 * bounded by `pollHorizonMs` per drive (default NOMI_POLL_TIMEOUT_MS or 300s, 对齐 core.ts 单镜链);
 * when in-flight units outlive it the drive rests with `quiescent: false` — NEVER `true` while pollable
 * work remains — and the caller (appIntegration) re-kicks later. Because `observe` is derived purely
 * from jobs[], a re-kick (timer / project reopen / restart) resumes polling exactly where the durable
 * Run stands: no double-submit (outbox intent log), no re-charge (commandId-idempotent ledger).
 * Waiting rounds do NOT consume `maxTicks` — only state-advancing ticks do.
 */

export type BatchSchedulerOptions = {
  /**
   * Auto-release the anchor checkpoint after this many ms (§3.2). Undefined = never (default): the
   * batch pauses at the checkpoint until the user approves. `0` = release immediately (test/express).
   */
  anchorAutoReleaseMs?: number;
  /** Safety cap on how many NEW shots this run dispatches (test hook for partial batches). */
  maxShotsPerRun?: number;
  /** Safety cap on scheduler ticks before giving up (default 64). A healthy batch needs a few. */
  maxTicks?: number;
  /**
   * Total wait budget for one drive's observe rounds, in ms. Default: NOMI_POLL_TIMEOUT_MS or 300s
   * (the single-shot legacy chain's video horizon, core.ts). In-flight units outliving it rest the
   * drive with `quiescent: false`; the caller re-kicks later and the derivation resumes them.
   */
  pollHorizonMs?: number;
};

export type BatchSchedulerDependencies = {
  repository: Pick<ProductionRunRepository, "read" | "execute">;
  submission: Pick<ProductionGenerationSubmission, "start" | "poll" | "materialize">;
  projectId: string;
  runId: string;
  /** Resolve a shot's derived price (S2) for the halt accounting. */
  perShotPrice: (shot: ProductionGenerationShot) => ShotPrice;
  now?: () => string;
  /** Wait between observe rounds. Injectable (like `now`) so tests drive a virtual clock; default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  options?: BatchSchedulerOptions;
  /**
   * P4 S5：一镜成功物化后回调（best-effort，永不抛）——appIntegration 据此 requestRenderer 把该镜 result
   * 推给渲染层回填占位节点（「逐个冒」）。scheduler 本身不认识渲染层，只发这个信号（关注点分离）。
   */
  onShotMaterialized?: (shotId: string) => void | Promise<void>;
  /**
   * Notify the owning production pipeline once every included video shot has
   * settled.  The scheduler deliberately does not know about QA/assembly/
   * export; the callback lets the domain owner continue the same Run without
   * introducing a second writer or a legacy generation path.
   */
  onBatchComplete?: (outcome: { progress: BatchDerivationResult["progress"] }) => void | Promise<void>;
};

export type BatchOutcome = {
  progress: BatchDerivationResult["progress"];
  checkpoint: CheckpointState;
  halt?: BudgetHalt;
  /**
   * True when the batch reached a stable resting point (all shots done, or blocked on checkpoint/halt/
   * stop). False when pollable in-flight work outlived this drive's wait budget (slow provider) or the
   * tick safety valve fired — the caller should re-kick later; the derivation's `observe` resumes it.
   */
  quiescent: boolean;
};

function requireRun(deps: BatchSchedulerDependencies): ProductionRun {
  const run = deps.repository.read(deps.projectId, deps.runId);
  if (!run) throw new Error(`Production run not found: ${deps.runId}`);
  return run;
}

/** Observe-round backoff: 3s floor (vendor "query interval ≥3-5s" contract), doubling to a 15s cap. */
const POLL_DELAY_START_MS = 3_000;
const POLL_DELAY_CAP_MS = 15_000;

/** Same env override as the single-shot legacy chain (core.ts) so slow vendors tune ONE knob. */
function defaultPollHorizonMs(): number {
  const env = Number(process.env.NOMI_POLL_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : 300_000;
}

export function createMultiShotBatchScheduler(deps: BatchSchedulerDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const options = deps.options ?? {};
  const maxTicks = options.maxShotsPerRun !== undefined ? Math.max(options.maxShotsPerRun + 4, 8) : (options.maxTicks ?? 64);
  const pollHorizonMs = options.pollHorizonMs ?? defaultPollHorizonMs();

  function command(run: ProductionRun, type: string, payload: Record<string, unknown>, suffix: string): ProductionRun {
    return deps.repository.execute(run.projectId, run.runId, {
      commandId: `batch.scheduler:${run.runId}:${suffix}`,
      expectedRevision: run.revision,
      type,
      payload,
      issuedAt: now(),
    }).run;
  }

  /**
   * Poll one in-flight unit ONCE; materialize (or leave at needs_attention) if it settled.
   * "settled" = the unit reached a state the derivation reacts to (ready / attention); "pending" = still
   * processing (or a transient poll/materialize error — swallowed with a warn so one flaky query can't
   * kill the sibling units' long-running observation; the next round retries, bounded by the horizon).
   * Budget errors cannot originate here: poll/materialize never reserve — submit-path halts are untouched.
   */
  async function observeUnitOnce(task: DispatchTask): Promise<"settled" | "pending"> {
    try {
      const polled = await deps.submission.poll({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId });
      if (polled.nextAction === "materialize") {
        await deps.submission.materialize({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId });
        // P4 S5：这一镜落地了 → 通知上层把 result 推给渲染层回填占位（逐个冒）。best-effort，不阻断批次。
        if (deps.onShotMaterialized) {
          try {
            await deps.onShotMaterialized(task.shotId);
          } catch (error) {
            logWarn("production-run", "on-shot-materialized-failed", undefined, error);
          }
        }
        return "settled";
      }
      if (polled.nextAction === "attention") return "settled"; // provider failed → job is needs_attention, leave it
      return "pending";
    } catch (error) {
      logWarn("production-run", "batch-observe-failed", { shotId: task.shotId }, error);
      return "pending";
    }
  }

  /** Submit one unit (anchor or shot), then poll once: instant providers settle in the same tick; a slow
   * provider leaves the job at `polling` and the derivation's `observe` list + waiting rounds take over. */
  async function dispatchUnit(task: DispatchTask): Promise<void> {
    const started = await deps.submission.start({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId });
    if (started.nextAction !== "observe") return;
    await observeUnitOnce(task);
  }

  /** Open the anchor checkpoint gate (§3.2) referencing the ready anchor jobs — a free quality gate. */
  function openCheckpoint(run: ProductionRun, checkpoint: CheckpointState): ProductionRun {
    const gate = buildAnchorCheckpointGate({ runId: run.runId, planHash: run.generationPlan?.planHash ?? "", anchorJobIds: checkpoint.readyAnchorJobIds, now: now() });
    return command(run, "gate.add", { gate }, "open-anchor-checkpoint");
  }

  /** Record an auto-release as an approval on the checkpoint gate (§3.2) —留痕, then shots release. */
  function autoReleaseCheckpoint(run: ProductionRun): ProductionRun {
    const gateId = anchorCheckpointGateId(run.runId);
    const gate = run.gates.find((candidate) => candidate.gateId === gateId);
    if (!gate || gate.status !== "waiting") return run;
    return command(run, "gate.decide", { gateId, status: "approved" }, "auto-release-anchor-checkpoint");
  }

  async function notifyBatchComplete(progress: BatchDerivationResult["progress"]): Promise<void> {
    if (!deps.onBatchComplete || progress.total === 0 || progress.completed !== progress.total || progress.inFlight !== 0) return;
    try {
      await deps.onBatchComplete({ progress });
    } catch (error) {
      // Completion of the generation units is already durable.  A downstream
      // QA/assembly kick may be retried from the Run owner, so do not turn a
      // transient renderer/export handoff failure into a false scheduler
      // failure or another provider submission.
      logWarn("production-run", "on-batch-complete-failed", undefined, error);
    }
  }

  /** Halt the Run (§3.3): a queryable stop, never a silent over-spend. */
  function haltRun(run: ProductionRun): ProductionRun {
    if (run.status === "needs_attention") return run;
    if (run.status !== "running") return run;
    return command(run, "run.status", { status: "needs_attention" }, "budget-halt");
  }

  async function runToQuiescence(): Promise<BatchOutcome> {
    let dispatchedShots = 0;
    let lastResult: BatchDerivationResult | undefined;

    // A confirmed multi-shot plan drives the run. Gate approval already wrote the only budget
    // authorization; the scheduler may start execution but can never mint or raise spend authority.
    {
      let seed = requireRun(deps);
      const batchActive = seed.generationPlan?.state === "submitted" && (seed.generationPlan?.shots?.length ?? 0) > 0;
      if (batchActive && seed.status === "draft") {
        seed = command(seed, "run.status", { status: "running" }, "batch-start-running");
      }
    }

    // Progress actions consume the maxTicks safety valve; WAITING rounds do not — those are bounded by
    // pollHorizonMs instead, so a slow provider can wait minutes without exhausting the tick budget.
    let progressTicks = 0;
    let sleptMs = 0;
    let backoffStep = 0;
    const consumeTick = (): boolean => {
      progressTicks += 1;
      return progressTicks <= maxTicks;
    };

    while (true) {
      let run = requireRun(deps);
      const plan = run.generationPlan;
      if (!plan) throw new Error(`Batch scheduler requires a generation plan: ${run.runId}`);

      const anchorGate = run.gates.find((gate) => gate.gateId === anchorCheckpointGateId(run.runId));
      const result = deriveBatchPlan({
        runId: run.runId,
        runStatus: run.status,
        plan,
        jobs: run.jobs,
        budget: run.budget,
        perShotPrice: (shotId) => {
          const shot = (plan.shots ?? []).find((candidate) => candidate.shotId === shotId);
          return shot ? deps.perShotPrice(shot) : { known: false };
        },
        anchorGate,
        now: now(),
        anchorAutoReleaseMs: options.anchorAutoReleaseMs,
      });
      lastResult = result;

      // 1. Open the checkpoint once anchors are ready and no gate exists yet.
      if (result.checkpoint.status === "should_open") {
        if (!consumeTick()) break;
        openCheckpoint(run, result.checkpoint);
        continue; // re-derive with the gate present
      }
      // 2. Auto-release: record the approval, then re-derive so shots release.
      if (result.checkpoint.status === "auto_release") {
        if (!consumeTick()) break;
        autoReleaseCheckpoint(run);
        continue;
      }

      // 3. Dispatch anchors first (fresh or a rejected-checkpoint re-attempt).
      if (result.anchorDispatch.length > 0) {
        if (!consumeTick()) break;
        for (const task of result.anchorDispatch) {
          await dispatchUnit(task);
        }
        continue; // re-derive: anchors now have jobs; checkpoint may open next
      }

      // 4. Dispatch shots (the derivation only clears them once the checkpoint released / no anchors).
      // Reserve happens inside the Run lock; if the ledger's reserve throws "Budget authorization
      // exceeded", that is the last hard wall → structured halt.
      if (result.shotDispatch.length > 0) {
        if (!consumeTick()) break;
        for (const task of result.shotDispatch) {
          if (options.maxShotsPerRun !== undefined && dispatchedShots >= options.maxShotsPerRun) {
            return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: true };
          }
          try {
            await dispatchUnit(task);
            dispatchedShots += 1;
          } catch (error) {
            if (isBudgetExceeded(error)) {
              const halted = haltRun(requireRun(deps));
              void halted;
              const finalRun = requireRun(deps);
              const finalGate = finalRun.gates.find((gate) => gate.gateId === anchorCheckpointGateId(finalRun.runId));
              const finalResult = deriveBatchPlan({
                runId: finalRun.runId, runStatus: finalRun.status, plan: finalRun.generationPlan!, jobs: finalRun.jobs, budget: finalRun.budget,
                perShotPrice: (shotId) => { const shot = (finalRun.generationPlan?.shots ?? []).find((c) => c.shotId === shotId); return shot ? deps.perShotPrice(shot) : { known: false }; },
                anchorGate: finalGate, now: now(), anchorAutoReleaseMs: options.anchorAutoReleaseMs,
              });
              const halt = finalResult.halt ?? buildExhaustedHalt(finalRun, task.shotId, deps.perShotPrice);
              throw new BudgetExhaustedError(halt);
            }
            throw error;
          }
        }
        continue; // re-derive: dispatched shots now have jobs; halt/completion decided next
      }

      // 5. Units in flight → poll them in rounds with REAL waits between rounds (the slow-provider fix:
      // this used to spin 32 instant polls inside dispatchUnit and then rest claiming "quiescent" while
      // the jobs sat at processing forever). A settle re-derives immediately; otherwise back off and try
      // again until the drive's wait budget runs out.
      if (result.observe.length > 0) {
        let settledCount = 0;
        for (const task of result.observe) {
          if ((await observeUnitOnce(task)) === "settled") settledCount += 1;
        }
        if (settledCount > 0) {
          if (!consumeTick()) break;
          backoffStep = 0; // a settle means siblings are likely close too — poll faster again
          continue; // re-derive: checkpoint may open / halt may apply / batch may complete
        }
        if (sleptMs >= pollHorizonMs) {
          // In-flight work outlived this drive's wait budget. Rest HONESTLY (quiescent: false — never
          // true while pollable work remains): the durable Run keeps the jobs at provider_accepted/
          // polling, so any re-kick (timer / project reopen / restart) resumes via `observe`.
          return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: false };
        }
        const delayMs = Math.min(POLL_DELAY_START_MS * 2 ** backoffStep, POLL_DELAY_CAP_MS, pollHorizonMs - sleptMs);
        backoffStep += 1;
        sleptMs += delayMs;
        await sleep(delayMs);
        continue; // waiting round — bounded by pollHorizonMs, does not consume maxTicks
      }

      // 6. If the checkpoint is waiting (user must approve) → rest here (nothing more to do this run).
      // pending_anchors here means anchors are neither dispatchable nor pollable (e.g. needs_attention)
      // — a genuine rest until the user re-attempts them.
      if (result.checkpoint.status === "waiting" || result.checkpoint.status === "pending_anchors" || result.checkpoint.status === "rejected") {
        return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: true };
      }

      // 7. Budget halt → halt the Run and rest (提额续拍 is a fresh scheduler run). In-flight units have
      // already settled (case 5 runs first), so halting never strands pollable paid work.
      if (result.halt) {
        run = haltRun(run);
        return { progress: result.progress, checkpoint: result.checkpoint, halt: result.halt, quiescent: true };
      }

      // 8. Nothing to dispatch, observe or decide → the batch is complete (or stopped).
      // Keep QA/assembly/export in the owning production pipeline.  This
      // callback is only emitted for a fully settled batch; checkpoint waits,
      // budget halts, and partial test drives never trigger it.
      await notifyBatchComplete(result.progress);
      return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: true };
    }

    // Bounded-out (should not happen for a healthy batch) — report the last derived state. The loop ran
    // at least once (maxTicks >= 8), so lastResult is set; fall back to an empty progress only defensively.
    const result = lastResult ?? { progress: { total: 0, completed: 0, inFlight: 0, pending: 0 }, checkpoint: { status: "not_required" as const, readyAnchorJobIds: [] }, anchorDispatch: [], shotDispatch: [], observe: [] };
    return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: false };
  }

  return { runToQuiescence };
}

function isBudgetExceeded(error: unknown): boolean {
  if (error instanceof BudgetExhaustedError) return true;
  const message = error instanceof Error ? error.message : "";
  return /Budget authorization exceeded|budget_exhausted/i.test(message);
}

/** Build a halt structure when the ledger's hard wall fired but the derivation had not pre-flagged it. */
function buildExhaustedHalt(run: ProductionRun, haltedAtShotId: string, perShotPrice: (shot: ProductionGenerationShot) => ShotPrice): BudgetHalt {
  const shots = (run.generationPlan?.shots ?? []).filter((shot) => shot.role !== "anchor" && shot.included !== false);
  let completed = 0;
  let remaining = 0;
  let reachedHalt = false;
  for (const shot of shots) {
    const jobId = `generation-${run.runId}-${shot.shotId}-${(shot.contract?.contractHash ?? "").slice(0, 16)}`;
    const job = run.jobs.find((candidate) => candidate.jobId === jobId || candidate.jobId.startsWith(`${jobId}-attempt-`));
    if (job && (job.status === "ready" || job.status === "adopted")) completed += 1;
    if (shot.shotId === haltedAtShotId) reachedHalt = true;
    if (reachedHalt && !(job && (job.status === "ready" || job.status === "adopted"))) remaining += 1;
  }
  void perShotPrice;
  return { haltedAtShotId, completedCount: completed, dispatchableCount: 0, remainingCount: remaining, authorized: run.budget.authorized, currency: run.budget.currency };
}

export type MultiShotBatchScheduler = ReturnType<typeof createMultiShotBatchScheduler>;
