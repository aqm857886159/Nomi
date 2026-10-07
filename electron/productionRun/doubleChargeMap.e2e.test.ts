import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// 双扣地图（施工计划 docs/plan/2026-10-05-engine-convergence-cut1.md §3）的五条路径，一处锁住——0.24 的发版条件。
// 画布与制作同一镜各花一次钱，只可能从这五条路钻出来；每一条在这里都走真实边界：画布那一侧经真实的画布付费口
// （appIntegrationCanvasShot：准入 → 认领 → 单镜 Run → 提交出口），制作那一侧经真实的调度器 / 提交出口 / 派发闸 / 仓库。
// 两边的供应商各是一个进程内计数器：断言的就是「这一镜，供应商一共收到几次」。

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { setupCanvasShots } from "../capabilityCore/canvasShotTestUtils";
import { detachShotNodesCommandId } from "../shared/productionRunCommandId";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { applyRunControl } from "./productionRunControl";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";

const NOW_BASE = Date.parse("2026-10-05T00:00:00.000Z");
const ELEVEN_MINUTES = 11 * 60 * 1000;
const PROJECT = "project-1";
const RUN = "op-batch";
const roots: string[] = [];
let clock = NOW_BASE;
const now = () => new Date(clock).toISOString();

const CAPS = { submitIdempotency: false, query: true, reconcile: true, cancel: true, materialize: true } as const;
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["image-to-video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: CAPS }] }],
}]);
type Repository = ReturnType<typeof createProductionRunRepository>;

