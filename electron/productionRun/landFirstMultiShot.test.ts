import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { retryLiftsStop } from "./productionRunLifecycle";
import type { ProductionGenerationShot, ProductionRunStopReason } from "./productionRunTypes";

// 架构③ 合同 1（协调会话 10-08）：制作流程多镜派发前必须有已落地的节点。落地失败 = 不派发 = 这一批停在
// 「落地失败」（可重试、不扣钱）。以前确认那一下只做 best-effort 预落地，落不下照样派（appIntegration 的
// landCanvasBestEffort + 调度器从不看节点）；钱花了、画布上没有这一镜。
//
// 这里走真仓库 + 假供应商（零额度）。「派发次数」数的是供应商 submit 被调了几次——那一下才是花钱。
// 调度器拿一个必填的「落画布」依赖（`landShots`）：它不负责怎么落（主进程 → 渲染层那条 materialize-shots），
// 只负责「没落下来就不派」。

const NOW = "2026-10-08T00:00:00.000Z";
const PROJECT = "project-1";
const RUN = "op-land-first";
const roots: string[] = [];

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image", "video"],
  modes: ["image-to-video"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "apimart",
    models: [{ modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }],
  }],
}]);

function candidate(candidateId: string, prompt: string): PlanCandidate {
  return { candidateId, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt, parameters: { aspectRatio: "9:16" }, references: [] };
}

function shotEntry(shotId: string, prompt: string): ProductionGenerationShot {
  const cand = candidate(`cand-${shotId}`, prompt);
  const contract = compileExecutionContract(cand, registry);
  return { shotId, candidate: { ...cand, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: NOW };
}

function setupBatch(shots: ProductionGenerationShot[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-land-first-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === PROJECT ? root : null),
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, shots,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 2 },
  });
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: shots[0].candidate, contract: shots[0].contract!,
    providers: [{ providerId: "apimart", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true }, buildRequest: (input) => input, submit: async () => ({ providerTaskId: "unused" }) }],
    multiShot: { shots, scope: shots.map((shot) => shot.shotId), planHash: "plan-hash-land-first" },
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    receiptId: "receipt-plan",
    now: NOW,
  });
  const sealed = repository.read(PROJECT, RUN)!;
  repository.execute(PROJECT, RUN, { commandId: `generation.submit:${RUN}`, expectedRevision: sealed.revision, type: "generation.submit", payload: {}, issuedAt: NOW });
  return { root, repository };
}

function mockProvider(submit: ReturnType<typeof vi.fn>): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: submit as unknown as GenerationProvider["submit"],
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ url: `nomi-local://asset/${PROJECT}/${providerTaskId}.mp4`, kind: "video" as const }] }),
  };
}

type Repository = ReturnType<typeof createProductionRunRepository>;
type LandShots = (projectId: string, runId: string) => Promise<void>;

function scheduler(root: string, repository: Repository, submit: ReturnType<typeof vi.fn>, landShots: LandShots) {
  const submission = createProductionGenerationSubmission({
    repository,
    beforeDispatch: () => undefined,
    projectRoot: root,
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    intentMacKey: "test-intent-key",
    provider: mockProvider(submit),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now: () => NOW,
  });
  // `landShots` 是调度器的必填依赖（合同 2：多镜与单镜走同一个落地准入点）。
  return createMultiShotBatchScheduler({ repository, submission, projectId: PROJECT, runId: RUN, now: () => NOW, landShots } as Parameters<typeof createMultiShotBatchScheduler>[0]);
}

