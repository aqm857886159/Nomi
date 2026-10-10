/**
 * 特征测试（#975 A2）：**已生成、取回失败**的镜头在多镜批次里怎么收场。
 *
 * 用户现场（issue #975 评论）：6 镜批次，供应商 6 镜全部真实出片，Nomi 只回填了前 3 镜，后 3 镜长期停在
 * polling，主进程持续高 CPU、1.7–2.3GB 内存。机制：`multiShotBatchScheduler.observeUnitOnce` 把物化（取回）
 * 失败一律吞成 pending——确定性的取回失败（出站策略拒、对方 4xx、类型不对）于是每一轮都**重查供应商、
 * 重下整段视频**、再被拒一次，直到这一趟的等待预算用完，下一次重踢又从头来，永远不停。
 *
 * 这里全部走真链：真批次调度器 → 真提交门面（真 Run 锁 / 真账本 / 耐久 job）→ 真运行时适配器 →
 * 本机 HTTP 假供应商 → **真取回器**（generationOutputMaterializer → fetchProviderMedia → hardenedFetch 的出站策略）。
 * 产物故意放在同一台本机的**另一个端口**上：按 #975 A 的判据，那不是这条连接自己的 origin，出站策略照旧拒——
 * 这正是「再取一万次都是同一堵墙」的确定性失败。
 *
 * 钉住三件事：
 *   ① 修前：一趟驱动里同一镜被反复重查、重下（> 1 次）；修后：恰好 1 次，然后停下；
 *   ② 修后这一镜耐久地进 needs_attention（errorCode output_retrieval_failed，人话带稳定码），Run 如实停下；
 *   ③ 「重新取回」只查一次、取一次：零新提交，取到了就落盘、这一镜 ready。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 落盘走真的 writeDeterministicAsset（含生成产物的字节 / 解码校验）；只把项目根换成临时目录。
const assetRoot = vi.hoisted(() => ({ dir: "" }));
vi.mock("../projects/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../projects/repository")>(),
  projectDirById: () => assetRoot.dir,
}));

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createGenerationOutputMaterializer } from "../capabilityCore/generationOutputMaterializer";
import { fetchProviderMedia } from "../assets/providerMediaFetch";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { createProductionShotDispatchGuard } from "./productionShotDispatchGuard";
import { registerBatchSchedulerKicker } from "./batchSchedulerKick";
import { createProductionRunService } from "./productionRunService";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";
import { writeDeterministicAsset } from "../assets/projectAssetStore";
import { deriveProductionShotState } from "../shared/productionShotPhase";
import { buildMaterializeShotsPayload } from "./multiShotCanvasLanding";
import type { ProductionGenerationShot } from "./productionRunTypes";
import { landingThatBinds } from "./landFirstTestUtils";

const NOW_BASE = Date.parse("2026-10-04T00:00:00.000Z");
const roots: string[] = [];
const servers: http.Server[] = [];
let clock = NOW_BASE;
const now = () => new Date(clock).toISOString();
const MP4 = Buffer.from("00000018667479706d703432000000006d703432", "hex");

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["video"],
  modes: ["text-to-video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "local-52931",
    models: [{ modelId: "local-video", modes: ["text-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } }],
  }],
}]);

afterEach(async () => {
  registerBatchSchedulerKicker(null);
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
});

/** 本机一台 HTTP 服务：只负责把成片字节交出去，数一数被下载了几次。 */
async function startFileServer(): Promise<{ origin: string; downloads: () => number }> {
  let downloads = 0;
  const server = http.createServer((_request, response) => {
    downloads += 1;
    response.writeHead(200, { "content-type": "video/mp4" }).end(MP4);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, downloads: () => downloads };
}

/** 供应商：收单、报成功、把产物地址指向 outputOrigin。数提交与查询次数。 */
function provider(outputOrigin: () => string, counts: { submits: number; queries: number }): GenerationProvider {
  return {
    providerId: "local-52931",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: async () => { counts.submits += 1; return { providerTaskId: `h3-${counts.submits}` }; },
    query: async (providerTaskId) => { counts.queries += 1; return { status: "succeeded", raw: { id: providerTaskId } }; },
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `${outputOrigin()}/${providerTaskId}.mp4` }] }),
  };
}

