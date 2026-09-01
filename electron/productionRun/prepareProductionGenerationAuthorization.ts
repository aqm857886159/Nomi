import type { ExecutionContractV1, PlanCandidate } from "../capabilityCore/executionContract";
import {
  createGenerationRuntimeAdapter,
  type GenerationProvider,
} from "../capabilityCore/generationRuntimeAdapter";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import type { GenerationSealMultiShot } from "../capabilityCore/mcpGenerationMultiShot";
import {
  PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
  createProductionGenerationAuthorizationEnvelope,
  productionGenerationAuthorizationDigest,
  productionGenerationJobId,
  productionGenerationProviderIdempotencyKey,
  type ProductionGenerationAuthorizationEnvelopeV1,
} from "./productionGenerationAuthorization";
import { assertKnownShotPrice, type ShotPrice } from "./shotPricing";
import type { ProductionGenerationShot, ProductionJob, ProductionRun } from "./productionRunTypes";

type AuthorizationOperation = Readonly<{
  operationId: string;
  projectId: string;
  candidate: PlanCandidate;
  planVersion?: number;
}>;

export type GenerationAuthorizationProjectIdentity = Pick<
  ProjectLeaseV2,
  "projectId" | "immutableProjectUuid" | "projectGeneration" | "revocationEpoch"
>;

type AuthorizationUnit = Readonly<{
  shotId: string;
  jobShotId?: string;
  candidate: PlanCandidate;
  contract: ExecutionContractV1;
}>;

export type PreparedProductionGenerationAuthorization = Readonly<{
  envelope: ProductionGenerationAuthorizationEnvelopeV1;
  authorizationDigest: string;
}>;

export type PreparedProductionGenerationReauthorization = PreparedProductionGenerationAuthorization & Readonly<{
  shotId?: string;
  attempt: number;
  parentJobId: string;
}>;

export type PreparedProductionGenerationContinuationAuthorization = PreparedProductionGenerationAuthorization & Readonly<{
  jobIds: readonly string[];
}>;

export const REWORKABLE_JOB_STATUSES = new Set<ProductionJob["status"]>([
  "ready",
  "adopted",
  "needs_attention",
  "cancelled_remote",
  "detached",
  "too_late",
]);

export const UNSUBMITTED_AUTHORIZATION_STATUSES = new Set<ProductionJob["status"]>([
  "authorization_required",
  "authorized",
  "submit_intent_persisted",
]);

function unitsFor(
  operation: AuthorizationOperation,
  contract: ExecutionContractV1,
  multiShot?: GenerationSealMultiShot,
): AuthorizationUnit[] {
  if (!multiShot) {
    return [{ shotId: operation.candidate.candidateId, candidate: operation.candidate, contract }];
  }
  return multiShot.shots
    .filter((shot) => shot.included !== false)
    .map((shot) => {
      if (!shot.contract) throw new Error(`Included generation shot has no sealed contract: ${shot.shotId}`);
      return {
        shotId: shot.shotId,
        jobShotId: shot.shotId,
        candidate: shot.candidate,
        contract: shot.contract,
      };
    });
}

