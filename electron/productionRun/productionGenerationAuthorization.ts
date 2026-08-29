import crypto from "node:crypto";

import type { ExecutionContractV1 } from "../capabilityCore/executionContract";

export const PRODUCTION_GENERATION_AUTHORIZATION_VERSION = 1 as const;

export type ProductionGenerationTargetEvidence =
  | Readonly<{
      kind: "canvas-node";
      nodeId: string;
      nodeRevision: number;
      currentResultId?: string;
      currentResultContentHash?: string;
    }>
  | Readonly<{
      kind: "generation-operation";
      operationId: string;
      candidateRevision: number;
    }>;

export type ProductionGenerationAuthorizationJobV1 = Readonly<{
  jobId: string;
  shotId: string;
  attempt: number;
  target: ProductionGenerationTargetEvidence;
  contractHash: string;
  providerId: string;
  modelId: string;
  mode: string;
  parameters: Readonly<Record<string, unknown>>;
  references: readonly ExecutionContractV1["references"][number][];
  providerWirePayloadHash: string;
  providerIdempotencyKey: string;
  price: Readonly<{ currency: string; maximum: number }>;
}>;

export type ProductionGenerationAuthorizationEnvelopeV1 = Readonly<{
  schemaVersion: typeof PRODUCTION_GENERATION_AUTHORIZATION_VERSION;
  immutableProjectUuid: string;
  projectGeneration: number;
  projectId: string;
  projectRevision: number;
  runId: string;
  planVersion: number;
  gateId: string;
  costScope: string;
  expiresAt: string;
  jobs: readonly ProductionGenerationAuthorizationJobV1[];
  budget: Readonly<{
    currency: string;
    /** Maximum new liability covered by this human decision. */
    maximum: number;
    /** Absolute Run ledger ceiling after this authorization is approved. */
    ledgerCeiling: number;
  }>;
}>;

export class ProductionGenerationAuthorizationError extends Error {
  readonly code = "generation_authorization_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "ProductionGenerationAuthorizationError";
  }
}