function shot(shotId: string): ProductionGenerationShot {
  const candidate: PlanCandidate = { candidateId: `cand-${shotId}`, revision: 1, moduleId: "generation.single-shot", providerId: "local-52931", modelId: "local-video", mode: "text-to-video", prompt: shotId, parameters: {}, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  return { shotId, candidate: { ...candidate, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

function setup(shots: ProductionGenerationShot[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-975-retrieval-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (p) => (p === "project-1" ? root : null), now });
  repository.createGenerationDraft({ operationId: "op-batch", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate: shots[0]!.candidate, shots, policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["local-52931"], allowedModels: ["local-video"], maxSpend: null, maxAttemptsPerJob: 3 } });
  sealAndApproveProductionGeneration({
    repository, projectId: "project-1", operationId: "op-batch", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0,
    candidate: shots[0]!.candidate, contract: shots[0]!.contract!,
    providers: [{ providerId: "local-52931", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true }, buildRequest: (input) => input, submit: async () => ({ providerTaskId: "unused" }) }],
    multiShot: { shots, scope: shots.map((entry) => entry.shotId), planHash: "plan-hash-975" },
    resolveShotPrice: () => ({ known: true, amount: 6 }), receiptId: "receipt-plan", now: now(),
  });
  repository.execute("project-1", "op-batch", { commandId: "submit", expectedRevision: 2, type: "generation.submit", payload: {}, issuedAt: now() });
  return { root, repository };
}

function wire(input: {
  root: string;
  repository: ReturnType<typeof createProductionRunRepository>;
  vendorBase: () => string;
  outputOrigin: () => string;
  counts: { submits: number; queries: number };
  fetchCalls: { count: number };
  realAssetStore?: boolean;
}) {
  // 真取回器：连接地址来自「目录」（这里是 vendorBase），私网例外只问 #975 A 的那一句判据。
  const materializer = createGenerationOutputMaterializer({
    resolveVendor: () => ({ baseUrlHint: input.vendorBase() }),
    fetchOutput: (url, options) => { input.fetchCalls.count += 1; return fetchProviderMedia(url, options); },
    writeAsset: input.realAssetStore
      ? writeDeterministicAsset
      : ((_projectId: string, bytes: Buffer) => ({ id: `asset-${bytes.length}`, data: { relativePath: "assets/generated/out.mp4" } })) as never,
  });
  const submission = createProductionGenerationSubmission({
    repository: input.repository,
    beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => input.repository.read(projectId, runId) ?? undefined }),
    projectRoot: input.root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, intentMacKey: "test-intent-key",
    provider: provider(input.outputOrigin, input.counts),
    materializeOutput: ({ projectId, providerTaskId, output, job }) => materializer.materialize({ projectId, providerTaskId, output, providerId: job.provider }),
    now,
  });
  return createMultiShotBatchScheduler({
    repository: input.repository, landShots: landingThatBinds(input.repository), submission, projectId: "project-1", runId: "op-batch", now,
    sleep: async (ms) => { clock += ms; },
    options: { pollHorizonMs: 120_000 },
  });
}

