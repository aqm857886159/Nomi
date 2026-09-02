import crypto from "node:crypto";
import path from "node:path";

import {
  createGenerationRuntimeAdapter,
  GenerationProviderObservationError,
  resolveExecutionContract,
  type GenerationProvider,
  type GenerationProviderOutput,
} from "../capabilityCore/generationRuntimeAdapter";
import type { ExecutionContractV1 } from "../capabilityCore/executionContract";
import {
  productionGenerationJobId,
  productionGenerationProviderIdempotencyKey,
} from "./productionGenerationAuthorization";
import { createProductionRunRuntimeEnvelope } from "./productionRunRuntimeEnvelope";
import { createProductionRunIntentLog } from "./productionRunIntentLog";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunLock } from "./productionRunLock";
import type { ProductionRunRepository } from "./productionRunRepository";
import {
  SubmissionNotDispatchedError,
  SubmissionReceiptUnknownError,
  SubmissionReconciliationRequiredError,
  createSubmissionOutbox,
} from "./submissionOutbox";
import { classifyGenerationResume, type GenerationResumeDecision } from "./productionRunResume";
import { createProductionExecutionBinding, type ProductionExecutionBinding } from "./productionExecutionBinding";
import type { ProductionArtifact, ProductionJob, ProductionRun } from "./productionRunTypes";

export { SubmissionReceiptUnknownError, SubmissionReconciliationRequiredError };

export type GenerationSubmissionStartInput = {
  projectId: string;
  operationId: string;
  definitelyNotSubmitted?: boolean;
  /** Explicitly selected attempt; omitted means the latest durable attempt. */
  attempt?: number;
  /**
   * P4 S1 shot addressing: which shot's sub-contract to submit. Omitted = the default (single) shot,
   * behaving exactly as the P1–P3 single-shot chain (top-level plan contract). Backward compatible.
   */
  shotId?: string;
};

export type GenerationSubmissionResult = {
  operationId: string;
  runId: string;
  jobId: string;
  providerTaskId: string;
  attempt: number;
  nextAction: "observe";
};

export type GenerationSubmissionPollResult = {
  operationId: string;
  runId: string;
  jobId: string;
  providerTaskId: string;
  providerStatus: string;
  nextAction: "poll" | "materialize" | "attention";
};

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

export type GenerationSubmissionResumeResult = GenerationResumeDecision & {
  operationId: string;
  nextAction: "poll" | "reconcile" | "dispatch" | "attention";
  providerTaskId?: string;
};

