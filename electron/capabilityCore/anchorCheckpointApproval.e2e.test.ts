import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "./executionContract";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationRuntimeAdapter, type GenerationProvider } from "./generationRuntimeAdapter";
import { dispatch } from "./dispatcher";
import { createProductionGenerationSubmission } from "../productionRun/productionGenerationSubmission";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { createProductionRunService } from "../productionRun/productionRunService";
import { createMultiShotBatchScheduler, type BatchOutcome } from "../productionRun/multiShotBatchScheduler";
import { anchorCheckpointGateId } from "../productionRun/anchorCheckpoint";
import { registerBatchSchedulerKicker } from "../productionRun/batchSchedulerKick";
import { sealAndApproveProductionGeneration } from "../productionRun/productionGenerationAuthorizationTestUtils";
import type { ProductionGenerationShot } from "../productionRun/productionRunTypes";

// P4 §3.2 — 锚定妆照检查点的**生产审批入口** E2E（修 §8.5 停死 gap 的验收）。此前所有测试都用
// repository.execute 直发 gate.decide 或 anchorAutoReleaseMs 绕过检查点，正好把「生产没有入口」盖住。
// 这里走真入口整链：真 loopback vendor（零额度）→ 真 durable Run → 真 scheduler 停在检查点 →
// **真 dispatcher `production.decide-gate`**（= nomi_decide_gate 的 method 层）→ 真 service post-decide
// 钩子经插槽重踢 → 镜头批自动续跑到完成。核心断言：批准动作本身让批次醒过来（入口不用再做任何事），
// 且总提交数 = 锚 + 镜、每 job ≤1 submit（重踢不双花）。

const NOW_BASE = Date.parse("2026-08-25T00:00:00.000Z");
const roots: string[] = [];
let clock = NOW_BASE;
const now = () => new Date(clock).toISOString();
const tickClock = () => { clock += 1000; return now(); };

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["text-to-image", "image-to-video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "apimart",
    models: [
      { modelId: "image-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } },
      { modelId: "video-model", modes: ["image-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } },
    ],
  }],
}]);

async function startLoopbackVendor() {
  const hits: Array<{ url: string; method: string }> = [];
  const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url ?? "", method: req.method ?? "" });
    req.on("data", () => { /* drain */ }); req.on("end", () => {
      const payload = JSON.stringify({ created: 1, data: [{ task_id: `task-${hits.length}`, status: "succeeded", url: pngDataUrl, images: [{ url: pngDataUrl }] }] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function loopbackProvider(origin: string, submits: string[]): GenerationProvider {
  return {
    providerId: "apimart",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true },
    buildRequest: (input) => input,
    submit: async (_request, idempotencyKey) => {
      submits.push(idempotencyKey);
      const res = await fetch(`${origin}/v1/generations`, { method: "POST", body: JSON.stringify({ idempotencyKey }) });
      const json = await res.json() as { data: Array<{ task_id: string }> };
      return { providerTaskId: json.data[0].task_id, raw: json };
    },
    query: async (providerTaskId) => ({ status: "succeeded", raw: { id: providerTaskId, status: "succeeded" } }),
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/project-1/${providerTaskId}.png` }] }),
  };
}

function candidate(id: string, prompt: string, modelId: string, mode: string): PlanCandidate {
  return { candidateId: id, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId, mode, prompt, parameters: {}, references: [] };
}

function shotEntry(shotId: string, prompt: string, role: "anchor" | "shot"): ProductionGenerationShot {
  const modelId = role === "anchor" ? "image-model" : "video-model";
  const mode = role === "anchor" ? "text-to-image" : "image-to-video";
  const cand = candidate(`cand-${shotId}`, prompt, modelId, mode);
  const contract = compileExecutionContract(cand, registry);
  return { shotId, ...(role === "anchor" ? { role } : {}), candidate: { ...cand, sealedContractHash: contract.contractHash }, contract, updatedAt: now() };
}

function setup(shots: ProductionGenerationShot[], provider: GenerationProvider) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-checkpoint-e2e-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (p) => (p === "project-1" ? root : null), now });
  repository.createGenerationDraft({ operationId: "op-batch", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["image-model", "video-model"], maxSpend: null, maxAttemptsPerJob: 2 } });
  const top = shots[0].contract!;
  const approved = sealAndApproveProductionGeneration({
    repository,
    projectId: "project-1",
    operationId: "op-batch",
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    candidate: shots[0].candidate,
    contract: top,
    providers: [provider],
    multiShot: { shots, planHash: "plan-hash-batch" },
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    receiptId: "receipt-plan",
    now: now(),
  });
  repository.execute("project-1", "op-batch", { commandId: "submit", expectedRevision: approved.run.revision, type: "generation.submit", payload: {}, issuedAt: now() });
  return { root, repository };
}

function buildScheduler(root: string, repository: ReturnType<typeof createProductionRunRepository>, provider: GenerationProvider) {
  createGenerationRuntimeAdapter({ providers: [provider] });
  const submission = createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    projectRevision: 0, intentMacKey: "test-intent-key", providers: [provider],
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.png` }),
    now,
  });
  return createMultiShotBatchScheduler({ repository, submission, projectId: "project-1", runId: "op-batch", perShotPrice: () => ({ known: true, amount: 6 }), now });
}

/** 真 dispatcher 的最小 ctx：productionRuns = 真 service（与生产同一条 ctx.productionRuns.command 路）。 */
function dispatcherContext(service: ReturnType<typeof createProductionRunService>) {
  return {
    runTask: async () => { throw new Error("decide-gate must not run tasks"); },
    makeGateway: () => { throw new Error("decide-gate must not resolve a canvas gateway"); },
    productionRuns: service,
    origin: { host: "external" as const },
  };
}

