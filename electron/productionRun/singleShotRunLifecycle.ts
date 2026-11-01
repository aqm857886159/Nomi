import { matchNomiErrorCode, RETRIEVAL_UNAVAILABLE_MESSAGE, tagNomiError } from "../shared/nomiErrorCodes";
import { jobAwaitsRetrieval } from "../shared/productionShotPhase";
import { classifyUpstreamTaskStatus } from "../shared/taskStatus";
import { ProductionRunLockBusyError, ProductionRunLockLostError } from "./productionRunLock";
import { OUTPUT_RETRIEVAL_FAILED, type ProductionJob, type ProductionRun, type RunCommand, type RunCommandResult } from "./productionRunTypes";

/**
 * Durable lifecycle bridge for the semantic one-shot generation path.
 *
 * `ProductionGenerationSubmission` owns provider/job/artifact writes.  This
 * module owns the small amount of Run/stage state that surrounds those writes
 * so the task center never presents a materialized result as still running and
 * a failed observation is not retried forever on every project reopen.
 */
export type SingleShotRunLifecycleRepository = {
  read: (projectId: string, runId: string) => ProductionRun | null;
  execute: (projectId: string, runId: string, command: RunCommand) => RunCommandResult;
};

const SINGLE_SHOT_PLAYBOOK = "generation.single-shot";
const RUNNING_SOURCES = new Set<ProductionRun["status"]>([
  "draft",
  "ready",
]);
const NON_TERMINAL_JOB_STATUSES = new Set([
  "authorized",
  "submit_intent_persisted",
  "submitting",
  "provider_accepted",
  "polling",
  "retry_wait",
  "downloading",
  "validating_technical",
  "validating_content",
  "submission_unknown",
  "reconciling",
]);

function isSemanticSingleShot(run: ProductionRun): boolean {
  return run.playbook.name === SINGLE_SHOT_PLAYBOOK
    && run.generationPlan?.operationId === run.runId
    && !run.generationPlan.shots?.length;
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof Error && /revision conflict/i.test(error.message);
}

/**
 * 撞上了别的观察者或写者，不是这笔任务的失败：过一会儿再来，不记成取回失败。观察者和画布的查询共用这一个判据。
 * 忙（等生命周期锁到了期限）、锁被接手、账本版本被别人推进，都属于这一种。
 */
export function isObservationContention(error: unknown): boolean {
  return error instanceof ProductionRunLockBusyError || error instanceof ProductionRunLockLostError || isRevisionConflict(error);
}

/**
 * 观察这一笔失败了（查不到 / 取不回 / 落不下），任务号还在：它只差取回，不是失败。**不写人话**：界面按机器码说话（zh / en 都走词表）。
 * 这一次连问都问不了（模型 / Key 用不了）就说这个，它是眼下最新的事实；供应商说过做完了才说「已经生成」；否则只知道这次没查成
 * （`narrate` 的 `retrieval-incomplete`，用户 10-22 拍板不说「已经生成」）。原因只取机器码，不存原文。
 */
function retrievalAttentionPatch(job: Pick<ProductionJob, "providerStatus">, cause: unknown): { errorCode: string; errorMessage: string } {
  const finished = classifyUpstreamTaskStatus(job.providerStatus ?? "") === "succeeded";
  const unavailable = matchNomiErrorCode(cause instanceof Error ? cause.message : "") === "retrieval-unavailable";
  return {
    errorCode: OUTPUT_RETRIEVAL_FAILED,
    errorMessage: unavailable ? RETRIEVAL_UNAVAILABLE_MESSAGE : finished
      ? tagNomiError("output-retrieval-failed", "The provider finished this task, but Nomi could not retrieve the result")
      : tagNomiError("retrieval-query", "Nomi could not check this accepted task this time"),
  };
}

function commandFor(
  run: ProductionRun,
  type: string,
  payload: Record<string, unknown>,
  tag: string,
  now: () => string,
): RunCommand {
  return {
    commandId: `single-shot:${run.runId}:${tag}:${run.revision}`,
    expectedRevision: run.revision,
    type,
    payload,
    issuedAt: now(),
  };
}