export function prepareProductionGenerationAuthorization(input: Readonly<{
  lease: GenerationAuthorizationProjectIdentity;
  projectRevision: number;
  operation: AuthorizationOperation;
  contract: ExecutionContractV1;
  multiShot?: GenerationSealMultiShot;
  providers: readonly GenerationProvider[];
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice;
  /** Optional Run hard cap for the first wave; the frozen job set may cost more and halt before later jobs. */
  maximumSpend?: number | null;
  now: string;
  ttlMs?: number;
}>): PreparedProductionGenerationAuthorization {
  if (input.operation.projectId !== input.lease.projectId) {
    throw new Error("Generation operation does not belong to the leased project");
  }
  const planVersion = input.operation.planVersion;
  if (!Number.isSafeInteger(planVersion) || (planVersion as number) < 1) {
    throw new Error("Generation operation has no durable plan version");
  }
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0) {
    throw new Error("Generation authorization requires the current project revision");
  }
  const adapter = createGenerationRuntimeAdapter({ providers: input.providers });
  const units = unitsFor(input.operation, input.contract, input.multiShot);
  const currency = "CNY";
  const jobs = units.map((unit) => {
    const price = input.resolveShotPrice(unit.contract);
    assertKnownShotPrice(price, unit.shotId);
    const jobId = productionGenerationJobId(
      input.operation.operationId,
      unit.contract.contractHash,
      1,
      unit.jobShotId,
    );
    const providerIdempotencyKey = productionGenerationProviderIdempotencyKey(
      input.operation.operationId,
      unit.contract.contractHash,
      1,
      unit.jobShotId,
    );
    const prepared = adapter.prepareAuthorization({
      contract: unit.contract,
      providerIdempotencyKey,
    });
    return {
      jobId,
      shotId: unit.shotId,
      attempt: 1,
      target: {
        kind: "generation-operation" as const,
        operationId: input.operation.operationId,
        candidateRevision: unit.candidate.revision,
      },
      contractHash: unit.contract.contractHash,
      providerId: unit.contract.providerId,
      modelId: unit.contract.modelId,
      mode: unit.contract.mode,
      parameters: unit.contract.parameters,
      references: unit.contract.references,
      providerWirePayloadHash: prepared.providerRequestHash,
      providerIdempotencyKey,
      price: { currency, maximum: price.amount },
    };
  });
  const issuedAt = Date.parse(input.now);
  if (!Number.isFinite(issuedAt)) throw new Error("Generation authorization time is invalid");
  const jobMaximum = jobs.reduce((sum, job) => sum + job.price.maximum, 0);
  const maximumSpend = input.maximumSpend;
  if (maximumSpend !== undefined && maximumSpend !== null && (!Number.isFinite(maximumSpend) || maximumSpend < 0)) {
    throw new Error("Generation authorization spend ceiling is invalid");
  }
  const initialCeiling = maximumSpend === undefined || maximumSpend === null
    ? jobMaximum
    : Math.min(jobMaximum, maximumSpend);
  const expiresAt = new Date(issuedAt + (input.ttlMs ?? 10 * 60 * 1000)).toISOString();
  const runId = input.operation.operationId;
  const envelope = createProductionGenerationAuthorizationEnvelope({
    schemaVersion: PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
    immutableProjectUuid: input.lease.immutableProjectUuid,
    projectGeneration: input.lease.projectGeneration,
    projectId: input.lease.projectId,
    projectRevision: input.projectRevision,
    runId,
    planVersion: planVersion as number,
    gateId: `generation-authorization:${runId}:v${planVersion}`,
    costScope: input.multiShot ? `generation.multi-shot:${runId}` : `generation.single-shot:${runId}`,
    expiresAt,
    jobs,
    budget: {
      currency,
      maximum: initialCeiling,
      ledgerCeiling: initialCeiling,
    },
  });
  return { envelope, authorizationDigest: productionGenerationAuthorizationDigest(envelope) };
}

function addressedUnit(run: ProductionRun, shotId?: string): {
  shot?: ProductionGenerationShot;
  candidate: PlanCandidate;
  contract: ExecutionContractV1;
} {
  const plan = run.generationPlan;
  if (!plan || (plan.state !== "sealed" && plan.state !== "submitted") || !plan.authorizationEnvelope) {
    throw new Error("This generation Run cannot create new paid work until it has a sealed authorization");
  }
  if (shotId) {
    const shot = (plan.shots ?? []).find((candidate) => candidate.shotId === shotId);
    if (!shot?.contract) throw new Error(`Generation shot is not sealed: ${shotId}`);
    return { shot, candidate: shot.candidate, contract: shot.contract };
  }
  if (plan.shots?.length) throw new Error("A multi-shot reauthorization requires a shot id");
  if (!plan.contract) throw new Error("Generation contract is not sealed");
  return { candidate: plan.candidate, contract: plan.contract };
}

function latestJobFor(run: ProductionRun, contractHash: string, shotId?: string): ProductionJob | undefined {
  const prefix = productionGenerationJobId(run.runId, contractHash, 1, shotId);
  return run.jobs
    .filter((job) => job.jobId === prefix || job.jobId.startsWith(`${prefix}-attempt-`))
    .sort((left, right) => right.attempt - left.attempt)[0];
}

