import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { setupCanvasShots } from "../capabilityCore/canvasShotTestUtils";
import { decideShotClaim } from "../shared/decideShotClaim";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { prepareProductionGenerationAuthorization, prepareProductionGenerationReauthorization } from "./prepareProductionGenerationAuthorization";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";
import { landingThatBinds } from "./landFirstTestUtils";
import { waitForProduction } from "./productionRunTestHelpers";

// 同一镜只交一次——外部宿主（MCP：origin.host ≠ nomi）起的制作批次那一侧，入口 × 时刻的特征表（I-double-submit-probe，2026-10-28）。
//
// 外部宿主的出价照旧走制作流程自己的付费门与逐镜**顺序**派发的调度器（multiShotBatchScheduler），不经 Agent 面板的卡。
// #875 的规矩在这里最原样：一镜归了制作流程（门在等人 / 已授权排队 / 提交中 / 生成中），画布再发就是同一镜两笔。
// 每一格走真实边界：画布那一侧经真实的画布付费口（准入 → 认领 → 单镜 Run → 提交出口），制作那一侧经真实的调度器 / 提交出口 /
// 派发闸 / 仓库。断言只认一样东西：**这一镜两边的供应商合起来一共收到几份请求**。
//
// 三个时刻（门是外部宿主自己的确认；画布那一侧看到的就是「这一镜归制作流程」）：
//   M1 报价在等人（付费门封好、等批）；
//   M2 已授权排队、还没轮到（批了、提交了，调度器卡在前一镜的受理上，这一镜作业停在 authorized）；
//   M3 提交 / 生成中（M3a 交的那一下还在供应商门口；M3b 供应商已受理、还在生成）。

const NOW_BASE = Date.parse("2026-10-28T00:00:00.000Z");
const PROJECT = "project-1";
const RUN = "op-external";
const HOST = "semantic-mcp";
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

