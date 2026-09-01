import type { ExecutionContractV1, PlanCandidate } from "../capabilityCore/executionContract";
import {
  createProductionGenerationAuthorizationEnvelope,
  productionGenerationAuthorizationDigest,
  productionGenerationJobId,
  productionGenerationProviderIdempotencyKey,
  stableAuthorizationJson,
  type ProductionGenerationAuthorizationEnvelopeV1,
} from "./productionGenerationAuthorization";
import type {
  ProductionGate,
  ProductionGenerationPlan,
  ProductionGenerationShot,
  ProductionJob,
  ProductionRun,
} from "./productionRunTypes";
import {
  REWORKABLE_JOB_STATUSES,
  UNSUBMITTED_AUTHORIZATION_STATUSES,
} from "./prepareProductionGenerationAuthorization";

type AuthorizationPreparation = Readonly<{
  envelope: ProductionGenerationAuthorizationEnvelopeV1;
  authorizationDigest: string;
}>;

type AuthorizationUnit = Readonly<{
  shotId: string;
  jobShotId?: string;
  candidate: PlanCandidate;
  contract: ExecutionContractV1;
  nodeId?: string;
}>;

export type SealedGenerationAuthorizationState = Readonly<{
  envelope: ProductionGenerationAuthorizationEnvelopeV1;
  authorizationDigest: string;
  jobs: readonly ProductionJob[];
  gate: ProductionGate;
}>;

export type GenerationAuthorizationGateDecision = Readonly<{
  receiptId?: string;
  generationPlan?: ProductionGenerationPlan;
}>;

export type ReauthorizedGenerationState = Readonly<{
  generationPlan: ProductionGenerationPlan;
  job: ProductionJob;
  gate: ProductionGate;
  policyMaxSpend: number;
}>;

export type ContinuedGenerationState = Readonly<{
  generationPlan: ProductionGenerationPlan;
  jobs: readonly ProductionJob[];
  gate: ProductionGate;
  policyMaxSpend: number;
}>;

function preparationFrom(value: unknown): AuthorizationPreparation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Generation authorization preparation is required");
  }
  const raw = value as Partial<AuthorizationPreparation>;
  if (!raw.envelope || typeof raw.authorizationDigest !== "string" || !raw.authorizationDigest.trim()) {
    throw new Error("Generation authorization preparation is invalid");
  }
  const envelope = createProductionGenerationAuthorizationEnvelope(raw.envelope);
  const authorizationDigest = productionGenerationAuthorizationDigest(envelope);
  if (authorizationDigest !== raw.authorizationDigest.trim()) {
    throw new Error("Generation authorization digest does not match its envelope");
  }
  return { envelope, authorizationDigest };
}

function authorizationUnits(
  plan: ProductionGenerationPlan,
  topLevelContract: ExecutionContractV1,
  sealedShots: readonly ProductionGenerationShot[] | undefined,
): AuthorizationUnit[] {
  if (!sealedShots) {
    return [{
      shotId: plan.candidate.candidateId,
      candidate: plan.candidate,
      contract: topLevelContract,
    }];
  }
  return sealedShots
    .filter((shot) => shot.included !== false)
    .map((shot) => {
      if (!shot.contract) throw new Error(`Generation shot is missing its sealed contract: ${shot.shotId}`);
      return {
        shotId: shot.shotId,
        jobShotId: shot.shotId,
        candidate: shot.candidate,
        contract: shot.contract,
        ...(shot.nodeId ? { nodeId: shot.nodeId } : {}),
      };
    });
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableAuthorizationJson(left) === stableAuthorizationJson(right);
}

