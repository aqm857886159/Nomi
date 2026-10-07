import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 急停之后 Run 一定会从「暂停中」落到「已暂停」，而且落下后「继续剩余」接得上（2026-10-07 复验旧记录）。
//
// 旧记录：把 pausing 收成 paused 的那一步只有旧驱动在自己循环尾巴上调，多镜调度器从不调 → 批次急停后永远「暂停中」，
// 画布上的「继续剩余」又只认 paused / needs_attention。#934 把这一步搬到了仓库唯一写入口上（productionRunLifecycle
// .settleRunLifecycle）。这里按「谁让最后一件活收尾 × 怎么收尾」逐格走真仓库 + 真调度器 / 真对账驱动 + 内存供应商，
// 零花费；另加两格：急停与最后一镜完成同时发生、以及「暂停中」时点「取消制作」。

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../logging/logger", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logInfo: logs.info,
  logWarn: logs.warn,
  logError: logs.error,
}));

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createRunObservationDrivers } from "../capabilityCore/appIntegrationRunObservation";
import { deriveProductionShotState } from "../shared/productionShotPhase";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { applyRunControl } from "./productionRunControl";
import { createProductionRunRepository, ProductionRunRevisionConflictError } from "./productionRunRepository";
import { createProductionRunService } from "./productionRunService";
import { waitForProduction } from "./productionRunTestHelpers";
import { OUTPUT_RETRIEVAL_FAILED, type ProductionGenerationShot, type ProductionJob, type ProductionRun } from "./productionRunTypes";
import { registerBatchSchedulerKicker } from "./batchSchedulerKick";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";

const PROJECT = "project-1";
const RUN = "op-pause";
const now = () => "2026-10-07T00:00:00.000Z";
const roots: string[] = [];

type Repository = ReturnType<typeof createProductionRunRepository>;
/** 在飞那一镜在供应商那边怎么收尾。`timeout` 是供应商自己报超时（终态）；「观察窗过了还没结论」见每格第一趟驱动。 */
type Ending = "succeeded" | "failed" | "cancelled" | "timeout";

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text", "image"], outputKinds: ["video"],
  modes: ["image-to-video"], parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "apimart", models: [
    { modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } },
  ] }],
}]);

