import { classifyUpstreamTaskStatus } from "../shared/taskStatus";
import { OUTPUT_RETRIEVAL_FAILED, type ProductionRun } from "./productionRunTypes";

export type GenerationSubmissionMaterializeResult = {
  operationId: string;
  runId: string;
  jobId: string;
  providerTaskId: string;
  artifactId: string;
  contentHash: string;
  nextAction: "completed";
};

export class GenerationMaterializationUnsupportedError extends Error {
  readonly code = "provider_materialization_unsupported" as const;

  constructor(message = "This provider has no verified output materialization path") {
    super(message);
    this.name = "GenerationMaterializationUnsupportedError";
  }
}

export class GenerationMaterializationError extends Error {
  readonly code = "materialization_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "GenerationMaterializationError";
  }
}

/**
 * 供应商说成了、产物取不回来，而且再取一次也不会不一样（#975 A2）。抛出前这一镜已经**耐久地**进了
 * needs_attention（errorCode = output_retrieval_failed）：调用方据此把它当成「已结清」而不是「还在处理」，
 * 不许下一轮再查再下。仍是 GenerationMaterializationError（code materialization_failed），既有的单镜对账照旧认得。
 */
export class GenerationOutputRetrievalFailedError extends GenerationMaterializationError {
  constructor(message: string) {
    super(message);
    this.name = "GenerationOutputRetrievalFailedError";
  }
}

type RetrievalFailure = { code?: unknown; deterministic?: unknown; message?: unknown };

export function deterministicRetrievalFailure(error: unknown): error is RetrievalFailure & { message: string } {
  const value = error as RetrievalFailure | null;
  return Boolean(value && typeof value === "object" && value.code === OUTPUT_RETRIEVAL_FAILED && value.deterministic === true);
}


type ProviderPollStatusClass = "pending" | "succeeded" | "failed" | "unknown";

/**
 * Provider adapters expose their native status verbatim.  The submission seam
 * must only advance a job for a status that is explicitly known to be pending,
 * successful, or failed.  Treating an unrecognised verb as success is unsafe
 * (it can materialize an incomplete output); treating it as pending is worse
 * (the observer can spin forever).  The vocabulary itself lives in exactly one
 * place (shared/taskStatus, #1213) — engine A asks the same table.
 */
export function classifyProviderStatus(status: string): ProviderPollStatusClass {
  const cls = classifyUpstreamTaskStatus(status);
  if (cls === "queued" || cls === "running") return "pending";
  if (cls === "succeeded") return "succeeded";
  if (cls === "failed" || cls === "cancelled") return "failed";
  return "unknown";
}

export function isPendingProviderStatus(status: string): boolean {
  return classifyProviderStatus(status) === "pending";
}

export function isSuccessfulProviderStatus(status: string): boolean {
  return classifyProviderStatus(status) === "succeeded";
}

export function isFailedProviderStatus(status: string): boolean {
  return classifyProviderStatus(status) === "failed";
}

/**
 * 产物已经在账上，job 落在后面（崩在记产物和改 job 之间，或这一笔先被停成「需要处理」）：把 job 补到 ready。
 * 停成「需要处理」的不能直达 ready，先回轮询（同一条可重放的边）。已取消 / 脱离的没有这条边，不补。
 */
export function catchUpJobToArtifact(
  run: ProductionRun,
  jobId: string,
  command: (run: ProductionRun, type: string, payload: Record<string, unknown>, suffix: string) => ProductionRun,
): void {
  let current = run;
  const behind = current.jobs.find((candidate) => candidate.jobId === jobId)!;
  if (behind.status === "needs_attention") current = command(current, "job.status", { jobId, status: "polling", patch: { errorCode: "", errorMessage: "" } }, `materialize-job-resume:${jobId}:${current.revision}`);
  if (behind.status === "needs_attention" || behind.status === "provider_accepted" || behind.status === "polling") command(current, "job.status", { jobId, status: "ready", patch: { lastPollAt: behind.lastPollAt } }, `materialize-job:${jobId}`);
}