export function deriveSealedGenerationAuthorizationState(input: Readonly<{
  run: ProductionRun;
  plan: ProductionGenerationPlan;
  topLevelContract: ExecutionContractV1;
  sealedShots?: readonly ProductionGenerationShot[];
  preparation: unknown;
  now: string;
}>): SealedGenerationAuthorizationState {
  const { envelope, authorizationDigest } = preparationFrom(input.preparation);
  if (
    envelope.projectId !== input.run.projectId
    || envelope.runId !== input.run.runId
    || envelope.planVersion !== input.run.planVersion
  ) {
    throw new Error("Generation authorization does not belong to the current Run plan");
  }
  if (envelope.budget.currency !== input.run.budget.currency) {
    throw new Error("Generation authorization currency does not match the Run budget");
  }
  if (input.run.policy.maxSpend !== null && envelope.budget.ledgerCeiling > input.run.policy.maxSpend) {
    throw new Error("Generation authorization exceeds the Run hard spend ceiling");
  }
  if (Date.parse(envelope.expiresAt) <= Date.parse(input.now)) {
    throw new Error("Generation authorization has expired");
  }
  if (input.run.gates.some((gate) => gate.gateId === envelope.gateId)) {
    throw new Error(`Duplicate gate: ${envelope.gateId}`);
  }

  const units = authorizationUnits(input.plan, input.topLevelContract, input.sealedShots);
  if (units.length !== envelope.jobs.length) {
    throw new Error("Generation authorization job set does not match the sealed plan");
  }

  const jobs = units.map((unit, index): ProductionJob => {
    const authorized = envelope.jobs[index];
    if (
      authorized.shotId !== unit.shotId
      || authorized.attempt !== 1
      || authorized.contractHash !== unit.contract.contractHash
      || authorized.providerId !== unit.contract.providerId
      || authorized.modelId !== unit.contract.modelId
      || authorized.mode !== unit.contract.mode
      || !sameJson(authorized.parameters, unit.contract.parameters)
      || !sameJson(authorized.references, unit.contract.references)
    ) {
      throw new Error(`Generation authorization job does not match sealed shot: ${unit.shotId}`);
    }
    if (
      authorized.target.kind !== "generation-operation"
      || authorized.target.operationId !== input.plan.operationId
      || authorized.target.candidateRevision !== unit.candidate.revision
    ) {
      throw new Error(`Generation authorization target does not match sealed shot: ${unit.shotId}`);
    }
    const expectedJobId = productionGenerationJobId(
      input.run.runId,
      unit.contract.contractHash,
      authorized.attempt,
      unit.jobShotId,
    );
    const expectedIdempotencyKey = productionGenerationProviderIdempotencyKey(
      input.run.runId,
      unit.contract.contractHash,
      authorized.attempt,
      unit.jobShotId,
    );
    if (authorized.jobId !== expectedJobId || authorized.providerIdempotencyKey !== expectedIdempotencyKey) {
      throw new Error(`Generation authorization identity does not match sealed shot: ${unit.shotId}`);
    }
    if (input.run.jobs.some((job) => job.jobId === authorized.jobId)) {
      throw new Error(`Duplicate job: ${authorized.jobId}`);
    }
    return {
      jobId: authorized.jobId,
      stageId: "generate",
      status: "authorization_required",
      attempt: authorized.attempt,
      provider: authorized.providerId,
      model: authorized.modelId,
      idempotencyKey: authorized.providerIdempotencyKey,
      providerIdempotencyKey: authorized.providerIdempotencyKey,
      authorizationDigest,
      taskKind: authorized.mode,
      ...(unit.nodeId ? { nodeId: unit.nodeId } : {}),
      ...(unit.jobShotId ? { metadata: { shotId: unit.jobShotId } } : {}),
      createdAt: input.now,
      updatedAt: input.now,
    };
  });

  return {
    envelope,
    authorizationDigest,
    jobs,
    gate: {
      gateId: envelope.gateId,
      scope: "budget_envelope",
      status: "waiting",
      planHash: authorizationDigest,
      authorizationDigest,
      costScope: envelope.costScope,
      requestedSpend: envelope.budget.maximum,
      jobIds: jobs.map((job) => job.jobId),
      title: "Confirm generation spend",
      summary: "Approve the frozen provider requests and their maximum total cost.",
      createdAt: input.now,
      expiresAt: envelope.expiresAt,
    },
  };
}