/** 渲染层落地成功的样子：每一镜拿到一个真节点，经 `plan.bind-shot-nodes` 写回 Run（与生产落地同一条命令）。 */
function landingThatBinds(repository: Repository, order: string[]): LandShots {
  return async (projectId, runId) => {
    order.push("land");
    const run = repository.read(projectId, runId)!;
    const bindings = (run.generationPlan?.shots ?? []).map((shot) => ({ shotId: shot.shotId, nodeId: `node-${shot.shotId}` }));
    repository.execute(projectId, runId, { commandId: `test-land:${run.revision}`, expectedRevision: run.revision, type: "plan.bind-shot-nodes", payload: { bindings }, issuedAt: NOW });
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("land first: a multi-shot production batch never dispatches a shot that has no canvas node", () => {
  it("reported case: landing fails → zero provider submits, and the batch rests in a retryable landing_failed stop", async () => {
    const { root, repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b")]);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length + 1}` }));
    const landShots = vi.fn<LandShots>(async () => { throw Object.assign(new Error("storyboard_project_unavailable"), { code: "storyboard_project_unavailable" }); });

    await scheduler(root, repository, submit, landShots).runToQuiescence();

    expect(landShots).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(0);
    const run = repository.read(PROJECT, RUN)!;
    expect(run.jobs.filter((job) => job.status !== "planned" && job.status !== "authorized")).toEqual([]);
    expect(run.status).toBe("needs_attention");
    expect(run.stop?.reason).toBe("landing_failed");
    // 「可重试」= 用户点「继续」/ 重做这一镜时，这次停下随之解除（生命周期 owner 判）。
    expect(retryLiftsStop("landing_failed" as ProductionRunStopReason)).toBe(true);
  });

  it("order: every shot is bound to a node before the first provider submit (call order, not wall clock)", async () => {
    const { root, repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b")]);
    const order: string[] = [];
    const nodesAtSubmit: Array<string | undefined> = [];
    const submit = vi.fn(async () => {
      order.push("submit");
      const run = repository.read(PROJECT, RUN)!;
      nodesAtSubmit.push(...(run.generationPlan?.shots ?? []).map((shot) => shot.nodeId));
      return { providerTaskId: `task-${submit.mock.calls.length}` };
    });

    await scheduler(root, repository, submit, landingThatBinds(repository, order)).runToQuiescence();

    expect(order[0]).toBe("land");
    expect(order.filter((step) => step === "submit")).toHaveLength(2);
    expect(nodesAtSubmit.every(Boolean)).toBe(true);
  });

  it("retry: after a landing failure, resuming lands then dispatches each shot exactly once", async () => {
    const { root, repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b")]);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length}` }));
    await scheduler(root, repository, submit, async () => { throw new Error("renderer_unavailable"); }).runToQuiescence();
    expect(submit).toHaveBeenCalledTimes(0);

    // 用户点「继续」：resumeProductionBatch 的 run.control resume 落到仓库就是这一步（needs_attention → running）。
    const stopped = repository.read(PROJECT, RUN)!;
    repository.execute(PROJECT, RUN, { commandId: `resume:${stopped.revision}`, expectedRevision: stopped.revision, type: "run.status", payload: { status: "running" }, issuedAt: NOW });
    const order: string[] = [];
    await scheduler(root, repository, submit, landingThatBinds(repository, order)).runToQuiescence();

    expect(order[0]).toBe("land");
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("class: a shot the landing could not bind (others did) is not dispatched; the batch still rests in landing_failed", async () => {
    const { root, repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b")]);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length}` }));
    const partial: LandShots = async (projectId, runId) => {
      const run = repository.read(projectId, runId)!;
      repository.execute(projectId, runId, { commandId: `partial:${run.revision}`, expectedRevision: run.revision, type: "plan.bind-shot-nodes", payload: { bindings: [{ shotId: "shot-a", nodeId: "node-shot-a" }] }, issuedAt: NOW });
    };

    await scheduler(root, repository, submit, partial).runToQuiescence();

    const run = repository.read(PROJECT, RUN)!;
    const dispatchedShots = run.jobs.filter((job) => job.providerTaskId).map((job) => job.metadata?.shotId);
    expect(dispatchedShots).not.toContain("shot-b");
    expect(run.stop?.reason).toBe("landing_failed");
  });
});
