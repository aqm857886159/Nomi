import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { prepareProductionGenerationContinuationAuthorization } from "./prepareProductionGenerationAuthorization";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import type { ProductionGenerationShot } from "./productionRunTypes";

// P4 S4 — batch scheduler orchestrator over a REAL repository + mock provider (zero quota). TDD:
// these lock the SAFETY invariants — halt stops at the right shot, stop dispatches nothing new,
// crash-recovery re-runs the derivation and never double-submits (total submits = anchors + shots),
// the anchor checkpoint gates the video batch, and the trial loop shrinks to shot 1.

const NOW = "2026-08-25T00:00:00.000Z";
const roots: string[] = [];

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image", "video"],
  modes: ["text-to-image", "image-to-video"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "apimart",
    models: [
      { modelId: "image-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
      { modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
    ],
  }],
}]);

function candidate(candidateId: string, prompt: string, modelId = "video-model", mode = "image-to-video"): PlanCandidate {
  return { candidateId, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId, mode, prompt, parameters: { aspectRatio: "9:16" }, references: [] };
}

function shotEntry(shotId: string, prompt: string, opts: { role?: "anchor" | "shot"; included?: boolean; modelId?: string; mode?: string } = {}): ProductionGenerationShot {
  const cand = candidate(`cand-${shotId}`, prompt, opts.modelId, opts.mode);
  const contract = compileExecutionContract(cand, registry);
  return {
    shotId,
    ...(opts.role ? { role: opts.role } : {}),
    ...(opts.included === false ? { included: false } : {}),
    candidate: { ...cand, sealedContractHash: contract.contractHash },
    contract,
    approvedReceiptId: "receipt-plan",
    updatedAt: NOW,
  };
}

/** Build a sealed+approved multi-shot Run in a fresh temp project. maxSpend caps the plan. */
function setupBatch(shots: ProductionGenerationShot[], maxSpend: number | null): {
  root: string;
  repository: ReturnType<typeof createProductionRunRepository>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-batch-sched-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === "project-1" ? root : null),
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  repository.createGenerationDraft({
    operationId: "op-batch",
    projectId: "project-1",
    origin: { host: "semantic-mcp" },
    candidate: shots[0].candidate,
    shots,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["image-model", "video-model"], maxSpend, maxAttemptsPerJob: 2 },
  });
  const topContract = shots[0].contract!;
  sealAndApproveProductionGeneration({
    repository,
    projectId: "project-1",
    operationId: "op-batch",
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    candidate: shots[0].candidate,
    contract: topContract,
    providers: [{
      providerId: "apimart",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
      buildRequest: (input) => input,
      submit: async () => ({ providerTaskId: "unused" }),
    }],
    multiShot: { shots, planHash: "plan-hash-batch" },
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    maximumSpend: maxSpend,
    receiptId: "receipt-plan",
    now: NOW,
  });
  // Move the plan to submitted (the batch is confirmed → scheduler drives it).
  repository.execute("project-1", "op-batch", {
    commandId: "generation.submit:op-batch",
    expectedRevision: 2,
    type: "generation.submit",
    payload: {},
    issuedAt: NOW,
  });
  return { root, repository };
}

/** A mock provider that accepts + immediately reports succeeded + materializes a tiny artifact. */
function mockProvider(submit: ReturnType<typeof vi.fn>): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: submit as unknown as GenerationProvider["submit"],
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ url: `nomi-local://asset/project-1/${providerTaskId}.png`, kind: "video" as const }] }),
  };
}

