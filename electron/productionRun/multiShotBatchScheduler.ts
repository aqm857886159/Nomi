import { deriveBatchPlan, BudgetExhaustedError, type BatchDerivationResult, type BudgetHalt, type CheckpointState, type DispatchTask } from "./batchScheduleDerivation";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";
import type { ProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationSubmission } from "./productionGenerationSubmission";
import type { ShotPrice } from "./shotPricing";
import { anchorCheckpointGateId, buildAnchorCheckpointGate } from "./anchorCheckpoint";

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
 * The loop is bounded by `maxTicks` (a safety valve; a healthy batch converges in a few ticks).
 */

export type BatchSchedulerOptions = {
  /**
   * Auto-release the anchor checkpoint after this many ms (§3.2). Undefined = never (default): the
   * batch pauses at the checkpoint until the user approves. `0` = release immediately (test/express).
   */
  anchorAutoReleaseMs?: number;
  /**
   * Raise the plan-level budget authorization to this ceiling before dispatching (提额续拍, §3.3).
   * Used when the user lifts the cap to resume a halted batch. The ledger only accepts authorize ≥
   * current liability, so this never lowers an existing authorization.
   */
  raisePlanAuthorizationTo?: number;
  /** Safety cap on how many NEW shots this run dispatches (test hook for partial batches). */
  maxShotsPerRun?: number;
  /** Safety cap on scheduler ticks before giving up (default 64). A healthy batch needs a few. */
  maxTicks?: number;
  /**
   * P4 真供应商加固：一个 dispatchUnit 内「快轮询」的最多次数（默认 3）。快轮询专治**秒回**的供应商
   * （loopback / 快 mock / 已缓存）——poll 到 materialize 就当场落。仍 pending 就快返（job 停在 `polling`），
   * 分钟级的等待交给 owner 的持久再驱动（P1 不把分钟级 sleep 塞进请求路径）。`0` = 不快轮询，纯靠再驱动。
   */
  maxFastPolls?: number;
  /**
   * P4 真供应商加固：两次快轮询之间的退避（ms，默认 800）。给秒级供应商一点结算窗口，又不空转。测试注 `0`
   * = 无退避（逐字节等同旧 loopback 行为：秒回 vendor 首轮即 materialize）。生产退避定时是允许的（R18 只禁测试墙钟）。
   */
  fastPollBackoffMs?: number;
};

export type BatchSchedulerDependencies = {
  repository: Pick<ProductionRunRepository, "read" | "execute">;
  submission: Pick<ProductionGenerationSubmission, "start" | "poll" | "materialize">;
  projectId: string;
  runId: string;
  /** Resolve a shot's derived price (S2) for the halt accounting. */
  perShotPrice: (shot: ProductionGenerationShot) => ShotPrice;
  now?: () => string;
  /**
   * P4 真供应商加固：快轮询之间的等待钩子（默认 setTimeout）。只在 dispatchUnit 的快轮询里用；分钟级等待
   * 由 owner 的持久再驱动承担，不阻塞此处。测试注入受控 sleep（或 0 退避）避免墙钟（R18）。
   */
  sleep?: (delayMs: number) => Promise<void>;
  options?: BatchSchedulerOptions;
  /**
   * P4 S5：一镜成功物化后回调（best-effort，永不抛）——appIntegration 据此 requestRenderer 把该镜 result
   * 推给渲染层回填占位节点（「逐个冒」）。scheduler 本身不认识渲染层，只发这个信号（关注点分离）。
   */
  onShotMaterialized?: (shotId: string) => void | Promise<void>;
};

export type BatchOutcome = {
  progress: BatchDerivationResult["progress"];
  checkpoint: CheckpointState;
  halt?: BudgetHalt;
  /** True when the batch reached a stable resting point (all shots done, or blocked on checkpoint/halt/stop). */
  quiescent: boolean;
};

function requireRun(deps: BatchSchedulerDependencies): ProductionRun {
  const run = deps.repository.read(deps.projectId, deps.runId);
  if (!run) throw new Error(`Production run not found: ${deps.runId}`);
  return run;
}