afterEach(() => {
  registerBatchSchedulerKicker(null);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  clock = NOW_BASE;
});

describe("P4 §3.2 — anchor checkpoint approval through the REAL production entrance", () => {
  it("create → anchor → checkpoint → dispatcher approve → hook re-kicks → shot batch completes (no manual scheduler call)", async () => {
    const shots = [shotEntry("anchor-1", "阿雨 定妆照", "anchor"), shotEntry("shot-1", "雨夜推门", "shot"), shotEntry("shot-2", "货架对视", "shot")];
    const vendor = await startLoopbackVendor();
    try {
      const submits: string[] = [];
      const provider = loopbackProvider(vendor.origin, submits);
      const { root, repository } = setup(shots, provider);
      // Phase A: the batch generates the anchor and parks at the checkpoint (production sets no auto-release).
      const phaseA = await buildScheduler(root, repository, provider).runToQuiescence();
      expect(phaseA.checkpoint.status).toBe("waiting");
      expect(submits).toHaveLength(1);
      let run = repository.read("project-1", "op-batch")!;
      const blockedShotJob = run.jobs.find((job) => job.metadata?.shotId === "shot-1");
      expect(blockedShotJob).toMatchObject({ status: "authorized" });
      expect(blockedShotJob?.providerTaskId).toBeUndefined();

      // Production wiring: the service owns the decide path; the slot holds the scheduler re-kick
      // (in the app, appIntegration registers kickSchedulerForRun; here the same-shape test kicker).
      const service = createProductionRunService({ repository, projectRootResolver: (p) => (p === "project-1" ? root : null) });
      const kicked: Array<Promise<BatchOutcome>> = [];
      registerBatchSchedulerKicker((projectId, runId) => {
        expect(projectId).toBe("project-1");
        expect(runId).toBe("op-batch");
        kicked.push(buildScheduler(root, repository, provider).runToQuiescence());
      });

      // The REAL approval entrance: dispatcher `production.decide-gate` (nomi_decide_gate's method layer).
      // Before this fix it threw 403 "must be decided in Nomi" — the deadlock this file guards against.
      tickClock();
      const projection = await dispatch("production.decide-gate", {
        projectId: "project-1", runId: "op-batch", gateId: anchorCheckpointGateId("op-batch"), decision: "approved",
      }, dispatcherContext(service) as never) as { gates?: Array<{ gateId: string; status: string }> };

      // The decide alone woke the batch: the service hook kicked the scheduler, no caller-side resume.
      expect(kicked).toHaveLength(1);
      const resumed = await kicked[0];
      expect(resumed.progress.completed).toBe(2);
      expect(resumed.halt).toBeUndefined();
      expect(submits).toHaveLength(3); // 1 anchor + 2 shots — the re-kick double-submits nothing
      expect(new Set(submits).size).toBe(submits.length); // ≤1 real submit per job

      run = repository.read("project-1", "op-batch")!;
      expect(run.gates.find((g) => g.gateId === anchorCheckpointGateId("op-batch"))?.status).toBe("approved");
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(3);
      expect(projection.gates?.find((g) => g.gateId === anchorCheckpointGateId("op-batch"))?.status).toBe("approved");
    } finally {
      await vendor.close();
    }
  });

  it("dispatcher reject parks the batch at the checkpoint: gate rejected, zero new submits, stills kept", async () => {
    const shots = [shotEntry("anchor-1", "阿雨 定妆照", "anchor"), shotEntry("shot-1", "雨夜推门", "shot")];
    const vendor = await startLoopbackVendor();
    try {
      const submits: string[] = [];
      const provider = loopbackProvider(vendor.origin, submits);
      const { root, repository } = setup(shots, provider);
      await buildScheduler(root, repository, provider).runToQuiescence();
      expect(submits).toHaveLength(1);

      const service = createProductionRunService({ repository, projectRootResolver: (p) => (p === "project-1" ? root : null) });
      const kicked: Array<Promise<BatchOutcome>> = [];
      registerBatchSchedulerKicker(() => {
        kicked.push(buildScheduler(root, repository, provider).runToQuiescence());
      });

      tickClock();
      await dispatch("production.decide-gate", {
        projectId: "project-1", runId: "op-batch", gateId: anchorCheckpointGateId("op-batch"), decision: "rejected",
      }, dispatcherContext(service) as never);

      // The rejection also ticks the machine (free re-derive): it rests at `rejected` — no shot dispatch,
      // no anchor re-attempt (重出形象 stages a new attempt through the S6 rework entrance, not here).
      expect(kicked).toHaveLength(1);
      const rested = await kicked[0];
      expect(rested.checkpoint.status).toBe("rejected");
      expect(rested.quiescent).toBe(true);
      expect(submits).toHaveLength(1); // nothing new paid for
      const run = repository.read("project-1", "op-batch")!;
      expect(run.gates.find((g) => g.gateId === anchorCheckpointGateId("op-batch"))?.status).toBe("rejected");
      const blockedShotJob = run.jobs.find((job) => job.metadata?.shotId === "shot-1");
      expect(blockedShotJob).toMatchObject({ status: "authorized" });
      expect(blockedShotJob?.providerTaskId).toBeUndefined();
      expect(run.artifacts.filter((a) => a.status === "ready")).toHaveLength(1); // the anchor still is kept
    } finally {
      await vendor.close();
    }
  });
});