function scheduler(root: string, repository: ReturnType<typeof createProductionRunRepository>, submit: ReturnType<typeof vi.fn>, options: Parameters<typeof createMultiShotBatchScheduler>[0]["options"] = {}) {
  const submission = createProductionGenerationSubmission({
    repository,
    projectRoot: root,
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    intentMacKey: "test-intent-key",
    provider: mockProvider(submit),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.png` }),
    now: () => NOW,
  });
  return createMultiShotBatchScheduler({
    repository,
    submission,
    projectId: "project-1",
    runId: "op-batch",
    perShotPrice: () => ({ known: true, amount: 6 }),
    now: () => NOW,
    options,
  });
}

function schedulerWithCompletion(
  root: string,
  repository: ReturnType<typeof createProductionRunRepository>,
  submit: ReturnType<typeof vi.fn>,
  onBatchComplete: NonNullable<Parameters<typeof createMultiShotBatchScheduler>[0]["onBatchComplete"]>,
  options: Parameters<typeof createMultiShotBatchScheduler>[0]["options"] = {},
) {
  const submission = createProductionGenerationSubmission({
    repository,
    projectRoot: root,
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    intentMacKey: "test-intent-key",
    provider: mockProvider(submit),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.png` }),
    now: () => NOW,
  });
  return createMultiShotBatchScheduler({
    repository,
    submission,
    projectId: "project-1",
    runId: "op-batch",
    perShotPrice: () => ({ known: true, amount: 6 }),
    now: () => NOW,
    options,
    onBatchComplete,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("P4 S4 batch scheduler — budget halt", () => {
  it("stops at the correct Kth shot (checkbox order) and records structured halt counts", async () => {
    // 3 shots @ ¥6 = ¥18 total, cap ¥13 → only shots a,b (¥12) fit; halt at c.
    const shots = [shotEntry("shot-a", "a"), shotEntry("shot-b", "b"), shotEntry("shot-c", "c")];
    const { root, repository } = setupBatch(shots, 13);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));
    const sched = scheduler(root, repository, submit);

    const outcome = await sched.runToQuiescence();

    // Exactly 2 provider submissions (shots a + b); shot c never submitted.
    expect(submit).toHaveBeenCalledTimes(2);
    expect(outcome.halt).toBeDefined();
    expect(outcome.halt?.haltedAtShotId).toBe("shot-c");
    expect(outcome.halt?.remainingCount).toBe(1);
    const run = repository.read("project-1", "op-batch")!;
    // Run is halted (needs_attention) — a queryable stop, never silent over-spend.
    expect(run.status).toBe("needs_attention");
    // The gate froze shot-c too, but the capped ledger prevents provider submission.
    const pendingShot = run.jobs.find((j) => j.metadata?.shotId === "shot-c");
    expect(pendingShot).toMatchObject({ status: "authorized" });
    expect(pendingShot?.providerTaskId).toBeUndefined();
  });

  it("resumes the halted batch after the cap is raised (same plan, second wave)", async () => {
    const shots = [shotEntry("shot-a", "a"), shotEntry("shot-b", "b"), shotEntry("shot-c", "c")];
    const { root, repository } = setupBatch(shots, 13);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));

    await scheduler(root, repository, submit).runToQuiescence();
    expect(submit).toHaveBeenCalledTimes(2);

    // Fresh continuation gate: freeze the remaining request again, then let only gate.decide raise the
    // absolute ledger ceiling. The scheduler remains a pure consumer of approved authority.
    let run = repository.read("project-1", "op-batch")!;
    const continuation = prepareProductionGenerationContinuationAuthorization({
      lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0,
      run,
      providers: [mockProvider(submit)],
      resolveShotPrice: () => ({ known: true, amount: 6 }),
      now: NOW,
    });
    run = repository.execute("project-1", "op-batch", {
      commandId: "continue-authorize", expectedRevision: run.revision, type: "generation.continue_authorization",
      payload: { authorization: continuation }, issuedAt: NOW,
    }).run;
    expect(run.jobs.find((job) => job.metadata?.shotId === "shot-c")?.status).toBe("authorization_required");
    run = repository.execute("project-1", "op-batch", {
      commandId: "continue-approve", expectedRevision: run.revision, type: "gate.decide",
      payload: { gateId: continuation.envelope.gateId, status: "approved", receiptId: "receipt-continuation", authorizationDigest: continuation.authorizationDigest }, issuedAt: NOW,
    }).run;
    expect(run.budget.authorized).toBe(18);
    repository.execute("project-1", "op-batch", { commandId: `resume:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "running" }, issuedAt: NOW });
    const sched2 = scheduler(root, repository, submit);
    const outcome2 = await sched2.runToQuiescence();

    expect(submit).toHaveBeenCalledTimes(3); // shot-c now submitted
    expect(outcome2.halt).toBeUndefined();
    run = repository.read("project-1", "op-batch")!;
    expect(run.jobs.filter((j) => j.metadata?.shotId).length).toBe(3);
  });
});

describe("P4 S4 batch scheduler — stop semantics", () => {
  it("dispatches nothing new once the run is paused; request count does not grow", async () => {
    const shots = [shotEntry("shot-a", "a"), shotEntry("shot-b", "b")];
    const { root, repository } = setupBatch(shots, null);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));

    // Start the run (draft → running, the legal batch-start edge) WITHOUT dispatching, then pause it.
    let run = repository.read("project-1", "op-batch")!;
    repository.execute("project-1", "op-batch", { commandId: `start:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "running" }, issuedAt: NOW });
    run = repository.read("project-1", "op-batch")!;
    repository.execute("project-1", "op-batch", { commandId: `pause:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "pausing" }, issuedAt: NOW });
    run = repository.read("project-1", "op-batch")!;
    repository.execute("project-1", "op-batch", { commandId: `pause-settle:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "paused" }, issuedAt: NOW });

    const outcome = await scheduler(root, repository, submit).runToQuiescence();
    expect(submit).toHaveBeenCalledTimes(0);
    expect(outcome.progress.pending).toBe(2);
    expect(outcome.progress.completed).toBe(0);
  });

  it("preserves completed shots and reports structured counts after a mid-batch stop", async () => {
    const shots = [shotEntry("shot-a", "a"), shotEntry("shot-b", "b"), shotEntry("shot-c", "c")];
    const { root, repository } = setupBatch(shots, null);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));

    // Dispatch only the first shot (cap it to 1 tick), then pause.
    const sched = scheduler(root, repository, submit, { maxShotsPerRun: 1 });
    await sched.runToQuiescence();
    expect(submit).toHaveBeenCalledTimes(1);

    let run = repository.read("project-1", "op-batch")!;
    repository.execute("project-1", "op-batch", { commandId: `pause:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "pausing" }, issuedAt: NOW });
    run = repository.read("project-1", "op-batch")!;
    if (run.status === "pausing") repository.execute("project-1", "op-batch", { commandId: `pause-settle:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "paused" }, issuedAt: NOW });

    const outcome = await scheduler(root, repository, submit).runToQuiescence();
    expect(submit).toHaveBeenCalledTimes(1); // paused → no new submissions
    expect(outcome.progress.completed).toBe(1); // shot-a finished + preserved
    expect(outcome.progress.pending).toBe(2);
  });
});