describe("#975 A2：确定性的取回失败停下来，不再一轮轮重查重下", () => {
  it("产物在同一台本机的另一个端口：取一次就停，这一镜如实进 needs_attention，Run 停下", async () => {
    const files = await startFileServer();
    const { root, repository } = setup([shot("shot-1")]);
    const counts = { submits: 0, queries: 0 };
    const fetchCalls = { count: 0 };
    // 连接地址是 127.0.0.1:52931 这一个 origin；产物却在同一台机器的另一个端口上 → 出站策略拒。
    const scheduler = wire({ root, repository, vendorBase: () => "http://127.0.0.1:52931", outputOrigin: () => files.origin, counts, fetchCalls });

    const outcome = await scheduler.runToQuiescence();

    expect(counts.submits).toBe(1);
    // 修前：一趟驱动里这一镜被反复重查、重下（每一轮 poll + 整段下载），直到等待预算用完。
    expect(fetchCalls.count).toBe(1);
    expect(counts.queries).toBe(1);
    expect(files.downloads()).toBe(0); // 出站策略在连接之前就拒了：一个字节都没出门
    expect(outcome.quiescent).toBe(true);

    const run = repository.read("project-1", "op-batch")!;
    const job = run.jobs.find((candidate) => candidate.metadata?.shotId === "shot-1")!;
    expect(job.status).toBe("needs_attention");
    expect(job.errorCode).toBe("output_retrieval_failed");
    expect(matchNomiErrorCode(job.errorMessage ?? "")).toBe("output-retrieval-failed");
    expect(job.errorMessage).not.toContain(files.origin); // 结果地址（可能带签名）不进人话
    expect(run.status).toBe("needs_attention");
    // V-975：镜头阶段投影只有一份判据——这一镜是「已生成、待取回」，不是「失败」；画布节点据此挂「可找回」。
    expect(deriveProductionShotState(run, "shot-1")?.phase).toBe("unretrieved");
    const payload = buildMaterializeShotsPayload(run, { projectRoot: null });
    expect(payload?.shots.find((entry) => entry.shotId === "shot-1")?.generation).toMatchObject({ state: "recoverable" });

    // 再踢一次（定时器 / 重开项目 / 重启）：这一镜不在观察列表里了，不查、不下、不提交。
    await scheduler.runToQuiescence();
    expect(fetchCalls.count).toBe(1);
    expect(counts.queries).toBe(1);
    expect(counts.submits).toBe(1);
  });

  it("V-975：产物取回来了但是坏 MP4（落盘校验 unknown_bytes）：同样取一次就停，不再每 15 秒整段重下", async () => {
    assetRoot.dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-975-assets-"));
    roots.push(assetRoot.dir);
    const files = await startFileServer(); // 交出去的就是 20 字节的「MP4 头」，不是一段能解码的视频
    const { root, repository } = setup([shot("shot-1")]);
    const counts = { submits: 0, queries: 0 };
    const fetchCalls = { count: 0 };
    // 连接地址就是产物所在的 origin（#975 A 放行），失败只发生在真的落盘校验这一步。
    const scheduler = wire({ root, repository, vendorBase: () => files.origin, outputOrigin: () => files.origin, counts, fetchCalls, realAssetStore: true });

    await scheduler.runToQuiescence();
    await scheduler.runToQuiescence(); // 再踢一次：不查、不下

    expect(files.downloads()).toBe(1);
    expect(fetchCalls.count).toBe(1);
    expect(counts.queries).toBe(1);
    expect(counts.submits).toBe(1);
    const job = repository.read("project-1", "op-batch")!.jobs[0]!;
    expect(job.status).toBe("needs_attention");
    expect(job.errorCode).toBe("output_retrieval_failed");
    expect(matchNomiErrorCode(job.errorMessage ?? "")).toBe("output-retrieval-failed");
    expect(job.errorMessage).toContain("unknown_bytes");
    expect(repository.read("project-1", "op-batch")!.status).toBe("needs_attention");
  });

  it("重新取回：只查一次、取一次，零新提交；取到了就落盘，这一镜 ready", async () => {
    const files = await startFileServer();
    const { root, repository } = setup([shot("shot-1")]);
    const counts = { submits: 0, queries: 0 };
    const fetchCalls = { count: 0 };
    // 第一次：连接地址与产物不同源 → 取回失败、停下。随后用户把连接地址改对（就是产物所在的那个 origin）。
    let vendorBase = "http://127.0.0.1:52931";
    const scheduler = wire({ root, repository, vendorBase: () => vendorBase, outputOrigin: () => files.origin, counts, fetchCalls });
    registerBatchSchedulerKicker((projectId, runId) => { if (projectId === "project-1" && runId === "op-batch") void scheduler.runToQuiescence(); });
    await scheduler.runToQuiescence();
    const parked = repository.read("project-1", "op-batch")!.jobs[0]!;
    expect(parked.errorCode).toBe("output_retrieval_failed");

    vendorBase = files.origin;
    const service = createProductionRunService({ repository, projectRootResolver: (p) => (p === "project-1" ? root : null) });
    const current = repository.read("project-1", "op-batch")!;
    await service.command("project-1", "op-batch", {
      commandId: "retry-retrieval-1", expectedRevision: current.revision, type: "job.retry_retrieval",
      payload: { jobId: parked.jobId }, issuedAt: now(),
    });
    // 被叫醒的调度器在后台跑；等它把这一镜落完。
    for (let i = 0; i < 50 && repository.read("project-1", "op-batch")!.jobs[0]!.status !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const job = repository.read("project-1", "op-batch")!.jobs[0]!;
    expect(job.status).toBe("ready");
    expect(counts.submits).toBe(1); // 零新提交：重新取回不是重新生成
    expect(counts.queries).toBe(2); // 只多查了一次
    expect(fetchCalls.count).toBe(2); // 只多取了一次
    expect(files.downloads()).toBe(1);
    expect(repository.read("project-1", "op-batch")!.artifacts.some((artifact) => artifact.jobId === job.jobId && artifact.status === "ready")).toBe(true);
  });

  it("重新取回只认「已生成、取回失败」的镜：别的 needs_attention 一律拒（拒了就什么都不动）", async () => {
    const { root, repository } = setup([shot("shot-1")]);
    const service = createProductionRunService({ repository, projectRootResolver: (p) => (p === "project-1" ? root : null) });
    const current = repository.read("project-1", "op-batch")!;
    await expect(service.command("project-1", "op-batch", {
      commandId: "retry-retrieval-bad", expectedRevision: current.revision, type: "job.retry_retrieval",
      payload: { jobId: current.jobs[0]!.jobId }, issuedAt: now(),
    })).rejects.toThrow(/not waiting for its result/);
    expect(repository.read("project-1", "op-batch")!.revision).toBe(current.revision);
  });
});
