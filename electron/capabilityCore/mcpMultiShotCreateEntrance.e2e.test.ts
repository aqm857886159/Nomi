import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationRuntimeAdapter, type GenerationProvider } from "./generationRuntimeAdapter";
import {
  createGenerationPlanningHandler,
  type GenerationOperation,
  type GenerationOperationStore,
  type StoryboardPlanResult,
} from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { createRunOwnedGenerationGateAuthority } from "./runOwnedGenerationGateAuthority";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionGenerationSubmission } from "../productionRun/productionGenerationSubmission";
import { prepareProductionGenerationAuthorization } from "../productionRun/prepareProductionGenerationAuthorization";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { createProductionRunService } from "../productionRun/productionRunService";
import { createMultiShotBatchScheduler } from "../productionRun/multiShotBatchScheduler";
import { anchorCheckpointGateId } from "../productionRun/anchorCheckpoint";

// P4 S6.5 生产入口 — end-to-end over the REAL semantic create→seal→gate→start entrance (NOT test injection
// into the reducer). This is the proof the review demanded: `nomi_operation_create` with a multi-shot
// `plan` (or `scriptText`) → durable seal with shots[] → the SAME S1-S6 downstream (gate multi-shot
// projection → anchor checkpoint → S4 scheduler → per-shot artifacts). Zero quota: a real loopback HTTP
// vendor. The §5.1 invariant is asserted: 每 Job ≤1 submit;总请求数 = 锚数 + 镜数 (the anchor is a request too).

const NOW_BASE = Date.parse("2026-08-25T00:00:00.000Z");
const roots: string[] = [];
let clock = NOW_BASE;
const now = () => new Date(clock).toISOString();

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

const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION,
  keyId: "key-1",
  algorithm: PROJECT_LEASE_ALGORITHM,
  issuer: "nomi-main",
  nonce: "nonce-1",
  scopeHash: "scope-hash-1",
  mac: "mac-1",
  projectId: "project-1",
  immutableProjectUuid: "project-uuid-1",
  projectGeneration: 1,
  canonicalRootDigest: "root-1",
  manifestDigest: "manifest-1",
  issuedAt: "2026-08-25T00:00:00.000Z",
  expiresAt: "2026-08-25T01:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE,
  leasePrincipal: "mcp:codex",
  sessionId: "session-1",
  connectionNonce: "connection-1",
  revocationEpoch: 0,
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:gate", "generation:submit", "generation:read"],
};

/** A real loopback HTTP vendor (zero quota): accepts a task, reports succeeded, returns a decodable data URL. */
async function startLoopbackVendor() {
  const hits: Array<{ url: string; method: string }> = [];
  const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url ?? "", method: req.method ?? "" });
    req.on("data", () => { /* drain */ }); req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: 1, data: [{ task_id: `task-${hits.length}`, status: "succeeded", url: pngDataUrl, images: [{ url: pngDataUrl }] }] }));
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