/** Prepare a fresh, single-unit paid authority for an explicit user rework. */
export function prepareProductionGenerationReauthorization(input: Readonly<{
  lease: GenerationAuthorizationProjectIdentity;
  projectRevision: number;
  run: ProductionRun;
  shotId?: string;
  providers: readonly GenerationProvider[];
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice;
  now: string;
  ttlMs?: number;
}>): PreparedProductionGenerationReauthorization {
  if (
    input.run.projectId !== input.lease.projectId
    || input.run.generationPlan?.operationId !== input.run.runId
  ) {
    throw new Error("Generation reauthorization does not belong to the leased Run");
  }
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0) {
    throw new Error("Generation reauthorization requires the current project revision");
  }
  const unit = addressedUnit(input.run, input.shotId);
  const parent = latestJobFor(input.run, unit.contract.contractHash, input.shotId);
  if (!parent || !REWORKABLE_JOB_STATUSES.has(parent.status)) {
    throw new Error("The previous generation attempt is not safely reworkable");
  }
  if (input.run.jobs.some((job) => UNSUBMITTED_AUTHORIZATION_STATUSES.has(job.status))) {
    throw new Error("Generation rework requires all previously authorized jobs to be submitted or settled");
  }
  const attempt = parent.attempt + 1;
  if (attempt > input.run.policy.maxAttemptsPerJob) {
    throw new Error("Generation rework exceeds the Run attempt limit");
  }
  const price = input.resolveShotPrice(unit.contract);
  assertKnownShotPrice(price, input.shotId ?? unit.contract.candidateId);

  const jobId = productionGenerationJobId(input.run.runId, unit.contract.contractHash, attempt, input.shotId);
  const providerIdempotencyKey = productionGenerationProviderIdempotencyKey(
    input.run.runId,
    unit.contract.contractHash,
    attempt,
    input.shotId,
  );
  const prepared = createGenerationRuntimeAdapter({ providers: input.providers }).prepareAuthorization({
    contract: unit.contract,
    providerIdempotencyKey,
  });
  const issuedAt = Date.parse(input.now);
  if (!Number.isFinite(issuedAt)) throw new Error("Generation reauthorization time is invalid");
  const shotScope = input.shotId ?? unit.candidate.candidateId;
  const liability = input.run.budget.reserved + input.run.budget.actual + input.run.budget.unsettled;
  const envelope = createProductionGenerationAuthorizationEnvelope({
    schemaVersion: PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
    immutableProjectUuid: input.lease.immutableProjectUuid,
    projectGeneration: input.lease.projectGeneration,
    projectId: input.run.projectId,
    projectRevision: input.projectRevision,
    runId: input.run.runId,
    planVersion: input.run.planVersion,
    gateId: `generation-authorization:${input.run.runId}:v${input.run.planVersion}:${shotScope}:attempt-${attempt}`,
    costScope: `generation.rework:${input.run.runId}:${shotScope}:attempt-${attempt}`,
    expiresAt: new Date(issuedAt + (input.ttlMs ?? 10 * 60 * 1000)).toISOString(),
    jobs: [{
      jobId,
      shotId: shotScope,
      attempt,
      target: {
        kind: "generation-operation",
        operationId: input.run.runId,
        candidateRevision: unit.candidate.revision,
      },
      contractHash: unit.contract.contractHash,
      providerId: unit.contract.providerId,
      modelId: unit.contract.modelId,
      mode: unit.contract.mode,
      parameters: unit.contract.parameters,
      references: unit.contract.references,
      providerWirePayloadHash: prepared.providerRequestHash,
      providerIdempotencyKey,
      price: { currency: input.run.budget.currency, maximum: price.amount },
    }],
    budget: {
      currency: input.run.budget.currency,
      maximum: price.amount,
      ledgerCeiling: Math.max(input.run.budget.authorized, liability + price.amount),
    },
  });
  return {
    envelope,
    authorizationDigest: productionGenerationAuthorizationDigest(envelope),
    ...(input.shotId ? { shotId: input.shotId } : {}),
    attempt,
    parentJobId: parent.jobId,
  };
}

