import { transitionJob, transitionRun } from "./productionRunState";
import { bindShotNodes, detachShotNodes } from "./productionRunCanvasLandingReducer";
import type {
  BudgetLedgerSummary,
  ProductionArtifact,
  ProductionDirectionCandidate,
  ProductionGate,
  ProductionJob,
  ProductionJobStatus,
  ProductionGenerationPlan,
  ProductionGenerationShot,
  ProductionRun,
  ProductionRunStatus,
  ProductionStage,
  RunCommand,
} from "./productionRunTypes";
import { validateProductionExecutionBinding } from "./productionExecutionBinding";
import {
  applyGenerationAuthorizationGateDecision,
  deriveGenerationContinuationAuthorizationState,
  deriveGenerationReauthorizationState,
  deriveSealedGenerationAuthorizationState,
} from "./productionGenerationAuthorizationState";
import { generationSealShotPrices, SealBudgetExceededError } from "./productionGenerationSeal";
import { checkSealAffordability } from "./shotPricing";

export { SealBudgetExceededError } from "./productionGenerationSeal";

/** Update one shot inside a plan by id; throws if the plan has no such shot. */
function replaceShot(
  plan: ProductionGenerationPlan,
  shotId: string,
  update: (shot: ProductionGenerationShot) => ProductionGenerationShot,
): ProductionGenerationShot[] {
  const shots = plan.shots ?? [];
  let found = false;
  const next = shots.map((shot) => {
    if (shot.shotId !== shotId) return shot;
    found = true;
    return update(shot);
  });
  if (!found) throw new Error(`Generation shot not found: ${shotId}`);
  return next;
}

/** A shot is included in the sealed contract unless it was explicitly unchecked (试拍/分批). */
function isShotIncluded(shot: Pick<ProductionGenerationShot, "included">): boolean {
  return shot.included !== false;
}

/**
 * P4 S1 seal helper: validate + freeze the shots[] payload. Returns undefined for a single-shot seal
 * (no shots[] payload → today's byte-identical path). For a multi-shot seal, every INCLUDED shot must
 * carry a matching sealed sub-contract; excluded shots must not; shot ids must be unique and non-empty.
 */