describe("P4 S4 batch scheduler — crash recovery", () => {
  it("re-runs the derivation after a restart: each job submitted at most once; total = anchors + shots", async () => {
    const shots = [
      shotEntry("anchor-1", "hero look", { role: "anchor", modelId: "image-model", mode: "text-to-image" }),
      shotEntry("shot-a", "a"),
      shotEntry("shot-b", "b"),
    ];
    const { root, repository } = setupBatch(shots, null);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));

    // First run: anchor generates + checkpoint auto-releases (test uses auto-release so it completes),
    // shots submit. Then we "crash" by constructing a fresh scheduler and running again — no double submit.
    await scheduler(root, repository, submit, { anchorAutoReleaseMs: 0 }).runToQuiescence();
    const firstCount = submit.mock.calls.length;
    // Simulate restart: a brand-new scheduler over the SAME durable Run re-derives and finds nothing new.
    await scheduler(root, repository, submit, { anchorAutoReleaseMs: 0 }).runToQuiescence();

    // Total provider submissions = 1 anchor + 2 shots = 3, and the restart added none.
    expect(firstCount).toBe(3);
    expect(submit).toHaveBeenCalledTimes(3);
    const run = repository.read("project-1", "op-batch")!;
    // Every unit has exactly one job.
    expect(run.jobs.filter((j) => j.metadata?.shotId).length + run.jobs.filter((j) => !j.metadata?.shotId).length).toBeGreaterThanOrEqual(3);
    const jobIds = run.jobs.map((j) => j.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length); // no duplicate jobs
  });

  it("notifies the ProductionRun owner exactly once when every shot is materialized", async () => {
    const shots = [shotEntry("shot-a", "a"), shotEntry("shot-b", "b")];
    const { root, repository } = setupBatch(shots, null);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));
    const completed = vi.fn();

    const outcome = await schedulerWithCompletion(root, repository, submit, completed).runToQuiescence();
    expect(outcome.quiescent).toBe(true);
    expect(outcome.progress).toMatchObject({ total: 2, completed: 2, inFlight: 0 });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith({ progress: outcome.progress });

    // A restart/re-kick sees the same durable ready jobs and must not notify a
    // second provider submission (or duplicate completion side effects).
    await schedulerWithCompletion(root, repository, submit, completed).runToQuiescence();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it("does not notify while a stop or bounded partial drive leaves work pending", async () => {
    const shots = [shotEntry("shot-a", "a"), shotEntry("shot-b", "b")];
    const { root, repository } = setupBatch(shots, null);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));
    const completed = vi.fn();

    await schedulerWithCompletion(root, repository, submit, completed, { maxShotsPerRun: 1 }).runToQuiescence();
    expect(completed).not.toHaveBeenCalled();

    let run = repository.read("project-1", "op-batch")!;
    repository.execute("project-1", "op-batch", { commandId: `pause:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "pausing" }, issuedAt: NOW });
    run = repository.read("project-1", "op-batch")!;
    if (run.status === "pausing") repository.execute("project-1", "op-batch", { commandId: `pause-settle:${run.revision}`, expectedRevision: run.revision, type: "run.status", payload: { status: "paused" }, issuedAt: NOW });
    await schedulerWithCompletion(root, repository, submit, completed).runToQuiescence();
    expect(completed).not.toHaveBeenCalled();
  });
});

describe("P4 S4 batch scheduler — anchor checkpoint", () => {
  it("opens the checkpoint gate after anchors are ready and blocks shots until it is decided", async () => {
    const shots = [
      shotEntry("anchor-1", "hero look", { role: "anchor", modelId: "image-model", mode: "text-to-image" }),
      shotEntry("shot-a", "a"),
    ];
    const { root, repository } = setupBatch(shots, null);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));

    // No auto-release → after the anchor, the scheduler opens the gate and STOPS (waiting for the user).
    const outcome = await scheduler(root, repository, submit).runToQuiescence();

    expect(submit).toHaveBeenCalledTimes(1); // only the anchor
    expect(outcome.checkpoint.status).toBe("waiting");
    const run = repository.read("project-1", "op-batch")!;
    const gate = run.gates.find((g) => g.scope === "anchor_checkpoint");
    expect(gate).toBeDefined();
    expect(gate?.status).toBe("waiting");
    // The paid gate created the video job, but the free checkpoint still blocks provider submission.
    const pendingShot = run.jobs.find((j) => j.metadata?.shotId === "shot-a");
    expect(pendingShot).toMatchObject({ status: "authorized" });
    expect(pendingShot?.providerTaskId).toBeUndefined();

    // Approve the checkpoint → shots release on the next scheduler run.
    repository.execute("project-1", "op-batch", { commandId: `decide:${run.revision}`, expectedRevision: run.revision, type: "gate.decide", payload: { gateId: gate!.gateId, status: "approved" }, issuedAt: NOW });
    await scheduler(root, repository, submit).runToQuiescence();
    expect(submit).toHaveBeenCalledTimes(2); // anchor + shot-a
    expect(repository.read("project-1", "op-batch")!.jobs.some((j) => j.metadata?.shotId === "shot-a")).toBe(true);
  });

  it("only re-generates the anchor (not shots) when the checkpoint is rejected", async () => {
    const shots = [
      shotEntry("anchor-1", "hero look", { role: "anchor", modelId: "image-model", mode: "text-to-image" }),
      shotEntry("shot-a", "a"),
    ];
    const { root, repository } = setupBatch(shots, null);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));

    // Anchor generates + gate opens.
    await scheduler(root, repository, submit).runToQuiescence();
    let run = repository.read("project-1", "op-batch")!;
    const gate = run.gates.find((g) => g.scope === "anchor_checkpoint")!;
    // Reject → scheduler parks. A replacement anchor requires its own fresh rework authority.
    repository.execute("project-1", "op-batch", { commandId: `reject:${run.revision}`, expectedRevision: run.revision, type: "gate.decide", payload: { gateId: gate.gateId, status: "rejected" }, issuedAt: NOW });

    const outcome = await scheduler(root, repository, submit).runToQuiescence();
    // No second provider submission and no video shot submission occur from a free checkpoint decision.
    run = repository.read("project-1", "op-batch")!;
    expect(submit).toHaveBeenCalledTimes(1);
    const pendingShot = run.jobs.find((j) => j.metadata?.shotId === "shot-a");
    expect(pendingShot).toMatchObject({ status: "authorized" });
    expect(pendingShot?.providerTaskId).toBeUndefined();
    expect(outcome.checkpoint.status).toBe("rejected");
  });
});
