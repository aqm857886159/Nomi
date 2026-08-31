import { dedupeSubmission } from "../submissionLedger";
import { authorizeSubmission } from "./approvalPolicy";
import type { ProductionRunRepository } from "./productionRunRepository";
import type { ProductionJob, ProductionRun } from "./productionRunTypes";

export class SubmissionNotDispatchedError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, options: { code?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = "SubmissionNotDispatchedError";
    this.code = options.code || "provider_not_dispatched";
    this.retryable = options.retryable ?? true;
  }
}

export class SubmissionReceiptUnknownError extends Error {
  constructor(message = "Provider submission receipt is unknown; reconciliation is required") {
    super(message);
    this.name = "SubmissionReceiptUnknownError";
  }
}

export class SubmissionReconciliationRequiredError extends Error {
  constructor(message = "Submission reconciliation is required before another provider call") {
    super(message);
    this.name = "SubmissionReconciliationRequiredError";
  }
}

export class SubmissionAuthorizationError extends Error {
  constructor(reason: string) {
    super(`Production submission is not authorized: ${reason}`);
    this.name = "SubmissionAuthorizationError";
  }
}

export type SubmissionOutboxRequest = {
  projectId: string;
  runId: string;
  jobId: string;
  approvalId: string;
  planHash: string;
  costCeiling: number | null;
  currency: string;
};

export type ProviderDispatchInput = {
  run: ProductionRun;
  job: ProductionJob;
  idempotencyKey: string;
  costCeiling: number;
};

export type ProviderDispatchResult = {
  providerTaskId: string;
  result?: unknown;
};

export type SubmissionOutboxDependencies = {
  repository: ProductionRunRepository;
  dispatch: (input: ProviderDispatchInput) => Promise<ProviderDispatchResult>;
  now?: () => string;
  beforeDispatch?: (input: ProviderDispatchInput) => void | Promise<void>;
  afterDispatch?: (result: ProviderDispatchResult, input: ProviderDispatchInput) => void | Promise<void>;
};

export type SubmissionOutboxResult = ProviderDispatchResult & {
  run: ProductionRun;
};

function requiredRun(repository: ProductionRunRepository, projectId: string, runId: string): ProductionRun {
  const run = repository.read(projectId, runId);
  if (!run) throw new Error(`Production run not found: ${runId}`);
  return run;
}

function requiredJob(run: ProductionRun, jobId: string): ProductionJob {
  const job = run.jobs.find((value) => value.jobId === jobId);
  if (!job) throw new Error(`Production job not found: ${jobId}`);
  return job;
}

