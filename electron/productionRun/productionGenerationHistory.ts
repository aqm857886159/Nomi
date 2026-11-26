import type { ExecutionContractV1 } from "../capabilityCore/executionContract";
import type { ProductionRunRepository } from "./productionRunRepository";
import type { ProductionJob, ProductionRun } from "./productionRunTypes";
import { nextGenerationAttempt } from "./prepareProductionGenerationAuthorization";
import { authorizationGateForJob, normalizeLegacySpendAuthority } from "../shared/productionSpendAuthority";

/**
 * 一次执行的身份：哪一镜、第几次尝试。找不到或对不上，调用方要**分得清**这是「恢复态坏了」
 * 还是「冻结合同不见了」——`resume()` 对前者的既有契约是返回 `attention/invalid_recovery_state`，
 * 不是抛异常（抛异常等于把一个可分诊的状态变成一次崩溃）。
 */
export function findGenerationExecutionJob(
  run: ProductionRun,
  input: { shotId?: string; attempt?: number },
): ProductionJob | undefined {
  const matches = run.jobs.filter(job => job.stageId === "generate" && job.metadata?.shotId === input.shotId
    && (input.attempt === undefined || job.attempt === input.attempt));
  const attempt = input.attempt ?? Math.max(0, ...matches.map(job => job.attempt));
  const addressed = matches.filter(job => job.attempt === attempt);
  return addressed.length === 1 ? addressed[0] : undefined;
}

/**
 * 冻结合同的进程内索引。
 *
 * 为什么可以记：一份冻结合同由 `(projectId, runId, jobId, attempt, authorizationDigest)` 唯一确定，
 * 而事件日志只追加——同一个身份永远解出同一份合同，不存在「读到旧值」这回事。
 *
 * 为什么必须记：`poll()`/`materialize()` 在批次轮询里是**每镜每轮**调用的。当前快照的 digest
 * 对不上（重试、历史 attempt——也正是这个函数存在的理由）就要回事件日志里找；不记这一份，
 * 每一轮都会把整条日志重放一遍，把 T8 的增量索引原地抵消掉。
 *
 * 超限驱逐只让下一次重新扫一遍，不改变任何判定结果。（对照 `requestRevisions` 那次驱逐：那一次
 * 驱逐会让写静默降级成没有 CAS 保护——那种驱逐不许有，这种可以。）
 */
const FROZEN_CONTRACT_INDEX_LIMIT = 512;
const FROZEN_CONTRACT_KEY_SEPARATOR = "␟";
const frozenContracts = new Map<string, ExecutionContractV1>();

function rememberFrozenContract(key: string, contract: ExecutionContractV1): ExecutionContractV1 {
  if (frozenContracts.size >= FROZEN_CONTRACT_INDEX_LIMIT) {
    frozenContracts.delete(frozenContracts.keys().next().value!);
  }
  frozenContracts.set(key, contract);
  return contract;
}

/** Read-only execution identity. The existing event log is the immutable contract archive. */
export function readGenerationExecution(
  repository: ProductionRunRepository,
  run: ProductionRun,
  input: { shotId?: string; attempt?: number },
): { job: ProductionJob; contract: ExecutionContractV1; currentAuthority: boolean } {
  const job = findGenerationExecutionJob(run, input);
  if (!job) throw new Error("Generation execution identity is missing or ambiguous");
  const fromSnapshot = (stored: ProductionRun | undefined): ExecutionContractV1 | undefined => {
    // 事件里的旧快照可能还是「授权挂在计划上」的形状：先归一，再按「批这个 job 的那道门」找冻住的那一份。
    const snapshot = stored ? normalizeLegacySpendAuthority(stored) : undefined;
    const plan = snapshot?.generationPlan;
    if (!snapshot || !plan || !job.authorizationDigest) return undefined;
    const authorized = authorizationGateForJob(snapshot, job)?.authorizationEnvelope.jobs
      .find(entry => entry.jobId === job.jobId && entry.attempt === job.attempt);
    const contract = input.shotId ? plan.shots?.find(shot => shot.shotId === input.shotId)?.contract : plan.contract;
    return authorized && contract?.contractHash === authorized.contractHash ? contract : undefined;
  };
  const current = fromSnapshot(run);
  if (current) return {
    job, contract: current,
    currentAuthority: ["sealed", "submitted"].includes(run.generationPlan!.state)
      && authorizationGateForJob(run, job)?.status === "approved",
  };
  const key = [run.projectId, run.runId, job.jobId, job.attempt, job.authorizationDigest ?? ""].join(FROZEN_CONTRACT_KEY_SEPARATOR);
  const indexed = frozenContracts.get(key);
  if (indexed) return { job, contract: indexed, currentAuthority: false };
  // Newest first, decoded one entry at a time: a hit stops the scan instead of replaying the log.
  for (const event of repository.readEventsReverse(run.projectId, run.runId)) {
    const contract = fromSnapshot(event.payload?.run as ProductionRun | undefined);
    if (contract) return { job, contract: rememberFrozenContract(key, contract), currentAuthority: false };
  }
  throw new Error("Frozen generation execution contract is unavailable");
}

/**
 * P4 S1: resolve the sub-contract this call addresses.
 * - No shotId → the default (single) shot: the top-level plan contract.
 * - shotId → that shot's sealed sub-contract.
 * 批没批准不在这里判：派发前 `prepareAuthorizedSubmission` 核「批这个 job 的那道门」（唯一判据），这里只要合同在。
 */
export function requiredGenerationContract(run: ProductionRun, shotId?: string): ExecutionContractV1 {
  const plan = run.generationPlan;
  if (!plan || (plan.state !== "sealed" && plan.state !== "submitted")) {
    throw new Error("Seal and confirm the generation plan before starting");
  }
  if (shotId) {
    const shot = (plan.shots ?? []).find((candidate) => candidate.shotId === shotId);
    if (!shot?.contract) throw new Error("Seal and confirm the generation plan before starting");
    return shot.contract;
  }
  if (!plan.contract) throw new Error("Seal and confirm the generation plan before starting");
  return plan.contract;
}

/**
 * 「这次提交要发的是第几次尝试」**只有一个 owner**：`nextGenerationAttempt`（按 `metadata.shotId`
 * 数这一镜已有的 attempt）。授权在 job 落盘**之前**问它，拿到 `max + 1`；提交在 job 落盘**之后**问，
 * 要的就是那一条，于是 `- 1`。
 *
 * 这里原本另有一份 `latestGenerationAttempt`，按 jobId 前缀（含 contractHash）去数。它今天给的答案
 * 和这条一样，但口径不同：换了参数就换 contractHash，于是它对「同一镜的第几次」这个问题的回答
 * 会从头开始。一个语义两个推导式、两边都不报错 —— 那正是要收掉的形状（P1/R14.1）。
 *
 * P4 S1 identity: shotId is part of the jobId so two shots with identical parameters (equal contract
 * hash) never collide. The default shot keeps the legacy prefix (`generation-<run>-<hash16>`) so
 * durable Runs and single-shot callers are byte-compatible; a named shot inserts `-<shotId>` after it.
 */
export function addressedGenerationAttempt(run: ProductionRun, shotId?: string): number {
  return Math.max(1, nextGenerationAttempt(run, shotId) - 1);
}