/**
 * The plan-level authorized ceiling (§3.3): the HARD spend cap for the whole batch. It is the smaller of
 *   - the sum of known per-shot prices over included shots + anchors (what the batch would cost), and
 *   - the user's policy.maxSpend hard limit (null = unbounded → the estimated total governs).
 * Taking the min is what makes "构造超顶批次停在正确的第 K 镜" work: a user cap of ¥13 over a ¥18 batch
 * authorizes ¥13, so the derivation halts once the running reserve would breach ¥13.
 */
function planCeiling(run: ProductionRun, perShotPrice: (shot: ProductionGenerationShot) => ShotPrice): number {
  const shots = (run.generationPlan?.shots ?? []).filter((shot) => shot.included !== false);
  let estimatedTotal = 0;
  for (const shot of shots) {
    const price = perShotPrice(shot);
    if (price.known) estimatedTotal += price.amount;
  }
  const maxSpend = run.policy.maxSpend;
  return maxSpend === null || maxSpend === undefined ? estimatedTotal : Math.min(estimatedTotal, maxSpend);
}

export function createMultiShotBatchScheduler(deps: BatchSchedulerDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  const options = deps.options ?? {};
  const maxTicks = options.maxShotsPerRun !== undefined ? Math.max(options.maxShotsPerRun + 4, 8) : (options.maxTicks ?? 64);
  const sleep = deps.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const maxFastPolls = Math.max(0, options.maxFastPolls ?? 3);
  const fastPollBackoffMs = Math.max(0, options.fastPollBackoffMs ?? 800);

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
   * Seed the plan-level authorization once (§3.3): the receipt authorized the whole batch, so before the
   * first shot reserves we authorize the ledger up to the plan ceiling (or the raised ceiling). Without
   * this, the submission facade's per-shot authorize (first-entry only, single-shot cap) would make the
   * SECOND shot's reserve exceed the authorization. Idempotent by commandId; only raises, never lowers.
   */
  function ensurePlanAuthorization(run: ProductionRun): ProductionRun {
    const ceiling = Math.max(planCeiling(run, deps.perShotPrice), options.raisePlanAuthorizationTo ?? 0);
    if (ceiling <= run.budget.authorized) return run; // already authorized at/above the ceiling
    // The billingEntryId embeds the target amount so a raise gets a fresh (idempotent) entry.
    return command(run, "budget.entry", {
      entry: { billingEntryId: `plan-authorize:${run.runId}:${ceiling}`, kind: "authorize", amount: ceiling, occurredAt: now() },
    }, `plan-authorize:${ceiling}`);
  }

  /**
   * Drive one unit (anchor or shot) one step through the submission facade (start→poll→[materialize]).
   *
   * P4 真供应商加固修根因：旧实现在这里做 32 次**无间隔** poll。真视频（分钟级、query 恒返 processing）会让
   * 这 32 次瞬间打完然后悄悄返回，job 停在 `polling`，且 runToQuiescence 静息后**再没有东西 poll 它** → 真视频
   * 永不 materialize。改成：`start`（对已提交 job 返 observe = 安全续 poll）→ **有界快轮询**（专治秒回的
   * loopback/快 mock/已缓存，带短退避给结算窗口）→ 若仍 pending 就**返回**（job 留在 `polling`）。分钟级的
   * 等待不在这里空转，而由 owner（appIntegration.kickSchedulerForRun）在 outcome.inFlight>0 时用持久、重启安全的
   * 退避再驱动承担（P1：不把分钟级 sleep 塞进请求路径 / 不造第二套调度系统）。返回值 = 这一镜是否已落地。
   */
  async function dispatchUnit(task: DispatchTask): Promise<boolean> {
    const started = await deps.submission.start({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId });
    if (started.nextAction !== "observe") return false;
    return pollUnit(task);
  }

  /**
   * Poll one already-submitted unit (anchor or shot) toward materialization — the path that advances an
   * in-flight job across ticks. Fast-poll a bounded number of times (a fast provider settles here with no
   * wasted round-trips; a slow provider stays `polling` and we return, deferring to the owner's persistent
   * re-drive). Idempotent: for a finished/failed job the submission facade short-circuits. Returns whether
   * the unit materialized this call.
   */
  async function pollUnit(task: DispatchTask): Promise<boolean> {
    for (let i = 0; i <= maxFastPolls; i += 1) {
      const polled = await deps.submission.poll({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId });
      if (polled.nextAction === "materialize") {
        await deps.submission.materialize({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId });
        // P4 S5：这一镜落地了 → 通知上层把 result 推给渲染层回填占位（逐个冒）。best-effort，不阻断批次。
        if (deps.onShotMaterialized) {
          try {
            await deps.onShotMaterialized(task.shotId);
          } catch (error) {
            console.warn("[nomi:production] onShotMaterialized failed:", error instanceof Error ? error.message : String(error));
          }
        }
        return true;
      }
      if (polled.nextAction === "attention") return false; // provider failed → job is needs_attention, leave it
      // still polling → give a fast provider a brief settle window, then re-poll. When the fast-poll budget is
      // spent the job stays `polling`; the persistent re-drive resumes it (this pollUnit is a single step).
      if (i < maxFastPolls && fastPollBackoffMs > 0) await sleep(fastPollBackoffMs);
    }
    return false;
  }

  /** Open the anchor checkpoint gate (§3.2) referencing the ready anchor jobs — a free quality gate. */
  function openCheckpoint(run: ProductionRun, checkpoint: CheckpointState): ProductionRun {
    const gate = buildAnchorCheckpointGate({ runId: run.runId, planHash: run.generationPlan?.planHash ?? "", anchorJobIds: checkpoint.readyAnchorJobIds, now: now() });
    // P4 真供应商加固：commandId 后缀带**当前就绪锚 jobIds** 摘要——「不满意只重锚」后旧检查点门被丢、新锚有新
    // jobId，这里必须是一条**新** command 才能重开门；若用固定后缀，幂等命令库会把重开当作首次开门的重放而吞掉
    // （结果：新锚生成后检查点永不重开、批次死锁）。首次开门的后缀不变（同一批锚 → 幂等，不重复开）。
    const anchorFingerprint = [...checkpoint.readyAnchorJobIds].sort().join(",").slice(0, 48);
    return command(run, "gate.add", { gate }, `open-anchor-checkpoint:${anchorFingerprint}`);
  }

  /** Record an auto-release as an approval on the checkpoint gate (§3.2) —留痕, then shots release. */
  function autoReleaseCheckpoint(run: ProductionRun): ProductionRun {
    const gateId = anchorCheckpointGateId(run.runId);
    const gate = run.gates.find((candidate) => candidate.gateId === gateId);
    if (!gate || gate.status !== "waiting") return run;
    return command(run, "gate.decide", { gateId, status: "approved" }, "auto-release-anchor-checkpoint");
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

    // Batch startup (§3.3): a confirmed multi-shot plan (state submitted) drives the run. Two one-time,
    // idempotent seeds before the derivation loop:
    //   (a) transition draft → running so the batch becomes pausable/cancellable (Run pause needs running);
    //   (b) authorize the ledger up to the plan ceiling — the receipt authorized the WHOLE batch, so the
    //       derivation must see the cap from tick 0 (otherwise it halts at shot 1 against authorized=0).
    // A stopped run (paused/cancelled/needs_attention) is NOT re-started here — the scheduler only resumes
    // when an explicit control resumes it. 提额续拍 supplies `raisePlanAuthorizationTo`.
    {
      let seed = requireRun(deps);
      const batchActive = seed.generationPlan?.state === "submitted" && (seed.generationPlan?.shots?.length ?? 0) > 0;
      if (batchActive && seed.status === "draft") {
        seed = command(seed, "run.status", { status: "running" }, "batch-start-running");
      }
      if (batchActive && seed.status === "running") {
        try {
          ensurePlanAuthorization(seed);
        } catch (error) {
          // A concurrent writer may have advanced the revision; the next tick refreshes and retries.
          if (!isBudgetExceeded(error)) throw error;
        }
      }
    }

    for (let tick = 0; tick < maxTicks; tick += 1) {
      void tick;
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
      const anchorShotIds = new Set((plan.shots ?? []).filter((shot) => shot.role === "anchor").map((shot) => shot.shotId));

      // 1. Open the checkpoint once anchors are ready and no gate exists yet.
      if (result.checkpoint.status === "should_open") {
        openCheckpoint(run, result.checkpoint);
        continue; // re-derive with the gate present
      }
      // 2. Auto-release: record the approval, then re-derive so shots release.
      if (result.checkpoint.status === "auto_release") {
        autoReleaseCheckpoint(run);
        continue;
      }

      // 3. Dispatch anchors first (fresh or a rejected-checkpoint re-attempt).
      if (result.anchorDispatch.length > 0) {
        for (const task of result.anchorDispatch) {
          await dispatchUnit(task);
        }
        continue; // re-derive: anchors now have jobs; checkpoint may open next
      }

      // 3b. Poll any in-flight anchors (submitted, still settling) BEFORE resting at pending_anchors. A slow
      // real anchor stays `polling` across ticks; if this poll lands one, re-derive (the checkpoint may open).
      // If nothing progressed, fall through to rest — the owner's persistent re-drive polls again later.
      if (result.checkpoint.status === "pending_anchors") {
        const anchorPolls = result.inFlightPoll.filter((task) => anchorShotIds.has(task.shotId));
        let advanced = false;
        for (const task of anchorPolls) {
          if (await pollUnit(task)) advanced = true;
        }
        if (advanced) continue; // an anchor materialized → re-derive (checkpoint may open)
      }

      // 4. If the checkpoint is waiting (user must approve) → rest here (nothing more to do this run).
      if (result.checkpoint.status === "waiting" || result.checkpoint.status === "pending_anchors" || result.checkpoint.status === "rejected") {
        return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: true };
      }

      // 5. Budget halt → halt the Run and rest (提额续拍 is a fresh scheduler run).
      if (result.halt && result.shotDispatch.length === 0) {
        run = haltRun(run);
        return { progress: result.progress, checkpoint: result.checkpoint, halt: result.halt, quiescent: true };
      }

      // 6. Dispatch shots (checkpoint released or no anchors). Reserve happens inside the Run lock; if the
      // ledger's reserve throws "Budget authorization exceeded", that is the last hard wall → structured halt.
      if (result.shotDispatch.length > 0) {
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

      // 6b. Nothing new to dispatch, but shots are in-flight (submitted, still settling on the provider). Poll
      // them BEFORE declaring completion. A slow real video stays `polling` across ticks; if this poll lands
      // one, re-derive (more shots may release / the batch may complete). If nothing progressed, fall through
      // to rest — the batch is NOT complete (inFlight>0 in the outcome), and the owner re-drives later.
      if (result.inFlightPoll.length > 0) {
        let advanced = false;
        for (const task of result.inFlightPoll) {
          if (await pollUnit(task)) advanced = true;
        }
        if (advanced) continue; // a shot materialized → re-derive
        // Still all in-flight → rest (owner's persistent re-drive resumes polling). Report current progress.
        return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: true };
      }

      // 7. Nothing to dispatch, nothing in-flight, no blocking checkpoint → the batch is complete (or stopped).
      return { progress: result.progress, checkpoint: result.checkpoint, ...(result.halt ? { halt: result.halt } : {}), quiescent: true };
    }

    // Bounded-out (should not happen for a healthy batch) — report the last derived state. The loop ran
    // at least once (maxTicks >= 8), so lastResult is set; fall back to an empty progress only defensively.
    const result = lastResult ?? { progress: { total: 0, completed: 0, inFlight: 0, pending: 0 }, checkpoint: { status: "not_required" as const, readyAnchorJobIds: [] }, anchorDispatch: [], shotDispatch: [], inFlightPoll: [] };
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