/** Validate and materialize a fresh authorization_required job + gate for one explicit rework. */
export function deriveGenerationReauthorizationState(input: Readonly<{
  run: ProductionRun;
  shotId?: string;
  preparation: unknown;
  now: string;
}>): ReauthorizedGenerationState {
  const plan = input.run.generationPlan;
  if (
    !plan
    || (plan.state !== "sealed" && plan.state !== "submitted")
    || !plan.authorizationEnvelope
  ) {
    throw new Error("A previously authorized generation plan is required before rework");
  }
  const { envelope, authorizationDigest } = preparationFrom(input.preparation);
  if (
    envelope.projectId !== input.run.projectId
    || envelope.runId !== input.run.runId
    || envelope.planVersion !== input.run.planVersion
    || envelope.jobs.length !== 1
  ) {
    throw new Error("Generation reauthorization does not belong to the current Run plan");
  }
  if (Date.parse(envelope.expiresAt) <= Date.parse(input.now)) {
    throw new Error("Generation reauthorization has expired");
  }
  if (input.run.gates.some((gate) => gate.gateId === envelope.gateId)) {
    throw new Error(`Duplicate gate: ${envelope.gateId}`);
  }

  const shot = input.shotId
    ? (plan.shots ?? []).find((candidate) => candidate.shotId === input.shotId)
    : undefined;
  if (input.shotId && !shot?.contract) throw new Error(`Generation shot is not sealed: ${input.shotId}`);
  if (!input.shotId && plan.shots?.length) throw new Error("A multi-shot reauthorization requires a shot id");
  const candidate = shot?.candidate ?? plan.candidate;
  const contract = shot?.contract ?? plan.contract;
  if (!contract) throw new Error("Generation contract is not sealed");

  const authorized = envelope.jobs[0];
  const jobShotId = input.shotId;
  const expectedShotId = input.shotId ?? candidate.candidateId;
  const expectedJobId = productionGenerationJobId(input.run.runId, contract.contractHash, authorized.attempt, jobShotId);
  const expectedIdempotencyKey = productionGenerationProviderIdempotencyKey(
    input.run.runId,
    contract.contractHash,
    authorized.attempt,
    jobShotId,
  );
  if (
    authorized.shotId !== expectedShotId
    || authorized.attempt < 2
    || authorized.attempt > input.run.policy.maxAttemptsPerJob
    || authorized.jobId !== expectedJobId
    || authorized.providerIdempotencyKey !== expectedIdempotencyKey
    || authorized.contractHash !== contract.contractHash
    || authorized.providerId !== contract.providerId
    || authorized.modelId !== contract.modelId
    || authorized.mode !== contract.mode
    || !sameJson(authorized.parameters, contract.parameters)
    || !sameJson(authorized.references, contract.references)
    || authorized.target.kind !== "generation-operation"
    || authorized.target.operationId !== plan.operationId
    || authorized.target.candidateRevision !== candidate.revision
  ) {
    throw new Error("Generation reauthorization does not match the addressed shot");
  }
  if (input.run.jobs.some((job) => job.jobId === expectedJobId)) throw new Error(`Duplicate job: ${expectedJobId}`);
  const parentJobId = productionGenerationJobId(
    input.run.runId,
    contract.contractHash,
    authorized.attempt - 1,
    jobShotId,
  );
  const parent = input.run.jobs.find((job) => job.jobId === parentJobId);
  if (!parent || !REWORKABLE_JOB_STATUSES.has(parent.status)) {
    throw new Error("The previous generation attempt is not safely reworkable");
  }
  if (input.run.jobs.some((job) => UNSUBMITTED_AUTHORIZATION_STATUSES.has(job.status))) {
    throw new Error("Generation rework requires all previously authorized jobs to be submitted or settled");
  }
  const liability = input.run.budget.reserved + input.run.budget.actual + input.run.budget.unsettled;
  if (
    envelope.budget.currency !== input.run.budget.currency
    || envelope.budget.ledgerCeiling < input.run.budget.authorized
    || envelope.budget.ledgerCeiling < liability + envelope.budget.maximum
  ) {
    throw new Error("Generation reauthorization does not safely extend the Run budget");
  }

  const nodeId = shot?.nodeId ?? parent.nodeId;
  // Keep retry lineage on the explicit reauthorization path identical to the
  // automatic QA retry path.  Without this field the durable job still had
  // attempt=2, but projections/evidence could not tell it was the first retry
  // (and a subsequent recovery pass could schedule it again).
  const previousRetryCount = Math.max(0, Math.floor(Number(parent.retryCount ?? parent.metadata?.retryCount) || 0));
  const retryCount = previousRetryCount + 1;
  const job: ProductionJob = {
    jobId: expectedJobId,
    stageId: "generate",
    status: "authorization_required",
    attempt: authorized.attempt,
    provider: authorized.providerId,
    model: authorized.modelId,
    idempotencyKey: authorized.providerIdempotencyKey,
    providerIdempotencyKey: authorized.providerIdempotencyKey,
    authorizationDigest,
    taskKind: authorized.mode,
    parentJobId,
    retryCount,
    retryReason: "rework",
    ...(nodeId ? { nodeId } : {}),
    metadata: {
      ...(parent.metadata ?? {}),
      ...(input.shotId ? { shotId: input.shotId } : {}),
      retryCount,
      retryReason: "rework",
      parentJobId,
    },
    createdAt: input.now,
    updatedAt: input.now,
  };
  const gate: ProductionGate = {
    gateId: envelope.gateId,
    scope: "budget_envelope",
    status: "waiting",
    planHash: authorizationDigest,
    authorizationDigest,
    costScope: envelope.costScope,
    requestedSpend: envelope.budget.maximum,
    jobIds: [job.jobId],
    title: "Confirm generation spend",
    summary: "Approve the frozen provider request for this rework.",
    createdAt: input.now,
    expiresAt: envelope.expiresAt,
  };
  const generationPlan: ProductionGenerationPlan = {
    ...plan,
    state: "sealed",
    planHash: authorizationDigest,
    authorizationEnvelope: envelope,
    authorizationDigest,
    authorizationGateId: envelope.gateId,
    approvedReceiptId: undefined,
    approvedAt: undefined,
    approvedAttempt: undefined,
    ...(input.shotId
      ? {
          shots: plan.shots!.map((candidateShot) => candidateShot.shotId === input.shotId
            ? {
                ...candidateShot,
                attemptCount: authorized.attempt,
                approvedReceiptId: undefined,
                approvedAt: undefined,
                approvedAttempt: undefined,
                updatedAt: input.now,
              }
            : candidateShot),
        }
      : {}),
    updatedAt: input.now,
  };
  return { generationPlan, job, gate, policyMaxSpend: envelope.budget.ledgerCeiling };
}

