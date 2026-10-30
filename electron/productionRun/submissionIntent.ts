import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fsyncDirectoryIfDurable } from "../durability";
import { renameSyncWithRetry, writeJsonFileAtomic } from "../jsonFile";
import { createProductionRunRepository } from "./productionRunRepository";
import { createProductionRunLock, inspectProductionRunLockFile } from "./productionRunLock";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunRuntimeEnvelope } from "./productionRunRuntimeEnvelope";
import { createRunOwnedGenerationSubmission } from "./generationSubmission";
import { SubmissionNotDispatchedError } from "./submissionOutbox";
import { observeSubmissionHandoffs } from "../outboundDispatchEvidence";
import { submissionActions, type SubmissionActionProjection } from "../shared/productionSubmissionActions";
import { PRODUCTION_RUN_SCHEMA_VERSION, type ProductionJob, type ProductionRun, type RunCommand } from "./productionRunTypes";

type Request = { vendor: string; model: string; kind: string; prompt: string; params: Record<string, unknown>; spendDecidedBy?: string;
  /** The order before this one has an uncertain outcome. Frozen here so the confirmation wording and every retry read one fact. */
  priorOutcomeUnknown?: boolean };
type Result = { id?: string; status?: string; assets?: unknown[]; raw?: unknown; error?: string };

/** Why a record cannot carry another claim in place. Any value means: a plain call stays closed, an explicit new order moves the record aside. */
export type SubmissionRecordDamage =
  | "journal_unreadable" | "journal_missing" | "journal_shape" | "journal_behind" | "snapshot_unreadable"
  | "receipt_unreadable" | "receipt_missing" | "ledger_unreadable" | "record_missing"
  /** Not damage in this record: an earlier one was moved aside and no new order exists yet. */
  | "awaiting_new_order";

export type SubmissionIntentReceipt = SubmissionActionProjection & {
  intentId: string; attemptId: string; taskId?: string; request?: Request; result?: Result;
  errorCode?: string; errorMessage?: string; recordDamage?: SubmissionRecordDamage;
};

const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const UNREADABLE_ATTEMPT_PREFIX = "unreadable-r";

/** The one decision on who may allocate an order. Callers that only want to observe and the claim itself both ask here.
 * A synthetic id stands in for attempts Nomi can no longer read, so any id the caller still holds reaches the human
 * confirmation: at worst one more card, never one more order. */
function admission(previousReceipt: SubmissionIntentReceipt | null, newAttemptOf?: string) {
  const previous = previousReceipt?.attemptId;
  const explicitNew = !!newAttemptOf && (!previous || previous === newAttemptOf || previous.startsWith(UNREADABLE_ATTEMPT_PREFIX));
  const retry = !newAttemptOf && !!previousReceipt?.allowedActions.includes("retry");
  if (previous && !explicitNew && !retry) return { owned: false as const, receipt: previousReceipt! };
  return { owned: true as const, explicitNew, retry };
}

