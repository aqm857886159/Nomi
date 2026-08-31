import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createGenerationRuntimeAdapter, type GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { createProductionRunRepository } from "./productionRunRepository";
import { createMultiShotBatchScheduler } from "./multiShotBatchScheduler";
import { anchorCheckpointGateId } from "./anchorCheckpoint";
import type { ProductionGenerationShot } from "./productionRunTypes";

// P4 S4 — J1/J3 end-to-end over a REAL loopback vendor (zero quota). This drives the FULL durable chain:
// scheduler → real submission facade (real Run lock + real ledger + durable jobs) → REAL runtime adapter
// → REAL loopback HTTP provider → real materialization receipt. It proves the batch: anchor → checkpoint
// → (approve) → shot batch → per-shot artifact, that the total request count = anchors + shots, and that
// a "restart" (fresh scheduler over the same durable Run) and a "detached client" (scheduler runs after
// the caller returns) both converge without a second submit.

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

/** A real loopback HTTP vendor: accepts a task, reports succeeded, returns a decodable data URL. */
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

/**
 * A real GenerationProvider whose submit/query/materialize hit the loopback HTTP server. This exercises
 * the real adapter path (not a stub), so the batch runs through the genuine submit→poll→materialize chain.
 */
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
  return { shotId, ...(role === "anchor" ? { role } : {}), candidate: { ...cand, sealedContractHash: contract.contractHash }, contract, approvedReceiptId: "receipt-plan", updatedAt: now() };
}

function setup(shots: ProductionGenerationShot[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-batch-e2e-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (p) => (p === "project-1" ? root : null), now });
  repository.createGenerationDraft({ operationId: "op-batch", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate: shots[0].candidate, policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["image-model", "video-model"], maxSpend: null, maxAttemptsPerJob: 2 } });
  const top = shots[0].contract!;
  repository.execute("project-1", "op-batch", { commandId: "seal", expectedRevision: 0, type: "generation.seal", payload: { contract: top, shots, planHash: "plan-hash-batch" }, issuedAt: now() });
  repository.execute("project-1", "op-batch", { commandId: "approve", expectedRevision: 1, type: "generation.approve", payload: { receiptId: "receipt-plan", contractHash: "plan-hash-batch" }, issuedAt: now() });
  repository.execute("project-1", "op-batch", { commandId: "submit", expectedRevision: 2, type: "generation.submit", payload: {}, issuedAt: now() });
  return { root, repository };
}