export function stableAuthorizationJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ProductionGenerationAuthorizationError("Authorization values must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableAuthorizationJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableAuthorizationJson(child)}`)
      .join(",")}}`;
  }
  throw new ProductionGenerationAuthorizationError("Authorization values must be JSON serializable");
}

export function productionGenerationPayloadHash(payload: unknown): string {
  return crypto.createHash("sha256").update(stableAuthorizationJson(payload)).digest("hex");
}

function requiredText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new ProductionGenerationAuthorizationError(`${label} is required`);
  return text;
}

function nonNegativeMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new ProductionGenerationAuthorizationError(`${label} must be non-negative`);
  return value;
}

export function productionGenerationJobId(
  runId: string,
  contractHash: string,
  attempt = 1,
  shotId?: string,
): string {
  const shotSegment = shotId ? `-${requiredText(shotId, "Shot id")}` : "";
  const normalizedRunId = requiredText(runId, "Run id");
  const normalizedContractHash = requiredText(contractHash, "Contract hash");
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new ProductionGenerationAuthorizationError("Generation attempt must be a positive integer");
  }
  return `generation-${normalizedRunId}${shotSegment}-${normalizedContractHash.slice(0, 16)}${attempt > 1 ? `-attempt-${attempt}` : ""}`;
}

export function productionGenerationProviderIdempotencyKey(
  runId: string,
  contractHash: string,
  attempt = 1,
  shotId?: string,
): string {
  const jobId = productionGenerationJobId(runId, contractHash, attempt, shotId);
  const bindingShotId = shotId ? requiredText(shotId, "Shot id") : jobId;
  return `generation:${requiredText(runId, "Run id")}:${bindingShotId}:${requiredText(contractHash, "Contract hash")}:attempt-${attempt}`;
}

export function createProductionGenerationAuthorizationEnvelope(input: ProductionGenerationAuthorizationEnvelopeV1): ProductionGenerationAuthorizationEnvelopeV1 {
  if (input.schemaVersion !== PRODUCTION_GENERATION_AUTHORIZATION_VERSION) {
    throw new ProductionGenerationAuthorizationError("Unsupported generation authorization version");
  }
  if (!Number.isSafeInteger(input.projectGeneration) || input.projectGeneration < 1) {
    throw new ProductionGenerationAuthorizationError("Project generation must be a positive integer");
  }
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0) {
    throw new ProductionGenerationAuthorizationError("Project revision must be a non-negative integer");
  }
  if (!Number.isSafeInteger(input.planVersion) || input.planVersion < 1) {
    throw new ProductionGenerationAuthorizationError("Plan version must be a positive integer");
  }
  if (input.jobs.length === 0) throw new ProductionGenerationAuthorizationError("Authorization requires at least one job");
  const currency = requiredText(input.budget.currency, "Budget currency");
  const ids = new Set<string>();
  const jobs = input.jobs.map((job) => {
    const jobId = requiredText(job.jobId, "Job id");
    if (ids.has(jobId)) throw new ProductionGenerationAuthorizationError(`Duplicate authorization job: ${jobId}`);
    ids.add(jobId);
    if (!Number.isSafeInteger(job.attempt) || job.attempt < 1) {
      throw new ProductionGenerationAuthorizationError("Generation attempt must be a positive integer");
    }
    if (!job.target || typeof job.target !== "object") {
      throw new ProductionGenerationAuthorizationError("Generation target evidence is invalid");
    }
    let target: ProductionGenerationTargetEvidence;
    if (job.target.kind === "canvas-node") {
      if (!Number.isSafeInteger(job.target.nodeRevision) || job.target.nodeRevision < 0) {
        throw new ProductionGenerationAuthorizationError("Node revision must be a non-negative integer");
      }
      target = Object.freeze({
        kind: "canvas-node",
        nodeId: requiredText(job.target.nodeId, "Node id"),
        nodeRevision: job.target.nodeRevision,
        ...(job.target.currentResultId
          ? { currentResultId: requiredText(job.target.currentResultId, "Current result id") }
          : {}),
        ...(job.target.currentResultContentHash
          ? { currentResultContentHash: requiredText(job.target.currentResultContentHash, "Current result content hash") }
          : {}),
      });
    } else if (job.target.kind === "generation-operation") {
      if (!Number.isSafeInteger(job.target.candidateRevision) || job.target.candidateRevision < 1) {
        throw new ProductionGenerationAuthorizationError("Candidate revision must be a positive integer");
      }
      target = Object.freeze({
        kind: "generation-operation",
        operationId: requiredText(job.target.operationId, "Operation id"),
        candidateRevision: job.target.candidateRevision,
      });
    } else {
      throw new ProductionGenerationAuthorizationError("Generation target evidence is invalid");
    }
    if (job.price.currency.trim() !== currency) throw new ProductionGenerationAuthorizationError("Job price currency must match the batch budget");
    return Object.freeze({
      jobId,
      shotId: requiredText(job.shotId, "Shot id"),
      attempt: job.attempt,
      target,
      contractHash: requiredText(job.contractHash, "Contract hash"),
      providerId: requiredText(job.providerId, "Provider id"),
      modelId: requiredText(job.modelId, "Model id"),
      mode: requiredText(job.mode, "Generation mode"),
      parameters: Object.freeze(structuredClone(job.parameters)),
      references: Object.freeze(structuredClone(job.references)),
      providerWirePayloadHash: requiredText(job.providerWirePayloadHash, "Provider wire payload hash"),
      providerIdempotencyKey: requiredText(job.providerIdempotencyKey, "Provider idempotency key"),
      price: Object.freeze({ currency, maximum: nonNegativeMoney(job.price.maximum, "Job price ceiling") }),
    });
  });
  const maximum = nonNegativeMoney(input.budget.maximum, "Budget ceiling");
  const ledgerCeiling = nonNegativeMoney(input.budget.ledgerCeiling, "Run ledger ceiling");
  const jobMaximum = jobs.reduce((sum, job) => sum + job.price.maximum, 0);
  if (maximum > jobMaximum) throw new ProductionGenerationAuthorizationError("Budget ceiling must not exceed the ordered job ceilings");
  if (ledgerCeiling < maximum) throw new ProductionGenerationAuthorizationError("Run ledger ceiling must cover the approved job ceiling");
  const expiresAt = requiredText(input.expiresAt, "Authorization expiry");
  if (!Number.isFinite(Date.parse(expiresAt))) throw new ProductionGenerationAuthorizationError("Authorization expiry is invalid");
  return Object.freeze({
    schemaVersion: PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
    immutableProjectUuid: requiredText(input.immutableProjectUuid, "Immutable project uuid"),
    projectGeneration: input.projectGeneration,
    projectId: requiredText(input.projectId, "Project id"),
    projectRevision: input.projectRevision,
    runId: requiredText(input.runId, "Run id"),
    planVersion: input.planVersion,
    gateId: requiredText(input.gateId, "Gate id"),
    costScope: requiredText(input.costScope, "Cost scope"),
    expiresAt,
    jobs: Object.freeze(jobs),
    budget: Object.freeze({ currency, maximum, ledgerCeiling }),
  });
}

export function productionGenerationAuthorizationDigest(envelope: ProductionGenerationAuthorizationEnvelopeV1): string {
  return productionGenerationPayloadHash(createProductionGenerationAuthorizationEnvelope(envelope));
}

export function assertProductionGenerationPayloadHash(payload: unknown, expectedHash: string): void {
  const actual = productionGenerationPayloadHash(payload);
  if (actual !== expectedHash) throw new ProductionGenerationAuthorizationError("Provider wire payload no longer matches the approved authorization");
}