/** Validate a fresh budget continuation over existing, current-attempt jobs that have never submitted. */
export function deriveGenerationContinuationAuthorizationState(input: Readonly<{
  run: ProductionRun;
  preparation: unknown;
  now: string;
}>): ContinuedGenerationState {
  const plan = input.run.generationPlan;
  if (!plan || plan.state !== "submitted" || !plan.shots?.length || !plan.authorizationEnvelope) {
    throw new Error("A submitted multi-shot authorization is required before paid continuation");
  }
  const { envelope, authorizationDigest } = preparationFrom(input.preparation);
  if (
    envelope.projectId !== input.run.projectId
    || envelope.runId !== input.run.runId
    || envelope.planVersion !== input.run.planVersion
  ) {
    throw new Error("Generation continuation does not belong to the current Run plan");
  }
  if (Date.parse(envelope.expiresAt) <= Date.parse(input.now)) throw new Error("Generation continuation has expired");
  if (input.run.gates.some((gate) => gate.gateId === envelope.gateId)) throw new Error(`Duplicate gate: ${envelope.gateId}`);
  const liability = input.run.budget.reserved + input.run.budget.actual + input.run.budget.unsettled;
  if (
    envelope.budget.currency !== input.run.budget.currency
    || envelope.budget.ledgerCeiling <= input.run.budget.authorized
    || envelope.budget.ledgerCeiling < liability + envelope.budget.maximum
  ) {
    throw new Error("Generation continuation does not safely extend the Run budget");
  }

  const replacementById = new Map<string, ProductionJob>();
  for (const authorized of envelope.jobs) {
    const shot = plan.shots.find((candidate) => candidate.shotId === authorized.shotId);
    const contract = shot?.contract;
    const existing = input.run.jobs.find((job) => job.jobId === authorized.jobId);
    if (!shot || !contract || !existing || existing.status !== "authorized" || existing.providerTaskId) {
      throw new Error(`Generation continuation job is not safely pending: ${authorized.shotId}`);
    }
    const expectedJobId = productionGenerationJobId(input.run.runId, contract.contractHash, authorized.attempt, shot.shotId);
    const expectedIdempotencyKey = productionGenerationProviderIdempotencyKey(
      input.run.runId,
      contract.contractHash,
      authorized.attempt,
      shot.shotId,
    );
    if (
      authorized.jobId !== expectedJobId
      || authorized.providerIdempotencyKey !== expectedIdempotencyKey
      || existing.providerIdempotencyKey !== expectedIdempotencyKey
      || authorized.contractHash !== contract.contractHash
      || authorized.providerId !== contract.providerId
      || authorized.modelId !== contract.modelId
      || authorized.mode !== contract.mode
      || !sameJson(authorized.parameters, contract.parameters)
      || !sameJson(authorized.references, contract.references)
      || authorized.target.kind !== "generation-operation"
      || authorized.target.operationId !== plan.operationId
      || authorized.target.candidateRevision !== shot.candidate.revision
    ) {
      throw new Error(`Generation continuation does not match the sealed shot: ${authorized.shotId}`);
    }
    replacementById.set(existing.jobId, {
      ...existing,
      status: "authorization_required",
      authorizationDigest,
      updatedAt: input.now,
    });
  }
  if (replacementById.size !== envelope.jobs.length) throw new Error("Generation continuation job set is invalid");
  const jobs = input.run.jobs.map((job) => replacementById.get(job.jobId) ?? job);
  const gate: ProductionGate = {
    gateId: envelope.gateId,
    scope: "budget_envelope",
    status: "waiting",
    planHash: authorizationDigest,
    authorizationDigest,
    costScope: envelope.costScope,
    requestedSpend: envelope.budget.maximum,
    jobIds: envelope.jobs.map((job) => job.jobId),
    title: "Confirm generation continuation spend",
    summary: "Approve the frozen remaining provider requests and their maximum additional cost.",
    createdAt: input.now,
    expiresAt: envelope.expiresAt,
  };
  const continuedShotIds = new Set(envelope.jobs.map((job) => job.shotId));
  const generationPlan: ProductionGenerationPlan = {
    ...plan,
    planHash: authorizationDigest,
    authorizationEnvelope: envelope,
    authorizationDigest,
    authorizationGateId: envelope.gateId,
    approvedReceiptId: undefined,
    approvedAt: undefined,
    approvedAttempt: undefined,
    shots: plan.shots.map((shot) => continuedShotIds.has(shot.shotId)
      ? { ...shot, approvedReceiptId: undefined, approvedAt: undefined, updatedAt: input.now }
      : shot),
    updatedAt: input.now,
  };
  return { generationPlan, jobs, gate, policyMaxSpend: envelope.budget.ledgerCeiling };
}