/** 制作那一侧的供应商：`fail` 让它在写出去之后断（结果未知）。 */
function productionProvider(submits: string[], options: { fail?: boolean; settle?: boolean } = {}): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: CAPS,
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => {
      submits.push(idempotencyKey);
      if (options.fail) throw new Error("apimart create failed: socket hang up");
      return { providerTaskId: `task-${submits.length}`, raw: {} };
    },
    query: async (providerTaskId) => ({ status: options.settle === false ? "processing" : "succeeded", raw: { id: providerTaskId } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/${PROJECT}/${providerTaskId}.mp4` }] }),
  };
}

function shotEntry(shotId: string): ProductionGenerationShot {
  const candidate: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt: shotId, parameters: {}, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  return { shotId, candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

/** 一份制作批次：两镜。`approved` = 用户在付费卡上批过、计划已提交；否则卡还摆着等他点头。 */
function setup(options: { approved: boolean }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-double-charge-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (id) => (id === PROJECT ? root : null), now });
  const shots = ["shot-1", "shot-2"].map(shotEntry);
  const draftShots = shots.map(({ shotId, candidate }) => ({ shotId, candidate: { ...candidate, sealedContractHash: undefined } }));
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, origin: { host: "nomi" }, candidate: draftShots[0].candidate,
    shots: options.approved ? shots : draftShots,
    policy: { trustedHosts: ["nomi"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 3 },
  });
  if (options.approved) {
    sealAndApproveProductionGeneration({
      repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
      candidate: shots[0].candidate, contract: shots[0].contract!, providers: [productionProvider([])],
      multiShot: { shots, scope: shots.map((shot) => shot.shotId), planHash: "plan-hash-double-charge" },
      resolveShotPrice: () => ({ known: true, amount: 6 }), receiptId: "receipt-plan", now: now(),
    });
    const run = repository.read(PROJECT, RUN)!;
    repository.execute(PROJECT, RUN, { commandId: "submit", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() });
  }
  const canvas = setupCanvasShots({ root, repository, now });
  return { root, repository, canvas };
}

/** 制作那一侧的提交出口（含真实派发闸）。调度器经它交；「绕开调度器」的测试直接调它。 */
function productionSubmission(root: string, repository: Repository, provider: GenerationProvider) {
  return createProductionGenerationSubmission({
    repository,
    beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined }),
    projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key", provider,
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now,
  });
}

function scheduler(root: string, repository: Repository, provider: GenerationProvider, options: { maxShotsPerRun?: number; pollHorizonMs?: number } = {}) {
  const submission = productionSubmission(root, repository, provider);
  return createMultiShotBatchScheduler({ repository, submission, projectId: PROJECT, runId: RUN, now, options, sleep: async () => undefined });
}

const read = (repository: Repository): ProductionRun => repository.read(PROJECT, RUN)!;
const productionSubmitsFor = (repository: Repository, shotId: string) => read(repository).jobs.filter((job) => job.metadata?.shotId === shotId && job.status !== "authorized" && job.status !== "detached").length;
let canvasClicks = 0;
/** 用户在画布上对绑着这一镜的节点按 ↑（真实画布付费口）。 */
function canvasGenerates(canvas: ReturnType<typeof setupCanvasShots>, shotId: string) {
  canvasClicks += 1;
  return canvas.submit(`node-${shotId}`, `run-canvas-${canvasClicks}`, shotId, { productionRunId: RUN, productionShotId: shotId });
}
const canvasSendsFor = (canvas: ReturnType<typeof setupCanvasShots>, shotId: string) => canvas.vendor.executes.filter((call) => call.request.extras?.productionShotId === shotId).length;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
});

describe("双扣地图：同一镜，画布和制作合起来只花一次钱", () => {
  it("路径 1：批次停下后画布接手 shot-2，再点「继续」——制作一次都不派 shot-2", async () => {
    const { root, repository, canvas } = setup({ approved: true });
    const submits: string[] = [];
    let run = read(repository);
    run = repository.execute(PROJECT, RUN, { commandId: "batch-start", expectedRevision: run.revision, type: "run.status", payload: { status: "running" }, issuedAt: now() }).run;
    applyRunControl(repository, PROJECT, RUN, run, { commandId: "user-pause", expectedRevision: run.revision, type: "run.control", payload: { action: "pause" }, issuedAt: now() });

    await canvasGenerates(canvas, "shot-2");
    run = read(repository);
    applyRunControl(repository, PROJECT, RUN, run, { commandId: "user-resume", expectedRevision: run.revision, type: "run.control", payload: { action: "resume" }, issuedAt: now(), humanGesture: true });
    await scheduler(root, repository, productionProvider(submits)).runToQuiescence();

    expect(canvasSendsFor(canvas, "shot-2")).toBe(1);
    expect(productionSubmitsFor(repository, "shot-2")).toBe(0);
    expect(productionSubmitsFor(repository, "shot-1")).toBe(1);
  });

  // 派发闸（productionShotDispatchGuard）是交出去之前最后一道「按盘上最新的 Run 再判一次」：调度器挑中这一镜之后、
  // 交之前，他点了停（急停 / 暂停）——调度器的过滤已经过去了，只剩派发闸挡着。上面几条都先被调度器的过滤或
  // 任务状态（画布接手的镜已是 detached）挡住，派发闸改成「永不拒」它们照样绿；这一条绕开调度器、直接从提交出口交，
  // 派发闸必须拒，而且拒在任何耐久写之前（没有预留、没有提交意向、供应商一次都没收到）。
  it("派发闸：调度器挑中 shot-2 之后他点了停，直接从提交出口交 shot-2——派发闸拒，一个字节不发", async () => {
    const { root, repository } = setup({ approved: true });
    let run = read(repository);
    run = repository.execute(PROJECT, RUN, { commandId: "batch-start", expectedRevision: run.revision, type: "run.status", payload: { status: "running" }, issuedAt: now() }).run;
    applyRunControl(repository, PROJECT, RUN, run, { commandId: "user-pause", expectedRevision: run.revision, type: "run.control", payload: { action: "pause" }, issuedAt: now() });
    const shotTwo = () => read(repository).jobs.find((job) => job.metadata?.shotId === "shot-2");
    const statusBefore = shotTwo()?.status;

    const submits: string[] = [];
    await expect(productionSubmission(root, repository, productionProvider(submits)).start({ projectId: PROJECT, operationId: RUN, shotId: "shot-2" }))
      .rejects.toMatchObject({ code: "production_shot_claimed", reason: "run_stopped" });

    expect(submits).toEqual([]);
    expect(shotTwo()?.status).toBe(statusBefore);
    expect(repository.readBudgetLedger(PROJECT, RUN).reservations).toEqual({});
  });

  it("路径 2：付费卡还摆着等他点头时在画布上生成这一镜——画布被拒，一个字节不发", async () => {
    const { repository, canvas } = setup({ approved: false });
    expect(read(repository).generationPlan?.presentations?.at(-1)?.closed).toBeUndefined();

    await expect(canvasGenerates(canvas, "shot-2")).rejects.toMatchObject({ code: "production_shot_claimed", reason: "awaiting_confirmation" });
    expect(canvas.vendor.executes).toHaveLength(0);
  });

  it("路径 3：删掉镜头节点之后——调度器照样跑完别的镜，被删的那一镜一次都不派", async () => {
    const { root, repository } = setup({ approved: true });
    const submits: string[] = [];
    let run = read(repository);
    run = repository.execute(PROJECT, RUN, { commandId: "bind", expectedRevision: run.revision, type: "plan.bind-shot-nodes", payload: { bindings: [{ shotId: "shot-1", nodeId: "node-1" }, { shotId: "shot-2", nodeId: "node-2" }] }, issuedAt: now() }).run;
    repository.execute(PROJECT, RUN, { commandId: detachShotNodesCommandId(RUN, ["node-2"], run.revision), expectedRevision: run.revision, type: "plan.detach-shot-nodes", payload: { nodeIds: ["node-2"] }, issuedAt: now() });

    await scheduler(root, repository, productionProvider(submits)).runToQuiescence();

    expect(productionSubmitsFor(repository, "shot-2")).toBe(0);
    expect(productionSubmitsFor(repository, "shot-1")).toBe(1);
  });

  it("路径 4a：制作已经写出去、结果不明——画布对这一镜按 ↑ 被拒（先核对），不会再花一次", async () => {
    const { root, repository, canvas } = setup({ approved: true });
    const submits: string[] = [];
    await scheduler(root, repository, productionProvider(submits, { fail: true })).runToQuiescence();
    expect(read(repository).jobs.find((job) => job.metadata?.shotId === "shot-1")?.status).toBe("submission_unknown");

    await expect(canvasGenerates(canvas, "shot-1")).rejects.toMatchObject({ code: "production_shot_claimed", reason: "needs_reconcile" });
    expect(canvas.vendor.executes).toHaveLength(0);
    expect(submits.filter((key) => key.includes("shot-1"))).toHaveLength(1);
  });

  it("路径 4b：制作交出去了、还在生成——画布对这一镜按 ↑ 被拒（还在生成），不会再花一次", async () => {
    const { root, repository, canvas } = setup({ approved: true });
    const submits: string[] = [];
    await scheduler(root, repository, productionProvider(submits, { settle: false }), { pollHorizonMs: 0 }).runToQuiescence();
    expect(read(repository).jobs.find((job) => job.metadata?.shotId === "shot-1")?.status).toMatch(/provider_accepted|polling/);

    await expect(canvasGenerates(canvas, "shot-1")).rejects.toMatchObject({ code: "production_shot_claimed", reason: "in_flight" });
    expect(canvas.vendor.executes).toHaveLength(0);
    expect(submits.filter((key) => key.includes("shot-1"))).toHaveLength(1);
  });

  it("路径 5：批次停在「需要处理」（同意过期）——调度器不派剩下的镜，直到他再点一次", async () => {
    const { root, repository } = setup({ approved: true });
    const submits: string[] = [];
    await scheduler(root, repository, productionProvider(submits), { maxShotsPerRun: 1 }).runToQuiescence();
    clock += ELEVEN_MINUTES;
    await scheduler(root, repository, productionProvider(submits)).runToQuiescence();
    expect(read(repository)).toMatchObject({ status: "needs_attention", stop: { reason: "consent_expired" } });
    await scheduler(root, repository, productionProvider(submits)).runToQuiescence();

    expect(submits).toHaveLength(1);
    expect(productionSubmitsFor(repository, "shot-2")).toBe(0);
  });
});
