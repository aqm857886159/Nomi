import type { GenerationOperation } from "./mcpGenerationTools";
import type { ProductionRun } from "../productionRun/productionRunTypes";

/** The only result a semantic multi-shot start may expose before the batch settles. */
export type SemanticBatchStartResult = Readonly<{
  operationId: string;
  state: "submitted";
  nextAction: "observe";
}>;

export type SemanticBatchStartScheduler = Readonly<{
  runToQuiescence: () => Promise<unknown>;
}>;

type DurableBatchRun = Pick<ProductionRun, "projectId" | "runId" | "revision" | "generationPlan">;

export type SemanticBatchStartDependencies = Readonly<{
  readRun: (projectId: string, runId: string) => DurableBatchRun | null;
  /** Persist the sealed-to-submitted transition. This is a Run command, never a second owner. */
  submitPlan: (run: DurableBatchRun) => unknown | Promise<unknown>;
  createScheduler: (run: DurableBatchRun) => SemanticBatchStartScheduler;
  /** Fire the existing durable scheduler; it owns per-shot provider submission and polling. */
  driveScheduler: (scheduler: SemanticBatchStartScheduler) => void;
}>;

/**
 * Start a semantic multi-shot operation through the durable batch scheduler.
 *
 * The old stdio path called the single-shot submission facade with no shotId,
 * which submitted only the top-level contract while reporting observe. This
 * helper makes the invariant explicit: a plan with shots must first be in the
 * durable submitted state, then be handed to the scheduler. No provider
 * submission happens in this function itself, so retries remain idempotent in
 * the scheduler/outbox and the caller never receives a false single-shot
 * success.
 */
export async function startSemanticMultiShotBatch(
  operation: Pick<GenerationOperation, "operationId" | "projectId" | "shots">,
  deps: SemanticBatchStartDependencies,
): Promise<SemanticBatchStartResult> {
  if (!operation.shots || operation.shots.length === 0) {
    throw Object.assign(new Error("semantic_multi_shot_plan_missing"), { code: "semantic_multi_shot_plan_missing" });
  }
  let run = deps.readRun(operation.projectId, operation.operationId);
  if (!run || !run.generationPlan?.shots || run.generationPlan.shots.length === 0) {
    throw Object.assign(new Error("semantic_multi_shot_plan_missing"), { code: "semantic_multi_shot_plan_missing" });
  }
  if (run.generationPlan.state === "sealed") {
    await deps.submitPlan(run);
    run = deps.readRun(operation.projectId, operation.operationId);
  }
  if (!run || run.generationPlan?.state !== "submitted" || !run.generationPlan.shots?.length) {
    throw Object.assign(new Error("semantic_batch_not_submitted"), { code: "semantic_batch_not_submitted" });
  }
  const scheduler = deps.createScheduler(run);
  // driveScheduler is intentionally fire-and-forget at the transport boundary:
  // providers can take minutes. It is invoked only after the durable transition.
  deps.driveScheduler(scheduler);
  return { operationId: operation.operationId, state: "submitted", nextAction: "observe" };
}
