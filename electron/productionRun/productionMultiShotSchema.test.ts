import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { prepareProductionGenerationAuthorization, prepareProductionGenerationReauthorization } from "./prepareProductionGenerationAuthorization";
import { applyProductionCommand } from "./productionRunReducer";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";

// P4 S1: multi-shot generationPlan schema + shot addressing.
// TDD: these lock the contract that S1 must satisfy — shot-grained keys never collide, legacy
// single-shot snapshots replay unchanged, per-shot new attempts don't touch sibling shots, and
// attempt monotonicity is scoped to one shot's lineage.

const roots: string[] = [];
const NOW = "2026-08-24T00:00:00.000Z";

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{
      modelId: "fixture-model",
      modes: ["text-to-image"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

function candidate(candidateId: string, prompt: string): PlanCandidate {
  return {
    candidateId,
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt,
    parameters: { aspectRatio: "16:9" },
    references: [],
  };
}

function provider(submit: GenerationProvider["submit"] = async () => ({ providerTaskId: "unused" })): GenerationProvider {
  return {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (input) => input,
    submit,
  };
}

/** A single-shot draft, sealed + approved, exactly like today's chain. */
function setupSingleShot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-multishot-single-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === "project-1" ? root : null),
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate("candidate-1", "A paper boat on a quiet lake");
  const contract = compileExecutionContract(planCandidate, registry);
  repository.createGenerationDraft({
    operationId: "op-1",
    projectId: "project-1",
    origin: { host: "semantic-mcp" },
    candidate: planCandidate,
    policy: {
      trustedHosts: ["semantic-mcp"],
      allowedProviders: ["fixture-provider"],
      allowedModels: ["fixture-model"],
      maxSpend: 0,
      maxAttemptsPerJob: 2,
    },
  });
  sealAndApproveProductionGeneration({
    repository,
    projectId: "project-1",
    operationId: "op-1",
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    candidate: planCandidate,
    contract,
    providers: [provider()],
    receiptId: "receipt-fixture",
    now: NOW,
  });
  return { root, repository, contract };
}