/** 制作那一侧的供应商：每一次 submit 记下它属于哪一镜（幂等键里带着镜号）。`hold` 扣住受理；`settle: false` = 受理之后一直在生成。 */
function productionProvider(submits: string[], options: { hold?: Promise<void>; settle?: boolean } = {}): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: CAPS,
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => {
      submits.push(idempotencyKey);
      if (options.hold) await options.hold;
      return { providerTaskId: `task-${submits.length}`, raw: {} };
    },
    query: async (providerTaskId) => ({ status: options.settle === false ? "processing" : "succeeded", raw: { id: providerTaskId } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/${PROJECT}/${providerTaskId}.mp4` }] }),
  };
}

function shotEntry(shotId: string): ProductionGenerationShot {
  const candidate: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt: shotId, parameters: {}, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  return { shotId, candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, updatedAt: now() };
}

/** 外部宿主的两镜草稿 → 封门（等宿主那边批）。`approve` = 宿主那边批了，再提交（作业落成 authorized，交给调度器）。 */
function setup(options: { approve: boolean }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-same-shot-external-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (id) => (id === PROJECT ? root : null), now });
  const shots = ["shot-1", "shot-2"].map(shotEntry);
  repository.createGenerationDraft({
    operationId: RUN, projectId: PROJECT, origin: { host: HOST }, candidate: { ...shots[0].candidate, sealedContractHash: undefined },
    shots: shots.map(({ shotId, candidate }) => ({ shotId, candidate: { ...candidate, sealedContractHash: undefined } })),
    policy: { trustedHosts: [HOST], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 3 },
  });
  const current = repository.read(PROJECT, RUN)!;
  const authorization = prepareProductionGenerationAuthorization({
    lease: { projectId: PROJECT, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
    run: current, projectRevision: 0,
    operation: { operationId: RUN, projectId: PROJECT, candidate: shots[0].candidate, planVersion: current.planVersion },
    contract: shots[0].contract!,
    multiShot: { shots, scope: shots.map((shot) => shot.shotId), planHash: "plan-hash-external" },
    providers: [productionProvider([])],
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    now: now(),
  });
  let run = repository.execute(PROJECT, RUN, {
    commandId: `seal:${RUN}`, expectedRevision: current.revision, type: "generation.seal",
    payload: { contract: shots[0].contract!, shots, scope: shots.map((shot) => shot.shotId), planHash: "plan-hash-external", authorization }, issuedAt: now(),
  }).run;
  if (options.approve) {
    run = repository.execute(PROJECT, RUN, {
      commandId: `approve:${RUN}`, expectedRevision: run.revision, type: "gate.decide",
      payload: { gateId: authorization.envelope.gateId, status: "approved", receiptId: "receipt-external", authorizationDigest: authorization.authorizationDigest }, issuedAt: now(),
    }).run;
    repository.execute(PROJECT, RUN, { commandId: "submit", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() });
  }
  const canvas = setupCanvasShots({ root, repository, now });
  return { root, repository, canvas, authorization };
}

function scheduler(root: string, repository: Repository, provider: GenerationProvider, options: { pollHorizonMs?: number } = {}) {
  const submission = createProductionGenerationSubmission({
    repository,
    beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined }),
    projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key", provider,
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now,
  });
  return createMultiShotBatchScheduler({ repository, landShots: landingThatBinds(repository), submission, projectId: PROJECT, runId: RUN, now, options, sleep: async () => undefined });
}

const read = (repository: Repository): ProductionRun => repository.read(PROJECT, RUN)!;
type World = ReturnType<typeof setup> & { submits: string[] };
/** 这一镜两边的供应商一共收到几份：制作那一侧按幂等键里的镜号认，画布那一侧按请求里绑的镜认。 */
const sendsFor = (world: World, shotId: string) => world.submits.filter((key) => key.includes(shotId)).length
  + world.canvas.vendor.executes.filter((call) => call.request.extras?.productionShotId === shotId).length;
const codeOf = (error: unknown) => (error as { code?: string })?.code ?? "refused";
const reasonOf = (error: unknown) => (error as { reason?: string })?.reason ?? "";
const outcomeOf = (promise: Promise<unknown>) => promise.then(() => "sent", (error) => `${codeOf(error)}:${reasonOf(error)}`);

let sequence = 0;
/** 节点 ↑（画布单节点提交）：节点绑着这一镜（请求里带 productionRunId / productionShotId）。 */
const nodeUp = (world: World, shotId: string) => outcomeOf(world.canvas.submit(`node-${shotId}`, `rr-up-${shotId}-${++sequence}`, shotId, { productionRunId: RUN, productionShotId: shotId }));
/** 框菜单「生成整组」/ 组工具条 / 列表「生成全部」：先为这一镜开一份画布同意，轮到它时同一个运行记录号交。 */
function canvasBatch(world: World, shotId: string) {
  const runRecordId = `rr-batch-${shotId}-${++sequence}`;
  world.canvas.consent([{ nodeId: `node-${shotId}`, runRecordId }]);
  return outcomeOf(world.canvas.submit(`node-${shotId}`, runRecordId, shotId, { productionRunId: RUN, productionShotId: shotId }));
}
/** 制作那一侧的「重做这一镜」（节点重试走回制作那一台 / MCP 的 rework）：准入在付费前就判上一次尝试收没收尾。 */
function rework(world: World, shotId: string): string {
  try {
    prepareProductionGenerationReauthorization({
      lease: { projectId: PROJECT, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 0, run: read(world.repository), shotId, providers: [productionProvider([])],
      resolveShotPrice: () => ({ known: true, amount: 6 }), now: now(),
    });
    return "reauthorized";
  } catch (error) {
    return `refused:${(error as { reason?: string; code?: string }).reason ?? (error as { code?: string }).code ?? "error"}`;
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
});

describe("M1 报价在等人（外部宿主的付费门封好、等批）", () => {
  it("画布节点 ↑ / 批量都被认领判定口拒（这一镜归制作流程：等确认）；宿主批了之后调度器交，这一镜一共一份", async () => {
    const world = { ...setup({ approve: false }), submits: [] as string[] };
    expect(decideShotClaim(read(world.repository), "shot-1", "canvas"), "前提：门在等人，这一镜归制作流程").toMatchObject({ holder: "production", reason: "awaiting_confirmation" });
    expect(await nodeUp(world, "shot-1")).toBe("production_shot_claimed:awaiting_confirmation");
    expect(await canvasBatch(world, "shot-1")).toBe("production_shot_claimed:awaiting_confirmation");
    // 宿主那边批了：批门 + 提交，调度器交。
    let run = read(world.repository);
    run = world.repository.execute(PROJECT, RUN, {
      commandId: "approve-later", expectedRevision: run.revision, type: "gate.decide",
      payload: { gateId: world.authorization.envelope.gateId, status: "approved", receiptId: "receipt-external", authorizationDigest: world.authorization.authorizationDigest }, issuedAt: now(),
    }).run;
    world.repository.execute(PROJECT, RUN, { commandId: "submit-later", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() });
    await scheduler(world.root, world.repository, productionProvider(world.submits)).runToQuiescence();
    expect(sendsFor(world, "shot-1")).toBe(1);
    expect(sendsFor(world, "shot-2")).toBe(1);
  });
});

describe("M2 已授权排队（调度器卡在 shot-1 的受理上，shot-2 作业停在 authorized）", () => {
  it("shot-2：画布节点 ↑ / 批量被拒（排队中）、重做被拒（上一次没收尾）、再起一个调度器也不重派；放开后 shot-2 一共一份", async () => {
    const world = { ...setup({ approve: true }), submits: [] as string[] };
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const first = scheduler(world.root, world.repository, productionProvider(world.submits, { hold })).runToQuiescence();
    await waitForProduction(() => world.submits.length === 1);
    const shotTwo = () => read(world.repository).jobs.find((job) => job.metadata?.shotId === "shot-2");
    expect(shotTwo()?.status, "前提：shot-2 已授权、还没轮到").toBe("authorized");
    expect(decideShotClaim(read(world.repository), "shot-2", "canvas")).toMatchObject({ holder: "production", reason: "queued" });

    expect(await nodeUp(world, "shot-2")).toBe("production_shot_claimed:queued");
    expect(await canvasBatch(world, "shot-2")).toBe("production_shot_claimed:queued");
    expect(rework(world, "shot-2")).toMatch(/^refused:/);
    // MCP 的「开始 / 继续」会再踢一次调度器：两个调度器同时在跑，shot-2 仍只派一次。
    const second = scheduler(world.root, world.repository, productionProvider(world.submits, { hold })).runToQuiescence();
    release();
    await Promise.all([first, second]);
    expect(sendsFor(world, "shot-2")).toBe(1);
    expect(sendsFor(world, "shot-1")).toBe(1);
  });
});

describe("M3 提交 / 生成中", () => {
  it("M3a shot-1 交的那一下还在供应商门口：画布节点 ↑ / 批量被拒（在途）、重做被拒、再起调度器不重派；一共一份", async () => {
    const world = { ...setup({ approve: true }), submits: [] as string[] };
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const first = scheduler(world.root, world.repository, productionProvider(world.submits, { hold })).runToQuiescence();
    await waitForProduction(() => world.submits.length === 1);
    expect(read(world.repository).jobs.find((job) => job.metadata?.shotId === "shot-1")?.status, "前提：shot-1 正在交").toBe("submitting");

    expect(await nodeUp(world, "shot-1")).toBe("production_shot_claimed:in_flight");
    expect(await canvasBatch(world, "shot-1")).toBe("production_shot_claimed:in_flight");
    expect(rework(world, "shot-1")).toMatch(/^refused:/);
    const second = scheduler(world.root, world.repository, productionProvider(world.submits, { hold })).runToQuiescence();
    release();
    await Promise.all([first, second]);
    expect(sendsFor(world, "shot-1")).toBe(1);
  });

  it("M3b shot-1 供应商已受理、还在生成：画布节点 ↑ / 批量被拒（在途）、重做被拒、再跑调度器不重派；一共一份", async () => {
    const world = { ...setup({ approve: true }), submits: [] as string[] };
    const provider = productionProvider(world.submits, { settle: false });
    await scheduler(world.root, world.repository, provider, { pollHorizonMs: 0 }).runToQuiescence();
    expect(read(world.repository).jobs.find((job) => job.metadata?.shotId === "shot-1")?.status, "前提：shot-1 交到了、在生成").toMatch(/provider_accepted|polling/);

    expect(await nodeUp(world, "shot-1")).toBe("production_shot_claimed:in_flight");
    expect(await canvasBatch(world, "shot-1")).toBe("production_shot_claimed:in_flight");
    expect(rework(world, "shot-1")).toMatch(/^refused:/);
    await scheduler(world.root, world.repository, provider, { pollHorizonMs: 0 }).runToQuiescence();
    expect(sendsFor(world, "shot-1")).toBe(1);
  });
});