function shotEntry(shotId: string): ProductionGenerationShot {
  const candidate: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt: shotId, parameters: {}, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  return { shotId, candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-pause-settles-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// ── 多镜调度器 ────────────────────────────────────────────────────────────────

/**
 * 内存供应商：shot-1 的结论由 `vendor.shot1` 决定（`processing` = 还在做），其余镜照常出片。
 * `onSubmit` 在请求「正在供应商那边」时触发（用来模拟用户在那一刻点了暂停）。
 */
function vendorFor(submits: string[], onSubmit?: () => void) {
  const vendor = { shot1: "processing" as "processing" | Ending };
  const taskShot = new Map<string, string>();
  const provider: GenerationProvider = {
    providerId: "apimart",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => {
      submits.push(idempotencyKey);
      const taskId = `task-${submits.length}`;
      taskShot.set(taskId, ["shot-1", "shot-2", "shot-3"].find((shotId) => idempotencyKey.includes(shotId)) ?? "?");
      onSubmit?.();
      return { providerTaskId: taskId };
    },
    query: async (providerTaskId) => ({ status: taskShot.get(providerTaskId) === "shot-1" ? vendor.shot1 : "succeeded", raw: { id: providerTaskId } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/${PROJECT}/${providerTaskId}.mp4` }] }),
  };
  return { vendor, provider };
}

function setupBatch(root: string): Repository {
  const repository = createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now });
  const shots = ["shot-1", "shot-2", "shot-3"].map(shotEntry);
  repository.createGenerationDraft({ operationId: RUN, projectId: PROJECT, origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, shots,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["video-model"], maxSpend: null, maxAttemptsPerJob: 3 } });
  sealAndApproveProductionGeneration({
    repository, projectId: PROJECT, operationId: RUN, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: shots[0].candidate, contract: shots[0].contract!, providers: [vendorFor([]).provider],
    multiShot: { shots, scope: shots.map((shot) => shot.shotId), planHash: "plan-hash-pause" }, resolveShotPrice: () => ({ known: false }), receiptId: "receipt-plan", now: now(),
  });
  const run = repository.read(PROJECT, RUN)!;
  repository.execute(PROJECT, RUN, { commandId: "submit", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() });
  return repository;
}

function schedulerFor(root: string, repository: Repository, provider: GenerationProvider) {
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined }),
    projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key", provider,
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.mp4` }),
    now,
  });
  // 观察窗压到 10ms、等待不真睡：慢供应商「一趟驱动歇下、过会儿再踢」的那条路，一格一格地走。
  return createMultiShotBatchScheduler({ repository, submission, projectId: PROJECT, runId: RUN, now, sleep: async () => {}, options: { pollHorizonMs: 10 } });
}

function pressPause(repository: Pick<Repository, "read" | "execute">): ProductionRun {
  const run = repository.read(PROJECT, RUN)!;
  return applyRunControl(repository, PROJECT, RUN, run, { commandId: `user-pause:${run.revision}`, expectedRevision: run.revision, type: "run.control", payload: { action: "pause" }, issuedAt: now() }).run;
}

function pressResume(repository: Pick<Repository, "read" | "execute">): ProductionRun {
  const run = repository.read(PROJECT, RUN)!;
  return applyRunControl(repository, PROJECT, RUN, run, { commandId: `user-resume:${run.revision}`, expectedRevision: run.revision, type: "run.control", payload: { action: "resume" }, issuedAt: now(), humanGesture: true }).run;
}

/** 起一批三镜，第 1 镜交出去的那一刻急停；第一趟驱动在观察窗内等不到结论，歇下。 */
async function pausedWhileShotOneInFlight() {
  const root = tempRoot();
  const repository = setupBatch(root);
  const submits: string[] = [];
  const { vendor, provider } = vendorFor(submits, () => { if (submits.length === 1) pressPause(repository); });
  const firstDrive = await schedulerFor(root, repository, provider).runToQuiescence();
  return { root, repository, submits, vendor, provider, firstDrive };
}

const shotPhase = (run: ProductionRun, shotId: string) => deriveProductionShotState(run, shotId).phase;

describe("多镜调度器：急停后在飞那一镜怎么收尾，Run 都落到 paused，「继续剩余」接得上", () => {
  for (const ending of ["succeeded", "failed", "cancelled", "timeout"] as const satisfies readonly Ending[]) {
    it(`在飞那一镜 ${ending}：落到 paused（原因是用户暂停），继续后只派剩下两镜`, async () => {
      const { root, repository, submits, vendor, provider, firstDrive } = await pausedWhileShotOneInFlight();

      // 观察窗过了供应商还没结论：如实歇下（quiescent=false 让上层过会儿再踢），Run 仍是「暂停中」——钱已花出、活还在跑。
      expect(firstDrive.quiescent).toBe(false);
      expect(submits).toHaveLength(1);
      let run = repository.read(PROJECT, RUN)!;
      expect(run.status).toBe("pausing");
      expect(shotPhase(run, "shot-1")).toBe("generating");

      vendor.shot1 = ending;
      await schedulerFor(root, repository, provider).runToQuiescence();
      run = repository.read(PROJECT, RUN)!;
      expect(run, "最后一件活收了尾，同一次写入落到 paused").toMatchObject({ status: "paused", stop: { reason: "user_paused" } });
      expect(shotPhase(run, "shot-1")).toBe(ending === "succeeded" ? "done" : "failed");
      for (const shotId of ["shot-2", "shot-3"]) expect(deriveProductionShotState(run, shotId)).toMatchObject({ phase: "stopped", stoppedReason: "user_paused" });

      // 「继续剩余」：从 paused 接着派，只派没开拍的两镜，第 1 镜不重交。
      expect(pressResume(repository).status).toBe("running");
      await schedulerFor(root, repository, provider).runToQuiescence();
      run = repository.read(PROJECT, RUN)!;
      expect(submits, "每镜只交一次").toHaveLength(3);
      for (const shotId of ["shot-2", "shot-3"]) expect(shotPhase(run, shotId)).toBe("done");
    });
  }

  it("重启：暂停中、在飞那一镜还没回来时关了 Nomi——重开项目后照样有人盯着它，收尾后落到 paused", async () => {
    const { root, submits, vendor, provider } = await pausedWhileShotOneInFlight();

    // 新进程：新的仓库实例读同一份盘上记录，走真的「打开项目恢复」+ 真的调度器重踢入口。
    const reopened = createProductionRunRepository({ projectDirResolver: (projectId) => (projectId === PROJECT ? root : null), now });
    const service = createProductionRunService({ repository: reopened, projectRootResolver: () => root, requestRenderer: async () => { throw new Error("no renderer in this test"); } });
    await service.resumeUnfinishedRuns(PROJECT);
    let run = reopened.read(PROJECT, RUN)!;
    expect(run.status, "活还在供应商那边：仍是暂停中，不编一个结论").toBe("pausing");
    expect(shotPhase(run, "shot-1")).toBe("generating");

    vendor.shot1 = "succeeded";
    const built: string[] = [];
    const drivers = createRunObservationDrivers({
      repository: reopened,
      buildSchedulerForRun: (_projectId, runId) => { built.push(runId); return schedulerFor(root, reopened, provider); },
    });
    drivers.kickSchedulerForRun(PROJECT, RUN);
    expect(built, "暂停中的批次要驱动（在飞那一镜要有人盯着收尾）").toEqual([RUN]);
    await waitForProduction(() => reopened.read(PROJECT, RUN)!.status === "paused");
    drivers.stop();

    run = reopened.read(PROJECT, RUN)!;
    expect(run).toMatchObject({ status: "paused", stop: { reason: "user_paused" } });
    expect(submits).toHaveLength(1);
  });

  it("急停和最后一镜完成同时发生：谁先落盘都一样，最后都是 paused", () => {
    for (const order of ["pause-first", "finish-first"] as const) {
      const repository = setupBatch(tempRoot());
      let run = repository.read(PROJECT, RUN)!;
      run = repository.execute(PROJECT, RUN, { commandId: "start", expectedRevision: run.revision, type: "run.status", payload: { status: "running" }, issuedAt: now() }).run;
      const job = run.jobs.find((candidate) => candidate.metadata?.shotId === "shot-1")!;
      const write = (status: ProductionJob["status"]) => repository.execute(PROJECT, RUN, { commandId: `${order}-job-${status}`, expectedRevision: repository.read(PROJECT, RUN)!.revision, type: "job.status", payload: { jobId: job.jobId, status }, issuedAt: now() }).run;
      for (const status of ["submit_intent_persisted", "submitting", "provider_accepted", "polling", "downloading", "validating_technical", "validating_content"] as const) write(status);

      // 用户点暂停那一刻看到的 Run（第 1 镜还在飞）。
      const seen = repository.read(PROJECT, RUN)!;
      const pause = () => applyRunControl(repository, PROJECT, RUN, repository.read(PROJECT, RUN)!, { commandId: `${order}-pause-${repository.read(PROJECT, RUN)!.revision}`, expectedRevision: repository.read(PROJECT, RUN)!.revision, type: "run.control", payload: { action: "pause" }, issuedAt: now() });
      if (order === "pause-first") {
        expect(pause().run.status).toBe("pausing");
        expect(write("ready").status).toBe("paused");
      } else {
        write("ready");
        // 拿着旧修订号的那一下暂停被拒（不会写坏），渲染层按最新修订号重发（executeProductionRunCommand）——手上已无活，直接落到 paused。
        expect(() => applyRunControl(repository, PROJECT, RUN, seen, { commandId: `${order}-stale-pause`, expectedRevision: seen.revision, type: "run.control", payload: { action: "pause" }, issuedAt: now() }))
          .toThrow(ProductionRunRevisionConflictError);
        expect(pause().events.map((event) => event.message)).toEqual(["pausing", "paused"]);
      }
      expect(repository.read(PROJECT, RUN)!).toMatchObject({ status: "paused", stop: { reason: "user_paused" } });
    }
  });

});

// ── 停下以后，已经交给供应商的那几件仍有人盯到收尾 ─────────────────────────────────────────────
//
// 取消 / 暂停的承诺是「已提交的任务无法撤回、仍会跑完，产物保留」。慢供应商一趟驱动等不完，要靠「过一会儿再踢」接着问——
// 而那个踢的入口以前按 Run 状态挑：已暂停 / 已取消一律不踢（#934 只给「暂停中」开了口子），钱花了、片出了，没人去取。

/** 真的「过一会儿再踢」入口（appIntegrationRunObservation）：歇下没静止就定时重踢；这里把定时器换成手动拨。 */
function kickerFor(root: string, repository: Repository, provider: GenerationProvider) {
  const built: string[] = [];
  const drivers = createRunObservationDrivers({
    repository,
    buildSchedulerForRun: (_projectId, runId) => { built.push(runId); return schedulerFor(root, repository, provider); },
  });
  return { built, drivers };
}

describe("停下以后在飞的已付费活仍有人盯到收尾", () => {
  it("暂停中点「取消制作」（任务卡在暂停中只给这一个按钮）：取消成功；在飞那一镜之后出片照样落进项目", async () => {
    const { root, repository, submits, vendor, provider } = await pausedWhileShotOneInFlight();
    const run = repository.read(PROJECT, RUN)!;
    expect(run.status).toBe("pausing");
    const cancelled = applyRunControl(repository, PROJECT, RUN, run, { commandId: "user-cancel", expectedRevision: run.revision, type: "run.control", payload: { action: "cancel" }, issuedAt: now() }).run;
    expect(cancelled).toMatchObject({ status: "cancelled", stop: { reason: "user_cancelled" } });

    vendor.shot1 = "succeeded";
    const { built, drivers } = kickerFor(root, repository, provider);
    drivers.kickSchedulerForRun(PROJECT, RUN);
    expect(built, "取消了，但第 1 镜还在供应商那边：要有人去问").toEqual([RUN]);
    await waitForProduction(() => shotPhase(repository.read(PROJECT, RUN)!, "shot-1") === "done");
    drivers.stop();
    expect(repository.read(PROJECT, RUN)!.status, "取消仍是取消，只盯不派").toBe("cancelled");
    expect(submits).toHaveLength(1);
  });

  it("运行中取消、在飞那一镜比一趟驱动的观察窗还慢：再踢时照样去问，出片落进项目，不多交一笔", async () => {
    const root = tempRoot();
    const repository = setupBatch(root);
    const submits: string[] = [];
    const { vendor, provider } = vendorFor(submits, () => {
      if (submits.length !== 1) return;
      const run = repository.read(PROJECT, RUN)!;
      applyRunControl(repository, PROJECT, RUN, run, { commandId: "user-cancel-running", expectedRevision: run.revision, type: "run.control", payload: { action: "cancel" }, issuedAt: now() });
    });
    expect((await schedulerFor(root, repository, provider).runToQuiescence()).quiescent).toBe(false);
    expect(repository.read(PROJECT, RUN)!.status).toBe("cancelled");
    expect(shotPhase(repository.read(PROJECT, RUN)!, "shot-1")).toBe("generating");

    vendor.shot1 = "succeeded";
    const { built, drivers } = kickerFor(root, repository, provider);
    drivers.kickSchedulerForRun(PROJECT, RUN);
    expect(built).toEqual([RUN]);
    await waitForProduction(() => shotPhase(repository.read(PROJECT, RUN)!, "shot-1") === "done");
    drivers.stop();
    expect(submits).toHaveLength(1);
  });

  it("已暂停的批次里点「重新取回」：真的去取一次（以前踢的入口跳过已暂停，那一镜永远转圈）", async () => {
    const { root, repository, submits, vendor, provider } = await pausedWhileShotOneInFlight();
    // 供应商做完了，但结果没能取回本机（#975 A2）：这一镜挂「可找回」。
    let run = repository.read(PROJECT, RUN)!;
    const job = run.jobs.find((candidate) => candidate.metadata?.shotId === "shot-1")!;
    run = repository.execute(PROJECT, RUN, { commandId: "retrieval-failed", expectedRevision: run.revision, type: "job.status", payload: { jobId: job.jobId, status: "needs_attention", patch: { errorCode: OUTPUT_RETRIEVAL_FAILED } }, issuedAt: now() }).run;
    expect(run.status).toBe("paused");
    expect(shotPhase(run, "shot-1")).toBe("unretrieved");

    vendor.shot1 = "succeeded";
    const { built, drivers } = kickerFor(root, repository, provider);
    registerBatchSchedulerKicker(drivers.kickSchedulerForRun);
    try {
      const service = createProductionRunService({ repository, projectRootResolver: () => root, requestRenderer: async () => { throw new Error("no renderer in this test"); } });
      await service.command(PROJECT, RUN, { commandId: "retry-retrieval", expectedRevision: run.revision, type: "job.retry_retrieval", payload: { jobId: job.jobId }, issuedAt: now() });
      expect(built, "已暂停，但这一镜要去取：要有人去问").toEqual([RUN]);
      await waitForProduction(() => shotPhase(repository.read(PROJECT, RUN)!, "shot-1") === "done");
    } finally {
      registerBatchSchedulerKicker(null);
      drivers.stop();
    }
    expect(repository.read(PROJECT, RUN)!.status, "取回不等于继续：仍是已暂停").toBe("paused");
    expect(submits, "只取不交").toHaveLength(1);
  });
});

// ── 旧驱动（对账驱动 driveReconciliation：旧剧本 Run 里交给供应商的那一笔由它盯到收尾）──────────────────────────

const LEGACY_RUN = "run-legacy-pause";

async function legacyRunWithJobBeingReconciled(root: string, ending: Ending) {
  fs.mkdirSync(path.join(root, "assets/generated"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets/generated/recovered.mp4"), "video", "utf8");
  const repository = createProductionRunRepository({ projectDirResolver: () => root });
  let pressed = false;
  let release: () => void = () => {};
  const settled = new Promise<void>((resolve) => { release = resolve; });
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer: async () => { throw new Error("no renderer in this test"); },
    // 对账驱动在两次查询之间等一下：第一次等待时（第 1 笔还在供应商那边）用户点了暂停。
    sleep: async () => {
      if (!pressed) {
        pressed = true;
        const current = service.readFull(PROJECT, LEGACY_RUN);
        await service.command(PROJECT, LEGACY_RUN, { commandId: "legacy-pause", expectedRevision: current.revision, type: "run.control", payload: { action: "pause" }, issuedAt: new Date().toISOString() });
      }
    },
    reconcileProviderTask: async () => {
      if (!pressed) return { status: "processing" };
      release();
      if (ending === "timeout") throw new Error("provider query timed out");
      if (ending === "succeeded") return { status: "succeeded", assets: [{ type: "video", url: `nomi-local://asset/${PROJECT}/assets/generated/recovered.mp4` }] };
      return { status: ending };
    },
  });
  const created = service.createDraft({ runId: LEGACY_RUN, projectId: PROJECT, playbook: { name: "brand.promo", version: "1.0.0" }, origin: { host: "codex" }, brief: { goal: "pause settles" } });
  let revision = repository.execute(PROJECT, LEGACY_RUN, { commandId: "direction", expectedRevision: created.revision, type: "gate.decide", humanGesture: true, payload: { gateId: "gate-direction-v1", status: "approved" }, issuedAt: created.createdAt }).run.revision;
  const job = { jobId: "job-legacy", stageId: "generate", status: "planned" as const, attempt: 0, provider: "local", model: "demo-video", idempotencyKey: "idem-legacy", providerTaskId: "provider-task-1", taskKind: "text_to_video", createdAt: created.createdAt, updatedAt: created.createdAt };
  for (const command of [
    { type: "job.add", payload: { job } },
    ...(["authorization_required", "authorized", "submit_intent_persisted", "submitting", "submission_unknown"] as const).map((status) => ({ type: "job.status", payload: { jobId: job.jobId, status } })),
  ]) {
    revision = repository.execute(PROJECT, LEGACY_RUN, { commandId: `seed-${revision}`, expectedRevision: revision, ...command, issuedAt: created.createdAt }).run.revision;
  }
  expect(repository.read(PROJECT, LEGACY_RUN)!.status).toBe("running");
  // 用户核对后说「找到了」→ 对账驱动接手这一笔（reconciling → provider_accepted → polling，在供应商那边）。
  await service.command(PROJECT, LEGACY_RUN, { commandId: "reconcile-found", expectedRevision: revision, type: "job.reconcile", payload: { jobId: job.jobId, outcome: "found" }, issuedAt: new Date().toISOString() });
  return { repository, service, settled, jobId: job.jobId };
}

describe("旧驱动（对账驱动）：急停后在飞那一笔怎么收尾，Run 都落到 paused", () => {
  for (const ending of ["succeeded", "failed", "cancelled", "timeout"] as const satisfies readonly Ending[]) {
    it(`在飞那一笔 ${ending}：落到 paused（原因是用户暂停）`, async () => {
      const root = tempRoot();
      const { repository, settled, jobId } = await legacyRunWithJobBeingReconciled(root, ending);
      await settled;
      const terminal = ending === "succeeded" ? "adopted" : "needs_attention";
      await waitForProduction(() => repository.read(PROJECT, LEGACY_RUN)!.jobs.find((job) => job.jobId === jobId)!.status === terminal);
      expect(repository.read(PROJECT, LEGACY_RUN)!).toMatchObject({ status: "paused", stop: { reason: "user_paused" } });
    });
  }

  it("重启：暂停中、那一笔停在「提交中」时关了 Nomi——重开项目后落到 paused，那一笔如实标成「结果待核对」", async () => {
    // 旧驱动留在盘上的在飞形态只有「提交中」这一种：旧剧本那台写手交到渲染层就被拒，从没拿到过供应商任务号
    // （2026-10-05 已整段删掉）。拿着任务号在轮询的旧剧本作业只可能来自用户核对后的对账——见合同 residual_risks。
    const root = tempRoot();
    const repository = createProductionRunRepository({ projectDirResolver: () => root });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, requestRenderer: async () => { throw new Error("no renderer in this test"); } });
    const created = service.createDraft({ runId: LEGACY_RUN, projectId: PROJECT, playbook: { name: "brand.promo", version: "1.0.0" }, origin: { host: "codex" }, brief: { goal: "pause settles" } });
    let revision = repository.execute(PROJECT, LEGACY_RUN, { commandId: "direction", expectedRevision: created.revision, type: "gate.decide", humanGesture: true, payload: { gateId: "gate-direction-v1", status: "approved" }, issuedAt: created.createdAt }).run.revision;
    const jobId = "job-legacy";
    const job = { jobId, stageId: "generate", status: "planned" as const, attempt: 0, provider: "local", model: "demo-video", idempotencyKey: "idem-legacy", taskKind: "text_to_video", createdAt: created.createdAt, updatedAt: created.createdAt };
    for (const command of [
      { type: "job.add", payload: { job } },
      ...(["authorization_required", "authorized", "submit_intent_persisted", "submitting"] as const).map((status) => ({ type: "job.status", payload: { jobId, status } })),
    ]) {
      revision = repository.execute(PROJECT, LEGACY_RUN, { commandId: `seed-${revision}`, expectedRevision: revision, ...command, issuedAt: created.createdAt }).run.revision;
    }
    await service.command(PROJECT, LEGACY_RUN, { commandId: "legacy-pause", expectedRevision: revision, type: "run.control", payload: { action: "pause" }, issuedAt: new Date().toISOString() });
    expect(repository.read(PROJECT, LEGACY_RUN)!.status).toBe("pausing");

    const reopened = createProductionRunRepository({ projectDirResolver: () => root });
    const restarted = createProductionRunService({ repository: reopened, projectRootResolver: () => root, requestRenderer: async () => { throw new Error("no renderer in this test"); } });
    await restarted.resumeUnfinishedRuns(PROJECT);
    const run = reopened.read(PROJECT, LEGACY_RUN)!;
    expect(run).toMatchObject({ status: "paused", stop: { reason: "user_paused" } });
    expect(run.jobs.find((job) => job.jobId === jobId)!.status).toBe("submission_unknown");
  });
});
