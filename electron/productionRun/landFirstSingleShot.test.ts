import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
// 新的单镜开拍口：appIntegration 与 mcpStdioServer 的单镜分支都只调它（以前两处各自直接 submission.start，
// GUI 那一处还是「先交、后落」：appIntegration 先 submission.start，再 landCanvasBestEffort）。
import { startSingleShotProduction } from "./singleShotProductionStart";

// 架构③ 合同 1 + 2（协调会话 10-08）：单镜与多镜同一条规矩——落地在派发之前；落地失败 = 不派发 = 停在「落地失败」。

const NOW = "2026-10-08T00:00:00.000Z";
const PROJECT = "project-1";
const RUN = "op-single-land-first";
const roots: string[] = [];

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "fixture-provider", models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}]);

const candidate = (): PlanCandidate => ({
  candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider", modelId: "fixture-model",
  mode: "text-to-image", prompt: "A paper boat on a quiet lake", parameters: { aspectRatio: "16:9" }, references: [],
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-single-land-first-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === PROJECT ? root : null),
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate();
  const contract = compileExecutionContract(planCandidate, registry);
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, origin: { host: "nomi" }, candidate: planCandidate,
    policy: { trustedHosts: ["nomi"], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"], maxSpend: 0, maxAttemptsPerJob: 2 },
  });
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: planCandidate, contract,
    providers: [{ providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true }, buildRequest: (input) => input, submit: async () => ({ providerTaskId: "unused" }) }],
    now: NOW,
  });
  return { root, repository };
}

type Repository = ReturnType<typeof createProductionRunRepository>;
type LandShots = (projectId: string, runId: string) => Promise<void>;

function submissionFor(root: string, repository: Repository, submit: ReturnType<typeof vi.fn>) {
  const provider: GenerationProvider = {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (input) => input,
    submit: submit as unknown as GenerationProvider["submit"],
  };
  return createProductionGenerationSubmission({
    repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    intentMacKey: "test-intent-key", provider, now: () => NOW,
  });
}

/** 渲染层落地成功：单镜的地址是候选 id，节点经同一条 `plan.bind-shot-nodes` 写回顶层 nodeId。 */
function landingThatBinds(repository: Repository, order: string[]): LandShots {
  return async (projectId, runId) => {
    order.push("land");
    const run = repository.read(projectId, runId)!;
    repository.execute(projectId, runId, {
      commandId: `test-land:${run.revision}`, expectedRevision: run.revision, type: "plan.bind-shot-nodes",
      payload: { bindings: [{ shotId: run.generationPlan!.candidate.candidateId, nodeId: "node-single" }] }, issuedAt: NOW,
    });
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("land first: a single-shot production run lands its node before the provider submit", () => {
  it("reported case: landing fails → zero provider submits, and the run rests in a retryable landing_failed stop", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const landShots = vi.fn<LandShots>(async () => { throw new Error("renderer_unavailable"); });

    const result = await startSingleShotProduction({ repository, submission: submissionFor(root, repository, submit), landShots, projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(landShots).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(0);
    expect(result).toMatchObject({ nextAction: "canvas_landing_failed" });
    const run = repository.read(PROJECT, RUN)!;
    expect(run.jobs.filter((job) => job.providerTaskId)).toEqual([]);
    expect(run.stop?.reason).toBe("landing_failed");
  });

  it("order: land → submission.start (call order, not wall clock); the node is bound when the provider is called", async () => {
    const { root, repository } = setup();
    const order: string[] = [];
    let nodeAtSubmit: string | undefined;
    const submit = vi.fn(async () => {
      order.push("submit");
      nodeAtSubmit = repository.read(PROJECT, RUN)!.generationPlan?.nodeId;
      return { providerTaskId: "provider-task-1" };
    });

    const result = await startSingleShotProduction({ repository, submission: submissionFor(root, repository, submit), landShots: landingThatBinds(repository, order), projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(order).toEqual(["land", "submit"]);
    expect(nodeAtSubmit).toBe("node-single");
    expect(result).toMatchObject({ nextAction: "observe" });
  });

  it("retry: the same start after a landing failure lands and dispatches exactly once", async () => {
    const { root, repository } = setup();
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));
    const submission = submissionFor(root, repository, submit);
    await startSingleShotProduction({ repository, submission, landShots: async () => { throw new Error("renderer_unavailable"); }, projectId: PROJECT, runId: RUN, now: () => NOW });
    const order: string[] = [];

    await startSingleShotProduction({ repository, submission, landShots: landingThatBinds(repository, order), projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(order).toEqual(["land"]);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("an already-landed single shot is not landed twice", async () => {
    const { root, repository } = setup();
    const order: string[] = [];
    await landingThatBinds(repository, order)(PROJECT, RUN);
    const landShots = vi.fn<LandShots>(async () => undefined);
    const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1" }));

    await startSingleShotProduction({ repository, submission: submissionFor(root, repository, submit), landShots, projectId: PROJECT, runId: RUN, now: () => NOW });

    expect(landShots).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