function submission(root: string, repository: ReturnType<typeof createProductionRunRepository>, submit: ReturnType<typeof vi.fn>, now = "2026-08-24T00:00:00.000Z") {
  return createProductionGenerationSubmission({
    repository,
    projectRoot: root,
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    intentMacKey: "test-intent-key",
    provider: {
      ...provider(submit as GenerationProvider["submit"]),
    },
    now: () => now,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("P4 S1 multi-shot generation plan schema", () => {
  it("keeps the legacy single-shot snapshot (no shots[]) readable and submittable unchanged", async () => {
    const { root, repository, contract } = setupSingleShot();
    // The legacy snapshot has no shots[]. Reading it must expose the top-level plan as before.
    const beforeSubmit = repository.read("project-1", "op-1");
    expect(beforeSubmit?.generationPlan).toMatchObject({ state: "sealed", contract: { contractHash: contract.contractHash } });
    expect(beforeSubmit?.generationPlan?.shots).toBeUndefined();

    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1", raw: { accepted: true } }));
    const runner = submission(root, repository, submit);
    // A start() with no shotId must address the default (legacy) shot and behave exactly as today.
    await expect(runner.start({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({
      operationId: "op-1",
      providerTaskId: "provider-task-1",
      nextAction: "observe",
    });
    expect(submit).toHaveBeenCalledTimes(1);
    const run = repository.read("project-1", "op-1");
    expect(run?.jobs).toHaveLength(1);
    expect(run?.jobs[0]).toMatchObject({ status: "provider_accepted", providerTaskId: "provider-task-1" });
    // Default-shot jobId keeps the legacy prefix so old callers/tests still match.
    expect(run?.jobs[0]?.jobId).toMatch(/^generation-op-1-/);
  });

  it("gives two shots with identical parameters distinct jobId / providerIdempotencyKey / commandId", async () => {
    // Build a two-shot sealed plan where both shots share the SAME contract hash (identical params).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-multishot-collide-"));
    roots.push(root);
    const repository = createProductionRunRepository({
      projectDirResolver: (projectId) => (projectId === "project-1" ? root : null),
      now: () => "2026-08-24T00:00:00.000Z",
      randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
    });
    // The realistic collision: the SAME candidate (same id/revision/params/prompt) applied to two
    // shots → identical contract hashes. The old identity keyed only on contractHash would collapse
    // both shots onto one jobId / one provider task. shotId in the derivation must keep them distinct.
    const shotACandidate = candidate("candidate-shared", "Identical shot");
    const shotBCandidate = candidate("candidate-shared", "Identical shot");
    const shotAContract = compileExecutionContract(shotACandidate, registry);
    const shotBContract = compileExecutionContract(shotBCandidate, registry);
    expect(shotAContract.contractHash).toBe(shotBContract.contractHash);

    repository.createGenerationDraft({
      operationId: "op-multi",
      projectId: "project-1",
      origin: { host: "semantic-mcp" },
      candidate: shotACandidate,
      policy: {
        trustedHosts: ["semantic-mcp"],
        allowedProviders: ["fixture-provider"],
        allowedModels: ["fixture-model"],
        maxSpend: 0,
        maxAttemptsPerJob: 2,
      },
    });
    // Seal a two-shot plan. The reducer variant must accept per-shot sealed contracts.
    const shots: ProductionGenerationShot[] = [
      { shotId: "shot-a", candidate: { ...shotACandidate, sealedContractHash: shotAContract.contractHash }, contract: shotAContract, updatedAt: "2026-08-24T00:00:00.000Z" },
      { shotId: "shot-b", candidate: { ...shotBCandidate, sealedContractHash: shotBContract.contractHash }, contract: shotBContract, updatedAt: "2026-08-24T00:00:00.000Z" },
    ];
    sealAndApproveProductionGeneration({
      repository,
      projectId: "project-1",
      operationId: "op-multi",
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      candidate: shotACandidate,
      contract: shotAContract,
      providers: [provider()],
      multiShot: { shots, planHash: "plan-hash-multi" },
      receiptId: "receipt-multi",
      now: NOW,
    });

    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length}` }));
    const runner = submission(root, repository, submit);
    await runner.start({ projectId: "project-1", operationId: "op-multi", shotId: "shot-a" });
    await runner.start({ projectId: "project-1", operationId: "op-multi", shotId: "shot-b" });

    const run = repository.read("project-1", "op-multi")!;
    const jobs = run.jobs;
    expect(jobs).toHaveLength(2);
    const [jobA, jobB] = jobs;
    // #5 identity: two shots with identical parameters must not collide on any derived key.
    expect(jobA.jobId).not.toBe(jobB.jobId);
    expect(jobA.providerIdempotencyKey).toBeDefined();
    expect(jobA.providerIdempotencyKey).not.toBe(jobB.providerIdempotencyKey);
    expect(jobA.executionBinding?.shotId).not.toBe(jobB.executionBinding?.shotId);
    expect(submit).toHaveBeenCalledTimes(2);

    // #4 commandId: the second shot's job.add / budget.authorize must not be swallowed by dedupe.
    // Both provider submissions landed distinct provider tasks → both jobs reached provider_accepted.
    expect(jobA).toMatchObject({ status: "provider_accepted" });
    expect(jobB).toMatchObject({ status: "provider_accepted" });
    expect(jobA.providerTaskId).not.toBe(jobB.providerTaskId);
  });
});

describe("P4 S1 reducer shot addressing", () => {
  const now = "2026-08-24T00:00:00.000Z";

  function sealedTwoShotRun(approve = true): ProductionRun {
    const shotACandidate = candidate("cand-a", "shot a");
    const shotBCandidate = candidate("cand-b", "shot b differs");
    const shotAContract = compileExecutionContract(shotACandidate, registry);
    const shotBContract = compileExecutionContract(shotBCandidate, registry);
    const sealedShots: ProductionGenerationShot[] = [
      { shotId: "shot-a", candidate: { ...shotACandidate, sealedContractHash: shotAContract.contractHash }, contract: shotAContract, updatedAt: now },
      { shotId: "shot-b", candidate: { ...shotBCandidate, sealedContractHash: shotBContract.contractHash }, contract: shotBContract, updatedAt: now },
    ];
    const draft: ProductionRun = {
      schemaVersion: 1, runId: "op-x", projectId: "project-1", revision: 5,
      status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
      origin: { host: "semantic-mcp" },
      policy: { mode: "balanced", trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
      budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
      planVersion: 1, snapshotCursor: 5, stages: [], gates: [], jobs: [], artifacts: [],
      generationPlan: {
        operationId: "op-x",
        state: "draft",
        candidate: shotACandidate,
        shots: [
          { shotId: "shot-a", candidate: shotACandidate, updatedAt: now },
          { shotId: "shot-b", candidate: shotBCandidate, updatedAt: now },
        ],
        updatedAt: now,
      },
      createdAt: now, updatedAt: now,
    };
    const authorization = prepareProductionGenerationAuthorization({
      lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0,
      operation: { operationId: "op-x", projectId: "project-1", candidate: shotACandidate, planVersion: 1 },
      contract: shotAContract,
      multiShot: { shots: sealedShots, planHash: "plan-hash-x" },
      providers: [provider()],
      resolveShotPrice: () => ({ known: true, amount: 0 }),
      now,
    });
    let run = applyProductionCommand(draft, {
      commandId: "seal-op-x", expectedRevision: 5, type: "generation.seal",
      payload: { contract: shotAContract, shots: sealedShots, planHash: "plan-hash-x", authorization }, issuedAt: now,
    }, now).run;
    if (!approve) return run;
    run = applyProductionCommand(run, {
      commandId: "approve-op-x", expectedRevision: 5, type: "gate.decide",
      payload: { gateId: authorization.envelope.gateId, status: "approved", receiptId: "receipt-x", authorizationDigest: authorization.authorizationDigest }, issuedAt: now,
    }, now).run;
    return { ...run, jobs: run.jobs.map((job) => ({ ...job, status: "ready" as const })) };
  }

  function reauthorize(run: ProductionRun, shotId: string) {
    const authorization = prepareProductionGenerationReauthorization({
      lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0,
      run,
      shotId,
      providers: [provider()],
      resolveShotPrice: () => ({ known: true, amount: 0 }),
      now,
    });
    const effect = applyProductionCommand(run, {
      commandId: `reauthorize-${shotId}`, expectedRevision: run.revision, type: "generation.reauthorize",
      payload: { shotId, authorization }, issuedAt: now,
    }, now);
    return { authorization, effect };
  }

  it("a per-shot reauthorization creates a waiting attempt and leaves the sibling untouched", () => {
    const run = sealedTwoShotRun();
    const { authorization, effect } = reauthorize(run, "shot-a");
    expect(effect.run.generationPlan?.approvedReceiptId).toBeUndefined();
    const shotA = effect.run.generationPlan?.shots?.find((s) => s.shotId === "shot-a");
    const shotB = effect.run.generationPlan?.shots?.find((s) => s.shotId === "shot-b");
    expect(shotA?.approvedReceiptId).toBeUndefined();
    expect(shotA?.attemptCount).toBe(2);
    expect(shotB?.approvedReceiptId).toBe("receipt-x");
    expect(effect.run.jobs).toContainEqual(expect.objectContaining({
      jobId: authorization.envelope.jobs[0].jobId,
      status: "authorization_required",
      attempt: 2,
      parentJobId: authorization.parentJobId,
    }));
    expect(effect.run.gates).toContainEqual(expect.objectContaining({ gateId: authorization.envelope.gateId, status: "waiting" }));

    const approved = applyProductionCommand(effect.run, {
      commandId: "approve-shot-a-rework", expectedRevision: effect.run.revision, type: "gate.decide",
      payload: { gateId: authorization.envelope.gateId, status: "approved", receiptId: "receipt-rework-a", authorizationDigest: authorization.authorizationDigest }, issuedAt: now,
    }, now).run;
    expect(approved.jobs.find((job) => job.jobId === authorization.envelope.jobs[0].jobId)?.status).toBe("authorized");
    expect(approved.generationPlan?.shots?.find((shot) => shot.shotId === "shot-a")?.approvedReceiptId).toBe("receipt-rework-a");
    expect(approved.generationPlan?.shots?.find((shot) => shot.shotId === "shot-b")?.approvedReceiptId).toBe("receipt-x");
  });

  it("refuses to replace the run-wide authority while a sibling job is still authorized", () => {
    const settled = sealedTwoShotRun();
    const authorization = prepareProductionGenerationReauthorization({
      lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0,
      run: settled,
      shotId: "shot-a",
      providers: [provider()],
      resolveShotPrice: () => ({ known: true, amount: 0 }),
      now,
    });
    const withAuthorizedSibling = {
      ...settled,
      jobs: settled.jobs.map((job) => job.metadata?.shotId === "shot-b"
        ? { ...job, status: "authorized" as const }
        : job),
    };

    expect(() => prepareProductionGenerationReauthorization({
      lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0,
      run: withAuthorizedSibling,
      shotId: "shot-a",
      providers: [provider()],
      resolveShotPrice: () => ({ known: true, amount: 0 }),
      now,
    })).toThrow("requires all previously authorized jobs to be submitted or settled");

    expect(() => applyProductionCommand(withAuthorizedSibling, {
      commandId: "reauthorize-with-authorized-sibling",
      expectedRevision: withAuthorizedSibling.revision,
      type: "generation.reauthorize",
      payload: { shotId: "shot-a", authorization },
      issuedAt: now,
    }, now)).toThrow("requires all previously authorized jobs to be submitted or settled");
  });

  it("scopes attempt monotonicity to the shot lineage: shot A attempt 2 does not block shot B attempt 2", () => {
    const run = sealedTwoShotRun();
    const shotA = reauthorize(run, "shot-a");
    let afterA = applyProductionCommand(shotA.effect.run, {
      commandId: "approve-shot-a", expectedRevision: run.revision, type: "gate.decide",
      payload: { gateId: shotA.authorization.envelope.gateId, status: "approved", receiptId: "receipt-a-2", authorizationDigest: shotA.authorization.authorizationDigest }, issuedAt: now,
    }, now).run;
    afterA = { ...afterA, jobs: afterA.jobs.map((job) => job.jobId === shotA.authorization.envelope.jobs[0].jobId ? { ...job, status: "ready" as const } : job) };
    expect(() => reauthorize(afterA, "shot-b")).not.toThrow();
  });

  it("still rejects a stale attempt within the SAME shot lineage", () => {
    const run = sealedTwoShotRun();
    const first = reauthorize(run, "shot-a").effect.run;
    expect(() => reauthorize(first, "shot-a")).toThrow("previous generation attempt is not safely reworkable");
  });

  it("patches one shot's candidate + included flag without touching sibling shots (draft)", () => {
    const shotACandidate = candidate("cand-a", "shot a");
    const shotBCandidate = candidate("cand-b", "shot b");
    const draft: ProductionRun = {
      schemaVersion: 1, runId: "op-patch", projectId: "project-1", revision: 3,
      status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
      origin: { host: "semantic-mcp" },
      policy: { mode: "balanced", trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
      budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
      planVersion: 1, snapshotCursor: 3, stages: [], gates: [], jobs: [], artifacts: [],
      generationPlan: {
        operationId: "op-patch", state: "draft", candidate: shotACandidate,
        shots: [
          { shotId: "shot-a", candidate: shotACandidate, updatedAt: now },
          { shotId: "shot-b", candidate: shotBCandidate, updatedAt: now },
        ],
        updatedAt: now,
      },
      createdAt: now, updatedAt: now,
    };
    const effect = applyProductionCommand(draft, {
      commandId: "patch-shot-a", expectedRevision: 3, type: "generation.patch",
      payload: { shotId: "shot-a", patch: { prompt: "shot a revised" }, included: false }, issuedAt: now,
    }, now);
    const shotA = effect.run.generationPlan?.shots?.find((s) => s.shotId === "shot-a");
    const shotB = effect.run.generationPlan?.shots?.find((s) => s.shotId === "shot-b");
    expect(shotA?.candidate.prompt).toBe("shot a revised");
    expect(shotA?.candidate.revision).toBe(2);
    expect(shotA?.included).toBe(false);
    // Sibling shot untouched.
    expect(shotB?.candidate.prompt).toBe("shot b");
    expect(shotB?.candidate.revision).toBe(1);
    expect(shotB?.included).toBeUndefined();
  });

  it("seals only the included shots into per-shot contracts", () => {
    // A draft plan with three shots, one of them excluded (included: false).
    const shotACandidate = candidate("cand-a", "shot a");
    const shotBCandidate = candidate("cand-b", "shot b");
    const shotCCandidate = candidate("cand-c", "shot c");
    const draft: ProductionRun = {
      schemaVersion: 1, runId: "op-inc", projectId: "project-1", revision: 2,
      status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
      origin: { host: "semantic-mcp" },
      policy: { mode: "balanced", trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
      budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
      planVersion: 1, snapshotCursor: 2, stages: [], gates: [], jobs: [], artifacts: [],
      generationPlan: {
        operationId: "op-inc", state: "draft", candidate: shotACandidate,
        shots: [
          { shotId: "shot-a", candidate: shotACandidate, included: true, updatedAt: now },
          { shotId: "shot-b", candidate: shotBCandidate, included: false, updatedAt: now },
          { shotId: "shot-c", candidate: shotCCandidate, updatedAt: now },
        ],
        updatedAt: now,
      },
      createdAt: now, updatedAt: now,
    };
    const shotAContract = compileExecutionContract({ ...shotACandidate }, registry);
    const shotCContract = compileExecutionContract({ ...shotCCandidate }, registry);
    const sealShots: ProductionGenerationShot[] = [
      { shotId: "shot-a", candidate: { ...shotACandidate, sealedContractHash: shotAContract.contractHash }, contract: shotAContract, included: true, updatedAt: now },
      { shotId: "shot-b", candidate: shotBCandidate, included: false, updatedAt: now },
      { shotId: "shot-c", candidate: { ...shotCCandidate, sealedContractHash: shotCContract.contractHash }, contract: shotCContract, updatedAt: now },
    ];
    const effect = applyProductionCommand(draft, {
      commandId: "seal-inc", expectedRevision: 2, type: "generation.seal",
      payload: { contract: shotAContract, shots: sealShots, planHash: "plan-hash-inc" }, issuedAt: now,
    }, now);

    const sealed = effect.run.generationPlan!;
    expect(sealed.state).toBe("sealed");
    const included = (sealed.shots ?? []).filter((shot) => shot.included !== false);
    // Only included shots carry a sealed contract; excluded shots do not.
    expect(included.map((shot) => shot.shotId).sort()).toEqual(["shot-a", "shot-c"]);
    expect(sealed.shots?.find((s) => s.shotId === "shot-b")?.contract).toBeUndefined();
    expect(sealed.shots?.find((s) => s.shotId === "shot-a")?.contract?.contractHash).toBe(shotAContract.contractHash);
  });

  it("P4 S4 trial_narrow: shrinks a sealed multi-shot plan to only the first included video shot", () => {
    // Trial-first revokes the still-waiting authority because changing the included set changes payload
    // and spend. The narrowed plan must go through prepare -> seal -> gate again.
    const run = sealedTwoShotRun(false);
    const effect = applyProductionCommand(run, {
      commandId: "trial", expectedRevision: 5, type: "generation.trial_narrow",
      payload: { planHash: "plan-hash-trial" }, issuedAt: now,
    }, now);

    const narrowed = effect.run.generationPlan!;
    expect(narrowed.state).toBe("draft");
    expect(narrowed.planHash).toBeUndefined();
    expect(effect.run.planVersion).toBe(2);
    expect(effect.run.gates).toEqual([expect.objectContaining({ status: "revoked" })]);
    expect(effect.run.jobs).toEqual([]);
    // Only shot-a stays included; shot-b is excluded.
    expect(narrowed.shots?.find((s) => s.shotId === "shot-a")?.included).toBe(true);
    expect(narrowed.shots?.find((s) => s.shotId === "shot-b")?.included).toBe(false);
    // The old authority is cleared; a trial re-gate must re-confirm the smaller scope.
    expect(narrowed.approvedReceiptId).toBeUndefined();
    expect(narrowed.shots?.find((s) => s.shotId === "shot-a")?.approvedReceiptId).toBeUndefined();
  });

  it("P4 S4 trial_narrow: keeps anchors included (the trial still needs the identity image)", () => {
    const anchorCandidate = candidate("cand-anchor", "hero look");
    const shotACandidate = candidate("cand-a", "shot a");
    const anchorContract = compileExecutionContract(anchorCandidate, registry);
    const shotAContract = compileExecutionContract(shotACandidate, registry);
    const draft: ProductionRun = {
      schemaVersion: 1, runId: "op-anchor", projectId: "project-1", revision: 4,
      status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
      origin: { host: "semantic-mcp" },
      policy: { mode: "balanced", trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
      budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
      planVersion: 1, snapshotCursor: 4, stages: [], gates: [], jobs: [], artifacts: [],
      generationPlan: {
        operationId: "op-anchor", state: "draft", candidate: anchorCandidate,
        shots: [
          { shotId: "anchor-1", role: "anchor", candidate: anchorCandidate, updatedAt: now },
          { shotId: "shot-a", candidate: shotACandidate, updatedAt: now },
          { shotId: "shot-b", candidate: candidate("cand-b", "shot b"), updatedAt: now },
        ],
        updatedAt: now,
      },
      createdAt: now, updatedAt: now,
    };
    const shotBCandidate = draft.generationPlan!.shots![2].candidate;
    const shotBContract = compileExecutionContract(shotBCandidate, registry);
    const shots: ProductionGenerationShot[] = [
      { shotId: "anchor-1", role: "anchor", candidate: { ...anchorCandidate, sealedContractHash: anchorContract.contractHash }, contract: anchorContract, updatedAt: now },
      { shotId: "shot-a", candidate: { ...shotACandidate, sealedContractHash: shotAContract.contractHash }, contract: shotAContract, updatedAt: now },
      { shotId: "shot-b", candidate: { ...shotBCandidate, sealedContractHash: shotBContract.contractHash }, contract: shotBContract, updatedAt: now },
    ];
    const authorization = prepareProductionGenerationAuthorization({
      lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0,
      operation: { operationId: "op-anchor", projectId: "project-1", candidate: anchorCandidate, planVersion: 1 },
      contract: anchorContract,
      multiShot: { shots, planHash: "plan-hash-anchor" },
      providers: [provider()],
      resolveShotPrice: () => ({ known: true, amount: 0 }),
      now,
    });
    const run = applyProductionCommand(draft, {
      commandId: "seal-anchor", expectedRevision: 4, type: "generation.seal",
      payload: { contract: anchorContract, shots, planHash: "plan-hash-anchor", authorization }, issuedAt: now,
    }, now).run;
    const effect = applyProductionCommand(run, {
      commandId: "trial-anchor", expectedRevision: 4, type: "generation.trial_narrow",
      payload: { planHash: "plan-hash-trial-anchor" }, issuedAt: now,
    }, now);
    const narrowed = effect.run.generationPlan!;
    expect(narrowed.shots?.find((s) => s.shotId === "anchor-1")?.included).not.toBe(false); // anchor kept
    expect(narrowed.shots?.find((s) => s.shotId === "shot-a")?.included).toBe(true); // first video kept
    expect(narrowed.shots?.find((s) => s.shotId === "shot-b")?.included).toBe(false); // rest excluded
  });
});
