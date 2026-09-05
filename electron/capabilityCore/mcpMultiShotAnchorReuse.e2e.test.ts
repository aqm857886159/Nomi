import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationRuntimeAdapter, type GenerationProvider } from "./generationRuntimeAdapter";
import type { PlanAssetReference } from "./executionContract";
import {
  createGenerationPlanningHandler,
  type GenerationOperation,
  type GenerationOperationStore,
} from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { createRunOwnedGenerationGateAuthority } from "./runOwnedGenerationGateAuthority";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionGenerationSubmission } from "../productionRun/productionGenerationSubmission";
import { prepareProductionGenerationAuthorization } from "../productionRun/prepareProductionGenerationAuthorization";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { createMultiShotBatchScheduler } from "../productionRun/multiShotBatchScheduler";
import { anchorCheckpointGateId } from "../productionRun/anchorCheckpoint";

// P4 验收门 §5.1 变体 4「用已有锚开新计划」(跨集同脸) — end-to-end over the REAL semantic create entrance +
// the REAL durable scheduler (NOT test injection). The reused anchor is NOT a role:"anchor" shot (there is
// nothing to generate); it is an ALREADY-EXISTING project asset carried as a `character` reference on every
// video shot's candidate. The proof this file demands (the review's "framework supports it but there is no
// end-to-end evidence"):
//   ① seal → scheduler: total provider submissions = 视频镜数 (the reused anchor is 0 submits — no anchor job),
//   ② 每 Job ≤1 submit (idempotency keys unique), 无锚检查点 (not_required — no anchor-role shot to gate),
//   ③ 每镜子合同的 references 携带该已有资产 → 跨镜身份继承自复用锚 (asserted on shot.contract.references),
//   ④ 反向对照: 锚声明为「新生成」时 submits = 锚数 + 镜数 且停锚检查点 (existing form, one contrast assertion),
//   ⑤ 授权面: 外来/不存在的 assetId 当场拒 (对抗矩阵 #3) — 单镜与多镜同守 (P2 通用性).
// Zero quota: a real loopback HTTP vendor.

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

// The reused anchor: a定妆照 asset that ALREADY exists in this project (produced by a此前 batch). In the app
// this comes from the project asset store; here we model it as a known {assetId, contentHash, version} that
// the injected ownership guard recognizes. `role:"character"` = the face to inherit across every shot.
const REUSED_ANCHOR_ASSET: PlanAssetReference = { assetId: "asset-anchor-yu", contentHash: "hash-anchor-yu", version: 3, kind: "image", role: "character" };

/** The project's known assets (what "已有且属于本项目" means for the guard). Only this asset is resolvable. */
const PROJECT_ASSETS = new Map<string, PlanAssetReference>([[`${REUSED_ANCHOR_ASSET.assetId}:${REUSED_ANCHOR_ASSET.version}`, REUSED_ANCHOR_ASSET]]);

/** The REAL server-side guard shape the app wires: reject any reference not present in / not owned by the project. */
function assertReferencesResolvable(projectId: string, references: ReadonlyArray<PlanAssetReference>): void {
  if (projectId !== "project-1") throw new Error(`未知项目：${projectId}`);
  for (const reference of references) {
    const found = PROJECT_ASSETS.get(`${reference.assetId}:${reference.version}`);
    if (!found || found.contentHash !== reference.contentHash) {
      throw new Error(`该参考素材在本项目中不存在或不属于本项目：${reference.assetId}`);
    }
  }
}

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

