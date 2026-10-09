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
import { landedAdmission } from "./landFirstTestUtils";

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
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit,
      },
      now: () => "2026-08-23T00:00:00.000Z",
    });

    await expect(first.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).resolves.toMatchObject({
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
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit: restartedSubmit,
      },
      now: () => "2026-08-23T00:01:00.000Z",
    });
    expect(restarted.observeAccepted({ projectId: "project-1", operationId: "op-1" })).toMatchObject({
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
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
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

    await expect(first.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(repository.read("project-1", "op-1")).toMatchObject({ jobs: [{ status: "submission_unknown" }] });
    const unknownRun = repository.read("project-1", "op-1")!;
    expect(() => repository.execute("project-1", "op-1", { commandId: "unknown-next-batch", expectedRevision: unknownRun.revision,
      type: "generation.present", payload: {}, issuedAt: "2026-08-23T00:00:00.000Z" })).toThrow(/reconciliation_required/);
    expect(repository.read("project-1", "op-1")).toEqual(unknownRun);


    const restartedSubmit = vi.fn(async () => ({ providerTaskId: "provider-task-2" }));
    const restarted = createProductionGenerationSubmission({
      repository,
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
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
    await expect(restarted.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).rejects.toBeInstanceOf(SubmissionReconciliationRequiredError);
    expect(restartedSubmit).not.toHaveBeenCalled();
  });

  it("submits an observe-only provider once; observing the accepted job answers with the same provider task id (no token, no second submit)", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-observe-only" }));
    const runner = createProductionGenerationSubmission({
      repository,
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
        buildRequest: (input) => input,
        submit,
      },
      now: () => "2026-08-23T00:00:00.000Z",
    });

    await expect(runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).resolves.toMatchObject({ providerTaskId: "provider-task-observe-only" });
    expect(runner.observeAccepted({ projectId: "project-1", operationId: "op-1" })).toMatchObject({ nextAction: "observe", providerTaskId: "provider-task-observe-only" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("records a provider poll durably without submitting again", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-poll" }));
    const query = vi.fn(async (providerTaskId: string) => ({ status: "processing", raw: { taskId: providerTaskId, progress: 42 } }));
    const runner = createProductionGenerationSubmission({
      repository,
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
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

    await runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
    await expect(runner.poll({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({
      providerTaskId: "provider-task-poll",
      providerStatus: "processing",
      nextAction: "poll",
    });
    // 查询带着这笔任务冻结合同里的模型 / 模式（供应商实例是每次新建的，它自己记不住）。
    expect(query).toHaveBeenCalledWith("provider-task-poll", { modelId: "fixture-model", mode: "text-to-image", parameters: { aspectRatio: "16:9" } });
    expect(submit).toHaveBeenCalledTimes(1);
    const job = repository.read("project-1", "op-1")?.jobs[0];
    expect(job).toMatchObject({ status: "polling", providerTaskId: "provider-task-poll", providerStatus: "processing" });
    const envelopePath = path.join(root, ".nomi", "runs", "op-1", "jobs", job!.jobId, "runtime-envelope.json");
    expect(JSON.parse(fs.readFileSync(envelopePath, "utf8"))).toMatchObject({ lastPoll: { status: "processing", raw: { progress: 42 } } });
  });

  it("a fresh submission (re-kick / reopen / restart) polls with the durable model identity, never re-submits", async () => {
    const { root, repository } = setup();
    const deps = {
      repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
      intentMacKey: "test-intent-key", now: () => "2026-08-23T00:03:00.000Z",
    };
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-late" }));
    const provider = (query?: GenerationProvider["query"]): GenerationProvider => ({
      providerId: "fixture-provider",
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
      buildRequest: (input) => input,
      submit,
      ...(query ? { query } : {}),
    });
    await createProductionGenerationSubmission({ ...deps, provider: provider() }).start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
    // 观察窗过了：一个**全新的**提交门面 + 全新的供应商实例（它没交过这笔任务，内存里什么都没记）。
    const query = vi.fn(async (_taskId: string, context?: { modelId?: string; mode?: string }) => (
      context?.modelId ? { status: "processing" } : Promise.reject(new Error("cannot poll task without the model it was submitted with"))
    ));
    await expect(createProductionGenerationSubmission({ ...deps, provider: provider(query) }).poll({ projectId: "project-1", operationId: "op-1" }))
      .resolves.toMatchObject({ providerTaskId: "provider-task-late", nextAction: "poll" });
    expect(query).toHaveBeenCalledWith("provider-task-late", { modelId: "fixture-model", mode: "text-to-image", parameters: { aspectRatio: "16:9" } });
    expect(submit).toHaveBeenCalledTimes(1);
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
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
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

    await runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
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
      width: 1600,
      height: 900,
    }));
    const runner = createProductionGenerationSubmission({
      repository,
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
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

    await runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
    await runner.poll({ projectId: "project-1", operationId: "op-1" });
    await expect(runner.materialize({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ artifactId: "asset-image-1", nextAction: "completed" });
    await expect(runner.materialize({ projectId: "project-1", operationId: "op-1" })).resolves.toMatchObject({ artifactId: "asset-image-1", nextAction: "completed" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materializeOutput).toHaveBeenCalledTimes(1);
    expect(repository.read("project-1", "op-1")).toMatchObject({
      jobs: [{ status: "ready", providerTaskId: "provider-task-materialize" }],
      artifacts: [{ artifactId: "asset-image-1", jobId: expect.stringContaining("generation-op-1-") , kind: "image", status: "ready", contentHash: "c".repeat(64), width: 1600, height: 900 }],
    });
    const jobId = repository.read("project-1", "op-1")!.jobs[0]!.jobId;
    expect(JSON.parse(fs.readFileSync(path.join(root, ".nomi", "runs", "op-1", "jobs", jobId, "runtime-envelope.json"), "utf8"))).toMatchObject({ state: "materialized" });
  });

  it("keeps a provider without materialization support usable but does not invent a local Artifact", async () => {
    const { root, repository } = setup();
    const materializeOutput = vi.fn();
    const runner = createProductionGenerationSubmission({
      repository,
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
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

    await runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
    await runner.poll({ projectId: "project-1", operationId: "op-1" });
    await expect(runner.materialize({ projectId: "project-1", operationId: "op-1" })).rejects.toMatchObject({ code: "provider_materialization_unsupported" });
    expect(materializeOutput).not.toHaveBeenCalled();
    expect(repository.read("project-1", "op-1")?.artifacts).toHaveLength(0);
  });

  // 预留 → 提交意向 → 提交中是一次落盘（发动机收敛第一刀第 3 步的性能尾巴）：进程在这一批写下之前倒下 = 盘上什么都没有，
  // 重来一次照常交、只交一次。旧版本留下的「提交意向已落盘、还没开始提交」（中间那一步的停点）同样照常交一次——
  // 交出去之前还会先落提交意向日志；日志里已经 committed 的那种才是「可能已交」，那条路由出口记成结果未知（另有测试）。
  // 以前这里靠 resume(definitelyNotSubmitted) 放行；那条路在生产里没有任何调用方，随第 4 步删除。
  it("a crash before the pre-dispatch batch is written leaves nothing behind; starting again dispatches exactly once", async () => {
    const { root, repository } = setup();
    const crashing = {
      ...repository,
      executeBatch: (...args: Parameters<typeof repository.executeBatch>) => {
        if (args[3].some((command) => command.type === "job.status" && command.payload.status === "submitting")) throw new Error("crash before dispatch");
        return repository.executeBatch(...args);
      },
    };
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const make = (repo: typeof repository) => createProductionGenerationSubmission({
      repository: repo,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider: { providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true }, buildRequest: (input) => input, submit },
      beforeDispatch: () => undefined,
      now: () => "2026-08-23T00:00:00.000Z",
    });
    await expect(make(crashing).start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).rejects.toThrow("crash before dispatch");
    expect(submit).not.toHaveBeenCalled();
    expect(repository.read("project-1", "op-1")).toMatchObject({ jobs: [{ status: "authorized" }] });
    expect(repository.readBudgetLedger("project-1", "op-1").reservations).toEqual({});

    await expect(make(repository).start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).resolves.toMatchObject({ providerTaskId: "provider-task-1" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("an older build's stop between the submit intent and submitting dispatches exactly once", async () => {
    const { root, repository } = setup();
    const run = repository.read("project-1", "op-1")!;
    const job = run.jobs[0]!;
    repository.execute("project-1", "op-1", { commandId: `${run.runId}:${job.jobId}:${job.attempt}:submit-intent`, expectedRevision: run.revision, type: "job.status", payload: { jobId: job.jobId, status: "submit_intent_persisted", patch: {} }, issuedAt: "2026-08-23T00:00:00.000Z" });
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const runner = createProductionGenerationSubmission({
      repository,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider: { providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true }, buildRequest: (input) => input, submit },
      beforeDispatch: () => undefined,
      now: () => "2026-08-23T00:01:00.000Z",
    });
    await expect(runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).resolves.toMatchObject({ providerTaskId: "provider-task-1" });
    expect(runner.observeAccepted({ projectId: "project-1", operationId: "op-1" })).toMatchObject({ providerTaskId: "provider-task-1" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  // 受理之后原来是三次整份落盘（已受理 → 计划已交 → 单镜 Run 进行中，后两次由各个调用方各自补）；现在是一次，
  // 而且「进行中」只有提交出口这一处写（GUI、stdio、画布不再各自补一笔）。
  it("records acceptance, the submitted plan and the running single-shot Run in one write", async () => {
    const { root, repository } = setup();
    const batches: string[][] = [];
    const observed = {
      ...repository,
      executeBatch: (...args: Parameters<typeof repository.executeBatch>) => {
        batches.push(args[3].map((command) => `${command.type}:${String(command.payload.status ?? "")}`));
        return repository.executeBatch(...args);
      },
    };
    const runner = createProductionGenerationSubmission({
      repository: observed,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider: { providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true }, buildRequest: (input) => input, submit: async () => ({ providerTaskId: "provider-task-1" }) },
      beforeDispatch: () => undefined,
      now: () => "2026-08-23T00:00:00.000Z",
    });
    await runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
    expect(batches.at(-1)).toEqual(["job.status:provider_accepted", "generation.submit:", "run.status:running"]);
    expect(repository.read("project-1", "op-1")).toMatchObject({ status: "running", generationPlan: { state: "submitted" }, jobs: [{ status: "provider_accepted" }] });
  });

  it("submits even when a provider exposes no native recovery capabilities", async () => {
    const { root, repository, contract } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "should-not-run" }));
    const runner = createProductionGenerationSubmission({
      repository,
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider: {
        providerId: "fixture-provider",
        capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: true },
        buildRequest: (input) => input,
        submit,
      },
      now: () => "2026-08-23T00:00:00.000Z",
    });
    await expect(runner.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).resolves.toMatchObject({ providerTaskId: "should-not-run" });
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
      beforeDispatch: () => undefined,
      projectRoot: root,
      immutableProjectUuid: "project-uuid-1",
      projectGeneration: 1,
      intentMacKey: "test-intent-key",
      provider,
      afterProviderAcceptance: () => { throw new Error("receipt lost after acceptance"); },
      now: () => "2026-08-23T00:00:00.000Z",
    });
    await expect(first.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") })).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
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


describe("historical batch observation", () => {
  it("reads the frozen execution after a new draft and never starts the old authority", async () => {
    const { root, repository, contract } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "historical-task" }));
    const materializeOutput = vi.fn(async (_input: { contract: unknown }) => ({ artifactId: "historic-artifact", kind: "image" as const, contentHash: "hash", projectRelativePath: "out.png" }));
    const submission = createProductionGenerationSubmission({
      repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key", now: () => "2026-08-23T00:00:00.000Z", materializeOutput,
      provider: { providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
        buildRequest: input => input, submit, query: async () => ({ status: "succeeded", raw: {} }),
        materialize: async () => ({ outputs: [{ kind: "image", url: "https://fixture.invalid/out.png" }] }) },
    });
    const input = { projectId: "project-1", operationId: "op-1", attempt: 1 };
    const started = await submission.start({ ...input, admission: await landedAdmission(repository, input.projectId, input.operationId) });
    await submission.poll(input);
    await submission.materialize(input);
    const run = repository.read(input.projectId, input.operationId)!;
    repository.execute(input.projectId, input.operationId, { commandId: "next-batch", expectedRevision: run.revision,
      type: "generation.present", payload: {}, issuedAt: "2026-08-23T00:00:00.000Z" });
    expect(repository.read(input.projectId, input.operationId)!.generationPlan!.contract).toBeUndefined();
    await expect(submission.poll(input)).resolves.toMatchObject({ jobId: started.jobId, nextAction: "materialize" });
    await expect(submission.materialize(input)).resolves.toMatchObject({ jobId: started.jobId, artifactId: "historic-artifact" });
    await expect(submission.start({ ...input, admission: await landedAdmission(repository, input.projectId, input.operationId) })).rejects.toThrow(/Seal and confirm/);
    expect(materializeOutput.mock.calls[0][0].contract).toEqual(contract);
    expect(materializeOutput).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
