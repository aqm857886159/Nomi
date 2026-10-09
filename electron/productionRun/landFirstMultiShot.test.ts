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
import { landBatchBeforeKick } from "../capabilityCore/appIntegrationLandFirst";
import { safeRunProjection } from "./productionRunProjections";
import { buildToolOutcome } from "../capabilityCore/mcpToolResults";
import { shotLandingFacts } from "./shotLandingAdmission";

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

// #1139 对抗评审 B1，协调会话裁决：按镜头算，不整批拦。已落下、已批的兄弟镜照常派发；没落下的那镜派发 0 次、可重试。
// 但用户看到的话必须和真实派发一致：一镜都没发出时才说「这次没有发出生成请求」；部分落下时逐镜说「哪几镜发出了、哪几镜没放上（没发）」。
describe("partial landing is per shot: the words match what was really sent", () => {
  // 渲染层这一次只落下了 shot-a（另一镜没建出来）：正常返回、只回报 shot-a 的绑定——与 materializeShots 部分落地同形。
  // （落地器抛错时，这一次要落的镜一律不算落好——那是租约在绑定之后失效那一种，见 landFirstProjectAccess。）
  const partialLanding = (repository: Repository): LandShots => async (projectId, runId) => {
    const run = repository.read(projectId, runId)!;
    if (run.generationPlan!.shots!.find((shot) => shot.shotId === "shot-a")?.nodeId) return;
    repository.execute(projectId, runId, { commandId: `partial:${run.revision}`, expectedRevision: run.revision, type: "plan.bind-shot-nodes", payload: { bindings: [{ shotId: "shot-a", nodeId: "node-shot-a" }] }, issuedAt: NOW });
  };

  it("start report: 1 placed + 1 not placed → not the whole-batch canvas_landing_failed; the per-shot notice counts exactly the shots the scheduler then sends", async () => {
    const { root, repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b")]);
    const submit = vi.fn(async () => ({ providerTaskId: `task-${submit.mock.calls.length}` }));
    const landShots = partialLanding(repository);

    const report = await landBatchBeforeKick({ repository, landShots, projectId: PROJECT, runId: RUN });
    await scheduler(root, repository, submit, landShots).runToQuiescence();

    expect(report).toMatchObject({ allNotPlaced: false, shotsPlaced: ["shot-a"], shotsNotPlaced: ["shot-b"] });
    expect(submit).toHaveBeenCalledTimes(report!.shotsPlaced.length);
    // 入口当场回这一句时调度器和供应商都还没跑：说「已放到画布、开始生成」，不说「已发出」（第二轮复审）。
    expect(report!.notice).toContain("已放到画布、开始生成 1 镜：第 1 镜");
    expect(report!.notice).not.toContain("已发出");
    expect(report!.notice).not.toContain("并发出");
    expect(report!.notice).toContain("有 1 镜没放到画布上，没有发出：第 2 镜");
    expect(report!.notice).not.toContain("这次没有发出生成请求");

    // Agent 读 Run：逐镜事实与真实派发一致（sent = 真交出去的那一镜）。
    const run = repository.read(PROJECT, RUN)!;
    expect(run.stop?.reason).toBe("landing_failed");
    const projection = safeRunProjection(run);
    expect(projection.landing).toEqual({ sent: [{ shotId: "shot-a", index: 1 }], notPlaced: [{ shotId: "shot-b", index: 2 }], removed: [] });
    const zh = buildToolOutcome("nomi_read", { target: "run", projectId: PROJECT, runId: RUN }, projection).text;
    expect(zh).toContain("已放到画布并发出：第 1 镜");
    expect(zh).toContain("没放到画布上、没有发出：第 2 镜");
    expect(zh).not.toContain("这次没有发出生成请求");
    const en = buildToolOutcome("nomi_read", { target: "run", projectId: PROJECT, runId: RUN }, projection, "en").text;
    expect(en).toContain("Placed and sent: shot 1");
    expect(en).toContain("Not placed on the canvas and not sent: shot 2");
  });

  it("whole batch not placed → canvas_landing_failed, and only then the notice says no request was sent", async () => {
    const { root, repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b")]);
    const submit = vi.fn(async () => ({ providerTaskId: "unused" }));
    const landShots: LandShots = async () => { throw new Error("storyboard_project_changed"); };

    const report = await landBatchBeforeKick({ repository, landShots, projectId: PROJECT, runId: RUN });
    await scheduler(root, repository, submit, landShots).runToQuiescence();

    expect(report).toMatchObject({ allNotPlaced: true, shotsPlaced: [] });
    expect(report!.notice).toContain("这次没有发出生成请求");
    expect(submit).toHaveBeenCalledTimes(0);
    const projection = safeRunProjection(repository.read(PROJECT, RUN)!);
    expect(buildToolOutcome("nomi_read", { target: "run", projectId: PROJECT, runId: RUN }, projection).text).toContain("这次没有发出生成请求");
  });

  it("retry after a partial landing sends only the shot that was not placed", async () => {
    const { root, repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b")]);
    const submits: string[] = [];
    const submit = vi.fn(async () => { submits.push(`task-${submits.length + 1}`); return { providerTaskId: submits.at(-1)! }; });
    await scheduler(root, repository, submit, partialLanding(repository)).runToQuiescence();
    const firstShots = repository.read(PROJECT, RUN)!.jobs.filter((job) => job.providerTaskId).map((job) => job.metadata?.shotId);
    expect(firstShots).toEqual(["shot-a"]);

    const stopped = repository.read(PROJECT, RUN)!;
    repository.execute(PROJECT, RUN, { commandId: `resume:${stopped.revision}`, expectedRevision: stopped.revision, type: "run.status", payload: { status: "running" }, issuedAt: NOW });
    await scheduler(root, repository, submit, landingThatBinds(repository, [])).runToQuiescence();

    const sentShots = repository.read(PROJECT, RUN)!.jobs.filter((job) => job.providerTaskId).map((job) => job.metadata?.shotId);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(sentShots.filter((shotId) => shotId === "shot-a")).toHaveLength(1);
    expect(sentShots.filter((shotId) => shotId === "shot-b")).toHaveLength(1);
  });
});

// 第二轮复审：Agent 读 Run 时「发出了」只认唯一判据 jobMayHaveReachedProvider——没写出去（provider_not_reached）、
// 当场被拒（provider_rejected）、同意过期没发（停在 authorized）都不算已发，不另写一套。
describe("what counts as sent is the one shared judgement", () => {
  it("provider_not_reached / provider_rejected / still authorized are never reported as sent", async () => {
    const { repository } = setupBatch([shotEntry("shot-a", "a"), shotEntry("shot-b", "b"), shotEntry("shot-c", "c")]);
    await landingThatBinds(repository, [])(PROJECT, RUN);
    const run = repository.read(PROJECT, RUN)!;
    const jobOf = (shotId: string) => run.jobs.find((job) => job.metadata?.shotId === shotId)!;
    const patched = { ...run, status: "needs_attention" as const, stop: { reason: "landing_failed" as const, at: NOW }, jobs: run.jobs.map((job) =>
      job === jobOf("shot-a") ? { ...job, status: "needs_attention" as const, errorCode: "provider_not_reached" }
        : job === jobOf("shot-b") ? { ...job, status: "needs_attention" as const, errorCode: "provider_rejected" }
          : job) };

    expect(shotLandingFacts(patched).sent).toEqual([]);
    const projection = safeRunProjection(patched);
    expect(projection.landing?.sent).toEqual([]);
    const zh = buildToolOutcome("nomi_read", { target: "run", projectId: PROJECT, runId: RUN }, projection).text;
    expect(zh).not.toContain("并发出");
    expect(zh).not.toContain("已发出");
  });
});