/** A video shot whose candidate references the REUSED anchor asset (跨镜身份继承自复用锚). */
function reuseShotCandidate(id: string, prompt: string, references: PlanAssetReference[] = [REUSED_ANCHOR_ASSET]) {
  return { candidateId: `cand-${id}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "video-model", mode: "image-to-video", prompt, parameters: {}, references };
}

/** A shot for the "新生成锚" contrast form (anchor = a real role:"anchor" image shot that DOES generate). */
function freshShotCandidate(id: string, prompt: string, role: "anchor" | "shot") {
  const modelId = role === "anchor" ? "image-model" : "video-model";
  const mode = role === "anchor" ? "text-to-image" : "image-to-video";
  return { candidateId: `cand-${id}`, revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId, mode, prompt, parameters: {}, references: [] };
}

function harness(vendorOrigin: string, submits: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-anchor-reuse-e2e-"));
  roots.push(root);
  const repository = createProductionRunRepository({ projectDirResolver: (p) => (p === "project-1" ? root : null), now });
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
  const buildScheduler = () => createMultiShotBatchScheduler({ repository, submission, projectId: "project-1", runId: "op-reuse", perShotPrice: () => ({ known: true, amount: 6 }), now });
  const handler = createGenerationPlanningHandler({
    registry,
    operations,
    resolveModelPricing: () => ({ cost: 6, enabled: true, specCosts: [] }),
    // The ownership guard under test — wired exactly the way the app would inject it.
    assertReferencesResolvable,
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

describe("P4 §5.1.4 — 用已有锚开新计划 (跨集同脸) over a real loopback vendor", () => {
  it("reused anchor = existing asset ref on every shot → 锚 0 提交; total submits = 视频镜数; no checkpoint; each shot's sub-contract carries the reused asset", async () => {
    const vendor = await startLoopbackVendor();
    const submits: string[] = [];
    const { repository, handler, generationAuthority, receipts } = harness(vendor.origin, submits);
    try {
      // 1. Open a NEW plan whose anchor is REUSED (an existing定妆照 asset). No role:"anchor" shot — the
      // reused asset rides as a `character` reference on each of the 2 video shots (nothing to generate for it).
      const created = await handler({ capability: "create", lease, params: { operationId: "op-reuse", shots: [
        { shotId: "shot-1", role: "shot", candidate: reuseShotCandidate("shot-1", "雨夜推门") },
        { shotId: "shot-2", role: "shot", candidate: reuseShotCandidate("shot-2", "货架对视") },
      ] } }) as { operation: { operationId: string; shots?: Array<{ shotId: string; role?: string }> }; nextAction: string };
      const operationId = created.operation.operationId;
      expect(operationId).toBe("op-reuse");
      expect(created.nextAction).toBe("preview");
      // Draft persisted exactly 2 video shots — NO anchor-role shot (the reused anchor is not a generated unit).
      expect(created.operation.shots).toHaveLength(2);
      expect(created.operation.shots!.some((s) => s.role === "anchor")).toBe(false);

      // 2. Preview (zero provider calls) then gate_request → the REAL multi-shot gate projection.
      await handler({ capability: "preview", lease, params: { operationId } });
      const gate = await generationAuthority.requestGenerationGate({ lease, params: { operationId } }) as {
        shots?: { shots: Array<{ shotId: string }>; anchorChips?: unknown[] };
        maximumCost: number; costScope: string; nextAction: string;
        handoff: { challengeToken: string };
      };
      expect(gate.nextAction).toBe("confirm");
      // Both video shots are included; NO anchor chip (the anchor is reused, not a generated anchor-role shot).
      // (The per-shot character-reference proof lives at the SEALED sub-contract level below — the gate display
      // projection intentionally carries only price/duration/degradations per shot, not the raw references.)
      expect(gate.shots?.shots.map((s) => s.shotId).sort()).toEqual(["shot-1", "shot-2"]);
      expect(gate.shots?.anchorChips ?? []).toHaveLength(0);
      // PLAN-LEVEL ceiling = 2 video shots × ¥6 = ¥12 (NO anchor cost — nothing is generated for it).
      expect(gate.maximumCost).toBe(12);
      expect(gate.costScope).toBe(`generation.multi-shot:${operationId}`);

      // 3. Decide the gate → approve the whole batch.
      const decided = await approveGenerationGate(generationAuthority, receipts, operationId, gate.handoff.challengeToken) as { nextAction: string };
      expect(decided.nextAction).toBe("start");

      let run = repository.read("project-1", operationId)!;
      expect(run.generationPlan?.state).toBe("sealed");
      expect(run.generationPlan?.shots).toHaveLength(2);
      // The reused asset is frozen INTO each shot's sealed sub-contract (跨镜身份继承自复用锚).
      for (const shot of run.generationPlan!.shots!) {
        const refs = shot.contract!.references;
        expect(refs).toHaveLength(1);
        expect(refs[0]).toMatchObject({ assetId: REUSED_ANCHOR_ASSET.assetId, contentHash: REUSED_ANCHOR_ASSET.contentHash, version: REUSED_ANCHOR_ASSET.version, role: "character" });
      }
      // Both shots inherit the SAME anchor asset (same face across shots).
      const referencedAssetIds = new Set(run.generationPlan!.shots!.map((s) => s.contract!.references[0].assetId));
      expect(referencedAssetIds).toEqual(new Set([REUSED_ANCHOR_ASSET.assetId]));

      // 4. START → the real start branch transitions submitted + kicks the durable scheduler to quiescence.
      await handler({ capability: "start", lease, params: { operationId } });

      run = repository.read("project-1", operationId)!;
      // §5.1.4 invariant with a REUSED anchor: total provider submissions = 2 (视频镜数) — the anchor is 0 submits.
      expect(submits).toHaveLength(2);
      expect(new Set(submits).size).toBe(submits.length); // 每 Job ≤1 submit
      // No anchor checkpoint gate was ever opened (no anchor-role shot to gate → not_required → 直接连拍).
      expect(run.gates.some((g) => g.gateId === anchorCheckpointGateId(operationId))).toBe(false);
      // Both video shots landed a durable artifact; one job per shot, no anchor job.
      const shotJobs = run.jobs.filter((j) => typeof j.metadata?.shotId === "string");
      expect(shotJobs.map((j) => j.metadata!.shotId).sort()).toEqual(["shot-1", "shot-2"]);
      expect(run.artifacts.filter((a) => a.kind === "video" && a.status === "ready")).toHaveLength(2);
      // The reused asset is carried into the submitted request (跨镜身份继承): every dispatched job's binding
      // fingerprint was computed over a contract that included the character reference (asserted above on the
      // sub-contract; here we confirm both shots actually dispatched a job — the ref reached the provider path).
      expect(shotJobs).toHaveLength(2);
    } finally {
      await vendor.close();
    }
  });

  it("反向对照: 锚声明为『新生成』时 submits = 锚数 + 镜数 且停锚检查点 (vs 复用锚不停、少一次提交)", async () => {
    const vendor = await startLoopbackVendor();
    const submits: string[] = [];
    const { repository, handler, generationAuthority, receipts } = harness(vendor.origin, submits);
    try {
      // Same 2 video shots, but the anchor is FRESHLY GENERATED (a role:"anchor" image shot).
      const created = await handler({ capability: "create", lease, params: { operationId: "op-reuse", shots: [
        { shotId: "anchor-1", role: "anchor", candidate: freshShotCandidate("anchor-1", "阿雨 定妆照", "anchor") },
        { shotId: "shot-1", role: "shot", candidate: freshShotCandidate("shot-1", "雨夜推门", "shot") },
        { shotId: "shot-2", role: "shot", candidate: freshShotCandidate("shot-2", "货架对视", "shot") },
      ] } }) as { operation: { operationId: string } };
      const operationId = created.operation.operationId;
      await handler({ capability: "preview", lease, params: { operationId } });
      const gate = await generationAuthority.requestGenerationGate({ lease, params: { operationId } }) as { handoff: { challengeToken: string } };
      await approveGenerationGate(generationAuthority, receipts, operationId, gate.handoff.challengeToken);
      await handler({ capability: "start", lease, params: { operationId } });

      const run = repository.read("project-1", operationId)!;
      // Fresh anchor → the batch STOPS at the checkpoint after generating the anchor image only: exactly 1 submit.
      expect(submits).toHaveLength(1);
      const checkpoint = run.gates.find((g) => g.gateId === anchorCheckpointGateId(operationId))!;
      expect(checkpoint.status).toBe("waiting"); // the checkpoint exists AND blocks — the exact opposite of reuse.
      // Contrast the two forms explicitly: reuse = 0 anchor submits + no gate; fresh = 1 anchor submit + gate.
      // (Total for fresh once released = 锚数 1 + 镜数 2 = 3; the release path is covered by mcpMultiShotCreateEntrance.)
    } finally {
      await vendor.close();
    }
  });

  it("授权面: 外来/不存在的 assetId 当场拒 (多镜 create, 对抗矩阵 #3)", async () => {
    const vendor = await startLoopbackVendor();
    const { handler } = harness(vendor.origin, []);
    try {
      await expect(handler({ capability: "create", lease, params: { shots: [
        { shotId: "shot-1", role: "shot", candidate: reuseShotCandidate("shot-1", "雨夜推门", [
          { assetId: "asset-foreign-x", contentHash: "hash-foreign-x", version: 1, kind: "image", role: "character" },
        ]) },
      ] } })).rejects.toThrow(/不存在或不属于本项目/);
    } finally {
      await vendor.close();
    }
  });

  it("授权面: 复用锚的 contentHash 被篡改 (assetId 对但内容不匹配) 也拒 (归属=id+内容都要对)", async () => {
    const vendor = await startLoopbackVendor();
    const { handler } = harness(vendor.origin, []);
    try {
      await expect(handler({ capability: "create", lease, params: { shots: [
        { shotId: "shot-1", role: "shot", candidate: reuseShotCandidate("shot-1", "雨夜推门", [
          { ...REUSED_ANCHOR_ASSET, contentHash: "hash-tampered" },
        ]) },
      ] } })).rejects.toThrow(/不存在或不属于本项目/);
    } finally {
      await vendor.close();
    }
  });

  it("授权面 (单镜同守, P2 通用性): 单镜 create 引用外来 assetId 也拒", async () => {
    const vendor = await startLoopbackVendor();
    const { handler } = harness(vendor.origin, []);
    try {
      await expect(handler({ capability: "create", lease, params: { candidate: reuseShotCandidate("solo", "单镜引用外来资产", [
        { assetId: "asset-foreign-x", contentHash: "hash-foreign-x", version: 1, kind: "image", role: "character" },
      ]) } })).rejects.toThrow(/不存在或不属于本项目/);
    } finally {
      await vendor.close();
    }
  });

  it("复用锚放行不误伤: 单镜 create 引用一个真属于本项目的资产 → 正常建 (contentHash+version 都对)", async () => {
    const vendor = await startLoopbackVendor();
    const { handler, repository } = harness(vendor.origin, []);
    try {
      const created = await handler({ capability: "create", lease, params: { operationId: "op-solo-reuse", candidate: reuseShotCandidate("solo", "单镜复用锚") } }) as { operation: { operationId: string } };
      const run = repository.read("project-1", created.operation.operationId)!;
      // The reused asset survived into the single-shot draft candidate (nothing stripped it).
      expect(run.generationPlan?.candidate.references?.[0]).toMatchObject({ assetId: REUSED_ANCHOR_ASSET.assetId, role: "character" });
    } finally {
      await vendor.close();
    }
  });
});
