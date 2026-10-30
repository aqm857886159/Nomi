import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createProductionRunRepository } from "./productionRunRepository";
import { createProductionRunLock, ProductionRunLockBusyError } from "./productionRunLock";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunRuntimeEnvelope } from "./productionRunRuntimeEnvelope";
import { createRunOwnedGenerationSubmission } from "./generationSubmission";
import { SubmissionNotDispatchedError } from "./submissionOutbox";
import { observeSubmissionHandoffs } from "../outboundDispatchEvidence";
import { submissionActions, type SubmissionActionProjection } from "../shared/productionSubmissionActions";
import type { ProductionJob, RunCommand } from "./productionRunTypes";

type Request = { vendor: string; model: string; kind: string; prompt: string; params: Record<string, unknown>; spendDecidedBy?: string };
type Result = { id?: string; status?: string; assets?: unknown[]; raw?: unknown; error?: string };
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** App-scoped callers use the same Run journal, jobs, submission outbox and receipt as project generation.
 * The short Run lease owns only identity allocation. Network waits never hold it; an existing job is
 * observation-only even if the owner died before dispatch. No timeout or request change reallocates it.
 */
export function createSubmissionIntent(input: { root: string; scope: readonly string[]; networkTransport?: "app-fetch" }) {
  const projectId = "app-executions";
  const runId = `intent-${digest(input.scope)}`;
  const repository = createProductionRunRepository({ projectDirResolver: (id) => id === projectId ? input.root : null });
  const paths = productionRunPaths(input.root, runId);
  const envelopeFor = (jobId: string) => createProductionRunRuntimeEnvelope({ filePath: path.join(paths.jobsDir, jobId, "runtime.json") });
  const readRun = () => repository.read(projectId, runId);
  const command = (type: RunCommand["type"], payload: RunCommand["payload"], commandId: string) => {
    const run = readRun();
    if (!run) throw new Error("Submission intent not found");
    return repository.execute(projectId, runId, { type, payload, commandId, expectedRevision: run.revision, issuedAt: new Date().toISOString() }).run;
  };
  function receipt(job: ProductionJob) {
    const envelope = envelopeFor(job.jobId).read();
    const result = (envelope?.lastPoll?.raw ?? (envelope?.rawReceipt as { result?: Result } | undefined)?.result) as Result | undefined;
    const providerTaskId = job.providerTaskId ?? envelope?.providerTaskId;
    const actions: SubmissionActionProjection = submissionActions({ ...job, providerTaskId, materialized: envelope?.state === "materialized" });
    return {
      intentId: runId, attemptId: job.jobId,
      ...actions,
      ...(providerTaskId ? { taskId: providerTaskId } : {}),
      request: envelope?.request as Request | undefined,
      result, errorCode: job.errorCode, errorMessage: job.errorMessage,
    };
  }
  function read(attemptId?: string) {
    const jobs = readRun()?.jobs;
    const job = attemptId ? jobs?.find((row) => row.jobId === attemptId) : jobs?.at(-1);
    return job ? receipt(job) : null;
  }
  function claim(request: Request, newAttemptOf?: string) {
    fs.mkdirSync(paths.dir, { recursive: true });
    const lock = createProductionRunLock({ filePath: paths.lock, epochPath: paths.lockEpoch });
    const lease = lock.acquire();
    try {
      let run = readRun();
      const previous = run?.jobs.at(-1);
      const previousReceipt = previous ? receipt(previous) : null;
      const explicitNew = !!previous && newAttemptOf === previous.jobId;
      const retry = !newAttemptOf && previousReceipt?.allowedActions.includes("retry");
      if (previous && !explicitNew && !retry) return { owned: false as const, receipt: previousReceipt! };
      if (newAttemptOf && !explicitNew) throw new Error("New attempt must reference the current attemptId");
      if (explicitNew) request = { ...request, spendDecidedBy: "user" };
      if (retry) request = { ...request, spendDecidedBy: previousReceipt?.request?.spendDecidedBy ?? "user" };
      if (!run) {
        run = repository.createGenerationDraft({
          operationId: runId, projectId, origin: { host: "nomi" }, cardHidden: true,
          candidate: { candidateId: runId, revision: 1, moduleId: "generation", providerId: request.vendor, modelId: request.model,
            mode: request.kind, prompt: request.prompt, parameters: request.params, references: [] },
          policy: { trustedHosts: ["nomi"], allowedProviders: [request.vendor], allowedModels: [request.model], maxSpend: null, maxAttemptsPerJob: 1 },
        });
      }
      const jobId = `attempt-${run.jobs.length + 1}`;
      const now = new Date().toISOString();
      const job: ProductionJob = { jobId, stageId: "generate", status: "authorized", attempt: 1,
        provider: request.vendor, model: request.model, idempotencyKey: `${runId}:${jobId}:1`,
        retryCount: retry ? (previous?.retryCount ?? 0) + 1 : 0, createdAt: now, updatedAt: now };
      // The claim is durable BEFORE any asynchronous approval or provider call. Existing authorized
      // jobs are never dispatched by another caller, including after an owner crash.
      run = command("job.add", { job }, `claim:${jobId}`);
      const fingerprint = digest(request);
      envelopeFor(jobId).seal({ runId, jobId, runtimeTaskId: jobId, contractHash: fingerprint,
        providerIdempotencyKey: job.idempotencyKey, requestFingerprint: fingerprint, request });
      command("approval.record", { approval: { approvalId: jobId, runId, scope: "job_set", planHash: fingerprint,
        jobIds: [jobId], allowedProviders: [request.vendor], allowedModels: [request.model], currency: "CNY",
        maxSpend: 0, maxAttemptsPerJob: 1, decidedAt: now, expiresAt: now } }, `approval:${jobId}`);
      return { owned: true as const, job, envelope: envelopeFor(jobId).read()!, explicitNew,
        receipt: receipt(job), fingerprint };
    } finally { lock.release(lease); }
  }
  function submit(claimed: Extract<ReturnType<typeof claim>, { owned: true }>, dispatch: () => Promise<Result>) {
    const submission = createRunOwnedGenerationSubmission({
      repository, envelopeFor: ({ jobId }) => envelopeFor(jobId), safeRetryLimit: 0,
      dispatch: async () => {
        const observed = await observeSubmissionHandoffs(input.networkTransport, dispatch);
        if (!observed.ok) {
          if (observed.notDispatched && !(observed.error instanceof SubmissionNotDispatchedError)) {
            throw Object.assign(new SubmissionNotDispatchedError(String(observed.error), observed.notDispatched), { cause: observed.error });
          }
          throw observed.error;
        }
        const result = observed.value;
        if (!result.id) throw new Error("Provider result has no durable task identity");
        return { providerTaskId: result.id, result };
      },
    });
    return submission.submit({
      request: { projectId, runId, jobId: claimed.job.jobId, approvalId: claimed.job.jobId,
        planHash: claimed.fingerprint, costCeiling: null, currency: "CNY" },
      envelope: claimed.envelope,
    });
  }
  function recordResult(attemptId: string, result: Result) {
    const lock = createProductionRunLock({ filePath: paths.lock, epochPath: paths.lockEpoch });
    let lease;
    try { lease = lock.acquire(); }
    catch (error) { if (error instanceof ProductionRunLockBusyError) return; throw error; }
    try {
      const envelope = envelopeFor(attemptId);
      if (envelope.read()?.state === "materialized") return;
      envelope.markPolled({ status: result.status || "unknown", raw: result });
      if (result.status === "succeeded" && result.assets?.length) envelope.markMaterialized();
    } finally { lock.release(lease); }
  }

  return { read, claim, submit, recordResult };
}
export type SubmissionIntentReceipt = NonNullable<ReturnType<ReturnType<typeof createSubmissionIntent>["read"]>>;