/** Execute one lifecycle command, retrying a single optimistic-concurrency race. */
function mutate(
  repository: SingleShotRunLifecycleRepository,
  projectId: string,
  runId: string,
  build: (run: ProductionRun, now: () => string) => { type: string; payload: Record<string, unknown>; tag: string } | null,
  now: () => string,
): ProductionRun | null {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = repository.read(projectId, runId);
    if (!run || !isSemanticSingleShot(run)) return run;
    const next = build(run, now);
    if (!next) return run;
    try {
      return repository.execute(projectId, runId, commandFor(run, next.type, next.payload, next.tag, now)).run;
    } catch (error) {
      if (attempt === 0 && isRevisionConflict(error)) continue;
      throw error;
    }
  }
  return repository.read(projectId, runId);
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * 单镜语义 Run「供应商受理了 = 进行中」那一条命令；不是单镜语义 Run、或已经不在草稿 / 就绪就没有。
 * 提交出口把它和「已受理」放进同一次落盘（`productionGenerationSubmission`），交的那一刻 Run 就是进行中。
 */
export function singleShotRunningCommand(run: ProductionRun, now: () => string = defaultNow): Omit<RunCommand, "expectedRevision"> | null {
  if (!isSemanticSingleShot(run) || !RUNNING_SOURCES.has(run.status)) return null;
  const { expectedRevision: _revision, ...command } = commandFor(run, "run.status", { status: "running" }, "running", now);
  return command;
}

/** Mark a semantic one-shot as actively observed (settling a draft that never went through the submission owner). */
export function markSingleShotRunning(
  repository: SingleShotRunLifecycleRepository,
  projectId: string,
  runId: string,
  now: () => string = defaultNow,
): ProductionRun | null {
  return mutate(repository, projectId, runId, (run) => {
    if (!RUNNING_SOURCES.has(run.status)) return null;
    return { type: "run.status", payload: { status: "running" }, tag: "running" };
  }, now);
}

/**
 * Settle a materialized one-shot.  The artifact/job are written by the
 * submission owner first; this function only closes the Run and its generate
 * stage.  Repeated callbacks are idempotent.
 */
export function markSingleShotCompleted(
  repository: SingleShotRunLifecycleRepository,
  projectId: string,
  runId: string,
  options: { jobId?: string; artifactId?: string; now?: () => string } = {},
): ProductionRun | null {
  const now = options.now ?? defaultNow;
  let run = repository.read(projectId, runId);
  if (!run || !isSemanticSingleShot(run) || ["completed", "cancelled"].includes(run.status)) return run;
  // Completion is allowed only after the submission owner has durably written
  // one ready/adopted job and its local artifact.  This prevents an observer
  // race or a malformed provider response from turning a still-running Run
  // into a false success.
  const readyJobs = run.jobs.filter((job) => ["ready", "adopted"].includes(job.status));
  const targetJob = options.jobId
    ? readyJobs.find((job) => job.jobId === options.jobId)
    : readyJobs.length === 1 ? readyJobs[0] : undefined;
  if (!targetJob) return run;
  const targetArtifact = run.artifacts.find((artifact) =>
    artifact.jobId === targetJob.jobId
      && (!options.artifactId || artifact.artifactId === options.artifactId)
      && ["ready", "adopted"].includes(artifact.status)
      && Boolean(artifact.contentHash)
      && Boolean(artifact.projectRelativePath || artifact.thumbnailRelativePath),
  );
  if (!targetArtifact) return run;
  if (run.jobs.some((job) => job.jobId !== targetJob!.jobId && NON_TERMINAL_JOB_STATUSES.has(job.status))) return run;
  if (["paused", "pausing", "needs_attention"].includes(run.status)) return run;
  if (RUNNING_SOURCES.has(run.status)) {
    run = markSingleShotRunning(repository, projectId, runId, now) ?? run;
  }
  run = repository.read(projectId, runId) ?? run;
  const generateStage = run.stages.find((stage) => stage.stageId === "generate");
  if (generateStage && generateStage.status !== "completed") {
    run = mutate(repository, projectId, runId, (current) => {
      const stage = current.stages.find((candidate) => candidate.stageId === "generate");
      if (!stage || stage.status === "completed") return null;
      return {
        type: "stage.upsert",
        payload: {
          stage: {
            ...stage,
            status: "completed",
            completedAt: stage.completedAt ?? now(),
          },
        },
        tag: "stage-completed",
      };
    }, now) ?? run;
  }
  run = repository.read(projectId, runId) ?? run;
  if (run.status === "running") {
    run = mutate(repository, projectId, runId, (current) => current.status === "running"
      ? { type: "run.status", payload: { status: "completed" }, tag: "completed" }
      : null, now) ?? run;
  }
  return run;
}

/**
 * Persist an observation/materialization failure.  The fixed message avoids
 * leaking provider response text (which can contain credentials or payloads)
 * into the durable project log.  A job that still has its provider task id is
 * only waiting to be retrieved (`jobAwaitsRetrieval`), never dead; one without
 * a task id has nothing to retrieve.  No provider submission is attempted here.
 */
