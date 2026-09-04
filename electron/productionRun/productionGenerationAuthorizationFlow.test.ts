import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApprovalReceiptAuthority } from "../capabilityCore/approvalReceipt";
import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import { createRunOwnedGenerationGateAuthority, decideRunOwnedGenerationGate } from "../capabilityCore/runOwnedGenerationGateAuthority";
import { prepareProductionGenerationAuthorization, prepareProductionGenerationReauthorization } from "./prepareProductionGenerationAuthorization";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { productionRunPaths } from "./productionRunPaths";
import { createProductionRunRepository } from "./productionRunRepository";

const NOW = "2026-08-23T00:00:00.000Z";
const roots: string[] = [];
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: {},
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

const lease = {
  projectId: "project-1",
  immutableProjectUuid: "project-uuid-1",
  projectGeneration: 1,
  revocationEpoch: 0,
} as ProjectLeaseV2;

function candidate(): PlanCandidate {
  return {
    candidateId: "candidate-1",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt: "A paper boat on a quiet lake",
    parameters: { aspectRatio: "16:9" },
    references: [],
  };
}

function setup(approve = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generation-authorization-flow-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === "project-1" ? root : null,
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate();
  const contract = compileExecutionContract(planCandidate, registry);
  let drifted = false;
  const submit = vi.fn(async () => ({ providerTaskId: `provider-task-${submit.mock.calls.length}` }));
  const provider: GenerationProvider = {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (request) => ({
      model: request.modelId,
      prompt: drifted ? `${request.prompt} changed` : request.prompt,
      parameters: request.parameters,
    }),
    submit,
  };
  repository.createGenerationDraft({
    operationId: "op-1",
    projectId: "project-1",
    origin: { host: "semantic-mcp" },
    candidate: planCandidate,
    policy: {
      trustedHosts: ["semantic-mcp"],
      allowedProviders: ["fixture-provider"],
      allowedModels: ["fixture-model"],
      maxSpend: 10,
      maxAttemptsPerJob: 2,
    },
  });
  const authorization = prepareProductionGenerationAuthorization({
    lease,
    projectRevision: 12,
    operation: { operationId: "op-1", projectId: "project-1", candidate: planCandidate, planVersion: 1 },
    contract,
    providers: [provider],
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    now: NOW,
  });
  const sealed = repository.execute("project-1", "op-1", {
    commandId: "seal-authorized",
    expectedRevision: 0,
    type: "generation.seal",
    payload: { contract, authorization },
    issuedAt: NOW,
  }).run;
  if (approve) {
    repository.execute("project-1", "op-1", {
      commandId: "decide-authorized",
      expectedRevision: sealed.revision,
      type: "gate.decide",
      payload: {
        gateId: authorization.envelope.gateId,
        status: "approved",
        receiptId: "receipt-1",
        authorizationDigest: authorization.authorizationDigest,
      },
      issuedAt: NOW,
    });
  }
  const submission = createProductionGenerationSubmission({
    repository,
    projectRoot: root,
    immutableProjectUuid: lease.immutableProjectUuid,
    projectGeneration: lease.projectGeneration,
    projectRevision: 12,
    intentMacKey: "test-intent-key",
    providers: [provider],
    now: () => NOW,
  });
  return { root, repository, contract, authorization, submission, submit, provider, setDrifted: (value: boolean) => { drifted = value; } };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Run-owned paid generation authorization", () => {
  it("uses a human receipt to approve the sealed gate through the shared authority", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };
    const decision = await decideRunOwnedGenerationGate({
      owner: owner as never,
      receipts,
      lease,
      operationId: "op-1",
      authorization,
      commandPrefix: "test-authority",
      projectRevisionResolver: () => 12,
      display: { model: "fixture-model" },
      now: () => NOW,
      confirm: async ({ challengeToken }) => {
        const attestation = receipts.createMainProcessGestureAttestation(challengeToken, {
          webContentsId: 1,
          frameId: 2,
          origin: "app://nomi",
          decision: "accept",
        });
        const receipt = receipts.mintReceipt(challengeToken, attestation);
        return { confirmed: true, receiptToken: receipt.token };
      },
    });

    expect(decision.approved).toBe(true);
    expect(decision.run.gates).toEqual([expect.objectContaining({ status: "approved" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([expect.objectContaining({
      authorizationDigest: authorization.authorizationDigest,
    })]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(6);
  });

  it("rejects a receipt when the workspace revision drifts after confirmation and before the Run command", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    let projectRevision = 12;
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };

    await expect(decideRunOwnedGenerationGate({
      owner: owner as never,
      receipts,
      lease,
      operationId: "op-1",
      authorization,
      commandPrefix: "test-revision-drift",
      display: { model: "fixture-model" },
      now: () => NOW,
      // Drift is introduced after the challenge is presented but before the
      // receipt is verified/used. The old implementation only compares the
      // receipt to the sealed envelope and therefore approves this stale proof.
      projectRevisionResolver: () => projectRevision,
      confirm: async ({ challengeToken }) => {
        projectRevision = 13;
        const attestation = receipts.createMainProcessGestureAttestation(challengeToken, {
          webContentsId: 1,
          frameId: 2,
          origin: "app://nomi",
          decision: "accept",
        });
        const receipt = receipts.mintReceipt(challengeToken, attestation);
        return { confirmed: true, receiptToken: receipt.token };
      },
    })).rejects.toMatchObject({ code: "receipt_invalid", message: expect.stringMatching(/revision/i) });

    expect(repository.read("project-1", "op-1")?.gates).toEqual([expect.objectContaining({ status: "waiting" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([]);
  });

  it("does not issue a challenge when the project revision drifted before the gate request", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };
    const planning = vi.fn(async () => ({ operationId: "op-1", model: "fixture-model" }));
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: planning as never,
      receipts,
      projectRevisionResolver: () => 13,
      now: () => NOW,
    });

    await expect(generationAuthority.requestGenerationGate({
      params: { operationId: "op-1" },
      lease,
    })).rejects.toMatchObject({ code: "receipt_invalid", message: expect.stringMatching(/revision/i) });
    expect(planning).toHaveBeenCalledTimes(1);
    expect(repository.read("project-1", "op-1")?.gates).toEqual([expect.objectContaining({ status: "waiting" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([]);
    expect(authorization.envelope.projectRevision).toBe(12);
  });

  it("rejects a malformed sealed gate before issuing a request-time challenge", async () => {
    const { root, repository } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const malformed = repository.read("project-1", "op-1")!;
    malformed.generationPlan = undefined;
    const owner = {
      readFull: () => malformed,
      command: vi.fn(),
    };
    const planning = vi.fn(async () => ({ operationId: "op-1", model: "fixture-model" }));
    const requestChallenge = vi.spyOn(receipts, "requestChallenge");
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: planning as never,
      receipts,
      projectRevisionResolver: () => 12,
      now: () => NOW,
    });

    await expect(generationAuthority.requestGenerationGate({ params: { operationId: "op-1" }, lease }))
      .rejects.toThrow("Generation gate does not match the sealed Run authorization");
    expect(planning).toHaveBeenCalledTimes(1);
    expect(requestChallenge).not.toHaveBeenCalled();
  });

  it("rejects an expired sealed authorization at request time without issuing a challenge", async () => {
    const { root, repository } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: vi.fn(),
    };
    const planning = vi.fn(async () => ({ operationId: "op-1", model: "fixture-model" }));
    const requestChallenge = vi.spyOn(receipts, "requestChallenge");
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: planning as never,
      receipts,
      projectRevisionResolver: () => 12,
      now: () => "2026-08-24T00:00:00.000Z",
    });

    await expect(generationAuthority.requestGenerationGate({ params: { operationId: "op-1" }, lease }))
      .rejects.toThrow("Generation authorization has expired");
    expect(planning).toHaveBeenCalledTimes(1);
    expect(requestChallenge).not.toHaveBeenCalled();
  });

  it("does not authorize a valid receipt against a gate that is no longer waiting", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const challenge = receipts.requestChallenge({
      challengeKey: "non-waiting-gate",
      immutableProjectUuid: authorization.envelope.immutableProjectUuid,
      projectGeneration: authorization.envelope.projectGeneration,
      projectId: authorization.envelope.projectId,
      runId: authorization.envelope.runId,
      gateId: authorization.envelope.gateId,
      contractHash: authorization.authorizationDigest,
      targetHash: authorization.authorizationDigest,
      projectRevision: authorization.envelope.projectRevision,
      revocationEpoch: lease.revocationEpoch,
      costScope: authorization.envelope.costScope,
      pricingSnapshotHash: authorization.authorizationDigest,
      reservationPreview: { ...authorization.envelope.budget },
    });
    const gesture = receipts.createMainProcessGestureAttestation(challenge.token, {
      webContentsId: 1,
      frameId: 2,
      origin: "app://nomi",
      decision: "accept",
    });
    const receipt = receipts.mintReceipt(challenge.token, gesture).receipt;
    const current = repository.read("project-1", "op-1")!;
    const approved = {
      ...current,
      gates: current.gates.map((gate) => ({ ...gate, status: "approved" as const })),
    };
    const owner = {
      readFull: () => approved,
      command: vi.fn(),
    };
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: owner as never,
      operations: { read: vi.fn(async () => undefined) } as never,
      planning: vi.fn() as never,
      receipts,
      projectRevisionResolver: () => 12,
      now: () => NOW,
    });

    await expect(generationAuthority.authorizeGeneration({ params: { operationId: "op-1" }, lease, receipt }))
      .rejects.toThrow("Generation authorization gate is not waiting for this receipt");
    await expect(generationAuthority.authorizeGeneration({
      params: { operationId: "op-1" },
      lease,
      receipt: { ...receipt, projectRevision: 13 },
    })).rejects.toThrow("Generation approval receipt does not match the sealed Run authorization");
    expect(owner.command).not.toHaveBeenCalled();
  });

  it("authorizes a valid receipt through the production gate and forwards the sealed revision", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const challenge = receipts.requestChallenge({
      challengeKey: "authorize-production-gate",
      immutableProjectUuid: authorization.envelope.immutableProjectUuid,
      projectGeneration: authorization.envelope.projectGeneration,
      projectId: authorization.envelope.projectId,
      runId: authorization.envelope.runId,
      gateId: authorization.envelope.gateId,
      contractHash: authorization.authorizationDigest,
      targetHash: authorization.authorizationDigest,
      projectRevision: authorization.envelope.projectRevision,
      revocationEpoch: lease.revocationEpoch,
      costScope: authorization.envelope.costScope,
      pricingSnapshotHash: authorization.authorizationDigest,
      reservationPreview: { ...authorization.envelope.budget },
    });
    const gesture = receipts.createMainProcessGestureAttestation(challenge.token, {
      webContentsId: 1,
      frameId: 2,
      origin: "app://nomi",
      decision: "accept",
    });
    const receipt = receipts.mintReceipt(challenge.token, gesture).receipt;
    const current = repository.read("project-1", "op-1")!;
    const command = vi.fn(async (_projectId: string, _operationId: string, value: Parameters<typeof repository.execute>[2]) => ({
      run: current,
      events: [value as never],
    }));
    const operationsRead = vi.fn(async () => ({ operationId: "op-1", state: "sealed" }));
    const generationAuthority = createRunOwnedGenerationGateAuthority({
      owner: {
        readFull: () => current,
        command,
      } as never,
      operations: { read: operationsRead } as never,
      planning: vi.fn() as never,
      receipts,
      projectRevisionResolver: () => 12,
      now: () => NOW,
    });

    await expect(generationAuthority.authorizeGeneration({ params: { operationId: "op-1" }, lease, receipt }))
      .resolves.toMatchObject({ operationId: "op-1", nextAction: "start", state: "sealed" });
    expect(command).toHaveBeenCalledWith("project-1", "op-1", expect.objectContaining({
      type: "gate.decide",
      payload: expect.objectContaining({ projectRevision: 12, receiptId: receipt.receiptId }),
    }));
    expect(operationsRead).toHaveBeenCalledTimes(1);
  });

  it("rejects the shared gate without creating Approval or budget authority", async () => {
    const { root, repository, authorization } = setup(false);
    const receipts = createApprovalReceiptAuthority({
      filePath: path.join(root, "approval-receipts.json"),
      macKey: "approval-receipt-key",
      storeMacKey: "approval-receipt-store-key",
      keyId: "approval-receipt-v1",
      now: () => NOW,
    });
    const owner = {
      readFull: (projectId: string, runId: string) => repository.read(projectId, runId)!,
      command: async (projectId: string, runId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, runId, command),
    };
    const decision = await decideRunOwnedGenerationGate({
      owner: owner as never,
      receipts,
      lease,
      operationId: "op-1",
      authorization,
      commandPrefix: "test-authority",
      projectRevisionResolver: () => 12,
      display: { model: "fixture-model" },
      now: () => NOW,
      confirm: async () => ({ confirmed: false }),
    });

    expect(decision.approved).toBe(false);
    expect(decision.run.gates).toEqual([expect.objectContaining({ status: "rejected" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(0);
  });

  it("persists one digest-bound gate, Approval and budget authorization", () => {
    const { repository, authorization } = setup();
    const run = repository.read("project-1", "op-1")!;
    expect(run.generationPlan).toMatchObject({
      authorizationDigest: authorization.authorizationDigest,
      authorizationGateId: authorization.envelope.gateId,
      approvedReceiptId: "receipt-1",
      planHash: authorization.authorizationDigest,
    });
    expect(run.jobs).toEqual([expect.objectContaining({
      jobId: authorization.envelope.jobs[0].jobId,
      status: "authorized",
      authorizationDigest: authorization.authorizationDigest,
    })]);
    expect(run.gates).toEqual([expect.objectContaining({
      gateId: authorization.envelope.gateId,
      status: "approved",
      receiptId: "receipt-1",
      authorizationDigest: authorization.authorizationDigest,
    })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([expect.objectContaining({
      approvalId: `approval:${authorization.envelope.gateId}`,
      authorizationDigest: authorization.authorizationDigest,
      receiptId: "receipt-1",
      maxSpend: 6,
    })]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(6);
  });

  it("rejects provider payload drift before any durable or provider side effect", async () => {
    const { root, repository, authorization, submission, submit, setDrifted } = setup();
    const beforeRun = structuredClone(repository.read("project-1", "op-1"));
    const beforeApprovals = structuredClone(repository.readApprovals("project-1", "op-1"));
    const beforeLedger = structuredClone(repository.readBudgetLedger("project-1", "op-1"));
    setDrifted(true);

    await expect(submission.start({ projectId: "project-1", operationId: "op-1" }))
      .rejects.toThrow("Provider wire payload no longer matches the approved authorization");

    expect(repository.read("project-1", "op-1")).toEqual(beforeRun);
    expect(repository.readApprovals("project-1", "op-1")).toEqual(beforeApprovals);
    expect(repository.readBudgetLedger("project-1", "op-1")).toEqual(beforeLedger);
    const paths = productionRunPaths(root, "op-1");
    expect(fs.existsSync(paths.intents)).toBe(false);
    expect(fs.existsSync(path.join(root, ".nomi", "runs", "op-1", "jobs", authorization.envelope.jobs[0].jobId, "runtime-envelope.json"))).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits the already-verified prepared request without creating another Approval or authorization", async () => {
    const { repository, submission, submit } = setup();
    const approvalsBefore = repository.readApprovals("project-1", "op-1");
    await expect(submission.start({ projectId: "project-1", operationId: "op-1" }))
      .resolves.toMatchObject({ providerTaskId: "provider-task-1", nextAction: "observe" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(repository.readApprovals("project-1", "op-1")).toEqual(approvalsBefore);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(6);
  });

  it("rejecting the spend gate creates no Approval, budget authority, or provider side effect", () => {
    const { repository, authorization, submit } = setup(false);
    const before = repository.read("project-1", "op-1")!;
    const rejected = repository.execute("project-1", "op-1", {
      commandId: "decline-authorization",
      expectedRevision: before.revision,
      type: "gate.decide",
      payload: {
        gateId: authorization.envelope.gateId,
        status: "rejected",
        authorizationDigest: authorization.authorizationDigest,
      },
      issuedAt: NOW,
    }).run;

    expect(rejected.gates).toEqual([expect.objectContaining({ status: "rejected" })]);
    expect(rejected.gates[0].receiptId).toBeUndefined();
    expect(rejected.jobs).toEqual([expect.objectContaining({ status: "authorization_required" })]);
    expect(repository.readApprovals("project-1", "op-1")).toEqual([]);
    expect(repository.readBudgetLedger("project-1", "op-1").authorized).toBe(0);
    expect(submit).not.toHaveBeenCalled();
  });

  it("rework uses a fresh digest, gate, Approval and budget before dispatching only attempt 2", async () => {
    const { repository, authorization: initial, submission, submit, provider } = setup();
    await submission.start({ projectId: "project-1", operationId: "op-1" });
    let run = repository.read("project-1", "op-1")!;
    const firstJob = run.jobs[0];
    run = repository.execute("project-1", "op-1", {
      commandId: "test:first-attempt-ready",
      expectedRevision: run.revision,
      type: "job.status",
      payload: { jobId: firstJob.jobId, status: "ready" },
      issuedAt: NOW,
    }).run;
    const reauthorization = prepareProductionGenerationReauthorization({
      lease,
      projectRevision: 12,
      run,
      providers: [provider],
      resolveShotPrice: () => ({ known: true, amount: 6 }),
      now: "2026-08-23T00:01:00.000Z",
    });
    expect(reauthorization.authorizationDigest).not.toBe(initial.authorizationDigest);
    run = repository.execute("project-1", "op-1", {
      commandId: "request-rework",
      expectedRevision: run.revision,
      type: "generation.reauthorize",
      payload: { authorization: reauthorization },
      issuedAt: "2026-08-23T00:01:00.000Z",
    }).run;
    const reworkedJob = run.jobs.find((job) => job.jobId === reauthorization.envelope.jobs[0].jobId);
    expect(reworkedJob).toBeDefined();
    expect(reworkedJob).toMatchObject({
      jobId: reauthorization.envelope.jobs[0].jobId,
      status: "authorization_required",
      attempt: 2,
      parentJobId: firstJob.jobId,
      retryCount: 1,
      metadata: expect.objectContaining({ retryCount: 1, retryReason: "rework", parentJobId: firstJob.jobId }),
      authorizationDigest: reauthorization.authorizationDigest,
    });
    expect(submit).toHaveBeenCalledTimes(1);

    run = repository.execute("project-1", "op-1", {
      commandId: "approve-rework",
      expectedRevision: run.revision,
      type: "gate.decide",
      payload: {
        gateId: reauthorization.envelope.gateId,
        status: "approved",
        receiptId: "receipt-rework",
        authorizationDigest: reauthorization.authorizationDigest,
      },
      issuedAt: "2026-08-23T00:01:00.000Z",
    }).run;
    expect(run.budget.authorized).toBe(12);
    expect(repository.readApprovals("project-1", "op-1")).toContainEqual(expect.objectContaining({
      approvalId: `approval:${reauthorization.envelope.gateId}`,
      authorizationDigest: reauthorization.authorizationDigest,
      receiptId: "receipt-rework",
      jobIds: [reauthorization.envelope.jobs[0].jobId],
      maxSpend: 6,
    }));

    await submission.start({ projectId: "project-1", operationId: "op-1", attempt: 2 });
    expect(submit).toHaveBeenCalledTimes(2);
    const final = repository.read("project-1", "op-1")!;
    expect(final.jobs.find((job) => job.attempt === 1)?.status).toBe("ready");
    expect(final.jobs.find((job) => job.attempt === 2)).toMatchObject({ status: "provider_accepted" });
  });
});