export type ProductionGenerationSubmissionDependencies = {
  repository: ProductionRunRepository;
  projectRoot: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  projectRevision: number;
  intentMacKey: string | NodeJS.TypedArray;
  provider?: GenerationProvider;
  providers?: readonly GenerationProvider[];
  now?: () => string;
  runtimeTaskId?: (input: { runId: string; contractHash: string; attempt?: number }) => string;
  afterProviderAcceptance?: (input: { providerTaskId: string; run: ProductionRun }) => void | Promise<void>;
  beforeDispatch?: (input: { run: ProductionRun; job: ProductionJob }) => void | Promise<void>;
  /** Asset store owns bytes, identity and leases; the submission seam only commits its returned receipt. */
  materializeOutput?: (input: {
    projectId: string;
    operationId: string;
    run: ProductionRun;
    job: ProductionJob;
    contract: ExecutionContractV1;
    providerTaskId: string;
    output: GenerationProviderOutput;
  }) => Promise<Pick<ProductionArtifact, "artifactId" | "kind" | "contentHash" | "projectRelativePath" | "thumbnailRelativePath">>;
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

function requiredRun(repository: ProductionRunRepository, projectId: string, runId: string): ProductionRun {
  const run = repository.read(projectId, runId);
  if (!run) throw new Error(`Production run not found: ${runId}`);
  return run;
}

/**
 * P4 S1: resolve the sub-contract this call addresses.
 * - No shotId → the default (single) shot: top-level plan contract + plan-level receipt (today's chain).
 * - shotId → that shot's sealed sub-contract + the shot's own receipt approval.
 * Either way the plan must be sealed/submitted and the addressed unit must be approved before submit.
 */
function requiredContract(run: ProductionRun, shotId?: string): ExecutionContractV1 {
  const plan = run.generationPlan;
  if (!plan || (plan.state !== "sealed" && plan.state !== "submitted")) {
    throw new Error("Seal and confirm the generation plan before starting");
  }
  if (shotId) {
    const shot = (plan.shots ?? []).find((candidate) => candidate.shotId === shotId);
    if (!shot?.contract || !shot.approvedReceiptId) throw new Error("Seal and confirm the generation plan before starting");
    return shot.contract;
  }
  if (!plan.contract || !plan.approvedReceiptId) throw new Error("Seal and confirm the generation plan before starting");
  return plan.contract;
}

/**
 * P4 S1 identity: shotId is part of the jobId so two shots with identical parameters (equal contract
 * hash) never collide. The default shot keeps the legacy prefix (`generation-<run>-<hash16>`) so
 * durable Runs and single-shot callers are byte-compatible; a named shot inserts `-<shotId>` after it.
 */
function latestGenerationAttempt(run: ProductionRun, contractHash: string, shotId?: string): number {
  const prefix = productionGenerationJobId(run.runId, contractHash, 1, shotId).replace(/-attempt-\d+$/, "");
  return run.jobs
    .filter((job) => job.jobId === prefix || job.jobId.startsWith(`${prefix}-attempt-`))
    .reduce((latest, job) => Math.max(latest, job.attempt), 0);
}

function envelopeRefFor(runId: string, jobId: string): string {
  return `.nomi/runs/${runId}/jobs/${jobId}/runtime-envelope.json`;
}

type ProviderPollStatusClass = "pending" | "succeeded" | "failed" | "unknown";

/**
 * Provider adapters expose their native status verbatim.  The submission seam
 * must only advance a job for a status that is explicitly known to be pending,
 * successful, or failed.  Treating an unrecognised verb as success is unsafe
 * (it can materialize an incomplete output); treating it as pending is worse
 * (the observer can spin forever).  Keep this allow-list broad enough for the
 * shipped provider mappings, but fail closed for anything new.
 */
const PROVIDER_STATUS_CLASSES: Readonly<Record<ProviderPollStatusClass, ReadonlySet<string>>> = {
  pending: new Set([
    "submitted", "waiting", "queuing", "queued", "pending", "create", "created",
    "processing", "generating", "running", "in_progress", "in-progress", "in_queue",
    "queueing", "not_start", "notstart", "starting", "started", "downloading", "validating",
  ]),
  succeeded: new Set(["completed", "complete", "succeeded", "succeed", "success", "done"]),
  failed: new Set([
    "failed", "fail", "failure", "error", "cancelled", "canceled", "cancel", "rejected",
    "refused", "expired", "aborted", "timeout", "timed_out", "revoked",
  ]),
  unknown: new Set(),
};

function classifyProviderStatus(status: string): ProviderPollStatusClass {
  const normalized = status.trim().toLowerCase();
  if (PROVIDER_STATUS_CLASSES.pending.has(normalized)) return "pending";
  if (PROVIDER_STATUS_CLASSES.succeeded.has(normalized)) return "succeeded";
  if (PROVIDER_STATUS_CLASSES.failed.has(normalized)) return "failed";
  return "unknown";
}

function isPendingProviderStatus(status: string): boolean {
  return classifyProviderStatus(status) === "pending";
}

function isSuccessfulProviderStatus(status: string): boolean {
  return classifyProviderStatus(status) === "succeeded";
}

function isFailedProviderStatus(status: string): boolean {
  return classifyProviderStatus(status) === "failed";
}

/**
 * The binding's `shotId` is the addressed shot (default shot → its jobId, keeping single-shot bindings
 * byte-identical). The providerIdempotencyKey MUST include the shotId so two shots that hash identically
 * derive different keys (#5): a two-shot batch with equal parameters must not collapse to one provider task.
 */
function ensureBinding(deps: ProductionGenerationSubmissionDependencies, run: ProductionRun, contract: ExecutionContractV1, jobId: string, attempt: number, fencingEpoch: number, shotId?: string): ProductionExecutionBinding {
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

export function createProductionGenerationSubmission(deps: ProductionGenerationSubmissionDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  const providers = deps.providers ?? (deps.provider ? [deps.provider] : []);
  if (providers.length === 0) throw new Error("At least one generation provider is required");
  const adapter = createGenerationRuntimeAdapter({ providers });

  function intentLog(runId: string) {
    return createProductionRunIntentLog({
      filePath: productionRunPaths(deps.projectRoot, runId).intents,
      macKey: deps.intentMacKey,
    });
  }

  function lock(runId: string) {
    const paths = productionRunPaths(deps.projectRoot, runId);
    return createProductionRunLock({ filePath: paths.lock, epochPath: paths.lockEpoch, ownerId: `semantic-generation-${process.pid}` });
  }

  function envelope(runId: string, jobId: string) {
    return createProductionRunRuntimeEnvelope({ filePath: path.join(deps.projectRoot, envelopeRefFor(runId, jobId)) });
  }

  function command(run: ProductionRun, type: string, payload: Record<string, unknown>, suffix: string): ProductionRun {
    return deps.repository.execute(run.projectId, run.runId, {
      commandId: `generation.runtime:${run.runId}:${suffix}`,
      expectedRevision: run.revision,
      type,
      payload,
      issuedAt: now(),
    }).run;
  }

  function prepareAuthorizedSubmission(
    run: ProductionRun,
    contract: ExecutionContractV1,
    jobId: string,
    attempt: number,
    fencingEpoch: number,
    shotId?: string,
  ): {
    run: ProductionRun;
    envelope: ReturnType<typeof createProductionRunRuntimeEnvelope>;
    approvalId: string;
    authorizationDigest: string;
    costCeiling: number;
    currency: string;
    expectedProviderRequestHash: string;
    preparedProviderRequest: unknown;
  } {
    let current = run;
    const plan = current.generationPlan;
    const authorizationEnvelope = plan?.authorizationEnvelope;
    const authorizationDigest = plan?.authorizationDigest;
    const gateId = plan?.authorizationGateId;
    if (!plan || !authorizationEnvelope || !authorizationDigest || !gateId) {
      throw new Error("This generation Run has no sealed paid authorization; it is read-only until re-planned");
    }
    if (
      authorizationEnvelope.immutableProjectUuid !== deps.immutableProjectUuid
      || authorizationEnvelope.projectGeneration !== deps.projectGeneration
      || authorizationEnvelope.projectRevision !== deps.projectRevision
      || authorizationEnvelope.projectId !== current.projectId
      || authorizationEnvelope.runId !== current.runId
      || authorizationEnvelope.planVersion !== current.planVersion
      || authorizationEnvelope.gateId !== gateId
    ) {
      throw new Error("Generation authorization no longer matches the current project or Run");
    }
    const authorized = authorizationEnvelope.jobs.find((job) => job.jobId === jobId);
    const existingJob = current.jobs.find((job) => job.jobId === jobId);
    const gate = current.gates.find((candidate) => candidate.gateId === gateId);
    const approvalId = `approval:${gateId}`;
    const approval = deps.repository.readApprovals(current.projectId, current.runId)
      .find((candidate) => candidate.approvalId === approvalId);
    if (
      !authorized
      || !existingJob
      || authorized.attempt !== attempt
      || authorized.contractHash !== contract.contractHash
      || authorized.providerId !== contract.providerId
      || authorized.modelId !== contract.modelId
      || authorized.providerIdempotencyKey !== productionGenerationProviderIdempotencyKey(current.runId, contract.contractHash, attempt, shotId)
      || existingJob.authorizationDigest !== authorizationDigest
      || existingJob.providerIdempotencyKey !== authorized.providerIdempotencyKey
      || !gate
      || gate.status !== "approved"
      || gate.authorizationDigest !== authorizationDigest
      || gate.planHash !== authorizationDigest
      || gate.receiptId !== plan.approvedReceiptId
      || !approval
      || approval.authorizationDigest !== authorizationDigest
      || approval.planHash !== authorizationDigest
      || approval.receiptId !== gate.receiptId
      || !approval.jobIds.includes(jobId)
    ) {
      throw new Error("Generation submission is not covered by the approved Run authorization");
    }
    if (Date.parse(now()) >= Date.parse(authorizationEnvelope.expiresAt)) {
      throw new Error("Generation authorization has expired");
    }

    // This is the last zero-side-effect check. If provider serialization drifted since the gate,
    // nothing below (Run events, ledger, intents, runtime envelope or provider) is touched.
    const providerPreparation = adapter.prepareAuthorization({
      contract,
      providerIdempotencyKey: authorized.providerIdempotencyKey,
    });
    if (providerPreparation.providerRequestHash !== authorized.providerWirePayloadHash) {
      throw new Error("Provider wire payload no longer matches the approved authorization");
    }

    const binding = ensureBinding(deps, current, contract, jobId, attempt, fencingEpoch, shotId);
    if (!existingJob.executionBinding) {
      current = command(current, "job.patch", {
        jobId,
        patch: {
          executionBinding: binding,
          requestFingerprint: binding.requestFingerprint,
          providerIdempotencyKey: binding.providerIdempotencyKey,
          idempotencyKey: binding.providerIdempotencyKey,
          runtimeEnvelopeRef: binding.runtimeEnvelopeRef,
        },
      }, `job-bind:${jobId}`);
    }
    const resolved = resolveExecutionContract(contract, binding);
    const sealedEnvelope = envelope(current.runId, jobId);
    sealedEnvelope.seal({
      runId: current.runId,
      jobId,
      runtimeTaskId: binding.runtimeTaskId,
      contractHash: contract.contractHash,
      providerIdempotencyKey: binding.providerIdempotencyKey,
      requestFingerprint: binding.requestFingerprint,
      request: resolved,
    });
    return {
      run: current,
      envelope: sealedEnvelope,
      approvalId,
      authorizationDigest,
      costCeiling: authorized.price.maximum,
      currency: authorized.price.currency,
      expectedProviderRequestHash: authorized.providerWirePayloadHash,
      preparedProviderRequest: providerPreparation.providerRequest,
    };
  }

  async function start(input: GenerationSubmissionStartInput): Promise<GenerationSubmissionResult> {
    const shotId = input.shotId;
    let run = requiredRun(deps.repository, input.projectId, input.operationId);
    const contract = requiredContract(run, shotId);
    const attempt = input.attempt ?? Math.max(1, latestGenerationAttempt(run, contract.contractHash, shotId));
    if (!Number.isInteger(attempt) || attempt < 1) throw new Error("Generation attempt is invalid");
    let jobId = productionGenerationJobId(run.runId, contract.contractHash, attempt, shotId);
    const existingJob = run.jobs.find((job) => job.jobId === jobId);
    if (existingJob?.status === "provider_accepted" && existingJob.providerTaskId) {
      if (run.generationPlan?.state !== "submitted") run = command(run, "generation.submit", {}, "plan-submit");
      return { operationId: run.runId, runId: run.runId, jobId, providerTaskId: existingJob.providerTaskId, attempt, nextAction: "observe" };
    }
    if (existingJob && ["submission_unknown", "reconciling", "needs_attention", "cancel_requested"].includes(existingJob.status)) {
      throw new SubmissionReconciliationRequiredError();
    }
    const runLock = lock(run.runId);
    return runLock.withLock(async (lease) => {
      run = requiredRun(deps.repository, input.projectId, input.operationId);
      const lockedContract = requiredContract(run, shotId);
      if (lockedContract.contractHash !== contract.contractHash) throw new Error("Generation contract changed while waiting for the Run lock");
      const lockedAttempt = input.attempt ?? Math.max(1, latestGenerationAttempt(run, lockedContract.contractHash, shotId));
      jobId = productionGenerationJobId(run.runId, lockedContract.contractHash, lockedAttempt, shotId);
      const prepared = prepareAuthorizedSubmission(run, lockedContract, jobId, lockedAttempt, lease.fencingEpoch, shotId);
      run = prepared.run;
      const log = intentLog(run.runId);
      let rawReceipt: unknown;
      const outbox = createSubmissionOutbox({
        repository: deps.repository,
        intentLog: log,
        lock: runLock,
        lockLease: lease,
        now,
        beforeDispatch: async (dispatchInput) => {
          await deps.beforeDispatch?.({ run: dispatchInput.run, job: dispatchInput.job });
        },
        dispatch: async (dispatchInput) => {
          const currentBinding = dispatchInput.job.executionBinding;
          if (!currentBinding) throw new Error("Generation job is missing its sealed execution binding");
          try {
            const result = await adapter.submit({
              contract: lockedContract,
              binding: currentBinding,
              expectedProviderRequestHash: prepared.expectedProviderRequestHash,
              preparedProviderRequest: prepared.preparedProviderRequest,
            });
            rawReceipt = result.raw;
            return { providerTaskId: result.providerTaskId };
          } catch (error) {
            if (!(error instanceof SubmissionNotDispatchedError)) prepared.envelope.markSubmittedUnknown();
            throw error;
          }
        },
        afterDispatch: async (result, dispatchInput) => {
          prepared.envelope.markProviderAccepted({ providerTaskId: result.providerTaskId, rawReceipt });
          try {
            await deps.afterProviderAcceptance?.({ providerTaskId: result.providerTaskId, run: dispatchInput.run });
          } catch (error) {
            prepared.envelope.markSubmittedUnknown();
            throw error;
          }
        },
      });
      const result = await outbox.submit({
        projectId: run.projectId,
        runId: run.runId,
        jobId,
        approvalId: prepared.approvalId,
        planHash: prepared.authorizationDigest,
        costCeiling: prepared.costCeiling,
        currency: prepared.currency,
        allowRetryAfterAbort: input.definitelyNotSubmitted === true,
      });
      run = result.run;
      if (run.generationPlan?.state !== "submitted") run = command(run, "generation.submit", {}, "plan-submit");
      return { operationId: run.runId, runId: run.runId, jobId, providerTaskId: result.providerTaskId, attempt: lockedAttempt, nextAction: "observe" };
    });
  }

  async function poll(input: GenerationSubmissionStartInput): Promise<GenerationSubmissionPollResult> {
    const shotId = input.shotId;
    const run = requiredRun(deps.repository, input.projectId, input.operationId);
    const contract = requiredContract(run, shotId);
    const attempt = input.attempt ?? Math.max(1, latestGenerationAttempt(run, contract.contractHash, shotId));
    const jobId = productionGenerationJobId(run.runId, contract.contractHash, attempt, shotId);
    const job = run.jobs.find((candidate) => candidate.jobId === jobId);
    if (!job?.providerTaskId) throw new SubmissionReconciliationRequiredError("A provider task id is required before polling");

    const result = await adapter.query({ providerId: job.provider, providerTaskId: job.providerTaskId });
    const providerStatus = result.providerStatus.trim();
    if (!providerStatus) throw new Error("Provider returned an empty poll status");
    const statusClass = classifyProviderStatus(providerStatus);
    const envelopeStore = envelope(run.runId, job.jobId);
    envelopeStore.markPolled({ status: providerStatus, raw: result.raw });
    const observedAt = now();
    const statusChanged = job.providerStatus !== providerStatus;
    const nextStatus = statusClass === "pending"
      ? "polling"
      : statusClass === "failed" || statusClass === "unknown"
        ? "needs_attention"
        : job.status;
    const patch = {
      providerStatus,
      lastPollAt: observedAt,
      ...(statusChanged ? { lastVendorStateChangeAt: observedAt } : {}),
      ...(statusClass === "failed"
        ? { errorCode: "provider_task_failed", errorMessage: "供应商任务已返回失败状态" }
        : statusClass === "unknown"
          ? { errorCode: "provider_status_unknown", errorMessage: "供应商返回了未识别的任务状态，需要人工核对" }
          : {}),
    };
    command(run, nextStatus === job.status ? "job.patch" : "job.status", {
      jobId: job.jobId,
      ...(nextStatus === job.status ? { patch } : { status: nextStatus, patch }),
    }, `poll:${run.revision}:${providerStatus}`);
    return {
      operationId: run.runId,
      runId: run.runId,
      jobId: job.jobId,
      providerTaskId: job.providerTaskId,
      providerStatus,
      nextAction: statusClass === "pending" ? "poll" : statusClass === "succeeded" ? "materialize" : "attention",
    };
  }

  async function materialize(input: GenerationSubmissionStartInput): Promise<GenerationSubmissionMaterializeResult> {
    const shotId = input.shotId;
    let run = requiredRun(deps.repository, input.projectId, input.operationId);
    const contract = requiredContract(run, shotId);
    const attempt = input.attempt ?? Math.max(1, latestGenerationAttempt(run, contract.contractHash, shotId));
    const jobId = productionGenerationJobId(run.runId, contract.contractHash, attempt, shotId);
    let job = run.jobs.find((candidate) => candidate.jobId === jobId);
    if (!job?.providerTaskId) throw new GenerationMaterializationError("A provider task id is required before materialization");
    const providerTaskId = job.providerTaskId;
    const existing = run.artifacts.find((artifact) => artifact.jobId === jobId && ["image", "video", "audio"].includes(artifact.kind) && artifact.status === "ready");
    if (existing?.contentHash) {
      if (job.status !== "ready") run = command(run, "job.status", { jobId, status: "ready", patch: {} }, `materialize-job:${jobId}`);
      const currentEnvelope = envelope(run.runId, jobId).read();
      if (currentEnvelope?.state === "provider_accepted") envelope(run.runId, jobId).markMaterialized();
      return { operationId: run.runId, runId: run.runId, jobId, providerTaskId: job.providerTaskId, artifactId: existing.artifactId, contentHash: existing.contentHash, nextAction: "completed" };
    }
    const currentEnvelope = envelope(run.runId, jobId).read();
    if (!currentEnvelope?.providerTaskId || currentEnvelope.state !== "provider_accepted") throw new GenerationMaterializationError("Provider acceptance is required before materialization");
    const polled = currentEnvelope.lastPoll;
    if (!polled || isPendingProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider task is still processing");
    if (isFailedProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider task did not complete successfully");
    if (!isSuccessfulProviderStatus(polled.status)) throw new GenerationMaterializationError("The provider returned an unknown status; reconcile before materialization");
    let extracted: { outputs: readonly GenerationProviderOutput[] };
    try {
      extracted = await adapter.materialize({ providerId: job.provider, providerTaskId: job.providerTaskId, raw: polled.raw });
    } catch (error) {
      if (error instanceof GenerationProviderObservationError) throw new GenerationMaterializationUnsupportedError();
      throw error;
    }
    if (extracted.outputs.length !== 1) throw new GenerationMaterializationError(extracted.outputs.length === 0 ? "Provider did not expose a materializable output" : "Single-shot generation returned more than one output");
    if (!deps.materializeOutput) throw new GenerationMaterializationUnsupportedError();
    const receipt = await deps.materializeOutput({ projectId: input.projectId, operationId: run.runId, run, job, contract, providerTaskId: job.providerTaskId, output: extracted.outputs[0] });
    const artifactId = typeof receipt.artifactId === "string" ? receipt.artifactId.trim() : "";
    const contentHash = typeof receipt.contentHash === "string" ? receipt.contentHash.trim() : "";
    const projectRelativePath = typeof receipt.projectRelativePath === "string" ? receipt.projectRelativePath.trim() : "";
    if (!artifactId || !contentHash || !projectRelativePath) throw new GenerationMaterializationError("Asset store returned an incomplete materialization receipt");
    run = requiredRun(deps.repository, input.projectId, input.operationId);
    job = run.jobs.find((candidate) => candidate.jobId === jobId) || job;
    const artifact: ProductionArtifact = {
      artifactId,
      stageId: "generate",
      jobId,
      kind: receipt.kind,
      status: "ready",
      source: "external-mcp",
      contentHash,
      projectRelativePath,
      ...(receipt.thumbnailRelativePath ? { thumbnailRelativePath: receipt.thumbnailRelativePath } : {}),
      createdAt: now(),
    };
    run = command(run, "artifact.add", { artifact }, `materialize-artifact:${artifact.artifactId}`);
    run = command(run, "job.status", { jobId, status: "ready", patch: { lastPollAt: job.lastPollAt } }, `materialize-job:${jobId}`);
    envelope(run.runId, jobId).markMaterialized();
    return { operationId: run.runId, runId: run.runId, jobId, providerTaskId, artifactId: artifact.artifactId, contentHash, nextAction: "completed" };
  }

  async function resume(input: GenerationSubmissionStartInput): Promise<GenerationSubmissionResumeResult> {
    const shotId = input.shotId;
    let run = requiredRun(deps.repository, input.projectId, input.operationId);
    const contract = requiredContract(run, shotId);
    const attempt = input.attempt ?? Math.max(1, latestGenerationAttempt(run, contract.contractHash, shotId));
    const jobId = productionGenerationJobId(run.runId, contract.contractHash, attempt, shotId);
    const job = run.jobs.find((candidate) => candidate.jobId === jobId);
    if (!job) return { operationId: run.runId, action: "attention", reason: "invalid_recovery_state", nextAction: "attention" };
    const currentEnvelope = envelope(run.runId, jobId).read();
    if (!currentEnvelope) return { operationId: run.runId, action: "attention", reason: "invalid_recovery_state", nextAction: "attention" };
    if (input.definitelyNotSubmitted === true && ["submission_unknown", "needs_attention"].includes(job.status)) {
      const committed = intentLog(run.runId).list().some((intent) => intent.key === `${run.runId}:${jobId}:${job.attempt}` && intent.status === "committed");
      if (committed) return { operationId: run.runId, action: "reconcile", reason: "submission_receipt_unknown", nextAction: "reconcile" };
      if (currentEnvelope.state === "submitted_unknown") envelope(run.runId, jobId).markDefinitelyNotSubmitted();
      // Suffix carries jobId so a per-shot explicit retry never dedupes against a sibling shot.
      run = command(run, "job.status", { jobId, status: "submit_intent_persisted", patch: {} }, `explicit-retry:${jobId}`);
      return { ...(await start({ projectId: run.projectId, operationId: run.runId, definitelyNotSubmitted: true, ...(shotId ? { shotId } : {}) })), action: "dispatch", nextAction: "dispatch" };
    }
    const decision = classifyGenerationResume({ jobStatus: job.status, providerTaskId: job.providerTaskId, envelopeState: currentEnvelope.state, definitelyNotSubmitted: input.definitelyNotSubmitted });
    if (decision.action === "poll") return { operationId: run.runId, ...decision, nextAction: "poll", providerTaskId: job.providerTaskId };
    if (decision.action === "reconcile") return { operationId: run.runId, ...decision, nextAction: "reconcile" };
    if (decision.action === "dispatch") return { ...(await start(input)), action: "dispatch", nextAction: "dispatch" };
    return { operationId: run.runId, ...decision, nextAction: "attention" };
  }

  return { start, poll, materialize, resume };
}

export type ProductionGenerationSubmission = ReturnType<typeof createProductionGenerationSubmission>;