export function applyGenerationAuthorizationGateDecision(input: Readonly<{
  run: ProductionRun;
  gate: ProductionGate;
  status: ProductionGate["status"];
  receiptId?: string;
  now: string;
}>): GenerationAuthorizationGateDecision {
  if (!input.gate.authorizationDigest) return { generationPlan: input.run.generationPlan };
  const plan = input.run.generationPlan;
  if (
    !plan?.authorizationEnvelope
    || plan.authorizationDigest !== input.gate.authorizationDigest
    || plan.authorizationGateId !== input.gate.gateId
    || input.gate.planHash !== input.gate.authorizationDigest
    || input.gate.jobIds.join("\n") !== plan.authorizationEnvelope.jobs.map((job) => job.jobId).join("\n")
  ) {
    throw new Error("Generation authorization gate does not match the sealed plan");
  }
  if (input.status !== "approved") return { generationPlan: plan };
  const receiptId = input.receiptId?.trim();
  if (!receiptId) throw new Error("Production receiptId is required");
  return {
    receiptId,
    generationPlan: {
      ...plan,
      approvedReceiptId: receiptId,
      approvedAt: input.now,
      ...(plan.shots
        ? {
            shots: plan.shots.map((shot) => plan.authorizationEnvelope!.jobs.some((job) => job.shotId === shot.shotId)
              ? { ...shot, approvedReceiptId: receiptId, approvedAt: input.now, updatedAt: input.now }
              : shot),
          }
        : {}),
      updatedAt: input.now,
    },
  };
}
