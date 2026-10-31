import { jobAwaitsRetrieval } from "../shared/productionShotPhase";
import { isSemanticMultiShotRun } from "./productionRunDriverOps";
import type { ProductionRun, RunCommand, RunCommandResult } from "./productionRunTypes";
import { reopenSingleShotRetrieval } from "./singleShotRunLifecycle";

/**
 * 「已生成但取回失败」→ 重新取回（#975 A2）。只做一件事：把这一镜放回轮询，调用方再叫醒批次调度器去**查一次、取一次**。
 * 不重新提交、不预留、不扣费：轮询只用已有的供应商任务号；停着的 Run 也只观察在飞的镜，不派新的。
 */
export function retryJobRetrieval(
  repository: Parameters<typeof reopenSingleShotRetrieval>[0],
  projectId: string,
  runId: string,
  run: ProductionRun,
  runCommand: RunCommand,
): RunCommandResult {
  const jobId = typeof runCommand.payload.jobId === "string" ? runCommand.payload.jobId.trim() : "";
  const job = run.jobs.find((candidate) => candidate.jobId === jobId);
  if (!job || !jobAwaitsRetrieval(job)) throw new Error("Production job is not waiting for its result to be retrieved");
  if (!isSemanticMultiShotRun(run)) {
    const reopened = reopenSingleShotRetrieval(repository, projectId, runId, jobId, { commandId: runCommand.commandId, now: () => runCommand.issuedAt });
    if (!reopened) throw new Error("Retrieving a result again is only available for generation shots");
    return reopened;
  }
  return repository.execute(projectId, runId, {
    ...runCommand,
    type: "job.status",
    payload: { jobId, status: "polling", patch: { errorCode: "", errorMessage: "" } },
  });
}