function namesIn(dir: string): string[] {
  try { return fs.readdirSync(dir); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

/** Same envelope the repository writes. Its own check is private, and a read here must not repair or rewrite anything. */
function parseSnapshot(bytes: string): { snapshotCursor: number } | null {
  try {
    const raw = JSON.parse(bytes);
    const value = { schemaVersion: raw.schemaVersion, snapshotCursor: raw.snapshotCursor, run: raw.run };
    return raw.schemaVersion === PRODUCTION_RUN_SCHEMA_VERSION && raw.checksum === digest(value) ? raw : null;
  } catch { return null; }
}

/** App-scoped callers use the same Run journal, jobs, submission outbox and receipt as project generation.
 * The short claim lease owns only identity allocation. Network waits never hold it; an existing job is
 * observation-only even if the owner died before dispatch. No timeout or request change reallocates it.
 *
 * A record that cannot be read is neither proof that no order exists nor permission to send, and the
 * identity is a fixed path, so one broken record must not lock it forever. The way out is one human-confirmed
 * new order that moves the whole record aside untouched. What must outlive that move (the lease, the moved
 * records, the fact that an order was ever issued) lives beside the Run directory, never inside it.
 */
export function createSubmissionIntent(input: { root: string; scope: readonly string[]; networkTransport?: "app-fetch" }) {
  const projectId = "app-executions";
  const runId = `intent-${digest(input.scope)}`;
  const repository = createProductionRunRepository({ projectDirResolver: (id) => id === projectId ? input.root : null });
  const paths = productionRunPaths(input.root, runId);
  const claimDir = path.join(input.root, ".nomi", "intent-claims", runId);
  const claims = { lock: path.join(claimDir, "claim.lock"), epoch: path.join(claimDir, "claim.lock.epoch"),
    issued: path.join(claimDir, "issued.json"), quarantine: path.join(claimDir, "quarantine") };
  const envelopeFor = (jobId: string) => createProductionRunRuntimeEnvelope({ filePath: path.join(paths.jobsDir, jobId, "runtime.json") });
  const readRun = () => repository.read(projectId, runId);
  const jobDirectories = () => namesIn(paths.jobsDir).filter((name) => name.startsWith("attempt-"));
  const setAsideCount = () => Math.max(0, ...namesIn(claims.quarantine).map((name) => Number(/^r(\d+)$/.exec(name)?.[1] ?? 0)));
  const command = (type: RunCommand["type"], payload: RunCommand["payload"], commandId: string) => {
    const run = readRun();
    if (!run) throw new Error("Submission intent not found");
    return repository.execute(projectId, runId, { type, payload, commandId, expectedRevision: run.revision, issuedAt: new Date().toISOString() }).run;
  };

  /** One record judged whole. Writers go job row, then job directory and approval; journal, then snapshot.
   * A lock-free reader goes the other way round, so what it sees last can only be newer than what it saw first. */
  function readRecord(): { run: ProductionRun | null; damage?: SubmissionRecordDamage } {
    let approvalIds: string[] | null;
    try { approvalIds = repository.readApprovals(projectId, runId).map((row) => row.approvalId); } catch { approvalIds = null; }
    const directories = jobDirectories();
    let snapshotBytes: string | null;
    try { snapshotBytes = fs.readFileSync(paths.snapshot, "utf8"); } catch { snapshotBytes = null; }
    let run: ProductionRun | null;
    try { run = readRun(); } catch { return { run: null, damage: "journal_unreadable" }; }
    if (!run) return { run: null };
    if (!Array.isArray(run.jobs)) return { run: null, damage: "journal_shape" };
    const events = repository.readEvents(projectId, runId);
    if (!events.length) return { run, damage: "journal_missing" };
    if (run.schemaVersion !== PRODUCTION_RUN_SCHEMA_VERSION || events.some((event) => event.schemaVersion !== PRODUCTION_RUN_SCHEMA_VERSION)) return { run, damage: "journal_shape" };
    const snapshot = snapshotBytes === null ? null : parseSnapshot(snapshotBytes);
    if (snapshotBytes !== null && !snapshot) return { run, damage: "snapshot_unreadable" };
    const known = new Set(run.jobs.map((job) => job.jobId));
    if ((snapshot && snapshot.snapshotCursor > events.at(-1)!.cursor) || directories.some((name) => !known.has(name)) || approvalIds?.some((id) => !known.has(id))) {
      return { run, damage: "journal_behind" };
    }
    if (!approvalIds) return { run, damage: "ledger_unreadable" };
    try { repository.readBudgetLedger(projectId, runId); } catch { return { run, damage: "ledger_unreadable" }; }
    return { run };
  }

  function receipt(job: ProductionJob, recordDamage?: SubmissionRecordDamage): SubmissionIntentReceipt {
    let envelope: ReturnType<ReturnType<typeof envelopeFor>["read"]> = null;
    let damage = recordDamage;
    try { envelope = envelopeFor(job.jobId).read(); } catch { damage ??= "receipt_unreadable"; }
    // The only moment a job has no receipt yet is the crash window right after it was allocated.
    if (!envelope && job.status !== "authorized") damage ??= "receipt_missing";
    const result = (envelope?.lastPoll?.raw ?? (envelope?.rawReceipt as { result?: Result } | undefined)?.result) as Result | undefined;
    const providerTaskId = job.providerTaskId ?? envelope?.providerTaskId;
    const actions: SubmissionActionProjection = damage ? submissionActions({ status: "submission_unknown" })
      : submissionActions({ ...job, providerTaskId, materialized: envelope?.state === "materialized" });
    return {
      intentId: runId, attemptId: job.jobId,
      ...actions,
      ...(providerTaskId ? { taskId: providerTaskId } : {}),
      request: envelope?.request as Request | undefined,
      result, errorCode: job.errorCode, errorMessage: job.errorMessage,
      ...(damage ? { recordDamage: damage } : {}),
    };
  }
  function unreadableReceipt(recordDamage: SubmissionRecordDamage): SubmissionIntentReceipt {
    let moved = 0;
    try { moved = setAsideCount(); } catch { /* the id only has to be stable enough to refer back to */ }
    return { intentId: runId, attemptId: `${UNREADABLE_ATTEMPT_PREFIX}${moved}`, ...submissionActions({ status: "submission_unknown" }), recordDamage };
  }
  /** Null = nothing here yet. Never throws: a record that cannot be read still answers. */
  function inspect(attemptId: string | undefined, underLease: boolean): SubmissionIntentReceipt | null {
    try {
      const { run, damage } = readRecord();
      const job = (attemptId ? run?.jobs.find((row) => row.jobId === attemptId) : undefined) ?? run?.jobs.at(-1);
      if (job) return receipt(job, damage);
      // Someone is allocating right now: only the claim, which waits for them, may judge this.
      if (!underLease && inspectProductionRunLockFile(claims.lock, "lease") === "held") return null;
      if (damage) return unreadableReceipt(damage);
      if (setAsideCount() > 0) return unreadableReceipt("awaiting_new_order");
      const residue = [paths.commands, paths.approvals, paths.budgetLedger, paths.intents].some((file) => fs.existsSync(file) && fs.statSync(file).size > 0)
        || jobDirectories().length > 0;
      return residue || fs.existsSync(claims.issued) ? unreadableReceipt("record_missing") : null;
    } catch { return unreadableReceipt("journal_unreadable"); }
  }
  function read(attemptId?: string) { return inspect(attemptId, false); }
  /** After a dispatch there was a record, so an absent one is news, not an empty state. */
  function current(attemptId?: string) { return read(attemptId) ?? unreadableReceipt("record_missing"); }
  /** The order this call can only observe, or null when the claim has to decide. Lets callers answer before validating anything. */
  function observation(newAttemptOf?: string) {
    const admitted = admission(read(), newAttemptOf);
    return admitted.owned ? null : admitted.receipt;
  }

  /** A dead lock file guards no writer and says nothing about any order, so it may be replaced. It stays beside the lock for diagnosis. */
  function replaceDeadLockFiles(files: ReadonlyArray<{ file: string; kind: "lease" | "epoch" }>) {
    const dead = files.filter(({ file, kind }) => inspectProductionRunLockFile(file, kind) === "dead");
    for (const { file } of dead) renameSyncWithRetry(file, `${file}.corrupt.${crypto.randomUUID()}`);
    return dead.length > 0;
  }
  function acquireClaim() {
    const lock = createProductionRunLock({ filePath: claims.lock, epochPath: claims.epoch });
    try { return { lock, lease: lock.acquire() }; }
    catch (error) {
      if (!replaceDeadLockFiles([{ file: claims.lock, kind: "lease" }, { file: claims.epoch, kind: "epoch" }])) throw error;
      return { lock, lease: lock.acquire() };
    }
  }

  /** An explicit new order may move the record, so it judges and moves with the repository's own lock held: no writer
   * is mid-append meanwhile, and a half-written line cannot pass for damage. Null when no writer could be there. */
  function quietWriters() {
    if (!fs.statSync(paths.dir, { throwIfNoEntry: false })?.isDirectory()) return null;
    const writers = createProductionRunLock({ filePath: paths.repositoryLock, epochPath: paths.repositoryLockEpoch, durability: "ephemeral" });
    const lease = writers.acquire();
    let held = true;
    return { release() { if (held) { held = false; writers.release(lease); } }, moved() { held = false; } };
  }

  /** Atomic: the record is either all here or all in `quarantine`. Nothing in it is rewritten or deleted. */
  function setAside(quiet: ReturnType<typeof quietWriters>) {
    const target = path.join(claims.quarantine, `r${setAsideCount() + 1}`);
    fs.mkdirSync(claims.quarantine, { recursive: true });
    if (fs.existsSync(paths.dir)) {
      renameSyncWithRetry(paths.dir, target);
      quiet?.moved();
      // Our own lease came along; everything else in the moved record stays byte for byte.
      if (quiet) fs.rmSync(path.join(target, path.basename(paths.repositoryLock)), { force: true });
      fsyncDirectoryIfDurable(path.dirname(paths.dir));
    } else {
      fs.mkdirSync(target);
    }
    fsyncDirectoryIfDurable(claims.quarantine);
  }

  function claim(request: Request, newAttemptOf?: string) {
    const { lock, lease } = acquireClaim();
    let quiet: ReturnType<typeof quietWriters> = null;
    try {
      replaceDeadLockFiles([{ file: paths.repositoryLock, kind: "lease" }]);
      if (newAttemptOf) quiet = quietWriters();
      const previousReceipt = inspect(undefined, true);
      const admitted = admission(previousReceipt, newAttemptOf);
      if (!admitted.owned) return admitted;
      const { explicitNew, retry } = admitted;
      const damage = previousReceipt?.recordDamage;
      if (explicitNew && (!previousReceipt || (damage && damage !== "awaiting_new_order"))) setAside(quiet);
      // The repository takes this same lock for every write below.
      quiet?.release();
      const priorRequest = previousReceipt?.request;
      const priorOutcomeUnknown = retry ? !!priorRequest?.priorOutcomeUnknown
        : explicitNew && (!previousReceipt || !!damage || previousReceipt.accepted === "unknown" || (previousReceipt.accepted === "not_sent" && !!priorRequest?.priorOutcomeUnknown));
      if (explicitNew) request = { ...request, spendDecidedBy: "user" };
      if (retry) request = { ...request, spendDecidedBy: priorRequest?.spendDecidedBy ?? "user" };
      if (priorOutcomeUnknown) request = { ...request, priorOutcomeUnknown: true };
      let run = readRun();
      if (!run) {
        run = repository.createGenerationDraft({
          operationId: runId, projectId, origin: { host: "nomi" }, cardHidden: true,
          candidate: { candidateId: runId, revision: 1, moduleId: "generation", providerId: request.vendor, modelId: request.model,
            mode: request.kind, prompt: request.prompt, parameters: request.params, references: [] },
          policy: { trustedHosts: ["nomi"], allowedProviders: [request.vendor], allowedModels: [request.model], maxSpend: null, maxAttemptsPerJob: 1 },
        });
      }
      // Outlives the whole Run directory: an order was issued here, so an empty directory later is not a first trial.
      if (!fs.existsSync(claims.issued)) { writeJsonFileAtomic(claims.issued, { schemaVersion: 1 }); fsyncDirectoryIfDurable(claimDir); }
      const moved = setAsideCount();
      // A moved attempt's name is never reused, so an old newAttemptOf can only land on the current order.
      const jobId = `attempt-${moved ? `r${moved}-` : ""}${run.jobs.length + 1}`;
      const now = new Date().toISOString();
      const job: ProductionJob = { jobId, stageId: "generate", status: "authorized", attempt: 1,
        provider: request.vendor, model: request.model, idempotencyKey: `${runId}:${jobId}:1`,
        retryCount: retry ? (run.jobs.at(-1)?.retryCount ?? 0) + 1 : 0, createdAt: now, updatedAt: now };
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
    } finally {
      try { quiet?.release(); } finally { lock.release(lease); }
    }
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
  /** Best effort by design: losing this write only means the next observation asks the provider again. */
  function recordResult(attemptId: string, result: Result) {
    try {
      const { lock, lease } = acquireClaim();
      try {
        const envelope = envelopeFor(attemptId);
        if (envelope.read()?.state === "materialized") return;
        envelope.markPolled({ status: result.status || "unknown", raw: result });
        if (result.status === "succeeded" && result.assets?.length) envelope.markMaterialized();
      } finally { lock.release(lease); }
    } catch { /* see above */ }
  }

  return { read, current, observation, claim, submit, recordResult };
}