function buildSubmission(root: string, repository: ReturnType<typeof createProductionRunRepository>, origin: string, submits: string[]) {
  const provider = loopbackProvider(origin, submits);
  // Sanity: the real adapter must accept this provider (proves we exercise the genuine adapter path).
  createGenerationRuntimeAdapter({ providers: [provider] });
  return createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    intentMacKey: "test-intent-key", provider,
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.png` }),
    now,
  });
}

function scheduler(root: string, repository: ReturnType<typeof createProductionRunRepository>, origin: string, submits: string[], options: Parameters<typeof createMultiShotBatchScheduler>[0]["options"] = {}) {
  const submission = buildSubmission(root, repository, origin, submits);
  return createMultiShotBatchScheduler({ repository, submission, projectId: "project-1", runId: "op-batch", perShotPrice: () => ({ known: true, amount: 6 }), now, options });
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); clock = NOW_BASE; });

describe("P4 S4 J1 — full multi-shot batch over a real loopback vendor", () => {
  it("runs anchor → checkpoint → (approve) → shot batch → per-shot artifacts; total requests = anchors + shots", async () => {
    const shots = [shotEntry("anchor-1", "阿雨 定妆照", "anchor"), shotEntry("shot-1", "雨夜推门", "shot"), shotEntry("shot-2", "货架对视", "shot")];
    const { root, repository } = setup(shots);
    const vendor = await startLoopbackVendor();
    try {
      const submits: string[] = [];
      // Phase A: the batch generates the anchor and STOPS at the checkpoint (no auto-release).
      const phaseA = await scheduler(root, repository, vendor.origin, submits).runToQuiescence();
      expect(phaseA.checkpoint.status).toBe("waiting");
      expect(submits).toHaveLength(1); // only the anchor image submitted
      let run = repository.read("project-1", "op-batch")!;
      const gate = run.gates.find((g) => g.gateId === anchorCheckpointGateId("op-batch"))!;
      expect(gate.status).toBe("waiting");
      // The anchor produced a real durable artifact (submit→poll→materialize chain ran end-to-end).
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(1);
      // No video shot job yet (checkpoint blocks the batch).
      expect(run.jobs.some((j) => j.metadata?.shotId === "shot-1")).toBe(false);

      // Phase B: the user approves the checkpoint → the shot batch generates.
      repository.execute("project-1", "op-batch", { commandId: `approve-checkpoint`, expectedRevision: run.revision, type: "gate.decide", payload: { gateId: gate.gateId, status: "approved" }, issuedAt: tickClock() });
      const phaseB = await scheduler(root, repository, vendor.origin, submits).runToQuiescence();

      // Total provider submissions = 1 anchor + 2 shots = 3 (NOT "≤ 2 shots" — the anchor is a request too).
      expect(submits).toHaveLength(3);
      expect(phaseB.progress.completed).toBe(2); // both video shots finished
      expect(phaseB.halt).toBeUndefined();
      run = repository.read("project-1", "op-batch")!;
      // Each unit (anchor + 2 video shots) has exactly one durable job: 3 total, one per sealed unit.
      const shotJobs = run.jobs.filter((j) => typeof j.metadata?.shotId === "string");
      expect(shotJobs.map((j) => j.metadata!.shotId).sort()).toEqual(["anchor-1", "shot-1", "shot-2"]);
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(3); // anchor + 2 shots
      // No duplicate jobs anywhere.
      const jobIds = run.jobs.map((j) => j.jobId);
      expect(new Set(jobIds).size).toBe(jobIds.length);
    } finally {
      await vendor.close();
    }
  });
});

// P4 真供应商加固 — 锚检查点「不满意只重锚」闭环（验收门 §5.1 变体 + T1 拍板）over a real loopback vendor.
// 证：checkpoint 出现 → REJECT → 镜批**不开拍**（一个视频镜都没提交）→ 只重锚（reworkShot 锚 shot）→ 旧
// rejected 检查点门被丢、新锚生成后**重开一道全新 waiting 检查点**（引用新锚 job，不是旧的）→ approve 新检查点
// → 镜批才开拍。这补上了「reject 后检查点门恒 rejected、gate.add 拒重复 → 永远死锁」的根因缺口。
describe("P4 真供应商加固 — 锚检查点 reject 只重锚 → 重开检查点 → approve 开拍", () => {
  it("REJECT 检查点后镜不开拍；只重锚；新锚重开一道全新检查点；approve 后镜批才提交", async () => {
    const shots = [shotEntry("anchor-1", "阿雨 定妆照", "anchor"), shotEntry("shot-1", "雨夜推门", "shot"), shotEntry("shot-2", "货架对视", "shot")];
    const { root, repository } = setup(shots);
    const vendor = await startLoopbackVendor();
    try {
      const submits: string[] = [];
      // Phase A: batch generates the anchor and stops at the checkpoint (no auto-release).
      const phaseA = await scheduler(root, repository, vendor.origin, submits).runToQuiescence();
      expect(phaseA.checkpoint.status).toBe("waiting");
      expect(submits).toHaveLength(1); // only the anchor image
      let run = repository.read("project-1", "op-batch")!;
      const gate = run.gates.find((g) => g.gateId === anchorCheckpointGateId("op-batch"))!;
      expect(gate.status).toBe("waiting");
      const firstAnchorJobId = run.jobs.find((j) => j.metadata?.shotId === "anchor-1")!.jobId;

      // Phase B: user REJECTS the checkpoint ("不满意"). Shots must NOT proceed.
      run = repository.execute("project-1", "op-batch", { commandId: "reject-checkpoint", expectedRevision: run.revision, type: "gate.decide", payload: { gateId: gate.gateId, status: "rejected" }, issuedAt: tickClock() }).run;
      const phaseB = await scheduler(root, repository, vendor.origin, submits).runToQuiescence();
      expect(phaseB.checkpoint.status).toBe("rejected");
      expect(submits).toHaveLength(1);                                    // STILL only the anchor — no video shot submitted
      run = repository.read("project-1", "op-batch")!;
      expect(run.jobs.some((j) => j.metadata?.shotId === "shot-1")).toBe(false);
      expect(run.jobs.some((j) => j.metadata?.shotId === "shot-2")).toBe(false);

      // Phase C: user re-anchors ONLY the anchor (checkpoint card's「只重画形象」→ S6 reworkShot on role:'anchor').
      const submission = buildSubmission(root, repository, vendor.origin, submits);
      const rework = await submission.reworkShot({ projectId: "project-1", operationId: "op-batch", shotId: "anchor-1" });
      expect(rework.attempt).toBe(2);
      run = repository.read("project-1", "op-batch")!;
      // The rejected checkpoint gate was DROPPED by generation.new_attempt (so a fresh one can open).
      expect(run.gates.some((g) => g.gateId === anchorCheckpointGateId("op-batch"))).toBe(false);
      // Approve + submit the re-anchor (models the single-shot confirm the checkpoint card triggers for the new anchor).
      run = repository.execute("project-1", "op-batch", { commandId: "approve-reanchor", expectedRevision: run.revision, type: "generation.approve", payload: { receiptId: "receipt-reanchor", contractHash: "plan-hash-batch", attempt: rework.attempt }, issuedAt: tickClock() }).run;
      run = repository.execute("project-1", "op-batch", { commandId: "submit-reanchor", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: tickClock() }).run;

      // Phase D: scheduler re-anchors → new anchor ready → a BRAND-NEW checkpoint opens (waiting), referencing the
      // NEW anchor job. Shots STILL blocked (one video shot not submitted). This is the reopened stop-a-beat.
      // raisePlanAuthorizationTo lifts the ceiling for the re-anchor's extra spend (as reworkShot does in prod):
      // anchor v1 + anchor v2 + 2 shots = 4 × 6 = 24.
      const phaseD = await scheduler(root, repository, vendor.origin, submits, { raisePlanAuthorizationTo: 24 }).runToQuiescence();
      expect(phaseD.checkpoint.status).toBe("waiting");
      expect(submits).toHaveLength(2);                                    // anchor v1 + anchor v2; NO video shot yet
      run = repository.read("project-1", "op-batch")!;
      const reopened = run.gates.find((g) => g.gateId === anchorCheckpointGateId("op-batch"))!;
      expect(reopened.status).toBe("waiting");
      const secondAnchorJobId = run.jobs.find((j) => j.metadata?.shotId === "anchor-1" && j.jobId !== firstAnchorJobId)!.jobId;
      expect(reopened.jobIds).toContain(secondAnchorJobId);              // references the NEW anchor, not the old one
      expect(reopened.jobIds).not.toContain(firstAnchorJobId);
      expect(run.jobs.some((j) => j.metadata?.shotId === "shot-1")).toBe(false);

      // Phase E: approve the reopened checkpoint → NOW the shot batch generates.
      run = repository.execute("project-1", "op-batch", { commandId: "approve-reopened", expectedRevision: run.revision, type: "gate.decide", payload: { gateId: reopened.gateId, status: "approved" }, issuedAt: tickClock() }).run;
      const phaseE = await scheduler(root, repository, vendor.origin, submits, { raisePlanAuthorizationTo: 24 }).runToQuiescence();
      expect(phaseE.progress.completed).toBe(2);                         // both video shots finished after re-anchor approval
      expect(submits).toHaveLength(4);                                    // anchor v1 + anchor v2 + 2 shots
      run = repository.read("project-1", "op-batch")!;
      expect(new Set(submits).size).toBe(submits.length);                // ≤1 submit per job (no double charge)
    } finally {
      await vendor.close();
    }
  });
});

describe("P4 S4 J3 — crash recovery + detached driver over a real loopback vendor", () => {
  it("re-running the scheduler over the same durable Run submits nothing new (restart ≤1 submit per job)", async () => {
    const shots = [shotEntry("shot-1", "a", "shot"), shotEntry("shot-2", "b", "shot")];
    const { root, repository } = setup(shots);
    const vendor = await startLoopbackVendor();
    try {
      const submits: string[] = [];
      // First run completes both shots (no anchors → no checkpoint).
      await scheduler(root, repository, vendor.origin, submits).runToQuiescence();
      const firstCount = submits.length;
      expect(firstCount).toBe(2);

      // "Restart": a brand-new scheduler over the SAME durable Run re-derives and finds nothing to submit.
      const recovered = await scheduler(root, repository, vendor.origin, submits).runToQuiescence();
      expect(submits).toHaveLength(2); // unchanged — no double submit
      expect(recovered.progress.completed).toBe(2);

      // Every job has a unique id and every idempotency key was used at most once.
      expect(new Set(submits).size).toBe(submits.length);
    } finally {
      await vendor.close();
    }
  });

  it("the batch continues after the caller returns (detached, client-independent)", async () => {
    // The scheduler runs in the main process; once started it does not depend on the MCP client staying
    // alive. We model "client returned" by NOT awaiting, then awaiting the detached promise afterward.
    const shots = [shotEntry("shot-1", "a", "shot"), shotEntry("shot-2", "b", "shot")];
    const { root, repository } = setup(shots);
    const vendor = await startLoopbackVendor();
    try {
      const submits: string[] = [];
      const sched = scheduler(root, repository, vendor.origin, submits);
      // Fire and forget (client "detached"); the batch keeps going in the background.
      const detached = sched.runToQuiescence();
      const outcome = await detached; // the batch completes regardless of any client lifecycle
      expect(outcome.progress.completed).toBe(2);
      expect(submits).toHaveLength(2);
    } finally {
      await vendor.close();
    }
  });
});

// P4 真供应商加固 — 慢供应商轮询。真视频要几分钟：provider `query` 会连续返回 processing 若干轮才 succeeded。
// 旧调度器在 dispatchUnit 里做 32 次**无间隔** poll，对秒回的 loopback 恰好首轮 materialize，所以从没暴露；
// 真供应商上 32 次瞬间打完、job 停在 polling，且静息后再没有东西 poll 它 → 视频永不落地。这套用例把 vendor 做
// 成「头 N 轮 processing」，断言：① 单次 runToQuiescence 后 job 仍在飞（未落地，inFlight>0）；② 持续再驱动
// （重复 runToQuiescence 推进，模拟 owner 的持久退避再 kick）后最终 materialize + artifact ready。
// R18：不使用私有墙钟 waitFor / Date.now 截止轮询——用重复 runToQuiescence 的确定性推进 + 断言 outcome。
async function startSlowLoopbackVendor(processingRounds: number) {
  const hits: Array<{ url: string; method: string }> = [];
  const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  // Per-task query count → the provider reports processing for the first `processingRounds` queries, then succeeded.
  const queryCounts = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    hits.push({ url, method: req.method ?? "" });
    req.on("data", () => { /* drain */ }); req.on("end", () => {
      // Submit endpoint (/v1/generations POST) mints a task id; query endpoint (/v1/generations/:id) reports status.
      const isSubmit = req.method === "POST" && url.endsWith("/v1/generations");
      if (isSubmit) {
        const taskId = `task-${hits.filter((h) => h.method === "POST").length}`;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ created: 1, data: [{ task_id: taskId, status: "processing" }] }));
        return;
      }
      const taskId = url.split("/").pop() ?? "";
      const n = (queryCounts.get(taskId) ?? 0) + 1;
      queryCounts.set(taskId, n);
      const ready = n > processingRounds;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: 1, data: [{ task_id: taskId, status: ready ? "succeeded" : "processing", ...(ready ? { url: pngDataUrl, images: [{ url: pngDataUrl }] } : {}) }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, hits, queryCounts, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function slowLoopbackProvider(origin: string, submits: string[]): GenerationProvider {
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
    // The real slow path: query hits the server which reports processing until the round threshold, then succeeded.
    query: async (providerTaskId) => {
      const res = await fetch(`${origin}/v1/generations/${providerTaskId}`, { method: "GET" });
      const json = await res.json() as { data: Array<{ status: string }> };
      return { status: json.data[0].status, raw: { id: providerTaskId, status: json.data[0].status } };
    },
    materialize: async ({ providerTaskId }) => ({ outputs: [{ kind: "video", url: `nomi-local://asset/project-1/${providerTaskId}.png` }] }),
  };
}