export function createSubmissionOutbox(deps: SubmissionOutboxDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());
  const inflight = new Map();

  function jobCommand(
    request: SubmissionOutboxRequest,
    suffix: string,
    status: ProductionJob["status"],
    patch: Partial<ProductionJob> = {},
  ): ProductionRun {
    const run = requiredRun(deps.repository, request.projectId, request.runId);
    return deps.repository.execute(request.projectId, request.runId, {
      commandId: `${request.runId}:${request.jobId}:${requiredJob(run, request.jobId).attempt}:${suffix}`,
      expectedRevision: run.revision,
      type: "job.status",
      payload: { jobId: request.jobId, status, patch },
      issuedAt: now(),
    }).run;
  }

  function budgetCommand(request: SubmissionOutboxRequest, suffix: string, entry: Record<string, unknown>): ProductionRun {
    const run = requiredRun(deps.repository, request.projectId, request.runId);
    return deps.repository.execute(request.projectId, request.runId, {
      commandId: `${request.runId}:${request.jobId}:${requiredJob(run, request.jobId).attempt}:budget:${suffix}`,
      expectedRevision: run.revision,
      type: "budget.entry",
      payload: { entry },
      issuedAt: now(),
    }).run;
  }

  function markSubmissionUnknown(request: SubmissionOutboxRequest): ProductionRun {
    let run = requiredRun(deps.repository, request.projectId, request.runId);
    const job = requiredJob(run, request.jobId);
    if (job.status === "submitting") run = jobCommand(request, "submission-unknown", "submission_unknown");
    const reservationId = `${request.runId}:${request.jobId}:${job.attempt}`;
    const ledger = deps.repository.readBudgetLedger(request.projectId, request.runId);
    if (ledger.reservations[reservationId]?.status === "reserved") {
      run = budgetCommand(request, "mark-unsettled", {
        billingEntryId: `${reservationId}:mark-unsettled`,
        kind: "mark_unsettled",
        reservationId,
        occurredAt: now(),
      });
    }
    return run;
  }

  function markNotDispatched(request: SubmissionOutboxRequest, error: SubmissionNotDispatchedError): ProductionRun {
    let run = requiredRun(deps.repository, request.projectId, request.runId);
    const job = requiredJob(run, request.jobId);
    if (job.status === "submitting") {
      run = jobCommand(request, "not-dispatched", "not_dispatched", {
        errorCode: error.code,
        errorMessage: error.message,
      });
    }
    const reservationId = `${request.runId}:${request.jobId}:${job.attempt}`;
    const ledger = deps.repository.readBudgetLedger(request.projectId, request.runId);
    if (ledger.reservations[reservationId]?.status === "reserved") {
      run = budgetCommand(request, "release", {
        billingEntryId: `${reservationId}:release`,
        kind: "release",
        reservationId,
        providerSafe: true,
        occurredAt: now(),
      });
    }
    return run;
  }

  async function submitOnce(request: SubmissionOutboxRequest): Promise<SubmissionOutboxResult> {
    let run = requiredRun(deps.repository, request.projectId, request.runId);
    let job = requiredJob(run, request.jobId);
    if (job.status === "provider_accepted" && job.providerTaskId) {
      return { providerTaskId: job.providerTaskId, run };
    }
    if (["submission_unknown", "reconciling", "needs_attention", "cancel_requested"].includes(job.status)) {
      throw new SubmissionReconciliationRequiredError();
    }
    if (job.status === "submitting") {
      markSubmissionUnknown(request);
      throw new SubmissionReconciliationRequiredError();
    }
    if (job.status !== "authorized" && job.status !== "submit_intent_persisted") {
      throw new Error(`Production job cannot be submitted from status: ${job.status}`);
    }

    const approval = deps.repository.readApprovals(request.projectId, request.runId)
      .find((value) => value.approvalId === request.approvalId);
    if (!approval) throw new SubmissionAuthorizationError("approval-not-found");
    const authorization = authorizeSubmission({
      approval,
      job,
      policy: run.policy,
      now: now(),
      planHash: request.planHash,
      originHost: run.origin.host,
      estimatedCost: request.costCeiling,
      currency: request.currency,
      runId: request.runId,
    });
    if (!authorization.ok) throw new SubmissionAuthorizationError(authorization.reason);
    if (request.costCeiling === null) throw new SubmissionAuthorizationError("unknown-cost");

    const reservationId = `${request.runId}:${request.jobId}:${job.attempt}`;
    const ledger = deps.repository.readBudgetLedger(request.projectId, request.runId);
    if (!ledger.reservations[reservationId]) {
      run = budgetCommand(request, "reserve", {
        billingEntryId: `${reservationId}:reserve`,
        kind: "reserve",
        reservationId,
        jobId: request.jobId,
        amount: request.costCeiling,
        occurredAt: now(),
      });
      job = requiredJob(run, request.jobId);
    }
    if (job.status === "authorized") {
      run = jobCommand(request, "submit-intent", "submit_intent_persisted");
      job = requiredJob(run, request.jobId);
    }

    const dispatchInput: ProviderDispatchInput = {
      run,
      job,
      idempotencyKey: job.idempotencyKey,
      costCeiling: request.costCeiling,
    };
    await deps.beforeDispatch?.(dispatchInput);
    run = jobCommand(request, "submitting", "submitting");
    dispatchInput.run = run;
    dispatchInput.job = requiredJob(run, request.jobId);

    let response: ProviderDispatchResult;
    try {
      try {
        response = await deps.dispatch(dispatchInput);
      } catch (error) {
        if (!(error instanceof SubmissionNotDispatchedError) || !error.retryable) throw error;
        response = await deps.dispatch(dispatchInput);
      }
      if (!response.providerTaskId.trim()) throw new Error("Provider returned an empty task id");
      await deps.afterDispatch?.(response, dispatchInput);
      run = jobCommand(request, "provider-accepted", "provider_accepted", {
        providerTaskId: response.providerTaskId,
      });
      return { ...response, run };
    } catch (error) {
      const recovered = requiredRun(deps.repository, request.projectId, request.runId);
      const recoveredJob = requiredJob(recovered, request.jobId);
      if (recoveredJob.status === "provider_accepted" && recoveredJob.providerTaskId) {
        return { providerTaskId: recoveredJob.providerTaskId, run: recovered };
      }
      if (error instanceof SubmissionNotDispatchedError) {
        markNotDispatched(request, error);
        throw error;
      }
      markSubmissionUnknown(request);
      throw new SubmissionReceiptUnknownError(error instanceof Error ? error.message : undefined);
    }
  }

  function submit(request: SubmissionOutboxRequest): Promise<SubmissionOutboxResult> {
    const key = `${request.projectId}:${request.runId}:${request.jobId}`;
    return dedupeSubmission(inflight, key, () => submitOnce(request), { ttlMs: 0 });
  }

  return { submit };
}

export type SubmissionOutbox = ReturnType<typeof createSubmissionOutbox>;
