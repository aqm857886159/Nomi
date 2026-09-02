import type { ProductionRun, RunCommand, RunCommandResult } from "./productionRunTypes";

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

/** Mark an accepted semantic one-shot as actively observed. */
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
 * into the durable project log; the user can open the provider task to
 * reconcile it.  No provider submission is attempted here.
 */
export function markSingleShotAttention(
  repository: SingleShotRunLifecycleRepository,
  projectId: string,
  runId: string,
  jobId?: string,
  now: () => string = defaultNow,
): ProductionRun | null {
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
            patch: {
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
      ? { type: "run.status", payload: { status: "needs_attention" }, tag: "attention" }
      : null, now) ?? run;
  } else if (RUNNING_SOURCES.has(run.status)) {
    run = markSingleShotRunning(repository, projectId, runId, now) ?? run;
    run = mutate(repository, projectId, runId, (current) => current.status === "running"
      ? { type: "run.status", payload: { status: "needs_attention" }, tag: "attention" }
      : null, now) ?? run;
  }
  return run;
}