function sealGenerationShots(plan: ProductionGenerationPlan, raw: unknown): ProductionGenerationShot[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Multi-shot generation seal requires a non-empty shots list");
  const seen = new Set<string>();
  const sealed = raw.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid generation shot ${index}`);
    const shot = value as ProductionGenerationShot;
    const shotId = typeof shot.shotId === "string" ? shot.shotId.trim() : "";
    if (!shotId || seen.has(shotId)) throw new Error(`Invalid generation shot id at ${index}`);
    seen.add(shotId);
    const included = isShotIncluded(shot);
    if (included) {
      if (!shot.contract || typeof shot.contract.contractHash !== "string" || !shot.contract.contractHash.trim()) {
        throw new Error(`Included generation shot ${shotId} needs a sealed sub-contract`);
      }
      if (shot.candidate?.sealedContractHash !== shot.contract.contractHash) {
        throw new Error(`Generation shot ${shotId} sub-contract does not match its sealed candidate`);
      }
    } else if (shot.contract) {
      throw new Error(`Excluded generation shot ${shotId} must not carry a sealed sub-contract`);
    }
    return shot;
  });
  void plan;
  return sealed;
}

export type ProductionCommandEffect = {
  run: ProductionRun;
  eventType: string;
  message: string;
};

function record(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Missing ${key}`);
  return value as Record<string, unknown>;
}

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}`);
  return value.trim();
}

const ARTIFACT_STATUSES = new Set<ProductionArtifact["status"]>([
  "candidate",
  "ready",
  "adopted",
  "rejected",
]);
const GATE_STATUSES = new Set<ProductionGate["status"]>(["waiting", "approved", "rejected", "expired", "revoked"]);

export const ARTIFACT_REVIEW_DECISIONS = ["approved", "changes_requested", "rejected"] as const;
export type ArtifactReviewDecision = (typeof ARTIFACT_REVIEW_DECISIONS)[number];

function artifactVersion(value: ProductionArtifact): number {
  return Number.isInteger(value.version) && (value.version as number) > 0 ? value.version as number : 1;
}

function artifactHash(value: ProductionArtifact | undefined): string | undefined {
  return value?.contentHash;
}

function isApprovedScript(value: ProductionArtifact | undefined): boolean {
  return Boolean(value && value.kind === "script" && value.status === "adopted" && (value.reviewStatus === undefined || value.reviewStatus === "approved"));
}

function reviewDecision(payload: Record<string, unknown>): ArtifactReviewDecision {
  const value = typeof payload.decision === "string" ? payload.decision : payload.status;
  if (value !== "approved" && value !== "changes_requested" && value !== "rejected") {
    throw new Error("Invalid artifact review decision");
  }
  return value;
}

/** Return whether this candidate has passed review and can become the adopted artifact. */
export function canAdoptArtifact(run: ProductionRun, artifactId: string): boolean {
  const candidate = run.artifacts.find((item) => item.artifactId === artifactId);
  if (!candidate || candidate.status !== "candidate" || candidate.reviewStatus !== "approved") return false;
  if (candidate.kind === "storyboard") {
    try {
      assertStoryboardSourceApproved(run, artifactId);
    } catch {
      return false;
    }
  }
  return true;
}

/** Enforce the one-way script → storyboard provenance boundary. */
export function assertStoryboardSourceApproved(run: ProductionRun, artifactId: string): void {
  const storyboard = run.artifacts.find((item) => item.artifactId === artifactId);
  if (!storyboard || storyboard.kind !== "storyboard") throw new Error("Storyboard artifact not found");
  const sourceId = storyboard.sourceArtifactId || storyboard.sourceScriptArtifactId;
  const source = sourceId ? run.artifacts.find((item) => item.artifactId === sourceId) : undefined;
  if (!isApprovedScript(source)) throw new Error("approved script required");
  const sourceVersion = storyboard.sourceVersion ?? storyboard.sourceScriptVersion;
  if (sourceVersion !== undefined && sourceVersion !== artifactVersion(source!)) {
    throw new Error("storyboard source script version is stale");
  }
  const sourceHash = storyboard.sourceContentHash || storyboard.sourceHash || storyboard.sourceScriptHash;
  if (sourceHash && artifactHash(source) && sourceHash !== artifactHash(source)) {
    throw new Error("storyboard source script hash is stale");
  }
}

/** Mark derived artifacts rejected when their source is superseded or explicitly changed. */
export function markDerivedArtifactsStale(run: ProductionRun, sourceArtifactId: string): ProductionRun {
  const artifacts = run.artifacts.map((item) => {
    if (item.sourceArtifactId !== sourceArtifactId || item.status === "rejected") return item;
    return { ...item, status: "rejected" as const, reviewStatus: "changes_requested" as const };
  });
  return { ...run, artifacts };
}

function normalizeArtifactContract(value: ProductionArtifact): ProductionArtifact {
  const next: ProductionArtifact = {
    ...value,
    version: artifactVersion(value),
    ...(value.source ? {} : { source: "nomi-agent" as const }),
    ...(value.status === "candidate" && !value.reviewStatus ? { reviewStatus: "waiting" as const } : {}),
  };
  return next;
}

function artifact(payload: Record<string, unknown>): ProductionArtifact {
  const value = record(payload, "artifact");
  if (!ARTIFACT_STATUSES.has(value.status as ProductionArtifact["status"])) {
    throw new Error("Invalid artifact status");
  }
  return normalizeArtifactContract(value as ProductionArtifact);
}

/** B1：校验方向候选 —— 2-3 个、key 唯一且安全、title/oneLiner 非空且截断。别信 LLM 原样入库。 */
function directionCandidates(value: unknown): ProductionDirectionCandidate[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) throw new Error("Direction candidates must be 2 or 3 options");
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid direction candidate ${index}`);
    const raw = item as Record<string, unknown>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const oneLiner = typeof raw.oneLiner === "string" ? raw.oneLiner.trim() : "";
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(key) || seen.has(key)) throw new Error(`Invalid direction candidate key ${index}`);
    if (!title || !oneLiner) throw new Error(`Direction candidate ${index} needs a title and one-liner`);
    seen.add(key);
    return { key, title: title.slice(0, 80), oneLiner: oneLiner.slice(0, 200) };
  });
}

function replaceById<T>(items: T[], id: string, readId: (item: T) => string, update: (item: T) => T): T[] {
  let found = false;
  const next = items.map((item) => {
    if (readId(item) !== id) return item;
    found = true;
    return update(item);
  });
  if (!found) throw new Error(`Production entity not found: ${id}`);
  return next;
}