export function markSingleShotAttention(
  repository: SingleShotRunLifecycleRepository,
  projectId: string,
  runId: string,
  jobId?: string,
  options: { cause?: unknown; now?: () => string } = {},
): ProductionRun | null {
  const now = options.now ?? defaultNow;
  let run = repository.read(projectId, runId);
  if (!run || !isSemanticSingleShot(run) || ["completed", "cancelled"].includes(run.status)) return run;
  if (jobId) {
    const job = run.jobs.find((candidate) => candidate.jobId === jobId);
    if (job && NON_TERMINAL_JOB_STATUSES.has(job.status) && job.status !== "needs_attention") {
      run = mutate(repository, projectId, runId, (current) => {
        const currentJob = current.jobs.find((candidate) => candidate.jobId === jobId);
        if (!currentJob || !NON_TERMINAL_JOB_STATUSES.has(currentJob.status) || currentJob.status === "needs_attention") return null;
        return {
          type: "job.status",
          payload: {
            jobId,
            status: "needs_attention",
            patch: currentJob.providerTaskId ? retrievalAttentionPatch(currentJob, options.cause) : {
              errorCode: "single_shot_observation_failed",
              errorMessage: "生成结果未能安全落入项目，请查看任务并处理",
            },
          },
          tag: `job-attention-${jobId}`,
        };
      }, now) ?? run;
    }
  }
  run = repository.read(projectId, runId) ?? run;
  const generateStage = run.stages.find((stage) => stage.stageId === "generate");
  if (generateStage && generateStage.status !== "completed" && generateStage.status !== "needs_attention") {
    run = mutate(repository, projectId, runId, (current) => {
      const stage = current.stages.find((candidate) => candidate.stageId === "generate");
      if (!stage || stage.status === "completed" || stage.status === "needs_attention") return null;
      return {
        type: "stage.upsert",
        payload: { stage: { ...stage, status: "needs_attention" } },
        tag: "stage-attention",
      };
    }, now) ?? run;
  }
  run = repository.read(projectId, runId) ?? run;
  if (run.status === "running") {
    run = mutate(repository, projectId, runId, (current) => current.status === "running"
      ? { type: "run.status", payload: { status: "needs_attention", reason: "failed" }, tag: "attention" }
      : null, now) ?? run;
  } else if (RUNNING_SOURCES.has(run.status)) {
    run = markSingleShotRunning(repository, projectId, runId, now) ?? run;
    run = mutate(repository, projectId, runId, (current) => current.status === "running"
      ? { type: "run.status", payload: { status: "needs_attention", reason: "failed" }, tag: "attention" }
      : null, now) ?? run;
  }
  return run;
}

/**
 * 「重新取回」：把只差取回的那一笔放回轮询，Run 和生成阶段跟着回到进行中（三条一次落盘），然后由调用方真去查一次。
 * 全程不碰提交：只用已有的任务号，不预留、不扣费、不新建作业。这一笔不是在等取回（或不是单镜语义 Run）= null，什么都不写。
 */
export function reopenSingleShotRetrieval(
  repository: SingleShotRunLifecycleRepository & { executeBatch: (projectId: string, runId: string, expectedRevision: number, commands: ReadonlyArray<Omit<RunCommand, "expectedRevision">>) => RunCommandResult[] },
  projectId: string,
  runId: string,
  jobId: string,
  options: { commandId?: string; now?: () => string } = {},
): RunCommandResult | null {
  const now = options.now ?? defaultNow;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = repository.read(projectId, runId);
    if (!run || !isSemanticSingleShot(run) || !jobAwaitsRetrieval(run.jobs.find((job) => job.jobId === jobId))) return null;
    const issuedAt = now();
    const base = options.commandId ?? `single-shot:${runId}:reopen-retrieval:${run.revision}`;
    const stage = run.stages.find((candidate) => candidate.stageId === "generate");
    const commands: Array<Omit<RunCommand, "expectedRevision">> = [
      { commandId: base, type: "job.status", payload: { jobId, status: "polling", patch: { errorCode: "", errorMessage: "" } }, issuedAt },
      ...(stage?.status === "needs_attention" ? [{ commandId: `${base}:stage`, type: "stage.upsert", payload: { stage: { ...stage, status: "running" } }, issuedAt }] : []),
      ...(run.status === "needs_attention" ? [{ commandId: `${base}:run`, type: "run.status", payload: { status: "running" }, issuedAt }] : []),
    ];
    try {
      return repository.executeBatch(projectId, runId, run.revision, commands).at(-1)!;
    } catch (error) {
      if (attempt === 1 || !isRevisionConflict(error)) throw error;
    }
  }
  return null;
}