/** Prepare a fresh spend gate for the current-attempt jobs that a capped batch has not submitted yet. */
export function prepareProductionGenerationContinuationAuthorization(input: Readonly<{
  lease: GenerationAuthorizationProjectIdentity;
  projectRevision: number;
  run: ProductionRun;
  providers: readonly GenerationProvider[];
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice;
  now: string;
  ttlMs?: number;
}>): PreparedProductionGenerationContinuationAuthorization {
  const plan = input.run.generationPlan;
  if (
    input.run.projectId !== input.lease.projectId
    || !plan
    || plan.state !== "submitted"
    || !plan.shots?.length
    || !plan.authorizationEnvelope
  ) {
    throw new Error("A submitted multi-shot authorization is required before paid continuation");
  }
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0) {
    throw new Error("Generation continuation requires the current project revision");
  }

  const adapter = createGenerationRuntimeAdapter({ providers: input.providers });
  const jobs = plan.shots
    .filter((shot) => shot.included !== false && shot.contract)
    .flatMap((shot) => {
      const contract = shot.contract!;
      const attempt = Number.isSafeInteger(shot.attemptCount) && (shot.attemptCount as number) > 0
        ? shot.attemptCount as number
        : 1;
      const jobId = productionGenerationJobId(input.run.runId, contract.contractHash, attempt, shot.shotId);
      const existing = input.run.jobs.find((job) => job.jobId === jobId);
      if (!existing || existing.status !== "authorized" || existing.providerTaskId) return [];
      const price = input.resolveShotPrice(contract);
      assertKnownShotPrice(price, shot.shotId);
      const providerIdempotencyKey = productionGenerationProviderIdempotencyKey(
        input.run.runId,
        contract.contractHash,
        attempt,
        shot.shotId,
      );
      if (existing.providerIdempotencyKey !== providerIdempotencyKey) {
        throw new Error(`Generation continuation job identity changed: ${shot.shotId}`);
      }
      const prepared = adapter.prepareAuthorization({ contract, providerIdempotencyKey });
      return [{
        jobId,
        shotId: shot.shotId,
        attempt,
        target: {
          kind: "generation-operation" as const,
          operationId: input.run.runId,
          candidateRevision: shot.candidate.revision,
        },
        contractHash: contract.contractHash,
        providerId: contract.providerId,
        modelId: contract.modelId,
        mode: contract.mode,
        parameters: contract.parameters,
        references: contract.references,
        providerWirePayloadHash: prepared.providerRequestHash,
        providerIdempotencyKey,
        price: { currency: input.run.budget.currency, maximum: price.amount },
      }];
    });
  if (jobs.length === 0) throw new Error("This generation Run has no unsubmitted jobs to continue");

  const remainingMaximum = jobs.reduce((sum, job) => sum + job.price.maximum, 0);
  const liability = input.run.budget.reserved + input.run.budget.actual + input.run.budget.unsettled;
  if (input.run.budget.authorized - liability >= remainingMaximum) {
    throw new Error("The current generation authorization already covers the remaining jobs");
  }
  const issuedAt = Date.parse(input.now);
  if (!Number.isFinite(issuedAt)) throw new Error("Generation continuation time is invalid");
  const continuationNumber = input.run.gates.filter((gate) => gate.costScope?.startsWith(`generation.continuation:${input.run.runId}:`)).length + 1;
  const envelope = createProductionGenerationAuthorizationEnvelope({
    schemaVersion: PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
    immutableProjectUuid: input.lease.immutableProjectUuid,
    projectGeneration: input.lease.projectGeneration,
    projectId: input.run.projectId,
    projectRevision: input.projectRevision,
    runId: input.run.runId,
    planVersion: input.run.planVersion,
    gateId: `generation-authorization:${input.run.runId}:v${input.run.planVersion}:continuation-${continuationNumber}`,
    costScope: `generation.continuation:${input.run.runId}:${continuationNumber}`,
    expiresAt: new Date(issuedAt + (input.ttlMs ?? 10 * 60 * 1000)).toISOString(),
    jobs,
    budget: {
      currency: input.run.budget.currency,
      maximum: remainingMaximum,
      ledgerCeiling: Math.max(input.run.budget.authorized, liability + remainingMaximum),
    },
  });
  return {
    envelope,
    authorizationDigest: productionGenerationAuthorizationDigest(envelope),
    jobIds: jobs.map((job) => job.jobId),
  };
}
