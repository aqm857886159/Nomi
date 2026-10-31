// 一次提交的「执行绑定」怎么造、怎么认（从 productionGenerationSubmission.ts 原样搬出，行为不变）。
// 那个文件在体积门岗上冻结着；这几个函数只管「合同 → 绑定 / 信封引用」，不碰提交流程，是最干净的一块。
import crypto from "node:crypto";

import type { ExecutionContractV1 } from "../capabilityCore/executionContract";
import { createProductionExecutionBinding, validateProductionExecutionBinding, type ProductionExecutionBinding } from "./productionExecutionBinding";
import type { ProductionRunRuntimeEnvelope } from "./productionRunRuntimeEnvelope";
import type { ProductionRun } from "./productionRunTypes";

/** 造绑定只用到提交依赖里的这三项。 */
export type ExecutionBindingDependencies = {
  immutableProjectUuid: string;
  projectGeneration: number;
  runtimeTaskId?: (input: { runId: string; contractHash: string; attempt?: number }) => string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Generation request must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  throw new Error("Generation request must be JSON serializable");
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export function envelopeRefFor(runId: string, jobId: string): string {
  return `.nomi/runs/${runId}/jobs/${jobId}/runtime-envelope.json`;
}

/**
 * The binding's `shotId` is the addressed shot (default shot → its jobId, keeping single-shot bindings
 * byte-identical). The providerIdempotencyKey MUST include the shotId so two shots that hash identically
 * derive different keys (#5): a two-shot batch with equal parameters must not collapse to one provider task.
 */
export function sealedBindingFor(sealed: ProductionRunRuntimeEnvelope | null, contract: ExecutionContractV1): ProductionExecutionBinding | undefined {
  const candidate = (sealed?.request as { executionBinding?: unknown } | undefined)?.executionBinding;
  if (!sealed || candidate === undefined || sealed.contractHash !== contract.contractHash) return undefined;
  const binding = validateProductionExecutionBinding(candidate);
  return binding.providerNamespace === contract.providerId ? binding : undefined;
}

export function ensureBinding(deps: ExecutionBindingDependencies, run: ProductionRun, contract: ExecutionContractV1, jobId: string, attempt: number, fencingEpoch: number, shotId?: string): ProductionExecutionBinding {
  const existing = run.jobs.find((job) => job.jobId === jobId)?.executionBinding;
  if (existing) {
    if (existing.contractHash !== contract.contractHash || existing.providerNamespace !== contract.providerId) {
      throw new Error("Sealed generation job binding does not match the current contract");
    }
    return existing;
  }
  // The default shot keeps the jobId as its shot identity (single-shot binding unchanged); a named shot
  // uses its stable shotId. Both feed the idempotency key so identical-parameter shots stay distinct.
  const bindingShotId = shotId ?? jobId;
  const runtimeTaskId = deps.runtimeTaskId?.({ runId: run.runId, contractHash: contract.contractHash, attempt })
    || `runtime-${run.runId}-${contract.contractHash.slice(0, 16)}-attempt-${attempt}`;
  const requestFingerprint = sha256({
    contractHash: contract.contractHash,
    providerId: contract.providerId,
    modelId: contract.modelId,
    mode: contract.mode,
    prompt: contract.prompt,
    parameters: contract.parameters,
    references: contract.references,
  });
  return createProductionExecutionBinding({
    immutableProjectUuid: deps.immutableProjectUuid,
    projectGeneration: deps.projectGeneration,
    runId: run.runId,
    shotId: bindingShotId,
    contractHash: contract.contractHash,
    runtimeTaskId,
    providerNamespace: contract.providerId,
    providerIdempotencyKey: `generation:${run.runId}:${bindingShotId}:${contract.contractHash}:attempt-${attempt}`,
    requestFingerprint,
    runtimeEnvelopeRef: envelopeRefFor(run.runId, jobId),
    fencingEpoch,
  });
}
