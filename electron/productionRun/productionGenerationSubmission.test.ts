import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { prepareProductionGenerationReauthorization } from "./prepareProductionGenerationAuthorization";
import {
  SubmissionReceiptUnknownError,
  SubmissionReconciliationRequiredError,
  createProductionGenerationSubmission,
} from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";

const roots: string[] = [];
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

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generation-submit-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === "project-1" ? root : null,
    now: () => "2026-08-23T00:00:00.000Z",
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate();
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
    providers: [{
      providerId: "fixture-provider",
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
      buildRequest: (input) => input,
      submit: async () => ({ providerTaskId: "unused" }),
    }],
    now: "2026-08-23T00:00:00.000Z",
  });
  return { root, repository, contract };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Run-owned semantic generation submission", () => {
  it("seals the envelope, submits once, persists provider acceptance, and survives restart", async () => {
    const { root, repository, contract } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1", raw: { accepted: true } }));
    const first = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit,
      },
      now: () => "2026-08-23T00:00:00.000Z",
    });

    await expect(first.start({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({
      operationId: "op-1",
      providerTaskId: "provider-task-1",
      nextAction: "observe",
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(repository.read("project-1", "op-1")).toMatchObject({
      generationPlan: { state: "submitted", contract: { contractHash: contract.contractHash } },
      jobs: [{ status: "provider_accepted", providerTaskId: "provider-task-1" }],
    });

    const restartedSubmit = vi.fn(async () => ({ providerTaskId: "provider-task-2" }));
    const restarted = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit: restartedSubmit,
      },
      now: () => "2026-08-23T00:01:00.000Z",
    });
    await expect(restarted.start({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({
      providerTaskId: "provider-task-1",
      nextAction: "observe",
    });
    expect(restartedSubmit).not.toHaveBeenCalled();
  });

  it("turns a lost provider receipt into reconcile-only state and never retries", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const first = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit,
      },
      afterProviderAcceptance: () => { throw new Error("crash after provider accepted"); },
      now: () => "2026-08-23T00:00:00.000Z",
    });

    await expect(first.start({ projectId: "project-1", operationId: "op-1" })).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(repository.read("project-1", "op-1")).toMatchObject({ jobs: [{ status: "submission_unknown" }] });

    const restartedSubmit = vi.fn(async () => ({ providerTaskId: "provider-task-2" }));
    const restarted = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      registry,
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit: restartedSubmit,
      },
      now: () => "2026-08-23T00:01:00.000Z",
    });
    await expect(restarted.start({ projectId: "project-1", operationId: "op-1" })).rejects.toBeInstanceOf(SubmissionReconciliationRequiredError);
    expect(restartedSubmit).not.toHaveBeenCalled();
    await expect(restarted.resume({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ action: "reconcile" });
  });

  it("submits an observe-only provider once and resumes by its provider task id", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-observe-only" }));
    const runner = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
        buildRequest: (input) => input,
        submit,
      },
      now: () => "2026-08-23T00:00:00.000Z",
    });

    await expect(runner.start({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ providerTaskId: "provider-task-observe-only" });
    await expect(runner.resume({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ action: "poll", nextAction: "poll", providerTaskId: "provider-task-observe-only" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("records a provider poll durably without submitting again", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-poll" }));
    const query = vi.fn(async (providerTaskId: string) => ({ status: "processing", raw: { taskId: providerTaskId, progress: 42 } }));
    const runner = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
        buildRequest: (input) => input,
        submit,
        query,
      },
      now: () => "2026-08-23T00:03:00.000Z",
    });

    await runner.start({ projectId: "project-1", operationId: "op-1" });
    await expect(runner.poll({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({
      providerTaskId: "provider-task-poll",
      providerStatus: "processing",
      nextAction: "poll",
    });
    expect(query).toHaveBeenCalledWith("provider-task-poll");
    expect(submit).toHaveBeenCalledTimes(1);
    const job = repository.read("project-1", "op-1")?.jobs[0];
    expect(job).toMatchObject({ status: "polling", providerTaskId: "provider-task-poll", providerStatus: "processing" });
    const envelopePath = path.join(root, ".nomi", "runs", "op-1", "jobs", job!.jobId, "runtime-envelope.json");
    expect(JSON.parse(fs.readFileSync(envelopePath, "utf8"))).toMatchObject({ lastPoll: { status: "processing", raw: { progress: 42 } } });
  });

  it("fails closed when a provider returns an unknown poll status", async () => {
    const { root, repository } = setup();
    const materialize = vi.fn(async () => ({ outputs: [{ kind: "image" as const, url: "https://cdn.example/image.png" }] }));
    const materializeOutput = vi.fn(async () => ({
      artifactId: "asset-unknown-status",
      kind: "image" as const,
      contentHash: "d".repeat(64),
      projectRelativePath: "assets/generated/unknown-status.png",
    }));
    const runner = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true },
        buildRequest: (input) => input,
        submit: vi.fn(async () => ({ providerTaskId: "provider-task-unknown-status" })),
        query: vi.fn(async () => ({ status: "mystery_state", raw: { status: "mystery_state" } })),
        materialize,
      },
      materializeOutput,
      now: () => "2026-08-23T00:03:30.000Z",
    });

    await runner.start({ projectId: "project-1", operationId: "op-1" });
    await expect(runner.poll({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({
      providerStatus: "mystery_state",
      nextAction: "attention",
    });
    expect(repository.read("project-1", "op-1")).toMatchObject({
      jobs: [{ status: "needs_attention", providerStatus: "mystery_state", errorCode: "provider_status_unknown" }],
    });
    await expect(runner.materialize({ projectId: "project-1", operationId: "op-1" })).rejects.toMatchObject({
      code: "materialization_failed",
    });
    expect(materialize).not.toHaveBeenCalled();
    expect(materializeOutput).not.toHaveBeenCalled();
  });

  it("materializes exactly one provider output through the Asset-owned receipt and is restart-idempotent", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-materialize" }));
    const query = vi.fn(async () => ({ status: "completed", raw: { result: { image: "opaque-provider-shape" } } }));
    const materialize = vi.fn(async () => ({ outputs: [{ kind: "image" as const, url: "https://cdn.example/image.png" }] }));
    const materializeOutput = vi.fn(async () => ({
      artifactId: "asset-image-1",
      kind: "image" as const,
      contentHash: "c".repeat(64),
      projectRelativePath: "assets/generated/2026-08-23/image.png",
    }));
    const runner = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true },
        buildRequest: (input) => input,
        submit,
        query,
        materialize,
      },
      materializeOutput,
      now: () => "2026-08-23T00:04:00.000Z",
    });

    await runner.start({ projectId: "project-1", operationId: "op-1" });
    await runner.poll({ projectId: "project-1", operationId: "op-1" });
    await expect(runner.materialize({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ artifactId: "asset-image-1", nextAction: "completed" });
    await expect(runner.materialize({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ artifactId: "asset-image-1", nextAction: "completed" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materializeOutput).toHaveBeenCalledTimes(1);
    expect(repository.read("project-1", "op-1")).toMatchObject({
      jobs: [{ status: "ready", providerTaskId: "provider-task-materialize" }],
      artifacts: [{ artifactId: "asset-image-1", jobId: expect.stringContaining("generation-op-1-") , kind: "image", status: "ready", contentHash: "c".repeat(64) }],
    });
    const jobId = repository.read("project-1", "op-1")!.jobs[0]!.jobId;
    expect(JSON.parse(fs.readFileSync(path.join(root, ".nomi", "runs", "op-1", "jobs", jobId, "runtime-envelope.json"), "utf8"))).toMatchObject({ state: "materialized" });
  });

  it("keeps a provider without materialization support usable but does not invent a local Artifact", async () => {
    const { root, repository } = setup();
    const materializeOutput = vi.fn();
    const runner = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
        buildRequest: (input) => input,
        submit: vi.fn(async () => ({ providerTaskId: "provider-task-no-materialize" })),
        query: vi.fn(async () => ({ status: "completed", raw: { result: { opaque: true } } })),
      },
      materializeOutput,
      now: () => "2026-08-23T00:05:00.000Z",
    });

    await runner.start({ projectId: "project-1", operationId: "op-1" });
    await runner.poll({ projectId: "project-1", operationId: "op-1" });
    await expect(runner.materialize({ projectId: "project-1", operationId: "op-1" })).rejects.toMatchObject({ code: "provider_materialization_unsupported" });
    expect(materializeOutput).not.toHaveBeenCalled();
    expect(repository.read("project-1", "op-1")?.artifacts).toHaveLength(0);
  });

  it("can resume after a crash before dispatch only with an explicit not-submitted disposition", async () => {
    const { root, repository } = setup();
    const beforeDispatch = vi.fn(() => { throw new Error("crash before dispatch"); });
    const firstSubmit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const first = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit: firstSubmit,
      },
      beforeDispatch,
      now: () => "2026-08-23T00:00:00.000Z",
    });
    await expect(first.start({ projectId: "project-1", operationId: "op-1" })).rejects.toThrow("crash before dispatch");
    expect(firstSubmit).not.toHaveBeenCalled();
    expect(repository.read("project-1", "op-1")).toMatchObject({ jobs: [{ status: "submit_intent_persisted" }] });

    const secondSubmit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const resumed = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit: secondSubmit,
      },
      now: () => "2026-08-23T00:01:00.000Z",
    });
    await expect(resumed.resume({ projectId: "project-1", operationId: "op-1", definitelyNotSubmitted: true })).resolves.toMatchObject({ action: "dispatch", providerTaskId: "provider-task-1" });
    expect(secondSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits even when a provider exposes no native recovery capabilities", async () => {
    const { root, repository, contract } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "should-not-run" }));
    const runner = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit,
      },
      now: () => "2026-08-23T00:00:00.000Z",
    });
    await expect(runner.start({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ providerTaskId: "should-not-run" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(repository.read("project-1", "op-1")).toMatchObject({ generationPlan: { contract: { contractHash: contract.contractHash } }, jobs: [{ status: "provider_accepted" }] });
  });

  it("keeps an unknown provider submission reconcile-only instead of creating another paid attempt", async () => {
    const { root, repository } = setup();
    const firstSubmit = vi.fn(async () => ({ providerTaskId: "provider-task-unknown" }));
    const provider: GenerationProvider = {
      providerId: "fixture-provider",
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
      buildRequest: (input) => input,
      submit: firstSubmit,
    };
    const first = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      projectRevision: 0,
      intentMacKey: "test-intent-key",
      provider,
      afterProviderAcceptance: () => { throw new Error("receipt lost after acceptance"); },
      now: () => "2026-08-23T00:00:00.000Z",
    });
    await expect(first.start({ projectId: "project-1", operationId: "op-1" })).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    const run = repository.read("project-1", "op-1")!;
    expect(() => prepareProductionGenerationReauthorization({
      lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0,
      run,
      providers: [provider],
      resolveShotPrice: () => ({ known: true, amount: 0 }),
      now: "2026-08-23T00:01:00.000Z",
    })).toThrow("previous generation attempt is not safely reworkable");
    expect(run.jobs).toEqual([expect.objectContaining({ status: "submission_unknown", attempt: 1 })]);
    expect(firstSubmit).toHaveBeenCalledTimes(1);
  });
});