function validateBudget(value: Record<string, unknown>, current: BudgetLedgerSummary): BudgetLedgerSummary {
  const next = { ...current };
  for (const key of ["authorized", "reserved", "actual", "unsettled"] as const) {
    if (value[key] === undefined) continue;
    const amount = Number(value[key]);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid budget ${key}`);
    next[key] = amount;
  }
  if (typeof value.currency === "string" && value.currency.trim()) next.currency = value.currency.trim();
  if (next.reserved + next.actual + next.unsettled > next.authorized) {
    throw new Error("Budget liability exceeds authorization");
  }
  return next;
}

export function applyProductionCommand(
  current: ProductionRun,
  command: RunCommand,
  now: string,
): ProductionCommandEffect {
  switch (command.type) {
    case "run.status": {
      const status = text(command.payload, "status") as ProductionRunStatus;
      return { run: transitionRun(current, status, now), eventType: "run.status.changed", message: status };
    }
    case "run.stage": {
      const stageId = text(command.payload, "stageId");
      return { run: { ...current, stageId, updatedAt: now }, eventType: "run.stage.changed", message: stageId };
    }
    case "generation.patch": {
      const currentPlan = current.generationPlan;
      if (!currentPlan || currentPlan.state !== "draft") throw new Error("new_draft_required: edit a new generation draft");
      const patch = record(command.payload, "patch") as Partial<ProductionGenerationShot["candidate"]>;
      // P4 S1 shot-addressing patch variant: edit one shot's candidate (model/mode/params/prompt/refs)
      // and/or its included flag (试拍/分批). No shotId → patch the top-level candidate exactly as today.
      const rawShotId = typeof command.payload.shotId === "string" ? command.payload.shotId.trim() : "";
      const shotId = rawShotId || undefined;
      if (shotId) {
        const hasIncluded = typeof command.payload.included === "boolean";
        const shots = replaceShot(currentPlan, shotId, (shot) => ({
          ...shot,
          candidate: {
            ...shot.candidate,
            ...patch,
            revision: shot.candidate.revision + 1,
            parameters: patch.parameters ? structuredClone(patch.parameters) : structuredClone(shot.candidate.parameters),
            references: patch.references ? structuredClone(patch.references) : structuredClone(shot.candidate.references),
          },
          ...(hasIncluded ? { included: command.payload.included as boolean } : {}),
          updatedAt: now,
        }));
        return {
          run: { ...current, generationPlan: { ...currentPlan, shots, updatedAt: now }, updatedAt: now },
          eventType: "generation.plan.updated",
          message: currentPlan.operationId,
        };
      }
      const candidate = {
        ...currentPlan.candidate,
        ...patch,
        revision: currentPlan.candidate.revision + 1,
        parameters: patch.parameters ? structuredClone(patch.parameters) : structuredClone(currentPlan.candidate.parameters),
        references: patch.references ? structuredClone(patch.references) : structuredClone(currentPlan.candidate.references),
      };
      return {
        run: { ...current, generationPlan: { ...currentPlan, candidate, updatedAt: now }, updatedAt: now },
        eventType: "generation.plan.updated",
        message: currentPlan.operationId,
      };
    }
    case "generation.seal": {
      const currentPlan = current.generationPlan;
      if (!currentPlan || currentPlan.state !== "draft") throw new Error("Generation plan is not editable");
      const contract = record(command.payload, "contract") as ProductionGenerationPlan["contract"];
      if (!contract || typeof contract.contractHash !== "string" || contract.contractHash.trim() === "") throw new Error("Invalid generation contract");
      if (contract.candidateId !== currentPlan.candidate.candidateId || contract.candidateRevision !== currentPlan.candidate.revision) {
        throw new Error("Generation contract does not match the current draft");
      }
      // P4 S1 multi-shot seal: freeze per-shot sub-contracts (included shots only) + the plan-level hash.
      // Single-shot seal (no shots[] in payload) stays byte-identical to today.
      const sealedShots = sealGenerationShots(currentPlan, command.payload.shots);
      const rawPlanHash = typeof command.payload.planHash === "string" ? command.payload.planHash.trim() : "";
      if (sealedShots && !rawPlanHash) throw new Error("A multi-shot generation seal requires a plan hash");
      // P4 S2 seal precheck: when the caller supplies per-shot prices (derived from the catalog), the
      // reducer enforces the hard spend ceiling at the single source of truth. Absent shotPrices →
      // byte-identical to today (no precheck, no costCertainty) so the single-shot chain is untouched.
      const shotPrices = generationSealShotPrices(command.payload.shotPrices);
      let costCertainty: ProductionGenerationPlan["costCertainty"];
      if (shotPrices) {
        // Precheck order = included shots in their declared order (checkbox order), single default shot
        // when there is no shots[] payload. maxAffordableShots is counted in exactly this order.
        const orderedShots = sealedShots
          ? sealedShots.filter(isShotIncluded).map((shot) => ({ shotId: shot.shotId, price: shotPrices.get(shot.shotId) ?? { known: false as const } }))
          : [{ shotId: currentPlan.candidate.candidateId, price: shotPrices.get(currentPlan.candidate.candidateId) ?? { known: false as const } }];
        const affordability = checkSealAffordability({ shots: orderedShots, maxSpend: current.policy.maxSpend });
        if (!affordability.ok) throw new SealBudgetExceededError(affordability.maxAffordableShots, affordability.knownSubtotal, affordability.maxSpend);
        costCertainty = affordability.hasUnknownPrice ? "partial" : "known";
      }
      const authorization = command.payload.authorization === undefined
        ? undefined
        : deriveSealedGenerationAuthorizationState({
            run: current,
            plan: currentPlan,
            topLevelContract: contract,
            ...(sealedShots ? { sealedShots } : {}),
            preparation: command.payload.authorization,
            now,
          });
      return {
        run: {
          ...current,
          ...(authorization
            ? {
                policy: { ...current.policy, maxSpend: authorization.envelope.budget.ledgerCeiling },
                gates: [...current.gates, authorization.gate],
                jobs: [...current.jobs, ...authorization.jobs],
              }
            : {}),
          generationPlan: {
            ...currentPlan,
            candidate: { ...currentPlan.candidate, sealedContractHash: contract.contractHash },
            contract,
            state: "sealed",
            ...(sealedShots ? { shots: sealedShots, planHash: authorization?.authorizationDigest ?? rawPlanHash } : {}),
            ...(authorization
              ? {
                  authorizationEnvelope: authorization.envelope,
                  authorizationDigest: authorization.authorizationDigest,
                  authorizationGateId: authorization.envelope.gateId,
                  planHash: authorization.authorizationDigest,
                }
              : {}),
            ...(costCertainty ? { costCertainty } : {}),
            updatedAt: now,
          },
          updatedAt: now,
        },
        eventType: "generation.plan.sealed",
        message: currentPlan.operationId,
      };
    }
    case "generation.trial_narrow": {
      // Trial-first changes the provider payload and spend scope. Revoke the unapproved authority,
      // return to draft, and force the normal prepare -> seal -> gate path to create a new digest.
      const currentPlan = current.generationPlan;
      if (!currentPlan || currentPlan.state !== "sealed" || !currentPlan.shots || !currentPlan.authorizationDigest || !currentPlan.authorizationGateId) {
        throw new Error("A waiting authorized multi-shot plan is required to narrow to a trial shot");
      }
      const authorizationGate = current.gates.find((gate) => gate.gateId === currentPlan.authorizationGateId);
      if (!authorizationGate || authorizationGate.status !== "waiting") {
        throw new Error("Trial-first is available only before the spend gate is decided");
      }
      const abandonedJobs = current.jobs.filter((job) => job.authorizationDigest === currentPlan.authorizationDigest);
      if (abandonedJobs.some((job) => job.status !== "authorization_required")) {
        throw new Error("Trial-first cannot replace an authorization that has begun execution");
      }
      const videoShots = currentPlan.shots.filter((shot) => shot.role !== "anchor");
      const firstIncludedVideo = videoShots.find((shot) => isShotIncluded(shot));
      if (!firstIncludedVideo) throw new Error("No included video shot to trial");
      const shots = currentPlan.shots.map((shot) => {
        const included = shot.role === "anchor" || shot.shotId === firstIncludedVideo.shotId;
        return {
          ...shot,
          included,
          candidate: { ...shot.candidate, sealedContractHash: undefined },
          contract: undefined,
          approvedReceiptId: undefined,
          approvedAt: undefined,
          approvedAttempt: undefined,
          updatedAt: now,
        };
      });
      return {
        run: {
          ...current,
          planVersion: current.planVersion + 1,
          gates: current.gates.map((gate) => gate.gateId === authorizationGate.gateId
            ? { ...gate, status: "revoked", decidedAt: now }
            : gate),
          jobs: current.jobs.filter((job) => job.authorizationDigest !== currentPlan.authorizationDigest),
          generationPlan: {
            ...currentPlan,
            state: "draft",
            candidate: { ...currentPlan.candidate, sealedContractHash: undefined },
            contract: undefined,
            shots,
            planHash: undefined,
            authorizationEnvelope: undefined,
            authorizationDigest: undefined,
            authorizationGateId: undefined,
            approvedReceiptId: undefined,
            approvedAt: undefined,
            approvedAttempt: undefined,
            costCertainty: undefined,
            updatedAt: now,
          },
          updatedAt: now,
        },
        eventType: "generation.plan.updated",
        message: currentPlan.operationId,
      };
    }
    case "generation.cancel": {
      const currentPlan = current.generationPlan;
      if (!currentPlan) throw new Error("Generation plan not found");
      if (currentPlan.state === "submitted") throw new Error("Submitted generation cannot be cancelled as a draft");
      return {
        run: { ...current, generationPlan: { ...currentPlan, state: "cancelled", updatedAt: now }, updatedAt: now },
        eventType: "generation.plan.cancelled",
        message: currentPlan.operationId,
      };
    }
    case "generation.submit": {
      const currentPlan = current.generationPlan;
      if (!currentPlan || !currentPlan.contract || currentPlan.state === "draft" || currentPlan.state === "cancelled") {
        throw new Error("A sealed generation plan is required before submission");
      }
      if (currentPlan.state === "submitted") return { run: current, eventType: "generation.plan.submitted", message: currentPlan.operationId };
      return {
        run: { ...current, generationPlan: { ...currentPlan, state: "submitted", updatedAt: now }, updatedAt: now },
        eventType: "generation.plan.submitted",
        message: currentPlan.operationId,
      };
    }
    case "plan.bind-shot-nodes":
      // P4 S5 画布落地：拆进 productionRunCanvasLandingReducer 守 800 行门岗（R9）。
      return bindShotNodes(current, command, now);
    case "plan.detach-shot-nodes":
      return detachShotNodes(current, command, now);
    case "generation.approve": {
      const currentPlan = current.generationPlan;
      const receiptId = text(command.payload, "receiptId");
      const contractHash = text(command.payload, "contractHash");
      if (!currentPlan || currentPlan.state !== "sealed" || !currentPlan.contract) throw new Error("A sealed generation plan is required before approval");
      // P4 S1: a multi-shot receipt is keyed on the plan-level hash (covers the whole operation);
      // a single-shot receipt is keyed on the one sealed contract hash. Accept whichever this plan uses.
      const expectedHash = currentPlan.shots ? currentPlan.planHash : currentPlan.contract.contractHash;
      if (expectedHash !== contractHash) throw new Error("Generation approval does not match the sealed contract");
      const rawAttempt = command.payload.attempt;
      const approvedAttempt = rawAttempt === undefined ? undefined : Number(rawAttempt);
      if (approvedAttempt !== undefined && (!Number.isInteger(approvedAttempt) || approvedAttempt < 1)) throw new Error("Generation approval attempt is invalid");
      if (currentPlan.approvedReceiptId === receiptId && currentPlan.approvedAttempt === approvedAttempt) return { run: current, eventType: "generation.plan.approved", message: currentPlan.operationId };
      // P4 S1: the plan-level receipt approves every INCLUDED shot (a per-operation receipt covers the
      // whole batch — §1). Excluded shots stay unapproved. Single-shot plans (no shots[]) are unaffected.
      const approvedShots = currentPlan.shots
        ? currentPlan.shots.map((shot) => (isShotIncluded(shot)
            ? { ...shot, approvedReceiptId: receiptId, ...(approvedAttempt === undefined ? {} : { approvedAttempt }), approvedAt: now, updatedAt: now }
            : shot))
        : undefined;
      return {
        run: { ...current, generationPlan: { ...currentPlan, approvedReceiptId: receiptId, ...(approvedAttempt === undefined ? {} : { approvedAttempt }), ...(approvedShots ? { shots: approvedShots } : {}), approvedAt: now, updatedAt: now }, updatedAt: now },
        eventType: "generation.plan.approved",
        message: currentPlan.operationId,
      };
    }
    case "generation.reauthorize": {
      const rawShotId = typeof command.payload.shotId === "string" ? command.payload.shotId.trim() : "";
      const reauthorized = deriveGenerationReauthorizationState({
        run: current,
        ...(rawShotId ? { shotId: rawShotId } : {}),
        preparation: command.payload.authorization,
        now,
      });
      return {
        run: {
          ...current,
          policy: { ...current.policy, maxSpend: reauthorized.policyMaxSpend },
          generationPlan: reauthorized.generationPlan,
          gates: [...current.gates, reauthorized.gate],
          jobs: [...current.jobs, reauthorized.job],
          updatedAt: now,
        },
        eventType: "generation.attempt.authorization_requested",
        message: reauthorized.job.jobId,
      };
    }
    case "generation.continue_authorization": {
      const continued = deriveGenerationContinuationAuthorizationState({
        run: current,
        preparation: command.payload.authorization,
        now,
      });
      return {
        run: {
          ...current,
          policy: { ...current.policy, maxSpend: continued.policyMaxSpend },
          generationPlan: continued.generationPlan,
          gates: [...current.gates, continued.gate],
          jobs: [...continued.jobs],
          updatedAt: now,
        },
        eventType: "generation.continuation.authorization_requested",
        message: continued.gate.gateId,
      };
    }
    case "stage.upsert": {
      const stage = record(command.payload, "stage") as ProductionStage;
      const stages = current.stages.some((item) => item.stageId === stage.stageId)
        ? current.stages.map((item) => (item.stageId === stage.stageId ? stage : item))
        : [...current.stages, stage];
      return { run: { ...current, stages, updatedAt: now }, eventType: "stage.updated", message: stage.stageId };
    }
    case "job.add": {
      const job = record(command.payload, "job") as ProductionJob;
      if (current.jobs.some((item) => item.jobId === job.jobId)) throw new Error(`Duplicate job: ${job.jobId}`);
      if (job.executionBinding) {
        const binding = validateProductionExecutionBinding(job.executionBinding);
        if (binding.runId !== current.runId) throw new Error("Invalid execution binding: run id does not match ProductionRun");
        if (binding.providerNamespace !== job.provider) throw new Error("Invalid execution binding: provider namespace does not match job provider");
        if (binding.providerIdempotencyKey !== job.idempotencyKey) throw new Error("Invalid execution binding: idempotency key does not match job");
      }
      return { run: { ...current, jobs: [...current.jobs, job], updatedAt: now }, eventType: "job.created", message: job.jobId };
    }
    case "qa.retry.schedule": {
      // Budget reservation and retry-job creation are one durable command. A
      // crash cannot leave a reserved unit with no job to consume it.
      const job = record(command.payload, "job") as ProductionJob;
      if (current.jobs.some((item) => item.jobId === job.jobId)) throw new Error(`Duplicate job: ${job.jobId}`);
      const budget = validateBudget({ ...current.budget, reserved: current.budget.reserved + 1 }, current.budget);
      return {
        run: { ...current, budget, jobs: [...current.jobs, job], updatedAt: now },
        eventType: "qa.retry.scheduled",
        message: job.jobId,
      };
    }
    case "job.status": {
      const jobId = text(command.payload, "jobId");
      const status = text(command.payload, "status") as ProductionJobStatus;
      const patch = command.payload.patch && typeof command.payload.patch === "object"
        ? command.payload.patch as Partial<ProductionJob>
        : {};
      const jobs = replaceById(current.jobs, jobId, (job) => job.jobId, (job) => ({
        ...transitionJob(job, status, now),
        ...patch,
        jobId: job.jobId,
        status,
        updatedAt: now,
      }));
      return { run: { ...current, jobs, updatedAt: now }, eventType: `job.${status}`, message: jobId };
    }
    case "job.patch": {
      const jobId = text(command.payload, "jobId");
      const patch = command.payload.patch && typeof command.payload.patch === "object"
        ? command.payload.patch as Partial<ProductionJob>
        : {};
      const jobs = replaceById(current.jobs, jobId, (job) => job.jobId, (job) => ({
        ...job,
        ...patch,
        jobId: job.jobId,
        status: job.status,
        updatedAt: now,
      }));
      return { run: { ...current, jobs, updatedAt: now }, eventType: "job.updated", message: jobId };
    }
    case "gate.add": {
      const gate = record(command.payload, "gate") as ProductionGate;
      if (current.gates.some((item) => item.gateId === gate.gateId)) throw new Error(`Duplicate gate: ${gate.gateId}`);
      return { run: { ...current, gates: [...current.gates, gate], updatedAt: now }, eventType: "gate.waiting", message: gate.gateId };
    }
    case "gate.set_candidates": {
      // B1：方向门候选挂到 waiting 的 gate 上（driver 拟好后调）。只允许方向门、只在 waiting 时设。
      const gateId = text(command.payload, "gateId");
      const candidates = directionCandidates(command.payload.candidates);
      const currentGate = current.gates.find((gate) => gate.gateId === gateId);
      if (!currentGate) throw new Error(`Production entity not found: ${gateId}`);
      if (currentGate.scope !== "stage" || !gateId.startsWith("gate-direction-")) throw new Error("Direction candidates apply only to a direction gate");
      if (currentGate.status !== "waiting") throw new Error(`Production gate is already decided: ${gateId}`);
      const gates = replaceById(current.gates, gateId, (gate) => gate.gateId, (gate) => ({
        ...gate,
        directionCandidates: candidates,
      }));
      return { run: { ...current, gates, updatedAt: now }, eventType: "gate.candidates", message: gateId };
    }
    case "gate.decide": {
      const gateId = text(command.payload, "gateId");
      const status = text(command.payload, "status") as ProductionGate["status"];
      if (!GATE_STATUSES.has(status) || status === "waiting") throw new Error("Invalid production gate decision");
      const currentGate = current.gates.find((gate) => gate.gateId === gateId);
      if (!currentGate) throw new Error(`Production entity not found: ${gateId}`);
      if (currentGate.status !== "waiting") throw new Error(`Production gate is already decided: ${gateId}`);
      // B1：方向门批准可带 choiceKey（用户选中的候选）。校验它确属该门候选之一，留痕进 gate。
      const rawChoice = typeof command.payload.choiceKey === "string" ? command.payload.choiceKey.trim() : "";
      const choiceKey = status === "approved" && rawChoice && (currentGate.directionCandidates ?? []).some((candidate) => candidate.key === rawChoice)
        ? rawChoice
        : undefined;
      const authorizationDecision = applyGenerationAuthorizationGateDecision({
        run: current,
        gate: currentGate,
        status,
        ...(typeof command.payload.receiptId === "string" ? { receiptId: command.payload.receiptId } : {}),
        now,
      });
      const gates = replaceById(current.gates, gateId, (gate) => gate.gateId, (gate) => ({
        ...gate,
        status,
        decidedAt: now,
        ...(choiceKey ? { decidedChoiceKey: choiceKey } : {}),
        ...(authorizationDecision.receiptId ? { receiptId: authorizationDecision.receiptId } : {}),
      }));
      const jobs = status === "approved"
        ? current.jobs.map((job) => currentGate.jobIds.includes(job.jobId) && job.status === "authorization_required"
          ? transitionJob(job, "authorized", now)
          : job)
        : current.jobs;
      const approvesDirection = status === "approved" && current.status === "awaiting_direction"
        && currentGate.scope === "stage" && gateId.startsWith("gate-direction-");
      const approvesBuild = status === "approved" && current.status === "awaiting_contract"
        && currentGate.scope === "budget_envelope";
      const stages = current.stages.map((stage) => {
        if (approvesDirection && stage.stageId === "direction") {
          return { ...stage, status: "completed" as const, completedAt: now };
        }
        if (approvesBuild && stage.stageId === "build") {
          return { ...stage, status: "completed" as const, completedAt: now };
        }
        return stage;
      });
      const generationPlan = authorizationDecision.generationPlan;
      const decided = { ...current, gates, jobs, stages, ...(generationPlan ? { generationPlan } : {}) };
      const run = status === "approved" && current.status === "awaiting_contract"
        ? transitionRun(decided, "ready", now)
        : status === "approved" && current.status === "awaiting_direction"
          ? transitionRun(decided, "running", now)
        : status === "approved" && current.status === "awaiting_rough_cut_review"
          ? transitionRun(decided, "awaiting_export", now)
        : { ...decided, updatedAt: now };
      return { run, eventType: "gate.decided", message: gateId };
    }
    case "plan.proposed": {
      const proposed = Array.isArray(command.payload.artifacts) ? command.payload.artifacts.map((item) => artifact({ artifact: item })) : [];
      if (proposed.length === 0) throw new Error("Production plan artifacts are required");
      if (proposed.some((nextArtifact) => current.artifacts.some((item) => item.artifactId === nextArtifact.artifactId))) {
        throw new Error("Duplicate production plan artifact");
      }
      const scriptProposal = proposed.find((item) => item.kind === "script");
      const storyboardProposal = proposed.find((item) => item.kind === "storyboard");
      if (storyboardProposal) {
        const withProposed = { ...current, artifacts: [...current.artifacts, ...proposed] };
        assertStoryboardSourceApproved(withProposed, storyboardProposal.artifactId);
      }
      const stages = current.stages.map((stage) => {
        if (scriptProposal && stage.stageId === "script") return { ...stage, status: "awaiting_gate" as const, startedAt: stage.startedAt || now };
        if (!scriptProposal && stage.stageId === "script" || storyboardProposal && stage.stageId === "storyboard") return { ...stage, status: "completed" as const, completedAt: now };
        if (stage.stageId === "build") return { ...stage, status: "awaiting_gate" as const };
        return stage;
      });
      const next = { ...current, artifacts: [...current.artifacts, ...proposed], stages, stageId: scriptProposal ? "script" : "storyboard", updatedAt: now };
      const run = scriptProposal && ["running", "awaiting_storyboard_review"].includes(current.status)
        ? transitionRun(next, "awaiting_script_review", now)
        : storyboardProposal && current.status === "running"
          ? transitionRun(next, "awaiting_storyboard_review", now)
          : next;
      return { run, eventType: "plan.proposed", message: proposed[0].artifactId };
    }
    case "script.review":
    case "artifact.review": {
      const artifactId = text(command.payload, "artifactId");
      const decision = reviewDecision(command.payload);
      const target = current.artifacts.find((item) => item.artifactId === artifactId);
      if (!target) throw new Error(`Production entity not found: ${artifactId}`);
      if (target.status !== "candidate") throw new Error("Only candidate artifacts can be reviewed");
      if (decision === "approved" && target.kind === "storyboard") assertStoryboardSourceApproved(current, artifactId);
      const artifacts = current.artifacts.map((item) => item.artifactId === artifactId
        ? {
            ...item,
            status: decision === "approved" ? "adopted" as const : decision === "rejected" ? "rejected" as const : "candidate" as const,
            reviewStatus: decision === "approved" ? "approved" as const : "changes_requested" as const,
            ...(decision === "approved" ? { adoptedAt: now } : {}),
          }
        : item);
      let next: ProductionRun = { ...current, artifacts, updatedAt: now };
      if (decision === "approved" && target.kind === "script") {
        next = markDerivedArtifactsStale(next, artifactId);
        const stages = next.stages.map((stage) => stage.stageId === "script"
          ? { ...stage, status: "completed" as const, completedAt: now }
          : stage);
        next = { ...next, stages, stageId: "storyboard" };
        if (current.status === "awaiting_script_review") next = transitionRun(next, "running", now);
      }
      return { run: next, eventType: decision === "approved" ? "artifact.adopted" : "artifact.reviewed", message: artifactId };
    }
    case "plan.attach": {
      const artifactId = text(command.payload, "artifactId");
      const jobs = Array.isArray(command.payload.jobs)
        ? command.payload.jobs.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as ProductionJob : (() => { throw new Error("Invalid production job"); })())
        : [];
      const gate = record(command.payload, "gate") as unknown as ProductionGate;
      const nextArtifact = current.artifacts.find((item) => item.artifactId === artifactId);
      if (!nextArtifact) throw new Error(`Production entity not found: ${artifactId}`);
      if (nextArtifact.kind !== 'storyboard' || nextArtifact.status !== 'adopted' || (nextArtifact.reviewStatus !== undefined && nextArtifact.reviewStatus !== 'approved')) throw new Error("Approved storyboard artifact required before attach");
      if (current.gates.some((item) => item.gateId === gate.gateId)) throw new Error(`Duplicate gate: ${gate.gateId}`);
      if (jobs.some((job) => current.jobs.some((item) => item.jobId === job.jobId))) throw new Error("Duplicate production job");
      const stages = current.stages.map((stage) => {
        if (stage.stageId === "script" || stage.stageId === "storyboard") return { ...stage, status: "completed" as const, completedAt: now };
        if (stage.stageId === "build") return { ...stage, status: "awaiting_gate" as const };
        return stage;
      });
      const artifacts = current.artifacts.map((item) => item.artifactId === artifactId ? { ...item, status: "adopted" as const, adoptedAt: now } : item);
      const attached = { ...current, artifacts, jobs: [...current.jobs, ...jobs], gates: [...current.gates, gate], stages, stageId: "build", updatedAt: now };
      const run = current.status === "running" || current.status === "awaiting_storyboard_review"
        ? transitionRun(attached, "awaiting_contract", now)
        : attached;
      return { run, eventType: "plan.attached", message: nextArtifact.artifactId };
    }
    case "skill.evidence": {
      const skillName = text(command.payload, "skillName");
      const artifactId = typeof command.payload.artifactId === "string" ? command.payload.artifactId.trim() : "";
      const evidence = Array.isArray(command.payload.skillEvidence)
        ? command.payload.skillEvidence.filter((item): item is { name: string; version: string; stageId: string } => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            const value = item as Record<string, unknown>;
            return typeof value.name === "string" && typeof value.version === "string" && typeof value.stageId === "string";
          })
        : [];
      const artifacts = artifactId && evidence.length > 0
        ? current.artifacts.map((item) => item.artifactId === artifactId ? { ...item, skillEvidence: evidence } : item)
        : current.artifacts;
      return { run: { ...current, artifacts, updatedAt: now }, eventType: "skill.loaded", message: skillName };
    }
    case "qa.verdict": {
      // W1.5 审片判决：生成后一镜一条「过检 / 红标」的耐久事实事件（同 skill.evidence 的写法——
      // 只留痕、不改 run 结构）。message = 一句话人话判决（per-shot），经投影 sanitizer 后
      // nomi_subscribe_run 读得到；不是新门、不弹确认、不改任何状态机语义。
      const summary = text(command.payload, "summary");
      return { run: { ...current, updatedAt: now }, eventType: "qa.verdict", message: summary };
    }
    case "artifact.add": {
      const nextArtifact = artifact(command.payload);
      if (current.artifacts.some((item) => item.artifactId === nextArtifact.artifactId)) {
        throw new Error(`Duplicate artifact: ${nextArtifact.artifactId}`);
      }
      return { run: { ...current, artifacts: [...current.artifacts, nextArtifact], updatedAt: now }, eventType: "artifact.ready", message: nextArtifact.artifactId };
    }
    case "artifact.adopt": {
      const artifactId = text(command.payload, "artifactId");
      if (!canAdoptArtifact(current, artifactId)) throw new Error("Artifact requires approved review");
      const artifacts = replaceById(current.artifacts, artifactId, (artifact) => artifact.artifactId, (artifact): ProductionArtifact => ({
        ...artifact,
        status: "adopted",
        reviewStatus: "approved",
        adoptedAt: now,
      }));
      const next = current.artifacts.find((artifact) => artifact.artifactId === artifactId)?.kind === "script"
        ? markDerivedArtifactsStale({ ...current, artifacts, updatedAt: now }, artifactId)
        : { ...current, artifacts, updatedAt: now };
      return { run: next, eventType: "artifact.adopted", message: artifactId };
    }
    case "budget.set": {
      const budget = validateBudget(record(command.payload, "budget"), current.budget);
      return { run: { ...current, budget, updatedAt: now }, eventType: "budget.updated", message: budget.currency };
    }
    case "policy.set": {
      const policy = record(command.payload, "policy") as unknown as ProductionRun["policy"];
      return { run: { ...current, policy, updatedAt: now }, eventType: "policy.updated", message: policy.mode };
    }
    default:
      throw new Error(`Unknown production command: ${command.type}`);
  }
}