/** Full candidate for a `plan`-entrance shot (client supplies these — same shape single-shot create takes). */
function shotCandidate(id: string, prompt: string, role: "anchor" | "shot") {
  const modelId = role === "anchor" ? "image-model" : "video-model";
  const mode = role === "anchor" ? "text-to-image" : "image-to-video";
  return { candidateId: `cand-${id}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId, mode, prompt, parameters: {}, references: [] };
}

function harness(vendorOrigin: string, submits: string[], planStoryboard?: (input: { projectId: string; scriptText: string }) => StoryboardPlanResult) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-entrance-e2e-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (p) => (p === "project-1" ? root : null), now });
  // Minimal Run owner over the durable repository (the store needs createGenerationDraft/readFull/command).
  const owner = {
    createGenerationDraft: repository.createGenerationDraft,
    readFull: (projectId: string, operationId: string) => {
      const run = repository.read(projectId, operationId);
      if (!run) throw new Error(`Run not found: ${operationId}`);
      return run;
    },
    command: async (projectId: string, operationId: string, command: Parameters<typeof repository.execute>[2]) => repository.execute(projectId, operationId, command),
  };
  const operations = createProductionGenerationOperationStore(owner as never) as GenerationOperationStore;
  const provider = loopbackProvider(vendorOrigin, submits);
  createGenerationRuntimeAdapter({ providers: [provider] }); // sanity: the real adapter accepts this provider
  const submission = createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1,
    projectRevision: 0, intentMacKey: "test-intent-key", providers: [provider],
    materializeOutput: async ({ providerTaskId }) => ({ artifactId: `artifact-${providerTaskId}`, kind: "video", contentHash: `hash-${providerTaskId}`, projectRelativePath: `.nomi/out/${providerTaskId}.png` }),
    now,
  });
  const buildScheduler = () => createMultiShotBatchScheduler({ repository, submission, projectId: "project-1", runId: "op-entrance", perShotPrice: () => ({ known: true, amount: 6 }), now });
  // The `start` dep mirrors appIntegration's multi-shot start branch: transition sealed→submitted, then
  // kick the durable scheduler. (This is exactly the branch S6.5 fixed — without the submit, batchActive
  // stays false and the scheduler no-ops.)
  const handler = createGenerationPlanningHandler({
    registry,
    operations,
    resolveModelPricing: () => ({ cost: 6, enabled: true, specCosts: [] }),
    ...(planStoryboard ? { planStoryboard } : {}),
    now,
    prepareAuthorization: ({ lease: projectLease, operation, contract, multiShot }) => prepareProductionGenerationAuthorization({
      lease: projectLease,
      projectRevision: 0,
      operation,
      contract,
      ...(multiShot ? { multiShot } : {}),
      providers: [provider],
      resolveShotPrice: () => ({ known: true, amount: 6 }),
      now: now(),
    }),
    start: async (operation: GenerationOperation) => {
      const run = repository.read("project-1", operation.operationId)!;
      if (run.generationPlan?.state === "sealed") {
        repository.execute("project-1", operation.operationId, { commandId: `submit:${operation.operationId}`, expectedRevision: run.revision, type: "generation.submit", payload: {}, issuedAt: now() });
      }
      await buildScheduler().runToQuiescence();
      return { operationId: operation.operationId, nextAction: "observe" };
    },
  });
  let receiptSequence = 0;
  const receipts = createApprovalReceiptAuthority({
    filePath: path.join(root, "approval-receipts.json"),
    macKey: "test-receipt-key",
    storeMacKey: "test-receipt-store-key",
    keyId: "test-receipt-v1",
    now,
    randomId: () => `receipt-sequence-${++receiptSequence}`,
  });
  const generationAuthority = createRunOwnedGenerationGateAuthority({ owner: owner as never, operations, planning: handler, receipts, projectRevisionResolver: () => 0, now });
  return { root, repository, handler, buildScheduler, generationAuthority, receipts };
}

async function approveGenerationGate(
  generationAuthority: ReturnType<typeof createRunOwnedGenerationGateAuthority>,
  receipts: ReturnType<typeof createApprovalReceiptAuthority>,
  operationId: string,
  challengeToken: string,
) {
  const gesture = receipts.createMainProcessGestureAttestation(challengeToken, {
    webContentsId: 1,
    frameId: 0,
    origin: "app://nomi",
    decision: "accept",
  });
  const minted = receipts.mintReceipt(challengeToken, gesture);
  const decided = await generationAuthority.authorizeGeneration({ params: { operationId }, lease, receipt: minted.receipt });
  receipts.consumeReceipt(minted.token);
  return decided;
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); clock = NOW_BASE; });

describe("P4 S6.5 — semantic multi-shot create entrance (plan) over a real loopback vendor", () => {
  it("create({shots}) → seal(shots) → gate multi-shot projection → decide → start → anchor checkpoint → shot batch; total requests = anchors + shots", async () => {
    const vendor = await startLoopbackVendor();
    const submits: string[] = [];
    const { root, repository, handler, buildScheduler, generationAuthority, receipts } = harness(vendor.origin, submits);
    try {
      // 1. REAL create with a multi-shot plan (1 anchor + 2 video shots) — the production entrance.
      // operationId fixed to op-entrance so the harness scheduler (runId: op-entrance) drives THIS run.
      const created = await handler({ capability: "create", lease, params: { operationId: "op-entrance", shots: [
        { shotId: "anchor-1", role: "anchor", candidate: shotCandidate("anchor-1", "阿雨 定妆照", "anchor") },
        { shotId: "shot-1", role: "shot", candidate: shotCandidate("shot-1", "雨夜推门", "shot") },
        { shotId: "shot-2", role: "shot", candidate: shotCandidate("shot-2", "货架对视", "shot") },
      ] } }) as { operation: { operationId: string; shots?: unknown[] }; nextAction: string };
      const operationId = created.operation.operationId;
      expect(operationId).toBe("op-entrance");
      expect(created.nextAction).toBe("preview");
      // Draft persisted 3 shots (anchor + 2 video), no sub-contracts yet.
      expect(created.operation.shots).toHaveLength(3);

      // 2. Preview (zero provider calls) then gate_request → the REAL multi-shot gate projection.
      await handler({ capability: "preview", lease, params: { operationId } });
      const gate = await generationAuthority.requestGenerationGate({ lease, params: { operationId } }) as {
        shots?: { shots: Array<{ shotId: string; sceneOneLiner: string }>; anchorChips?: unknown[]; hardLimit: number };
        maximumCost: number; costScope: string; contractHash: string; nextAction: string;
        handoff: { challengeToken: string };
      };
      expect(gate.nextAction).toBe("confirm");
      // display.shots holds the 2 INCLUDED video shots; the anchor rides as a chip (§3.2).
      expect(gate.shots?.shots.map((s) => s.shotId).sort()).toEqual(["shot-1", "shot-2"]);
      expect(gate.shots?.anchorChips).toHaveLength(1);
      // PLAN-LEVEL receipt ceiling = sum of the 2 video shots + 1 anchor = 3 × ¥6 = ¥18.
      expect(gate.maximumCost).toBe(18);
      expect(gate.costScope).toBe(`generation.multi-shot:${operationId}`);

      // 3. Decide the gate (a verified receipt) → approve the whole batch.
      const decided = await approveGenerationGate(generationAuthority, receipts, operationId, gate.handoff.challengeToken) as { nextAction: string };
      expect(decided.nextAction).toBe("start");

      // Plan is sealed + approved; the scheduler needs 'submitted' (the S6.5 start-branch fix).
      let run = repository.read("project-1", operationId)!;
      expect(run.generationPlan?.state).toBe("sealed");
      expect(run.generationPlan?.shots).toHaveLength(3);

      // 4. START → the real start branch transitions submitted + kicks the durable scheduler.
      await handler({ capability: "start", lease, params: { operationId } });

      run = repository.read("project-1", operationId)!;
      // Anchor generated, checkpoint opened & auto-passed? No — default has no auto-release, so the batch
      // stops at the checkpoint after the anchor. Exactly 1 submit so far (the anchor image).
      expect(submits).toHaveLength(1);
      const checkpoint = run.gates.find((g) => g.gateId === anchorCheckpointGateId(operationId))!;
      expect(checkpoint.status).toBe("waiting");
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(1); // anchor
      const blockedShotJob = run.jobs.find((job) => job.metadata?.shotId === "shot-1");
      expect(blockedShotJob).toMatchObject({ status: "authorized" });
      expect(blockedShotJob?.providerTaskId).toBeUndefined();

      // 5. Approve the anchor checkpoint + manually re-kick (test mechanics for THIS file's concern = the
      // create entrance). The REAL production approval entrance (dispatcher `production.decide-gate` →
      // service post-decide hook → batchSchedulerKick 插槽 → appIntegration.kickSchedulerForRun) is covered
      // end-to-end by anchorCheckpointApproval.e2e.test.ts. The scheduler 无自有状态：从 jobs[]+ledger 纯
      // 派生「下一批」——已提交不重提，已完成不重扣. So this is a pure resume of the shot batch over the SAME Run.
      clock += 1000;
      repository.execute("project-1", operationId, { commandId: "approve-checkpoint", expectedRevision: run.revision, type: "gate.decide", payload: { gateId: checkpoint.gateId, status: "approved" }, issuedAt: now() });
      await buildScheduler().runToQuiescence();

      run = repository.read("project-1", operationId)!;
      // §5.1 invariant: total provider submissions = 1 anchor + 2 shots = 3 (NOT ≤2).
      expect(submits).toHaveLength(3);
      const shotJobs = run.jobs.filter((j) => typeof j.metadata?.shotId === "string");
      expect(shotJobs.map((j) => j.metadata!.shotId).sort()).toEqual(["anchor-1", "shot-1", "shot-2"]);
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(3); // anchor + 2 shots
      // Every idempotency key used at most once (≤1 submit per job).
      expect(new Set(submits).size).toBe(submits.length);

      // 外发面（agent 真正读到的那份）也得带得动这批的身份：镜头谱系 + 产物的项目内相对路径。
      // 少任何一格，agent 就只能按 status 数数、认不出哪个 job 是哪一镜、也找不到落地文件——S6.5 付费验收
      // 就是这么瞎的（ffprobe 腿降级、返工腿恒失败）。这里用真管道跑出来的 Run 过真投影，零花费。
      const projection = createProductionRunService({ repository, projectRootResolver: () => root })
        .readProjection("project-1", operationId);
      expect(projection.jobs.map((j) => j.metadata?.shotId).filter(Boolean).sort()).toEqual(["anchor-1", "shot-1", "shot-2"]);
      expect(projection.artifacts.filter((a) => a.projectRelativePath?.startsWith(".nomi/out/"))).toHaveLength(3);
      expect(JSON.stringify(projection)).not.toContain(root); // 相对路径出去了，项目绝对根仍不外发
    } finally {
      await vendor.close();
    }
  });

  it("rejects a plan with no video shot (only an anchor) with a human error", async () => {
    const vendor = await startLoopbackVendor();
    const { handler } = harness(vendor.origin, []);
    try {
      await expect(handler({ capability: "create", lease, params: { shots: [
        { role: "anchor", candidate: shotCandidate("anchor-1", "只有形象", "anchor") },
      ] } })).rejects.toThrow(/至少需要一个视频镜头/);
    } finally {
      await vendor.close();
    }
  });

  it("rejects duplicate shot ids with a human error", async () => {
    const vendor = await startLoopbackVendor();
    const { handler } = harness(vendor.origin, []);
    try {
      await expect(handler({ capability: "create", lease, params: { shots: [
        { shotId: "dup", role: "shot", candidate: shotCandidate("a", "镜一", "shot") },
        { shotId: "dup", role: "shot", candidate: shotCandidate("b", "镜二", "shot") },
      ] } })).rejects.toThrow(/镜头 id 重复/);
    } finally {
      await vendor.close();
    }
  });

  it("keeps single-shot create byte-identical (no shots persisted, flat gate card, single-shot cost scope)", async () => {
    const vendor = await startLoopbackVendor();
      const { handler, repository, generationAuthority } = harness(vendor.origin, []);
    try {
      const created = await handler({ capability: "create", lease, params: { candidate: shotCandidate("solo", "单镜", "shot") } }) as { operation: { operationId: string; shots?: unknown[] } };
      const operationId = created.operation.operationId;
      expect(created.operation.shots).toBeUndefined(); // single-shot draft has no shots
      expect(repository.read("project-1", operationId)!.generationPlan?.shots).toBeUndefined();
      await handler({ capability: "preview", lease, params: { operationId } });
      const gate = await generationAuthority.requestGenerationGate({ lease, params: { operationId } }) as { shots?: unknown; costScope: string; maximumCost: number };
      expect(gate.shots).toBeUndefined(); // flat single-shot card (no display.shots)
      expect(gate.costScope).toBe(`generation.single-shot:${operationId}`);
      expect(gate.maximumCost).toBe(6); // one shot's derived price
    } finally {
      await vendor.close();
    }
  });
});

describe("P4 S6.5 — scriptText create entrance (stubbed planner)", () => {
  it("maps the planner's board into draft shots (role/prompt preserved) and seals a real multi-shot gate", async () => {
    const vendor = await startLoopbackVendor();
    const submits: string[] = [];
    // A real planner picks the exact module/provider/model/mode per shot (single-provider v1 = APIMart).
    const planStoryboard = vi.fn((): StoryboardPlanResult => ({ shots: [
      { shotId: "anchor-1", role: "anchor", prompt: "阿雨 定妆照", moduleId: "generation.single-shot", providerId: "apimart", modelId: "image-model", mode: "text-to-image" },
      { shotId: "shot-1", role: "shot", prompt: "雨夜推门", moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video" },
      { shotId: "shot-2", role: "shot", prompt: "货架对视", moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video" },
    ] }));
    const { handler, generationAuthority } = harness(vendor.origin, submits, planStoryboard);
    try {
      const created = await handler({ capability: "create", lease, params: { scriptText: "雨夜便利店，两角色相遇。" } }) as {
        operation: { operationId: string; shots?: Array<{ shotId: string; role?: string; candidate: { prompt: string } }> };
      };
      expect(planStoryboard).toHaveBeenCalledTimes(1);
      const operationId = created.operation.operationId;
      // The board mapped to 3 draft shots with roles + prompts preserved.
      expect(created.operation.shots).toHaveLength(3);
      const anchor = created.operation.shots!.find((s) => s.role === "anchor")!;
      expect(anchor.candidate.prompt).toBe("阿雨 定妆照");
      const videoPrompts = created.operation.shots!.filter((s) => s.role !== "anchor").map((s) => s.candidate.prompt).sort();
      expect(videoPrompts).toEqual(["货架对视", "雨夜推门"]);

      // The scriptText draft seals a real multi-shot gate exactly like the plan entrance.
      await handler({ capability: "preview", lease, params: { operationId } });
      const gate = await generationAuthority.requestGenerationGate({ lease, params: { operationId } }) as { shots?: { shots: unknown[]; anchorChips?: unknown[] }; costScope: string };
      expect(gate.shots?.shots).toHaveLength(2); // 2 video shots
      expect(gate.shots?.anchorChips).toHaveLength(1); // 1 anchor chip
      expect(gate.costScope).toBe(`generation.multi-shot:${operationId}`);
    } finally {
      await vendor.close();
    }
  });

  it("throws a human error when scriptText is given but no planner is configured", async () => {
    const vendor = await startLoopbackVendor();
    const { handler } = harness(vendor.origin, []); // no planStoryboard
    try {
      await expect(handler({ capability: "create", lease, params: { scriptText: "一段剧本" } }))
        .rejects.toThrow(/未启用「剧本自动拟镜」/);
    } finally {
      await vendor.close();
    }
  });
});