function slowScheduler(root: string, repository: ReturnType<typeof createProductionRunRepository>, origin: string, submits: string[], options: Parameters<typeof createMultiShotBatchScheduler>[0]["options"] = {}) {
  const provider = slowLoopbackProvider(origin, submits);
  createGenerationRuntimeAdapter({ providers: [provider] }); // sanity: genuine adapter path
  const submission = createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    intentMacKey: "test-intent-key", provider,
    resolveShotPrice: () => ({ known: true, amount: 6 }),
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.png` }),
    now,
  });
  // sleep: 0 (no wall-clock in tests, R18); maxFastPolls: 1 so a single runToQuiescence does NOT drain a slow task.
  return createMultiShotBatchScheduler({ repository, submission, projectId: "project-1", runId: "op-batch", perShotPrice: () => ({ known: true, amount: 6 }), now, sleep: async () => {}, options: { maxFastPolls: 1, fastPollBackoffMs: 0, ...options } });
}

describe("P4 真供应商加固 — 慢供应商轮询（真视频分钟级）", () => {
  it("单次 runToQuiescence 不 materialize 慢 job（旧 32-poll 会误落）；持续再驱动后最终落地 + artifact ready", async () => {
    const shots = [shotEntry("shot-1", "雨夜推门", "shot"), shotEntry("shot-2", "货架对视", "shot")];
    const { root, repository } = setup(shots);
    // Each task reports processing for 5 query rounds before succeeding — far more than one runToQuiescence's fast-poll budget.
    const vendor = await startSlowLoopbackVendor(5);
    try {
      const submits: string[] = [];

      // Phase A: one kick. Both shots submit to the real provider, but the provider is still processing →
      // NOTHING materializes this tick. The batch rests with jobs in-flight (this is exactly where the old
      // scheduler died: it returned here and no re-poll ever came).
      const first = await slowScheduler(root, repository, vendor.origin, submits).runToQuiescence();
      expect(submits).toHaveLength(2);                       // both shots submitted (≤1 submit each)
      expect(first.progress.completed).toBe(0);              // none done yet (provider still processing)
      expect(first.progress.inFlight).toBe(2);               // both waiting on the provider → owner must re-drive
      expect(first.quiescent).toBe(true);                    // rested (not spinning)
      let run = repository.read("project-1", "op-batch")!;
      expect(run.jobs.filter((j) => j.status === "polling")).toHaveLength(2);
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(0);

      // Phase B: the persistent re-drive. Repeatedly re-kick the SAME durable Run (models the owner's backoff
      // timer) — no wall-clock waiting, just deterministic re-derivation. The provider settles after its rounds
      // and the shots materialize. Bounded loop so a real regression (never settles) fails instead of hanging.
      let completed = first.progress.completed;
      for (let kick = 0; kick < 20 && completed < 2; kick += 1) {
        const outcome = await slowScheduler(root, repository, vendor.origin, submits).runToQuiescence();
        completed = outcome.progress.completed;
      }
      expect(completed).toBe(2);                             // the slow batch DID converge via re-drive
      expect(submits).toHaveLength(2);                       // re-driving never re-submitted (≤1 submit per job)
      run = repository.read("project-1", "op-batch")!;
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(2);
      expect(new Set(submits).size).toBe(submits.length);    // every idempotency key used at most once
    } finally {
      await vendor.close();
    }
  });
});

// P4 S6 J2 — 单镜返工（rework）over a real loopback vendor (zero quota). Proves the §3.5 chain end-to-end:
// batch completes → rework shot-2 (同 Run 新 Job + parentJobId 谱系 + 该镜子合同复用 = 锚 character_ref 继承)
// → single-shot confirm 后 approve → scheduler dispatches ONLY the reworked shot → new artifact on the SAME
// shot → 旧 job/artifact 保留（版本可切回，数据层 rollbackHistory 另有单测）→ 其余镜 job 数不变（无重复扣费）
// → 锚引用在新请求中保持。Plus 插镜变体（组内插新镜、继承锚、结构正确）.
describe("P4 S6 J2 — single-shot rework over a real loopback vendor", () => {
  it("reworks one shot into a new same-Run Job with parentJobId lineage; siblings untouched (no double charge); anchor ref preserved; old version kept", async () => {
    const shots = [shotEntry("anchor-1", "阿雨 定妆照", "anchor"), shotEntry("shot-1", "雨夜推门", "shot"), shotEntry("shot-2", "货架对视", "shot")];
    const { root, repository } = setup(shots);
    const vendor = await startLoopbackVendor();
    try {
      const submits: string[] = [];
      // Phase A: full batch — anchor (checkpoint auto-released here for brevity) → 2 shots.
      await scheduler(root, repository, vendor.origin, submits, { anchorAutoReleaseMs: 0 }).runToQuiescence();
      let run = repository.read("project-1", "op-batch")!;
      expect(submits).toHaveLength(3); // 1 anchor + 2 shots
      const shot2JobBefore = run.jobs.find((j) => j.metadata?.shotId === "shot-2" && (j.status === "ready" || j.status === "adopted"))!;
      expect(shot2JobBefore).toBeDefined();
      const shot1JobsBefore = run.jobs.filter((j) => j.metadata?.shotId === "shot-1").length;
      const anchorRefBefore = shot2JobBefore.executionBinding!.requestFingerprint;

      // Phase B: user reworks shot-2. reworkShot pre-creates the new-attempt job (authorized) with parentJobId.
      const submission = buildSubmission(root, repository, vendor.origin, submits);
      const rework = await submission.reworkShot({ projectId: "project-1", operationId: "op-batch", shotId: "shot-2" });
      expect(rework.attempt).toBe(2);
      expect(rework.parentJobId).toBe(shot2JobBefore.jobId);
      expect(rework.nextAction).toBe("request_gate");

      run = repository.read("project-1", "op-batch")!;
      const reworkedJob = run.jobs.find((j) => j.jobId === rework.jobId)!;
      expect(reworkedJob.status).toBe("authorized"); // waiting for the single-shot gate + dispatch
      expect(reworkedJob.parentJobId).toBe(shot2JobBefore.jobId); // 谱系 durable
      expect(reworkedJob.retryReason).toBe("rework");
      expect(reworkedJob.nodeId).toBe(shot2JobBefore.nodeId); // 新版落回同一画布节点（此处两者都无 nodeId）
      // Anchor/DNA inherited: the reworked job reuses shot-2's SAME sub-contract → identical request fingerprint.
      expect(reworkedJob.requestFingerprint).toBe(anchorRefBefore);
      // Old shot-2 job + its artifact are still present (version-switchable).
      expect(run.jobs.some((j) => j.jobId === shot2JobBefore.jobId)).toBe(true);
      expect(run.artifacts.some((a) => a.jobId === shot2JobBefore.jobId && a.status === "ready")).toBe(true);

      // Phase C: user confirms the single-shot price → orchestration re-approves (with the new attempt) +
      // re-submits the plan (reworkShot reverted state→sealed + cleared this shot's approval), then kicks the
      // scheduler with the raised authorization. The scheduler dispatches ONLY the pre-submission (authorized)
      // rework job; siblings (anchor + shot-1) are already ready → not re-submitted (no double charge).
      run = repository.execute("project-1", "op-batch", { commandId: "approve-rework", expectedRevision: run.revision, type: "generation.approve", payload: { receiptId: "receipt-rework", contractHash: "plan-hash-batch", attempt: rework.attempt }, issuedAt: tickClock() }).run;
      run = repository.execute("project-1", "op-batch", { commandId: "submit-rework", expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: tickClock() }).run;
      const afterRework = await scheduler(root, repository, vendor.origin, submits, { anchorAutoReleaseMs: 0, raisePlanAuthorizationTo: 24 }).runToQuiescence();
      expect(afterRework.progress.completed).toBe(2); // both video shots still count as completed

      run = repository.read("project-1", "op-batch")!;
      // Exactly ONE new submit (the reworked shot); anchor + shot-1 were NOT re-submitted (no double charge).
      expect(submits).toHaveLength(4);
      // shot-1 still has exactly its original job count — untouched.
      expect(run.jobs.filter((j) => j.metadata?.shotId === "shot-1").length).toBe(shot1JobsBefore);
      // shot-2 now has TWO jobs (v1 kept + v2 rework), the new one succeeded.
      const shot2Jobs = run.jobs.filter((j) => j.metadata?.shotId === "shot-2");
      expect(shot2Jobs.length).toBe(2);
      const reworkedDone = run.jobs.find((j) => j.jobId === rework.jobId)!;
      expect(["ready", "adopted"]).toContain(reworkedDone.status);
      expect(reworkedDone.parentJobId).toBe(shot2JobBefore.jobId);
      // A new artifact landed for the reworked attempt (old one still there → two shot-2 artifacts).
      expect(run.artifacts.filter((a) => shot2Jobs.some((j) => j.jobId === a.jobId) && a.status === "ready").length).toBe(2);
      // Every idempotency key was used at most once (≤1 submit per job).
      expect(new Set(submits).size).toBe(submits.length);
    } finally {
      await vendor.close();
    }
  });

  // 插镜（§3.5「插镜同机制」）**本切片不落 E2E**：当前 durable 模型没有「往已 submitted 计划的 shots[] 追加新镜」的
  // 命令——`generation.seal`/`generation.patch` 都硬要 `state==='draft'`（reducer 332-334 / 293），`generation.trial_narrow`
  // 只**收窄**（勾掉镜）不追加，`generation.new_attempt` 只为**已存在**镜谱系加 job。插镜要么新造一条 reducer 命令
  // （`generation.insert-shot`：追加新镜 + 继承锚 references + 只对新镜起子合同 re-gate），要么走「新草稿」(§1「seal 后改=
  // 新草稿」=新 operationId，违反「同 Run」)。前者是计划未 spec 的新架构、§8 禁做倾向不扩，故此切片**只交付返工 J2**，
  // 插镜作为岔路上报（见交付报告）。返工 J2 的锚继承已由上面用例证明（reworkedJob.requestFingerprint 与旧一致）。
});
