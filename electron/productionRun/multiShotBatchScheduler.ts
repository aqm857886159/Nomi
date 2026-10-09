import { deriveBatchPlan, type BatchDerivationResult, type CheckpointState, type DispatchTask } from "./batchScheduleDerivation";
import type { ProductionRun } from "./productionRunTypes";
import type { ProductionRunRepository } from "./productionRunRepository";
import { GenerationMaterializationUnsupportedError, GenerationOutputRetrievalFailedError, type ProductionGenerationSubmission } from "./productionGenerationSubmission";
import { currentAnchorCheckpointGate, buildAnchorCheckpointGate } from "./anchorCheckpoint";
import { logInfo, logWarn } from "../logging/logger";
import { latestSpendAuthorizationDigest } from "../shared/productionSpendAuthority";
import { DispatchConsentLapsedError } from "../shared/productionDispatchConsent";
import { admitShotsForDispatch, recordLandingFailure, type LandedShotAdmission, type LandShotsOnCanvas } from "./shotLandingAdmission";

/**
 * P4 S4 — the durable batch scheduler orchestrator (plan §3.3). It has NO persistent state of its own:
 * every tick it reads the durable Run, calls the pure `deriveBatchPlan`, and turns the answer into side
 * effects (reserve + submit inside the Run lock via the submission facade; open/decide the anchor
 * checkpoint gate; stop the Run when it cannot go on by itself). A crash-restart re-runs the SAME loop over
 * the reloaded Run and converges — because "what was submitted" lives in `jobs[]`, "what was spent" lives in
 * the ledger, and "did the anchor pass" lives in the gate. See batchScheduleDerivation.ts for why.
 *
 * ## Consent that went stale (2026-10-01, paid card ① rule 13)
 *
 * A shot a person approved is only dispatched while that approval is fresh — the dispatch gate
 * (`productionGenerationSubmission`) asks `productionDispatchConsent`, the one owner of that question, and
 * refuses with `DispatchConsentLapsedError` once the window since the person's last click (approve, release
 * the look, continue) has passed. That is not a failure and not a reason to wait: nobody is going to renew it
 * but the person, so the drive stops the Run with `consent_expired` and the canvas asks him to click once more.
 * It never leaves the shot "queued" with nothing that will ever dispatch it.
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
  /**
   * 先落节点、再发请求（架构③）：每一趟派发前，没节点的镜先经它落到画布上（唯一准入点 `admitShotsForDispatch`）。
   * 落不下来的镜这一趟不派，批次歇下时停在 `landing_failed`。必填：没有落地器就造不出调度器。
   */
  landShots: LandShotsOnCanvas;
  projectId: string;
  runId: string;
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
  /**
   * True when the batch reached a stable resting point (all shots done, or blocked on checkpoint/stop).
   * False when pollable in-flight work outlived this drive's wait budget (slow provider) or the
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
      commandId: `batch.scheduler:${run.runId}:${latestSpendAuthorizationDigest(run) ?? run.planVersion}:${suffix}`,
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
   * A DETERMINISTIC retrieval failure is not transient (#975 A2): the submission layer has already parked the
   * job at needs_attention ("generated, but the result could not be retrieved"), so it is settled — before this,
   * every round re-polled the provider and re-downloaded the whole video only to be refused again, across every
   * re-kick, forever (the shape of "the last 3 shots stay polling, the main process pegs CPU and memory").
   * Dispatch refusals cannot originate here: poll/materialize never reserve and never re-check consent.
   */
  async function observeUnitOnce(task: DispatchTask): Promise<"settled" | "pending"> {
    try {
      const polled = await deps.submission.poll({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId, attempt: task.attempt });
      if (polled.nextAction === "materialize") {
        await deps.submission.materialize({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId, attempt: task.attempt });
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
      // 两种都已经由提交门面耐久地落成 needs_attention：已结清，不再重查重下。
      if (error instanceof GenerationOutputRetrievalFailedError || error instanceof GenerationMaterializationUnsupportedError) {
        logWarn("production-run", "batch-output-retrieval-failed", { shotId: task.shotId }, error);
        return "settled";
      }
      logWarn("production-run", "batch-observe-failed", { shotId: task.shotId }, error);
      return "pending";
    }
  }

  /** Submit one unit (anchor or shot), then poll once: instant providers settle in the same tick; a slow
   * provider leaves the job at `polling` and the derivation's `observe` list + waiting rounds take over. */
  async function dispatchUnit(task: DispatchTask, admission: LandedShotAdmission): Promise<void> {
    const started = await deps.submission.start({ projectId: deps.projectId, operationId: deps.runId, shotId: task.shotId, attempt: task.attempt, admission });
    if (started.nextAction !== "observe") return;
    await observeUnitOnce(task);
  }

  /** Open the anchor checkpoint gate (§3.2) referencing the ready anchor jobs — a free quality gate. */
  function openCheckpoint(run: ProductionRun, checkpoint: CheckpointState): ProductionRun {
    const gate = buildAnchorCheckpointGate({ runId: run.runId, planHash: latestSpendAuthorizationDigest(run) ?? "", anchorJobIds: checkpoint.readyAnchorJobIds, now: now() });
    return command(run, "gate.add", { gate }, `open-anchor-checkpoint:${gate.gateId}`);
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

  /** 批次自己停下（可查询的停）。原因在停的这一刻写进命令，由生命周期 owner 落成 run.stop。 */
  function stopRun(reason: "consent_expired" | "failed"): void {
    const run = requireRun(deps);
    if (run.status !== "running") return;
    command(run, "run.status", { status: "needs_attention", reason }, `batch-stop-${reason}-${run.revision}`);
  }

  /**
   * 这一趟驱动歇下来了（再没有能自己派、能自己轮询的活）：批次该不该停、为什么停，**只在这里判一次**。
   *   · 这一趟里有批过的单元因为同意过了窗口派不出去（`consentLapsed`）→ 停，原因 consent_expired：只有用户再点一下
   *     能续上，等下去不会有任何变化（付费卡① 第 13 条）。排在失败前面：点了「继续」之后真正没成的镜照样会如实停在 failed；
   *   · 有单元的当前尝试确定没成（参考卡或视频镜），而且不是在等人看形象（检查点 waiting）→ 停，原因 failed；
   *   · 其余（等人看形象、整批做完交给收尾）不停。
   * 以前这几种各有各的调用点：整批做完时才判失败，于是参考卡失败时（检查点卡在 pending_anchors）Run 永远 running、
   * 视频镜永远「排队中」（2026-09-18 C9 与 2026-09-29 用户实见同一族）。2026-10-01 删掉了「预算不够 → 停在 budget」：
   * 授权按镜批之后，它只会停下一镜用户亲手批过的镜（见 batchScheduleDerivation 文件头）。
   */
  function settleAtRest(result: BatchDerivationResult, consentLapsed: ReadonlySet<string>, landingFailed: ReadonlySet<string>): void {
    if (consentLapsed.size > 0) {
      stopRun("consent_expired");
      return;
    }
    // 有批过的镜没能先落到画布上：它们一个都没派（先落节点、再发请求）。停下等用户打开项目后点「继续」= 重落再派。
    if (landingFailed.size > 0) {
      recordLandingFailure(deps.repository, deps.projectId, deps.runId, now);
      return;
    }
    if (result.checkpoint.status === "waiting") return;
    if (result.failedUnits.length > 0) stopRun("failed");
  }

  /**
   * 派一个单元；同意过了窗口（`DispatchConsentLapsedError`）不是失败，记进 `consentLapsed`，这一趟不再碰它。
   * 返回 false = 没派出去（同意过期）。其余错误原样抛给调用方处置。
   */
  async function dispatchWithConsent(task: DispatchTask, admission: LandedShotAdmission, consentLapsed: Set<string>): Promise<boolean> {
    try {
      await dispatchUnit(task, admission);
      return true;
    } catch (error) {
      if (!(error instanceof DispatchConsentLapsedError)) throw error;
      consentLapsed.add(task.shotId);
      logInfo("production-run", "batch-dispatch-consent-lapsed", { shotId: task.shotId, gateId: error.gateId });
      return false;
    }
  }

  /**
   * 这一趟要派的单元先过唯一准入（没节点的先落画布）。落不下来的记进 `landingFailed`，这一趟不再碰它；
   * 返回能派的那几个和各自的准入。
   */
  async function admitForDispatch(tasks: readonly DispatchTask[], landingFailed: Set<string>): Promise<Array<{ task: DispatchTask; admission: LandedShotAdmission }>> {
    if (tasks.length === 0) return [];
    const outcome = await admitShotsForDispatch({
      repository: deps.repository, land: deps.landShots, projectId: deps.projectId, runId: deps.runId,
      shotIds: tasks.map((task) => task.shotId),
    });
    for (const shotId of outcome.unlanded) {
      landingFailed.add(shotId);
      logInfo("production-run", "batch-dispatch-not-landed", { shotId });
    }
    return tasks.flatMap((task) => {
      const admission = outcome.admitted.get(task.shotId);
      return admission ? [{ task, admission }] : [];
    });
  }

  async function runToQuiescence(): Promise<BatchOutcome> {
    let dispatchedShots = 0;
    let lastResult: BatchDerivationResult | undefined;
    // 这一趟驱动里已经失败过的镜：不在同一趟里反复重试，也**不让它带走整批**。
    const failedShots = new Set<string>();
    // 这一趟里因为同意过了窗口没派出去的单元（参考卡或视频镜）：歇下来时据此停在 consent_expired。
    const consentLapsed = new Set<string>();
    // 这一趟里没能先落到画布上的单元：一个都不派，歇下来时据此停在 landing_failed。
    const landingFailed = new Set<string>();

    // A confirmed multi-shot plan drives the run. Gate approval already wrote the only budget
    // authorization; the scheduler may start execution but can never mint or raise spend authority.
    {
      const seed = requireRun(deps);
      const batchActive = seed.generationPlan?.state === "submitted" && (seed.generationPlan?.shots?.length ?? 0) > 0;
      if (batchActive && seed.status === "draft") {
        command(seed, "run.status", { status: "running" }, `batch-start-running:v${seed.planVersion}`);
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
      const run = requireRun(deps);
      const plan = run.generationPlan;
      if (!plan) throw new Error(`Batch scheduler requires a generation plan: ${run.runId}`);

      const anchorGate = currentAnchorCheckpointGate(run);
      const result = deriveBatchPlan({
        run,
        runId: run.runId,
        runStatus: run.status,
        plan,
        jobs: run.jobs,
        anchorGate,
        now: now(),
      });
      lastResult = result;

      // 1. Open the checkpoint once anchors are ready and no gate exists yet.
      if (result.checkpoint.status === "should_open") {
        if (!consumeTick()) break;
        openCheckpoint(run, result.checkpoint);
        continue; // re-derive with the gate present
      }
      // 2. Dispatch anchors first (fresh or a rejected-checkpoint re-attempt). One whose consent went stale is
      // left alone for the rest of this drive (re-dispatching it would only be refused again).
      const pendingAnchors = result.anchorDispatch.filter((task) => !consentLapsed.has(task.shotId) && !landingFailed.has(task.shotId));
      if (pendingAnchors.length > 0) {
        if (!consumeTick()) break;
        for (const { task, admission } of await admitForDispatch(pendingAnchors, landingFailed)) {
          await dispatchWithConsent(task, admission, consentLapsed);
        }
        continue; // re-derive: anchors now have jobs; checkpoint may open next
      }

      // 3. Dispatch shots (the derivation only clears them once the checkpoint released / no anchors).
      // Reserve happens inside the Run lock; the ledger's reserve is the hard wall against spending more
      // than was approved — hitting it is a failure of that one shot, like any other dispatch error below.
      const pendingDispatch = result.shotDispatch.filter((task) => !failedShots.has(task.shotId) && !consentLapsed.has(task.shotId) && !landingFailed.has(task.shotId));
      if (pendingDispatch.length > 0) {
        if (!consumeTick()) break;
        for (const { task, admission } of await admitForDispatch(pendingDispatch, landingFailed)) {
          if (options.maxShotsPerRun !== undefined && dispatchedShots >= options.maxShotsPerRun) {
            return { progress: result.progress, checkpoint: result.checkpoint, quiescent: true };
          }
          try {
            if (await dispatchWithConsent(task, admission, consentLapsed)) dispatchedShots += 1;
          } catch (error) {
            // 派不出去的失败**只带走这一镜**。此前这里 `throw error` 会逐出 `runToQuiescence`，
            // 上游只剩一行 logWarn、无人重踢——于是一次瞬时出站失败把整批带走：
            // 已经付过钱、真在飞的兄弟镜停在 `polling` 再没人轮询，剩下的镜从未派发，
            // Run 连 `needs_attention` 都不进（2026-09-18 C9 间歇红的根因第三层）。
            // 同文件的 `observeUnitOnce` 早就写着这条防线的理由：「一条抖动不许杀死兄弟镜的长观察」。
            // 这一镜的耐久状态由提交那层写（未派发→`needs_attention`，未知→`submission_unknown`），
            // 调度器只负责别死。
            failedShots.add(task.shotId);
            // 派发准入闸拒了（画布接手 / 删了节点 / 急停）：这一镜本来就不该派，不是一次失败，不记成 batch-dispatch-failed。
            if (isShotClaimDenied(error)) logInfo("production-run", "batch-dispatch-skipped", { shotId: task.shotId, reason: claimDenialReason(error) });
            else logWarn("production-run", "batch-dispatch-failed", { shotId: task.shotId }, error);
          }
        }
        continue; // re-derive: dispatched shots now have jobs; stop/completion decided next
      }

      // 4. Units in flight → poll them in rounds with REAL waits between rounds (the slow-provider fix:
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
          continue; // re-derive: checkpoint may open / batch may complete
        }
        if (sleptMs >= pollHorizonMs) {
          // In-flight work outlived this drive's wait budget. Rest HONESTLY (quiescent: false — never
          // true while pollable work remains): the durable Run keeps the jobs at provider_accepted/
          // polling, so any re-kick (timer / project reopen / restart) resumes via `observe`.
          return { progress: result.progress, checkpoint: result.checkpoint, quiescent: false };
        }
        const delayMs = Math.min(POLL_DELAY_START_MS * 2 ** backoffStep, POLL_DELAY_CAP_MS, pollHorizonMs - sleptMs);
        backoffStep += 1;
        sleptMs += delayMs;
        await sleep(delayMs);
        continue; // waiting round — bounded by pollHorizonMs, does not consume maxTicks
      }

      // 6. If the checkpoint is waiting (user must approve) → rest here (nothing more to do this run).
      // pending_anchors here means anchors are neither dispatchable nor pollable (e.g. needs_attention)
      // — a genuine rest until the user re-attempts them; settleAtRest says whether that rest is a stop.
      if (result.checkpoint.status === "waiting" || result.checkpoint.status === "pending_anchors" || result.checkpoint.status === "rejected") {
        settleAtRest(result, consentLapsed, landingFailed);
        return { progress: result.progress, checkpoint: result.checkpoint, quiescent: true };
      }

      // 7. Nothing to dispatch, observe or decide → the batch is complete (or stopped, or waiting for the
      // person to renew consent). Keep QA/assembly/export in the owning production pipeline. This callback
      // is only emitted for a fully settled batch; checkpoint waits and partial test drives never trigger it.
      await notifyBatchComplete(result.progress);
      settleAtRest(result, consentLapsed, landingFailed);
      return { progress: result.progress, checkpoint: result.checkpoint, quiescent: true };
    }

    // Bounded-out (should not happen for a healthy batch) — report the last derived state. The loop ran
    // at least once (maxTicks >= 8), so lastResult is set; fall back to an empty progress only defensively.
    const result = lastResult ?? { progress: { total: 0, completed: 0, inFlight: 0, pending: 0 }, checkpoint: { status: "not_required" as const, readyAnchorJobIds: [] }, anchorDispatch: [], shotDispatch: [], observe: [], failedUnits: [] };
    return { progress: result.progress, checkpoint: result.checkpoint, quiescent: false };
  }

  return { runToQuiescence };
}

/** 派发准入闸的拒绝（canvasShotClaim 抛出的错误带结构化的 code: production_shot_claimed 与 reason）。 */
function isShotClaimDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "production_shot_claimed";
}

function claimDenialReason(error: unknown): string {
  const reason = (error as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : "unknown";
}

export type MultiShotBatchScheduler = ReturnType<typeof createMultiShotBatchScheduler>;
